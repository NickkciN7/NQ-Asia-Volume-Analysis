import fs from "node:fs";
import readline from "node:readline";
import { runPostParseChecks, runSelfChecks } from "./checks.js";
import type {
  DailyAsiaBuckets,
  FiveMinBuckets,
  ParsedAsiaDataset,
  RawEveningAccumulator,
  RawSymbolBuckets,
  ThirtyMinBuckets,
  VolumeCalculators,
} from "./types.js";
import {
  createZeroFiveMinBuckets,
  FIVE_MIN_BUCKET_COUNT,
  fmtInt,
  fmtPct,
  formatIntervalLabel,
  getContractExpiryKey,
  getNextUtcDate,
  isSeasonComplete,
  mapUtcToNyBucket,
  sumBuckets,
} from "./utils.js";

// USA's time change in fall brings confusion about what time Asia session starts for trading nq futures.
// During summer etc it is 8 pm new york time that lines up with 9 am tokyo time. But in fall USA goes back 1 hour,
// So now 7 pm new york time syncs with 9 am tokyo time. Some believe it should still be 8 pm because of "ICT killzones"
// This script aims to determine what time frame actually has more volume traded on mnq.
// We shall compare 7-8 vs 8-9. And compare 7-8:30 vs 8-9:30 (as for example many trade 1.5 hours in new york).

const CSV_PATH =
  "/Users/nickd/Documents/Trading/databento/GLBX-20261124-4LBPW74B7H/glbx-mdp3-20161122-20261122.ohlcv-1m.csv";

// ============================================================================
// Entry Point
// ============================================================================

/** Entry point: runs self-checks, parses the CSV, validates invariants, and prints reports. */
async function main(): Promise<void> {
  const calcs: VolumeCalculators = {
    getAverageVolume7To8,
    getAverageVolume8To9,
    getAverageVolume7To8_30,
    getAverageVolume8To9_30,
    getAverageBucketVolumes,
    getFiveMinIntervalVolumes,
  };
  runSelfChecks(calcs);
  const dataset = await parseCsv(CSV_PATH);
  runPostParseChecks(dataset, calcs);
  compareVolumes(dataset);
  printFiveMinIntervals(dataset);
  printTenMinIntervals(dataset);
  printFifteenMinIntervals(dataset);
}

// ============================================================================
// Stage 1 — Single-Pass CSV Ingestion
// ============================================================================

/**
 * Streams the Databento OHLCV CSV file in a single pass and aggregates outright
 * MNQ volume into both 30-minute (5) and 5-minute (30) buckets per NY evening.
 */
async function parseCsv(filePath: string): Promise<ParsedAsiaDataset> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const rawByDate = new Map<string, RawEveningAccumulator>();
  let isHeader = true;
  let totalRows = 0;
  let windowOutrightRows = 0;
  let spreadRowsSkipped = 0;
  let minUtcMinute = "";
  let maxUtcMinute = "";

  for await (const line of rl) {
    if (!line) continue;
    if (isHeader) {
      isHeader = false;
      continue;
    }

    totalRows++;
    const utcMinuteKey = line.slice(0, 16);
    if (!minUtcMinute || utcMinuteKey < minUtcMinute)
      minUtcMinute = utcMinuteKey;
    if (!maxUtcMinute || utcMinuteKey > maxUtcMinute)
      maxUtcMinute = utcMinuteKey;

    const match = mapUtcToNyBucket(line);
    if (!match) continue;

    const parts = line.split(",");
    const symbol = parts[9].trim();
    if (symbol.includes("-")) {
      spreadRowsSkipped++;
      continue;
    }

    const volume = Number(parts[8]);
    if (!Number.isFinite(volume) || volume <= 0) continue;

    windowOutrightRows++;

    let dayAcc = rawByDate.get(match.nyDate);
    if (!dayAcc) {
      dayAcc = {
        regime: match.regime,
        season: match.season,
        bySymbol: new Map<string, RawSymbolBuckets>(),
      };
      rawByDate.set(match.nyDate, dayAcc);
    }

    let symBuckets = dayAcc.bySymbol.get(symbol);
    if (!symBuckets) {
      symBuckets = {
        thirtyMin: [0, 0, 0, 0, 0],
        fiveMin: createZeroFiveMinBuckets(),
      };
      dayAcc.bySymbol.set(symbol, symBuckets);
    }
    symBuckets.thirtyMin[match.bucketIndex] += volume;
    symBuckets.fiveMin[match.fiveMinIndex] += volume;
  }

  const sortedDates = Array.from(rawByDate.keys()).sort();
  const frontMonthDays: DailyAsiaBuckets[] = [];
  const allOutrightDays: DailyAsiaBuckets[] = [];
  const truncatedEdgeDays: string[] = [];
  const zeroBucketDays: DailyAsiaBuckets[] = [];

  let lastFrontExpiryKey = -1;

  for (const nyDate of sortedDates) {
    const dayAcc = rawByDate.get(nyDate)!;
    const nextDate = getNextUtcDate(nyDate);

    // Guard against truncated file-edge evenings
    const windowStartUtc =
      dayAcc.regime === "EST" ? `${nextDate}T00:00` : `${nyDate}T23:00`;
    const windowEndUtc =
      dayAcc.regime === "EST" ? `${nextDate}T02:29` : `${nextDate}T01:29`;
    if (minUtcMinute > windowStartUtc || maxUtcMinute < windowEndUtc) {
      truncatedEdgeDays.push(nyDate);
      continue;
    }

    const nyYear = Number(nyDate.slice(0, 4));
    const allBuckets: ThirtyMinBuckets = [0, 0, 0, 0, 0];
    const allFiveMinBuckets: FiveMinBuckets = createZeroFiveMinBuckets();

    let bestSymbol = "";
    let bestBuckets: RawSymbolBuckets | null = null;
    let bestTotal = -1;
    let bestExpiryKey = -1;

    // First sum all outright contracts and find best monotonic front-month candidate
    for (const [symbol, symBuckets] of dayAcc.bySymbol) {
      for (let i = 0; i < 5; i++) {
        allBuckets[i] += symBuckets.thirtyMin[i];
      }
      for (let i = 0; i < FIVE_MIN_BUCKET_COUNT; i++) {
        allFiveMinBuckets[i] += symBuckets.fiveMin[i];
      }

      const expiryKey = getContractExpiryKey(symbol, nyYear);
      if (expiryKey < lastFrontExpiryKey) continue;

      const total = sumBuckets(symBuckets.thirtyMin);
      if (
        total > bestTotal ||
        (total === bestTotal && expiryKey > bestExpiryKey)
      ) {
        bestTotal = total;
        bestSymbol = symbol;
        bestBuckets = symBuckets;
        bestExpiryKey = expiryKey;
      }
    }

    // Defensive fallback if no candidate met monotonic threshold
    if (!bestBuckets) {
      for (const [symbol, symBuckets] of dayAcc.bySymbol) {
        const total = sumBuckets(symBuckets.thirtyMin);
        const expiryKey = getContractExpiryKey(symbol, nyYear);
        if (total > bestTotal) {
          bestTotal = total;
          bestSymbol = symbol;
          bestBuckets = symBuckets;
          bestExpiryKey = expiryKey;
        }
      }
    }

    if (!bestBuckets || bestTotal <= 0) continue;
    lastFrontExpiryKey = Math.max(lastFrontExpiryKey, bestExpiryKey);

    const frontRecord: DailyAsiaBuckets = {
      nyDate,
      regime: dayAcc.regime,
      season: dayAcc.season,
      symbol: bestSymbol,
      buckets: [
        bestBuckets.thirtyMin[0],
        bestBuckets.thirtyMin[1],
        bestBuckets.thirtyMin[2],
        bestBuckets.thirtyMin[3],
        bestBuckets.thirtyMin[4],
      ],
      fiveMinBuckets: [...bestBuckets.fiveMin],
    };

    // Guard against partial-outage evenings strictly on the 30-min buckets (not 5-min)
    if (frontRecord.buckets.some((v) => v === 0)) {
      zeroBucketDays.push(frontRecord);
      continue;
    }

    frontMonthDays.push(frontRecord);
    allOutrightDays.push({
      nyDate,
      regime: dayAcc.regime,
      season: dayAcc.season,
      symbol: "ALL_OUTRIGHTS",
      buckets: allBuckets,
      fiveMinBuckets: allFiveMinBuckets,
    });
  }

  return {
    frontMonthDays,
    allOutrightDays,
    stats: {
      totalRows,
      windowOutrightRows,
      spreadRowsSkipped,
      minUtcMinute,
      maxUtcMinute,
      truncatedEdgeDays,
      zeroBucketDays,
    },
  };
}

// ============================================================================
// Stage 2 — Comparison Report & 30-Minute Window Calculations
// ============================================================================

/** Prints the complete EST, per-season, rollover cross-check, and EDT control report. */
function compareVolumes(dataset: ParsedAsiaDataset): void {
  const { frontMonthDays, allOutrightDays, stats } = dataset;

  const estFrontAll = frontMonthDays.filter((d) => d.regime === "EST");
  const estFrontComplete = estFrontAll.filter((d) =>
    isSeasonComplete(d.season, "EST", stats.minUtcMinute, stats.maxUtcMinute),
  );
  const estOutrightsAll = allOutrightDays.filter((d) => d.regime === "EST");
  const estOutrightsComplete = estOutrightsAll.filter((d) =>
    isSeasonComplete(d.season, "EST", stats.minUtcMinute, stats.maxUtcMinute),
  );

  const edtFrontAll = frontMonthDays.filter((d) => d.regime === "EDT");
  const edtFrontComplete = edtFrontAll.filter((d) =>
    isSeasonComplete(d.season, "EDT", stats.minUtcMinute, stats.maxUtcMinute),
  );

  const totalEstFrontVol = estFrontAll.reduce(
    (acc, d) => acc + sumBuckets(d.buckets),
    0,
  );
  const totalEstAllOutrightVol = estOutrightsAll.reduce(
    (acc, d) => acc + sumBuckets(d.buckets),
    0,
  );
  const frontSharePct =
    totalEstAllOutrightVol > 0
      ? (totalEstFrontVol / totalEstAllOutrightVol) * 100
      : 0;

  console.log(
    "==========================================================================",
  );
  console.log(
    "MNQ ASIA SESSION VOLUME ANALYSIS (7:00-9:30 PM AMERICA/NEW_YORK)",
  );
  console.log(
    "==========================================================================",
  );
  console.log("1. DATASET SUMMARY");
  console.log(
    `  UTC Range              : ${stats.minUtcMinute}Z -> ${stats.maxUtcMinute}Z`,
  );
  console.log(
    `  Total CSV Rows Scanned : ${stats.totalRows.toLocaleString("en-US")}`,
  );
  console.log(
    `  Outright Rows in Window: ${stats.windowOutrightRows.toLocaleString("en-US")}`,
  );
  console.log(
    `  Calendar Spreads Skipped: ${stats.spreadRowsSkipped.toLocaleString("en-US")}`,
  );
  console.log(
    `  Clean Active Evenings  : ${frontMonthDays.length} total (${estFrontAll.length} EST, ${edtFrontAll.length} EDT)`,
  );
  console.log(
    `  Truncated Edge Days    : ${stats.truncatedEdgeDays.length === 0 ? "None" : stats.truncatedEdgeDays.join(", ")}`,
  );
  console.log(
    `  Zero-Bucket Outage Days: ${
      stats.zeroBucketDays.length === 0
        ? "None"
        : stats.zeroBucketDays
            .map(
              (d) =>
                `${d.nyDate} (${d.regime}, ${d.symbol}: [${d.buckets.join(", ")}])`,
            )
            .join("; ")
    }`,
  );
  console.log(
    `  EST Front-Month Share  : ${frontSharePct.toFixed(2)}% of total EST outright volume`,
  );

  console.log(
    "\n==========================================================================",
  );
  console.log(
    "2. PRIMARY RESULTS — EST (FALL/WINTER: 7:00 PM NY = 9:00 AM TOKYO)",
  );
  console.log(
    "==========================================================================",
  );

  printComparisonBlock(
    "EST Front-Month Proxy — Complete Seasons Only",
    estFrontComplete,
  );
  printComparisonBlock(
    "EST Front-Month Proxy — All EST Days (incl. partial seasons)",
    estFrontAll,
  );
  printComparisonBlock(
    "EST All-Outrights Cross-Check — Complete Seasons Only",
    estOutrightsComplete,
  );

  // Per-season breakdown
  const estSeasonMap = new Map<string, DailyAsiaBuckets[]>();
  for (const d of estFrontAll) {
    let arr = estSeasonMap.get(d.season);
    if (!arr) {
      arr = [];
      estSeasonMap.set(d.season, arr);
    }
    arr.push(d);
  }

  console.log("\nPer-Season EST Breakdown (Front-Month Proxy):");
  console.log(
    "  Season     | Status   | Days |   Avg 7-8 |   Avg 8-9 | Win (1h) |  Diff % | Avg 7-8:30 | Avg 8-9:30 | Win (1.5h) |  Diff %",
  );
  console.log(
    "  -----------+----------+------+-----------+-----------+----------+---------+------------+------------+------------+--------",
  );

  let completeSeasonsCount = 0;
  let wins7_8Complete = 0;
  let wins7_830Complete = 0;

  for (const season of Array.from(estSeasonMap.keys()).sort()) {
    const sDays = estSeasonMap.get(season)!;
    const complete = isSeasonComplete(
      season,
      "EST",
      stats.minUtcMinute,
      stats.maxUtcMinute,
    );
    const a7_8 = getAverageVolume7To8(sDays);
    const a8_9 = getAverageVolume8To9(sDays);
    const a7_830 = getAverageVolume7To8_30(sDays);
    const a8_930 = getAverageVolume8To9_30(sDays);

    const p1 = a8_9 > 0 ? ((a7_8 - a8_9) / a8_9) * 100 : 0;
    const p15 = a8_930 > 0 ? ((a7_830 - a8_930) / a8_930) * 100 : 0;
    const w1 = a7_8 >= a8_9 ? "7-8" : "8-9";
    const w15 = a7_830 >= a8_930 ? "7-8:30" : "8-9:30";

    if (complete) {
      completeSeasonsCount++;
      if (a7_8 >= a8_9) wins7_8Complete++;
      if (a7_830 >= a8_930) wins7_830Complete++;
    }

    console.log(
      `  ${season.padEnd(10)} | ${(complete ? "Complete" : "PARTIAL").padEnd(8)} | ${String(sDays.length).padStart(4)} | ${fmtInt(a7_8).padStart(9)} | ${fmtInt(a8_9).padStart(9)} | ${w1.padEnd(8)} | ${fmtPct(p1).padStart(7)} | ${fmtInt(a7_830).padStart(10)} | ${fmtInt(a8_930).padStart(10)} | ${w15.padEnd(10)} | ${fmtPct(p15).padStart(7)}`,
    );
  }

  console.log(
    `\n  Season Consistency (Complete EST Seasons): 7-8 won ${wins7_8Complete}/${completeSeasonsCount} | 7-8:30 won ${wins7_830Complete}/${completeSeasonsCount}`,
  );

  printBucketProfile(
    "EST 30-Minute Bucket Profile (Front-Month Proxy, Complete Seasons)",
    estFrontComplete,
  );

  console.log(
    "\n==========================================================================",
  );
  console.log(
    "3. CONTROL GROUP — EDT (SPRING/SUMMER: 8:00 PM NY = 9:00 AM TOKYO)",
  );
  console.log(
    "==========================================================================",
  );

  printComparisonBlock(
    "EDT Front-Month Proxy — Complete Seasons Only",
    edtFrontComplete,
  );
  printBucketProfile(
    "EDT 30-Minute Bucket Profile (Front-Month Proxy, Complete Seasons)",
    edtFrontComplete,
  );
}

/** Prints 1h (7-8 vs 8-9) and 1.5h (7-8:30 vs 8-9:30) volume comparisons for a subset. */
function printComparisonBlock(title: string, days: DailyAsiaBuckets[]): void {
  const avg7_8 = getAverageVolume7To8(days);
  const avg8_9 = getAverageVolume8To9(days);
  const avg7_830 = getAverageVolume7To8_30(days);
  const avg8_930 = getAverageVolume8To9_30(days);

  const diff1h = avg7_8 - avg8_9;
  const pct1h = avg8_9 > 0 ? (diff1h / avg8_9) * 100 : 0;
  const winner1h = avg7_8 >= avg8_9 ? "7:00-8:00" : "8:00-9:00";

  const diff15h = avg7_830 - avg8_930;
  const pct15h = avg8_930 > 0 ? (diff15h / avg8_930) * 100 : 0;
  const winner15h = avg7_830 >= avg8_930 ? "7:00-8:30" : "8:00-9:30";

  console.log(`\n${title} (N = ${days.length} evenings)`);
  console.log(
    `  1.0h | 7:00-8:00: ${fmtInt(avg7_8).padStart(8)} vs 8:00-9:00: ${fmtInt(avg8_9).padStart(8)} | Winner: ${winner1h} (${fmtInt(Math.abs(diff1h))}, ${fmtPct(pct1h)} vs 8-9)`,
  );
  console.log(
    `  1.5h | 7:00-8:30: ${fmtInt(avg7_830).padStart(8)} vs 8:00-9:30: ${fmtInt(avg8_930).padStart(8)} | Winner: ${winner15h} (${fmtInt(Math.abs(diff15h))}, ${fmtPct(pct15h)} vs 8-9:30)`,
  );
}

/** Computes average evening volume for 7:00-8:00 PM ET. */
function getAverageVolume7To8(days: DailyAsiaBuckets[]): number {
  if (days.length === 0) return 0;
  let total = 0;
  for (const d of days) {
    total += d.buckets[0] + d.buckets[1];
  }
  return total / days.length;
}

/** Computes average evening volume for 8:00-9:00 PM ET. */
function getAverageVolume8To9(days: DailyAsiaBuckets[]): number {
  if (days.length === 0) return 0;
  let total = 0;
  for (const d of days) {
    total += d.buckets[2] + d.buckets[3];
  }
  return total / days.length;
}

/** Computes average evening volume for 7:00-8:30 PM ET. */
function getAverageVolume7To8_30(days: DailyAsiaBuckets[]): number {
  if (days.length === 0) return 0;
  let total = 0;
  for (const d of days) {
    total += d.buckets[0] + d.buckets[1] + d.buckets[2];
  }
  return total / days.length;
}

/** Computes average evening volume for 8:00-9:30 PM ET. */
function getAverageVolume8To9_30(days: DailyAsiaBuckets[]): number {
  if (days.length === 0) return 0;
  let total = 0;
  for (const d of days) {
    total += d.buckets[2] + d.buckets[3] + d.buckets[4];
  }
  return total / days.length;
}

/** Prints an ASCII bar chart of average volume across all five 30-minute ET buckets. */
function printBucketProfile(title: string, days: DailyAsiaBuckets[]): void {
  const avgs = getAverageBucketVolumes(days);
  const labels = [
    "7:00-7:30 PM",
    "7:30-8:00 PM",
    "8:00-8:30 PM",
    "8:30-9:00 PM",
    "9:00-9:30 PM",
  ];
  const maxVal = Math.max(...avgs, 1);

  console.log(`\n${title} (N = ${days.length} evenings)`);
  for (let i = 0; i < 5; i++) {
    const barLen = Math.round((avgs[i] / maxVal) * 30);
    const bar = "#".repeat(barLen);
    console.log(`  ${labels[i]} : ${fmtInt(avgs[i]).padStart(8)}  ${bar}`);
  }
}

/** Computes the mean volume for each of the five 30-minute ET buckets across days. */
function getAverageBucketVolumes(days: DailyAsiaBuckets[]): ThirtyMinBuckets {
  if (days.length === 0) return [0, 0, 0, 0, 0];
  const sums: ThirtyMinBuckets = [0, 0, 0, 0, 0];
  for (const d of days) {
    for (let i = 0; i < 5; i++) {
      sums[i] += d.buckets[i];
    }
  }
  return [
    sums[0] / days.length,
    sums[1] / days.length,
    sums[2] / days.length,
    sums[3] / days.length,
    sums[4] / days.length,
  ];
}

// ============================================================================
// Stage 3 — 5-, 10-, and 15-Minute Interval Volume Tables (7:00-9:30 PM ET)
// ============================================================================

/** Prints a side-by-side table of average 5-minute interval volume for complete EST and EDT seasons. */
function printFiveMinIntervals(dataset: ParsedAsiaDataset): void {
  printIntervalTable(4, 5, dataset, getFiveMinIntervalVolumes);
}

/** Computes the mean volume for each of the 30 five-minute intervals (7:00-9:30 PM ET) across days. */
function getFiveMinIntervalVolumes(days: DailyAsiaBuckets[]): FiveMinBuckets {
  if (days.length === 0) return createZeroFiveMinBuckets();
  const sums = createZeroFiveMinBuckets();
  for (const d of days) {
    for (let i = 0; i < FIVE_MIN_BUCKET_COUNT; i++) {
      sums[i] += d.fiveMinBuckets[i];
    }
  }
  return sums.map((s) => s / days.length);
}

/** Prints a side-by-side table of average 10-minute interval volume for complete EST and EDT seasons. */
function printTenMinIntervals(dataset: ParsedAsiaDataset): void {
  printIntervalTable(5, 10, dataset, getTenMinIntervalVolumes);
}

/** Computes the mean volume for each of the 15 ten-minute intervals (7:00-9:30 PM ET) across days. */
function getTenMinIntervalVolumes(days: DailyAsiaBuckets[]): number[] {
  const fiveMin = getFiveMinIntervalVolumes(days);
  const result: number[] = [];
  for (let i = 0; i < FIVE_MIN_BUCKET_COUNT; i += 2) {
    result.push(fiveMin[i] + fiveMin[i + 1]);
  }
  return result;
}

/** Prints a side-by-side table of average 15-minute interval volume for complete EST and EDT seasons. */
function printFifteenMinIntervals(dataset: ParsedAsiaDataset): void {
  printIntervalTable(6, 15, dataset, getFifteenMinIntervalVolumes);
}

/** Computes the mean volume for each of the 10 fifteen-minute intervals (7:00-9:30 PM ET) across days. */
function getFifteenMinIntervalVolumes(days: DailyAsiaBuckets[]): number[] {
  const fiveMin = getFiveMinIntervalVolumes(days);
  const result: number[] = [];
  for (let i = 0; i < FIVE_MIN_BUCKET_COUNT; i += 3) {
    result.push(fiveMin[i] + fiveMin[i + 1] + fiveMin[i + 2]);
  }
  return result;
}

/** Prints a formatted EST/EDT side-by-side table for any interval size dividing 30 minutes (5, 10, 15). */
function printIntervalTable(
  sectionNum: number,
  intervalMinutes: number,
  dataset: ParsedAsiaDataset,
  getIntervalVolumes: (days: DailyAsiaBuckets[]) => number[],
): void {
  const { frontMonthDays, stats } = dataset;

  const estComplete = frontMonthDays.filter(
    (d) =>
      d.regime === "EST" &&
      isSeasonComplete(d.season, "EST", stats.minUtcMinute, stats.maxUtcMinute),
  );
  const edtComplete = frontMonthDays.filter(
    (d) =>
      d.regime === "EDT" &&
      isSeasonComplete(d.season, "EDT", stats.minUtcMinute, stats.maxUtcMinute),
  );

  const estAvgs = getIntervalVolumes(estComplete);
  const edtAvgs = getIntervalVolumes(edtComplete);
  const rowsPerHalfHour = 30 / intervalMinutes;

  const estHeader = `EST Avg Vol (N=${estComplete.length})`;
  const edtHeader = `EDT Avg Vol (N=${edtComplete.length})`;
  const divider = `  ----------------+${"-".repeat(estHeader.length + 2)}+${"-".repeat(edtHeader.length + 2)}`;

  console.log(
    "\n==========================================================================",
  );
  console.log(
    `${sectionNum}. ${intervalMinutes}-MINUTE INTERVAL VOLUME (7:00-9:30 PM ET, FRONT-MONTH COMPLETE SEASONS)`,
  );
  console.log(
    "==========================================================================",
  );
  console.log(`  ${"Interval (ET)".padEnd(15)} | ${estHeader} | ${edtHeader}`);
  console.log(divider);

  for (let i = 0; i < estAvgs.length; i++) {
    const label = formatIntervalLabel(i, intervalMinutes).padEnd(15);
    const estVal = fmtInt(estAvgs[i]).padStart(estHeader.length);
    const edtVal = fmtInt(edtAvgs[i]).padStart(edtHeader.length);
    console.log(`  ${label} | ${estVal} | ${edtVal}`);

    if ((i + 1) % rowsPerHalfHour === 0 && i < estAvgs.length - 1) {
      console.log(divider);
    }
  }
}

// ============================================================================
// Execution Trigger
// ============================================================================

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
