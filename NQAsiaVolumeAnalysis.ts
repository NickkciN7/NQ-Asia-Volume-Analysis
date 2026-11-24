import assert from "node:assert/strict";
import fs from "node:fs";
import readline from "node:readline";

// USA's time change in fall brings confusion about what time Asia session starts for trading nq futures.
// During summer etc it is 8 pm new york time that lines up with 9 am tokyo time. But in fall USA goes back 1 hour,
// So now 7 pm new york time syncs with 9 am tokyo time. Some believe it should still be 8 pm because of "ICT killzones"
// This script aims to determine what time frame actually has more volume traded on mnq.
// We shall compare 7-8 vs 8-9. And compare 7-8:30 vs 8-9:30 (as for example many trade 1.5 hours in new york).

const CSV_PATH =
  "/Users/nickd/Documents/Trading/databento/GLBX-20261124-4LBPW74B7H/glbx-mdp3-20161122-20261122.ohlcv-1m.csv";

type TimeRegime = "EST" | "EDT";

/** [19:00-19:30, 19:30-20:00, 20:00-20:30, 20:30-21:00, 21:00-21:30] in America/New_York */
type ThirtyMinBuckets = [number, number, number, number, number];

interface NyBucketMatch {
  nyDate: string; // "YYYY-MM-DD" in America/New_York
  regime: TimeRegime; // "EST" or "EDT"
  season: string; // e.g. "2019-2020" for EST, "2020" for EDT
  bucketIndex: number; // 0 | 1 | 2 | 3 | 4
}

interface DailyAsiaBuckets {
  nyDate: string; // "YYYY-MM-DD" in America/New_York
  regime: TimeRegime; // "EST" (fall/winter) or "EDT" (spring/summer)
  season: string; // e.g. "2019-2020" for EST, "2020" for EDT
  symbol: string; // e.g. "MNQZ6" for frontMonthDays, or "ALL_OUTRIGHTS" for allOutrightDays
  buckets: ThirtyMinBuckets;
}

interface ParseStats {
  totalRows: number;
  windowOutrightRows: number;
  spreadRowsSkipped: number;
  minUtcMinute: string; // "YYYY-MM-DDTHH:MM"
  maxUtcMinute: string; // "YYYY-MM-DDTHH:MM"
  truncatedEdgeDays: string[];
  zeroBucketDays: DailyAsiaBuckets[];
}

interface ParsedAsiaDataset {
  frontMonthDays: DailyAsiaBuckets[]; // Primary: monotonic volume-selected front-month proxy
  allOutrightDays: DailyAsiaBuckets[]; // Cross-check: sum of all outright quarterly contracts
  stats: ParseStats;
}

// ============================================================================
// DST, Date, Contract & Bucket Helpers
// ============================================================================

const dstDaysCache = new Map<number, { springDay: number; fallDay: number }>();
const prevUtcDateCache = new Map<string, string>();
const nextUtcDateCache = new Map<string, string>();

/** Returns the day-of-month (1-31) for the nth Sunday in a given month. */
function getNthSundayOfMonth(year: number, month1Based: number, n: number): number {
  const firstDayOfWeek = new Date(Date.UTC(year, month1Based - 1, 1)).getUTCDay(); // 0 = Sun
  const firstSunday = 1 + ((7 - firstDayOfWeek) % 7);
  return firstSunday + (n - 1) * 7;
}

/** Returns cached March spring-forward and November fall-back days for a year. */
function getDstTransitionDays(year: number): { springDay: number; fallDay: number } {
  let cached = dstDaysCache.get(year);
  if (!cached) {
    cached = {
      springDay: getNthSundayOfMonth(year, 3, 2), // 2nd Sunday of March
      fallDay: getNthSundayOfMonth(year, 11, 1), // 1st Sunday of November
    };
    dstDaysCache.set(year, cached);
  }
  return cached;
}

/** Reports whether a UTC date and hour fall inside US Eastern Daylight Time (EDT). */
function isUsEasternDstUtc(year: number, month: number, day: number, utcHour: number): boolean {
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;

  const { springDay, fallDay } = getDstTransitionDays(year);
  if (month === 3) {
    // Spring forward: 02:00 EST -> 03:00 EDT at 07:00 UTC
    return day > springDay || (day === springDay && utcHour >= 7);
  }
  // month === 11: Fall back: 02:00 EDT -> 01:00 EST at 06:00 UTC
  return day < fallDay || (day === fallDay && utcHour < 6);
}

/** Shifts a "YYYY-MM-DD" UTC date string by -1 or +1 day. */
function shiftUtcDate(utcDateStr: string, deltaDays: -1 | 1): string {
  const year = Number(utcDateStr.slice(0, 4));
  const month = Number(utcDateStr.slice(5, 7));
  const day = Number(utcDateStr.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day + deltaDays)).toISOString().slice(0, 10);
}

/** Returns the cached previous UTC calendar date for a "YYYY-MM-DD" string. */
function getPreviousUtcDate(utcDateStr: string): string {
  let cached = prevUtcDateCache.get(utcDateStr);
  if (!cached) {
    cached = shiftUtcDate(utcDateStr, -1);
    prevUtcDateCache.set(utcDateStr, cached);
  }
  return cached;
}

/** Returns the cached next UTC calendar date for a "YYYY-MM-DD" string. */
function getNextUtcDate(utcDateStr: string): string {
  let cached = nextUtcDateCache.get(utcDateStr);
  if (!cached) {
    cached = shiftUtcDate(utcDateStr, 1);
    nextUtcDateCache.set(utcDateStr, cached);
  }
  return cached;
}

/** Formats numeric year, month, and day values as "YYYY-MM-DD". */
function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Returns the seasonal grouping key ("YYYY-YYYY" for EST winter, "YYYY" for EDT). */
function getSeasonLabel(nyDate: string, regime: TimeRegime): string {
  const nyYear = Number(nyDate.slice(0, 4));
  if (regime === "EDT") {
    return String(nyYear);
  }
  const nyMonth = Number(nyDate.slice(5, 7));
  return nyMonth >= 11 ? `${nyYear}-${nyYear + 1}` : `${nyYear - 1}-${nyYear}`;
}

/**
 * Resolves a single-digit CME quarterly contract symbol (e.g. "MNQZ9", "MNQH0")
 * into a sortable YYYYMM expiry key using the current nyYear.
 */
function getContractExpiryKey(symbol: string, nyYear: number): number {
  const monthCode = symbol[symbol.length - 2];
  const yearDigit = Number(symbol[symbol.length - 1]);
  let monthNum: number;
  switch (monthCode) {
    case "H":
      monthNum = 3;
      break;
    case "M":
      monthNum = 6;
      break;
    case "U":
      monthNum = 9;
      break;
    case "Z":
      monthNum = 12;
      break;
    default:
      throw new Error(`Unexpected CME quarterly month code in symbol: ${symbol}`);
  }
  const decadeBase = Math.floor(nyYear / 10) * 10;
  let fullYear = decadeBase + yearDigit;
  if (fullYear < nyYear - 1) fullYear += 10;
  else if (fullYear > nyYear + 8) fullYear -= 10;
  return fullYear * 100 + monthNum;
}

/**
 * Maps an ISO-8601 UTC timestamp (or CSV line starting with ts_event) to its
 * America/New_York 30-minute bucket in [19:00, 21:30), or null if outside window.
 */
function mapUtcToNyBucket(tsEvent: string): NyBucketMatch | null {
  const utcHourStr = tsEvent.slice(11, 13);
  if (
    utcHourStr !== "23" &&
    utcHourStr !== "00" &&
    utcHourStr !== "01" &&
    utcHourStr !== "02"
  ) {
    return null;
  }

  const utcHour = Number(utcHourStr);
  const utcMinute = Number(tsEvent.slice(14, 16));
  if (utcHour === 2 && utcMinute >= 30) {
    return null;
  }

  const utcDateStr = tsEvent.slice(0, 10);
  const utcYear = Number(tsEvent.slice(0, 4));
  const utcMonth = Number(tsEvent.slice(5, 7));
  const utcDay = Number(tsEvent.slice(8, 10));

  const isDst = isUsEasternDstUtc(utcYear, utcMonth, utcDay, utcHour);
  const regime: TimeRegime = isDst ? "EDT" : "EST";
  const offsetHours = isDst ? -4 : -5;

  let nyHour = utcHour + offsetHours;
  let nyDate: string;
  if (nyHour < 0) {
    nyHour += 24;
    nyDate = getPreviousUtcDate(utcDateStr);
  } else {
    nyDate = utcDateStr;
  }

  // Exact half-open window [19:00, 21:30) ET -> inclusive minutes 19:00..21:29
  if (nyHour < 19 || nyHour > 21 || (nyHour === 21 && utcMinute >= 30)) {
    return null;
  }

  const bucketIndex = (nyHour - 19) * 2 + (utcMinute >= 30 ? 1 : 0);
  const season = getSeasonLabel(nyDate, regime);
  return { nyDate, regime, season, bucketIndex };
}

/** Checks whether the CSV time span covers an entire EST or EDT season. */
function isSeasonComplete(
  season: string,
  regime: TimeRegime,
  minUtcMinute: string,
  maxUtcMinute: string
): boolean {
  if (regime === "EST") {
    const [startYearStr, endYearStr] = season.split("-");
    const startYear = Number(startYearStr);
    const endYear = Number(endYearStr);
    const fallDay = getDstTransitionDays(startYear).fallDay;
    const springDay = getDstTransitionDays(endYear).springDay;
    const seasonStartUtc = `${formatDate(startYear, 11, fallDay)}T06:00`;
    const seasonEndUtc = `${formatDate(endYear, 3, springDay)}T02:29`;
    return minUtcMinute <= seasonStartUtc && maxUtcMinute >= seasonEndUtc;
  }

  const year = Number(season);
  const { springDay, fallDay } = getDstTransitionDays(year);
  const seasonStartUtc = `${formatDate(year, 3, springDay)}T23:00`;
  const seasonEndUtc = `${formatDate(year, 11, fallDay)}T01:29`;
  return minUtcMinute <= seasonStartUtc && maxUtcMinute >= seasonEndUtc;
}

// ============================================================================
// Single-Pass CSV Parser
// ============================================================================

interface RawEveningAccumulator {
  regime: TimeRegime;
  season: string;
  bySymbol: Map<string, ThirtyMinBuckets>;
}

/** Returns the total volume across all five 30-minute buckets for one evening. */
function sumBuckets(buckets: ThirtyMinBuckets): number {
  return buckets[0] + buckets[1] + buckets[2] + buckets[3] + buckets[4];
}

/**
 * Streams the Databento OHLCV CSV file in a single pass and aggregates outright
 * MNQ volume into 5 thirty-minute buckets per NY trading evening.
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
    if (!minUtcMinute || utcMinuteKey < minUtcMinute) minUtcMinute = utcMinuteKey;
    if (!maxUtcMinute || utcMinuteKey > maxUtcMinute) maxUtcMinute = utcMinuteKey;

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
        bySymbol: new Map<string, ThirtyMinBuckets>(),
      };
      rawByDate.set(match.nyDate, dayAcc);
    }

    let symBuckets = dayAcc.bySymbol.get(symbol);
    if (!symBuckets) {
      symBuckets = [0, 0, 0, 0, 0];
      dayAcc.bySymbol.set(symbol, symBuckets);
    }
    symBuckets[match.bucketIndex] += volume;
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

    let bestSymbol = "";
    let bestBuckets: ThirtyMinBuckets | null = null;
    let bestTotal = -1;
    let bestExpiryKey = -1;

    // First sum all outright contracts and find best monotonic front-month candidate
    for (const [symbol, buckets] of dayAcc.bySymbol) {
      for (let i = 0; i < 5; i++) {
        allBuckets[i] += buckets[i];
      }
      const expiryKey = getContractExpiryKey(symbol, nyYear);
      if (expiryKey < lastFrontExpiryKey) continue;

      const total = sumBuckets(buckets);
      if (total > bestTotal || (total === bestTotal && expiryKey > bestExpiryKey)) {
        bestTotal = total;
        bestSymbol = symbol;
        bestBuckets = buckets;
        bestExpiryKey = expiryKey;
      }
    }

    // Defensive fallback if no candidate met monotonic threshold
    if (!bestBuckets) {
      for (const [symbol, buckets] of dayAcc.bySymbol) {
        const total = sumBuckets(buckets);
        const expiryKey = getContractExpiryKey(symbol, nyYear);
        if (total > bestTotal) {
          bestTotal = total;
          bestSymbol = symbol;
          bestBuckets = buckets;
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
        bestBuckets[0],
        bestBuckets[1],
        bestBuckets[2],
        bestBuckets[3],
        bestBuckets[4],
      ],
    };

    // Guard against partial-outage evenings where any 30-min bucket is 0
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
// Average Volume Functions (All Times Eastern Time)
// ============================================================================

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
// Reporting & Comparison
// ============================================================================

/** Rounds and formats a numeric volume with US comma grouping. */
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Formats a percentage difference with an explicit sign and two decimal places. */
function fmtPct(diffPct: number): string {
  const sign = diffPct >= 0 ? "+" : "";
  return `${sign}${diffPct.toFixed(2)}%`;
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
    `  1.0h | 7:00-8:00: ${fmtInt(avg7_8).padStart(8)} vs 8:00-9:00: ${fmtInt(avg8_9).padStart(8)} | Winner: ${winner1h} (${fmtInt(Math.abs(diff1h))}, ${fmtPct(pct1h)} vs 8-9)`
  );
  console.log(
    `  1.5h | 7:00-8:30: ${fmtInt(avg7_830).padStart(8)} vs 8:00-9:30: ${fmtInt(avg8_930).padStart(8)} | Winner: ${winner15h} (${fmtInt(Math.abs(diff15h))}, ${fmtPct(pct15h)} vs 8-9:30)`
  );
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

/** Prints the complete EST, per-season, rollover cross-check, and EDT control report. */
function compareVolumes(dataset: ParsedAsiaDataset): void {
  const { frontMonthDays, allOutrightDays, stats } = dataset;

  const estFrontAll = frontMonthDays.filter((d) => d.regime === "EST");
  const estFrontComplete = estFrontAll.filter((d) =>
    isSeasonComplete(d.season, "EST", stats.minUtcMinute, stats.maxUtcMinute)
  );
  const estOutrightsAll = allOutrightDays.filter((d) => d.regime === "EST");
  const estOutrightsComplete = estOutrightsAll.filter((d) =>
    isSeasonComplete(d.season, "EST", stats.minUtcMinute, stats.maxUtcMinute)
  );

  const edtFrontAll = frontMonthDays.filter((d) => d.regime === "EDT");
  const edtFrontComplete = edtFrontAll.filter((d) =>
    isSeasonComplete(d.season, "EDT", stats.minUtcMinute, stats.maxUtcMinute)
  );

  const totalEstFrontVol = estFrontAll.reduce((acc, d) => acc + sumBuckets(d.buckets), 0);
  const totalEstAllOutrightVol = estOutrightsAll.reduce(
    (acc, d) => acc + sumBuckets(d.buckets),
    0
  );
  const frontSharePct =
    totalEstAllOutrightVol > 0 ? (totalEstFrontVol / totalEstAllOutrightVol) * 100 : 0;

  console.log("==========================================================================");
  console.log("MNQ ASIA SESSION VOLUME ANALYSIS (7:00-9:30 PM AMERICA/NEW_YORK)");
  console.log("==========================================================================");
  console.log("1. DATASET SUMMARY");
  console.log(`  UTC Range              : ${stats.minUtcMinute}Z -> ${stats.maxUtcMinute}Z`);
  console.log(`  Total CSV Rows Scanned : ${stats.totalRows.toLocaleString("en-US")}`);
  console.log(
    `  Outright Rows in Window: ${stats.windowOutrightRows.toLocaleString("en-US")}`
  );
  console.log(
    `  Calendar Spreads Skipped: ${stats.spreadRowsSkipped.toLocaleString("en-US")}`
  );
  console.log(
    `  Clean Active Evenings  : ${frontMonthDays.length} total (${estFrontAll.length} EST, ${edtFrontAll.length} EDT)`
  );
  console.log(
    `  Truncated Edge Days    : ${stats.truncatedEdgeDays.length === 0 ? "None" : stats.truncatedEdgeDays.join(", ")}`
  );
  console.log(
    `  Zero-Bucket Outage Days: ${
      stats.zeroBucketDays.length === 0
        ? "None"
        : stats.zeroBucketDays
            .map((d) => `${d.nyDate} (${d.regime}, ${d.symbol}: [${d.buckets.join(", ")}])`)
            .join("; ")
    }`
  );
  console.log(
    `  EST Front-Month Share  : ${frontSharePct.toFixed(2)}% of total EST outright volume`
  );

  console.log("\n==========================================================================");
  console.log("2. PRIMARY RESULTS — EST (FALL/WINTER: 7:00 PM NY = 9:00 AM TOKYO)");
  console.log("==========================================================================");

  printComparisonBlock(
    "EST Front-Month Proxy — Complete Seasons Only",
    estFrontComplete
  );
  printComparisonBlock(
    "EST Front-Month Proxy — All EST Days (incl. partial seasons)",
    estFrontAll
  );
  printComparisonBlock(
    "EST All-Outrights Cross-Check — Complete Seasons Only",
    estOutrightsComplete
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
    "  Season     | Status   | Days |   Avg 7-8 |   Avg 8-9 | Win (1h) |  Diff % | Avg 7-8:30 | Avg 8-9:30 | Win (1.5h) |  Diff %"
  );
  console.log(
    "  -----------+----------+------+-----------+-----------+----------+---------+------------+------------+------------+--------"
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
      stats.maxUtcMinute
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
      `  ${season.padEnd(10)} | ${(complete ? "Complete" : "PARTIAL").padEnd(8)} | ${String(sDays.length).padStart(4)} | ${fmtInt(a7_8).padStart(9)} | ${fmtInt(a8_9).padStart(9)} | ${w1.padEnd(8)} | ${fmtPct(p1).padStart(7)} | ${fmtInt(a7_830).padStart(10)} | ${fmtInt(a8_930).padStart(10)} | ${w15.padEnd(10)} | ${fmtPct(p15).padStart(7)}`
    );
  }

  console.log(
    `\n  Season Consistency (Complete EST Seasons): 7-8 won ${wins7_8Complete}/${completeSeasonsCount} | 7-8:30 won ${wins7_830Complete}/${completeSeasonsCount}`
  );

  printBucketProfile(
    "EST 30-Minute Bucket Profile (Front-Month Proxy, Complete Seasons)",
    estFrontComplete
  );

  console.log("\n==========================================================================");
  console.log("3. CONTROL GROUP — EDT (SPRING/SUMMER: 8:00 PM NY = 9:00 AM TOKYO)");
  console.log("==========================================================================");

  printComparisonBlock(
    "EDT Front-Month Proxy — Complete Seasons Only",
    edtFrontComplete
  );
  printBucketProfile(
    "EDT 30-Minute Bucket Profile (Front-Month Proxy, Complete Seasons)",
    edtFrontComplete
  );
}

// ============================================================================
// Self-Checks & Post-Parse Invariant Verification
// ============================================================================

/** Verifies DST rules, bucket boundaries, expiry keys, and averaging math via assertions. */
function runSelfChecks(): void {
  // 1. DST cross-check vs Intl.DateTimeFormat for 2019..2026
  const tzFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
  const isIntlEdt = (isoUtc: string): boolean => {
    const parts = tzFmt.formatToParts(new Date(isoUtc));
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value;
    return tzName === "EDT";
  };

  for (let y = 2019; y <= 2026; y++) {
    const { springDay, fallDay } = getDstTransitionDays(y);
    const marDate = formatDate(y, 3, springDay);
    const novDate = formatDate(y, 11, fallDay);

    assert.equal(isUsEasternDstUtc(y, 3, springDay, 6), isIntlEdt(`${marDate}T06:30:00Z`));
    assert.equal(isUsEasternDstUtc(y, 3, springDay, 7), isIntlEdt(`${marDate}T07:30:00Z`));
    assert.equal(isUsEasternDstUtc(y, 11, fallDay, 5), isIntlEdt(`${novDate}T05:30:00Z`));
    assert.equal(isUsEasternDstUtc(y, 11, fallDay, 6), isIntlEdt(`${novDate}T06:30:00Z`));
  }

  // 2. Bucket boundary checks on mapUtcToNyBucket
  assert.deepEqual(mapUtcToNyBucket("2024-11-04T00:00:00.000000000Z"), {
    nyDate: "2024-11-03",
    regime: "EST",
    season: "2024-2025",
    bucketIndex: 0,
  });
  assert.equal(mapUtcToNyBucket("2024-11-04T00:29:00.000000000Z")?.bucketIndex, 0);
  assert.equal(mapUtcToNyBucket("2024-11-04T00:30:00.000000000Z")?.bucketIndex, 1);
  assert.equal(mapUtcToNyBucket("2024-11-04T02:29:00.000000000Z")?.bucketIndex, 4);
  assert.equal(mapUtcToNyBucket("2024-11-04T02:30:00.000000000Z"), null);
  assert.equal(mapUtcToNyBucket("2024-11-03T23:59:00.000000000Z"), null);

  assert.deepEqual(mapUtcToNyBucket("2024-10-31T23:00:00.000000000Z"), {
    nyDate: "2024-10-31",
    regime: "EDT",
    season: "2024",
    bucketIndex: 0,
  });
  assert.deepEqual(mapUtcToNyBucket("2024-11-01T01:29:00.000000000Z"), {
    nyDate: "2024-10-31",
    regime: "EDT",
    season: "2024",
    bucketIndex: 4,
  });
  assert.equal(mapUtcToNyBucket("2024-11-01T01:30:00.000000000Z"), null);

  // 3. Contract expiry key (including 2019->2020 decade rollover) & average arithmetic
  assert.equal(getContractExpiryKey("MNQZ9", 2019), 201912);
  assert.equal(getContractExpiryKey("MNQH0", 2019), 202003);
  assert.ok(getContractExpiryKey("MNQZ9", 2019) < getContractExpiryKey("MNQH0", 2019));

  const fixture: DailyAsiaBuckets[] = [
    {
      nyDate: "2024-11-03",
      regime: "EST",
      season: "2024-2025",
      symbol: "MNQZ4",
      buckets: [1, 2, 4, 6, 5],
    },
    {
      nyDate: "2024-11-04",
      regime: "EST",
      season: "2024-2025",
      symbol: "MNQZ4",
      buckets: [3, 4, 5, 7, 9],
    },
  ];
  assert.equal(getAverageVolume7To8(fixture), 5);
  assert.equal(getAverageVolume8To9(fixture), 11);
  assert.equal(getAverageVolume7To8_30(fixture), 9.5);
  assert.equal(getAverageVolume8To9_30(fixture), 18);
}

/** Verifies dataset invariants (no Fri/Sat evenings, monotonic share, additive buckets). */
function runPostParseChecks(dataset: ParsedAsiaDataset): void {
  const { frontMonthDays, allOutrightDays } = dataset;
  assert.equal(frontMonthDays.length, allOutrightDays.length);

  for (let i = 0; i < frontMonthDays.length; i++) {
    const front = frontMonthDays[i];
    const all = allOutrightDays[i];
    assert.equal(front.nyDate, all.nyDate);

    // No Friday (5) or Saturday (6) NY evenings (CME Globex closed)
    const dow = new Date(`${front.nyDate}T12:00:00Z`).getUTCDay();
    assert.ok(dow !== 5 && dow !== 6, `Unexpected Fri/Sat evening: ${front.nyDate}`);

    for (let b = 0; b < 5; b++) {
      assert.ok(
        front.buckets[b] <= all.buckets[b],
        `Front-month exceeded all-outright on ${front.nyDate} bucket ${b}`
      );
    }
  }

  // Additive bucket identities on EST days
  const estDays = frontMonthDays.filter((d) => d.regime === "EST");
  const bucketAvgs = getAverageBucketVolumes(estDays);
  assert.ok(
    Math.abs(getAverageVolume7To8_30(estDays) - getAverageVolume7To8(estDays) - bucketAvgs[2]) <
      1e-6
  );
  assert.ok(
    Math.abs(getAverageVolume8To9_30(estDays) - getAverageVolume8To9(estDays) - bucketAvgs[4]) <
      1e-6
  );
}

/** Entry point: runs self-checks, parses the CSV, validates invariants, and prints results. */
async function main(): Promise<void> {
  runSelfChecks();
  const dataset = await parseCsv(CSV_PATH);
  runPostParseChecks(dataset);
  compareVolumes(dataset);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
