# Implementation Plan: MNQ Asia Session Volume Analysis (`NQAsiaVolumeAnalysis.ts`)

## 1. Objective

Determine empirically whether **MNQ (Micro E-mini Nasdaq-100)** futures trade higher average volume at the **7:00 PM NY** window (which aligns with **9:00 AM Tokyo** during US Standard Time / fall-winter) or the **8:00 PM NY** window ("ICT killzone") after the US falls back from EDT to EST.

Comparisons required (all times in `America/New_York` / Eastern Time):
1. **1-hour window**: `7:00–8:00 PM ET` vs `8:00–9:00 PM ET`
2. **1.5-hour window**: `7:00–8:30 PM ET` vs `8:00–9:30 PM ET`

Primary focus is **EST (US Standard Time, November–March)**, where the 1-hour shift occurs. We also compute **EDT (US Daylight Saving Time, March–November)** separately as a built-in control group (during EDT, 8:00 PM NY *is* 9:00 AM Tokyo, so both hypotheses agree).

---

## 2. Dataset Facts (Verified Against the Actual CSV)

- **File**: `/Users/nickd/Documents/Trading/databento/GLBX-20261124-4LBPW74B7H/glbx-mdp3-20161122-20261122.ohlcv-1m.csv`
- **Size**: ~448 MB, **4,069,140 data rows** (4,069,141 lines including header).
  - **Memory requirement**: Do **NOT** load all 4M rows into an `OhlcvRow[]` array. Stream line-by-line and aggregate directly into per-day, per-symbol 30-minute buckets in a **single pass** (runs in ~2–3 seconds and uses <50 MB RAM).
- **Columns**: `ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume,symbol`
  - `ts_event`: ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:MM:SS.000000000Z`), representing the **start** of each 1-minute bar (`[ts_event, ts_event + 1m)`).
  - `volume`: Integer count of contracts traded during that 1-minute bar for that `symbol`.
  - `symbol`: Parent query was `MNQ.FUT`, containing **98 symbols**: **35 outright quarterly contracts** (`H` = Mar, `M` = Jun, `U` = Sep, `Z` = Dec; e.g. `MNQZ6`, `MNQH7`) and **63 calendar spreads** containing a hyphen (e.g. `MNQM6-MNQU6`).
- **Actual Date Coverage**: `2019-05-05T22:03:00Z` through `2026-11-22T23:59:00Z` (MNQ launched on May 5, 2019, so no 2016–early 2019 data exists).
- **Trading Schedule**: CME Globex MNQ trades Sunday 6:00 PM ET – Friday 5:00 PM ET. Thus `7:00–9:30 PM ET` occurs on **Sunday, Monday, Tuesday, Wednesday, and Thursday evenings** (corresponding to Monday–Friday mornings in Tokyo). Friday and Saturday evenings have no trading.
- **Known Data Anomaly**: `2020-06-30` (an EDT evening, marked `degraded` in `condition.json`) has `0` volume in `7:00–8:00 PM` and normal volume in `8:00–9:30 PM` (`[0, 0, 3275, 3205, 4096]` on front-month `MNQU0`). All 637 EST evenings in the dataset have non-zero volume in all five 30-minute buckets.

---

## 3. Core Design Decisions & Edge Cases

### 3.1 Single-Pass 30-Minute Bucket Architecture
The entire `7:00–9:30 PM ET` span divides cleanly into **5 non-overlapping 30-minute buckets** per NY calendar evening (`nyDate: "YYYY-MM-DD"`), using **half-open intervals `[start, end)`** so boundary minutes (like `20:00` or `20:30`) are **never double-counted**:

| Bucket Index | NY Local Time Range | Inclusive 1-Min Bar Timestamps | Bars |
|---|---|---|---|
| `0` | `7:00–7:30 PM ET` | `19:00` through `19:29` | 30 |
| `1` | `7:30–8:00 PM ET` | `19:30` through `19:59` | 30 |
| `2` | `8:00–8:30 PM ET` | `20:00` through `20:29` | 30 |
| `3` | `8:30–9:00 PM ET` | `20:30` through `20:59` | 30 |
| `4` | `9:00–9:30 PM ET` | `21:00` through `21:29` | 30 |

Interval composition from the 5 buckets:
- **`7:00–8:00 PM ET`** = `buckets[0] + buckets[1]` (60 bars)
- **`8:00–9:00 PM ET`** = `buckets[2] + buckets[3]` (60 bars)
- **`7:00–8:30 PM ET`** = `buckets[0] + buckets[1] + buckets[2]` (90 bars)
- **`8:00–9:30 PM ET`** = `buckets[2] + buckets[3] + buckets[4]` (90 bars)

Bucket index formula (once `nyHour` and `nyMinute` are verified in `[19:00, 21:30)`):
```ts
const bucketIndex = (nyHour - 19) * 2 + (nyMinute >= 30 ? 1 : 0);
```

### 3.2 Non-Continuous Quarterly Contracts & Rollover Handling
Because `MNQ.FUT` is non-continuous parent symbology, multiple quarterly contracts (`H`, `M`, `U`, `Z`) trade concurrently on any given evening:
1. **Always exclude calendar spreads**: skip any row where `symbol.includes("-")` (e.g. `MNQZ5-MNQH6`). Spreads are inter-expiration roll trades, not directional MNQ trading.
2. **Track per-symbol buckets per evening** (`Map<string, ThirtyMinBuckets>` inside each evening's accumulator — at most 2–4 quarterly symbols per evening, costing <1 MB total RAM), then produce **two** clean `DailyAsiaBuckets[]` views from the single pass:
   - **`frontMonthDays` (Primary — Volume-Selected Front-Month Proxy)**: Iterate evenings in chronological order (`nyDate` ascending). For each `nyDate`, filter candidate outright contracts to those with `getContractExpiryKey(symbol, nyYear) >= lastFrontExpiryKey` (monotonic forward-only roll so the active contract never flips backward during a 50/50 rollover week), then select the **single outright `symbol` with the highest total volume across `7:00–9:30 PM ET`** on that evening.
     - *Relation to `MNQ1!`*: This is a close volume-based proxy (accounting for **98.11%** of all EST outright volume), not TradingView's exact fixed calendar roll rule—on 1–2 transition nights per quarterly roll when volume is ~50/50, it may roll one evening earlier or later than `MNQ1!`.
   - **`allOutrightDays` (Secondary Cross-Check — Sum of All Outright Expirations)**: For each `nyDate`, sum the 5 buckets across all active outright MNQ expirations. During quarterly rollover weeks (2nd week of December and March inside EST), volume splits between the expiring contract and the new contract for ~3–4 days, so checking `allOutrightDays` alongside `frontMonthDays` confirms rollover week splitting and the exact roll day do not alter the conclusion.

Note: On any given evening `nyDate`, the front-month contract is selected **once for the entire evening** (never switching contracts mid-evening between 7 PM and 8 PM), ensuring an exact apples-to-apples comparison on the same contract.

### 3.3 Exact US Daylight Saving Time (DST) Rules
Under the US Energy Policy Act of 2005 (in effect for 2007–present, covering the entire CSV):
- **Spring Forward (`EST -> EDT`, UTC-5 -> UTC-4)**: **2nd Sunday of March** at `02:00 EST` = **`07:00:00 UTC`**.
- **Fall Back (`EDT -> EST`, UTC-4 -> UTC-5)**: **1st Sunday of November** at `02:00 EDT` = **`06:00:00 UTC`**.

Reference transition dates (2019–2026):
| Year | Spring Forward (EST -> EDT) | Fall Back (EDT -> EST) |
|---|---|---|
| 2019 | `2019-03-10` | `2019-11-03` |
| 2020 | `2020-03-08` | `2020-11-01` |
| 2021 | `2021-03-14` | `2021-11-07` |
| 2022 | `2022-03-13` | `2022-11-06` |
| 2023 | `2023-03-12` | `2023-11-05` |
| 2024 | `2024-03-10` | `2024-11-03` |
| 2025 | `2025-03-09` | `2025-11-02` |
| 2026 | `2026-03-08` | `2026-11-01` |

Important boundary behavior:
- On **Fall-Back Sunday** (e.g. `2024-11-03`), the clock changes at `06:00 UTC` (morning). That **same Sunday evening** (`19:00 EST` = `2024-11-04T00:00Z`) is **already in EST**.
- On **Spring-Forward Sunday** (e.g. `2025-03-09`), the clock changes at `07:00 UTC` (morning). That **same Sunday evening** (`19:00 EDT` = `2025-03-09T23:00Z`) is **already in EDT**.
- Do **NOT** call `Intl.DateTimeFormat` inside the 4M-row loop (too slow). Compute `{ springDay, fallDay }` dynamically per year with a cached `Map<number, { springDay: number; fallDay: number }>` and convert with integer math.

Exact helper implementations to use:
```ts
function getNthSundayOfMonth(year: number, month1Based: number, n: number): number {
  const firstDayOfWeek = new Date(Date.UTC(year, month1Based - 1, 1)).getUTCDay(); // 0 = Sun
  const firstSunday = 1 + ((7 - firstDayOfWeek) % 7);
  return firstSunday + (n - 1) * 7;
}

function isUsEasternDstUtc(year: number, month: number, day: number, utcHour: number): boolean {
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;

  const { springDay, fallDay } = getDstTransitionDays(year); // cached per year
  if (month === 3) {
    return day > springDay || (day === springDay && utcHour >= 7);
  }
  // month === 11
  return day < fallDay || (day === fallDay && utcHour < 6);
}
```

### 3.4 Pure Timestamp-to-Bucket Mapper & Fast-Path UTC Pre-Filter
Because `America/New_York` is only ever `UTC-4` (EDT) or `UTC-5` (EST):
- `19:00–21:29 EDT` = `23:00–23:59 UTC` (same UTC date) and `00:00–01:29 UTC` (next UTC date).
- `19:00–21:29 EST` = `00:00–02:29 UTC` (next UTC date).

Extract a pure helper `mapUtcToNyBucket(tsEvent: string): NyBucketMatch | null` so both `parseCsv` and `runSelfChecks()` call the **exact same code path**:
1. Read `const utcHourStr = tsEvent.slice(11, 13);`.
2. **Fast-path reject (~85% of rows)**: if `utcHourStr !== "23" && utcHourStr !== "00" && utcHourStr !== "01" && utcHourStr !== "02"`, return `null`.
3. Parse `utcHour = Number(utcHourStr)` and `utcMinute = Number(tsEvent.slice(14, 16))`. If `utcHour === 2 && utcMinute >= 30`, return `null`.
4. Parse `utcDateStr = tsEvent.slice(0, 10)`, `utcYear`, `utcMonth`, `utcDay`.
5. Compute `isDst = isUsEasternDstUtc(utcYear, utcMonth, utcDay, utcHour)`, `regime: TimeRegime = isDst ? "EDT" : "EST"`, and `offsetHours = isDst ? -4 : -5`.
6. Compute `nyHour = utcHour + offsetHours`:
   - If `nyHour < 0`: `nyHour += 24` and `nyDate = getPreviousUtcDate(utcDateStr)` (memoized in a `Map<string, string>`).
   - Else: `nyDate = utcDateStr`.
7. Check exact NY window: if `nyHour < 19 || nyHour > 21 || (nyHour === 21 && utcMinute >= 30)`, return `null`.
   - Note: This automatically drops `23:00–23:59 UTC` in EST (`nyHour === 18`) and `01:30–02:29 UTC` in EDT (`nyHour === 21 && min >= 30` or `nyHour === 22`).
8. Compute `bucketIndex = (nyHour - 19) * 2 + (utcMinute >= 30 ? 1 : 0)` (`0..4`), `season = getSeasonLabel(nyDate, regime)`, and return `{ nyDate, regime, season, bucketIndex }`.

Inside `parseCsv`'s loop over lines:
1. Update `minUtcMinute` and `maxUtcMinute` using `const utcMinuteKey = line.slice(0, 16);` (`YYYY-MM-DDTHH:MM`).
2. Call `const match = mapUtcToNyBucket(line);` — if `null`, `continue` immediately **before** calling `line.split(",")`!
3. Only for matching rows (~15% of file), split `line` by `,`, check `symbol` (if `symbol.includes("-")`, increment `spreadRowsSkipped` and `continue`), parse `volume = Number(parts[8])`, and add `volume` to that `nyDate` + `symbol` bucket array.

### 3.5 Seasons & Handling Incomplete Years / Partial Seasons
An **EST (winter) season** spans **two calendar years** (November of year `Y` through early March of year `Y + 1`). Grouping by raw calendar year would wrongly splice Jan–Mar of one winter with Nov–Dec of the next winter.

Assign a `season` label to every `DailyAsiaBuckets` record using `nyDate` (`nyYear`, `nyMonth`):
- If `regime === "EST"`:
  - `nyMonth >= 11` -> season `"${nyYear}-${nyYear + 1}"` (e.g., `2019-11-03` -> `"2019-2020"`)
  - `nyMonth <= 3` -> season `"${nyYear - 1}-${nyYear}"` (e.g., `2020-02-10` -> `"2019-2020"`)
- If `regime === "EDT"`:
  - season `"${nyYear}"` (e.g., `2020-06-15` -> `"2020"`)

**Programmatic completeness check** (do not hardcode which years are incomplete—derive from `minUtcMinute` and `maxUtcMinute` seen in the CSV):
- **EST season `Y-(Y+1)`** is `complete` iff:
  - `minUtcMinute <= "${fallBackDate(Y)}T06:00"` AND `maxUtcMinute >= "${springForwardDate(Y + 1)}T02:29"`.
  - On this CSV: `2019-2020` through `2025-2026` (7 seasons) are **complete**; `2026-2027` is **partial** (ends Nov 2026).
- **EDT season `Y`** is `complete` iff:
  - `minUtcMinute <= "${springForwardDate(Y)}T23:00"` AND `maxUtcMinute >= "${fallBackDate(Y)}T01:29"`.
  - On this CSV: `2019` is **partial** (MNQ launched May 5, 2019); `2020` through `2026` (7 seasons) are **complete**.

**Boundary & Outage Guards**:
1. **Truncated file-edge evening guard**: For each `nyDate`, compute its UTC window start (`19:00 ET`) and end (`21:29 ET`) using `nextDate = getNextUtcDate(nyDate)`:
   - For `EST`: `windowStartUtc = "${nextDate}T00:00"`, `windowEndUtc = "${nextDate}T02:29"`.
   - For `EDT`: `windowStartUtc = "${nyDate}T23:00"`, `windowEndUtc = "${nextDate}T01:29"`.
   If `minUtcMinute > windowStartUtc` or `maxUtcMinute < windowEndUtc`, exclude that edge evening as truncated.
2. **Partial-outage day guard**: After streaming completes, detect any `nyDate` where at least one of the 5 buckets on the front-month contract is `0` (while total volume > 0). Exclude such incomplete/outage evenings from both `frontMonthDays` and `allOutrightDays` so both arrays share the exact same clean dates (and record excluded days in `stats.zeroBucketDays`). On this CSV, this excludes 0 EST days and 1 degraded EDT day (`2020-06-30`).

### 3.6 Exact Averaging Formula
For any array `days: DailyAsiaBuckets[]` of length `N = days.length`:
- If `N === 0`, return `0`.
- Every interval divides by the **same denominator `N`** (total active trading evenings in `days`), ensuring apples-to-apples comparisons:
  - `getAverageVolume7To8(days)`: `sum(b[0] + b[1]) / N`
  - `getAverageVolume8To9(days)`: `sum(b[2] + b[3]) / N`
  - `getAverageVolume7To8_30(days)`: `sum(b[0] + b[1] + b[2]) / N`
  - `getAverageVolume8To9_30(days)`: `sum(b[2] + b[3] + b[4]) / N`
- Example sanity check: Day 1 has `8–9` volume `10`, Day 2 has `8–9` volume `12` -> `(10 + 12) / 2 = 11`.

---

## 4. Target Types & Function Signatures (`NQAsiaVolumeAnalysis.ts`)

Keep all existing skeleton function names (`parseCsv`, `getAverageVolume7To8`, `getAverageVolume8To9`, `getAverageVolume7To8_30`, `getAverageVolume8To9_30`, `compareVolumes`) and implement them with clean TypeScript types:

```ts
type TimeRegime = "EST" | "EDT";

/** [19:00-19:30, 19:30-20:00, 20:00-20:30, 20:30-21:00, 21:00-21:30] in America/New_York */
type ThirtyMinBuckets = [number, number, number, number, number];

interface NyBucketMatch {
  nyDate: string;          // "YYYY-MM-DD" in America/New_York
  regime: TimeRegime;      // "EST" or "EDT"
  season: string;          // e.g. "2019-2020" for EST, "2020" for EDT
  bucketIndex: number;     // 0 | 1 | 2 | 3 | 4
}

interface DailyAsiaBuckets {
  nyDate: string;          // "YYYY-MM-DD" in America/New_York
  regime: TimeRegime;      // "EST" (fall/winter) or "EDT" (spring/summer)
  season: string;          // e.g. "2019-2020" for EST, "2020" for EDT
  symbol: string;          // e.g. "MNQZ6" for frontMonthDays, or "ALL_OUTRIGHTS" for allOutrightDays
  buckets: ThirtyMinBuckets;
}

interface ParseStats {
  totalRows: number;
  windowOutrightRows: number;
  spreadRowsSkipped: number;
  minUtcMinute: string;    // "YYYY-MM-DDTHH:MM"
  maxUtcMinute: string;    // "YYYY-MM-DDTHH:MM"
  truncatedEdgeDays: string[];
  zeroBucketDays: DailyAsiaBuckets[];
}

interface ParsedAsiaDataset {
  frontMonthDays: DailyAsiaBuckets[];   // Primary: highest-volume contract per evening (sorted by nyDate)
  allOutrightDays: DailyAsiaBuckets[];  // Cross-check: sum of all outright quarterly contracts per evening
  stats: ParseStats;
}
```

### Functions to Implement
1. **DST, Date & Bucket Helpers**:
   - `getNthSundayOfMonth(year: number, month1Based: number, n: number): number`
   - `getDstTransitionDays(year: number): { springDay: number; fallDay: number }` (memoized in a `Map`)
   - `isUsEasternDstUtc(year: number, month: number, day: number, utcHour: number): boolean`
   - `getPreviousUtcDate(utcDateStr: string): string` (memoized in a `Map`)
   - `getNextUtcDate(utcDateStr: string): string` (memoized in a `Map`)
   - `getSeasonLabel(nyDate: string, regime: TimeRegime): string`
   - `getContractExpiryKey(symbol: string, nyYear: number): number` (resolves single-digit CME year codes like `MNQZ9` -> `201912` and `MNQH0` -> `202003` for monotonic forward-only rolls)
   - `mapUtcToNyBucket(tsEvent: string): NyBucketMatch | null`
   - `isSeasonComplete(season: string, regime: TimeRegime, minUtcMinute: string, maxUtcMinute: string): boolean`
2. **`async function parseCsv(filePath: string): Promise<ParsedAsiaDataset>`**:
   - Streams `filePath` once with `fs.createReadStream` + `readline.createInterface`.
   - Calls `mapUtcToNyBucket(line)` first (skipping ~85% of lines before `.split(",")`), excludes calendar spreads (`symbol.includes("-")`), and accumulates per `(nyDate, symbol)` 5-element bucket arrays.
   - Builds `frontMonthDays` (walking evenings chronologically, enforcing `getContractExpiryKey(symbol, nyYear) >= lastFrontExpiryKey`, and selecting the highest-volume outright `symbol` per evening) and `allOutrightDays` (summing all outright symbols per evening), filtering out truncated edge days and zero-bucket outage days (`stats`).
   - Returns `{ frontMonthDays, allOutrightDays, stats }` sorted ascending by `nyDate`.
3. **Average Functions** (operate on any `DailyAsiaBuckets[]`, whether `frontMonthDays` or `allOutrightDays`):
   - `function getAverageVolume7To8(days: DailyAsiaBuckets[]): number`
   - `function getAverageVolume8To9(days: DailyAsiaBuckets[]): number`
   - `function getAverageVolume7To8_30(days: DailyAsiaBuckets[]): number`
   - `function getAverageVolume8To9_30(days: DailyAsiaBuckets[]): number`
4. **`function compareVolumes(dataset: ParsedAsiaDataset): void`**:
   - Prints a structured, easy-to-read report to stdout containing:
     1. **Dataset Summary**: UTC range (`minUtcMinute` -> `maxUtcMinute`), total rows parsed, outright rows in `7:00–9:30 PM ET`, spreads skipped, truncated/zero-bucket days excluded, and front-month share of total EST outright volume (~`98.1%`).
     2. **Primary Results — EST Front-Month Proxy (`frontMonthDays`, Fall/Winter, 7 PM NY = 9 AM Tokyo)**:
        - **Complete EST Seasons Only** (`isSeasonComplete === true`): day count `N`, averages for all 4 windows, side-by-side winner + absolute difference + `%` difference for `7–8 vs 8–9` and `7–8:30 vs 8–9:30`.
        - **All EST Days (including partial seasons)**: same comparison, clearly labeled with partial seasons included.
        - **All-Outrights Rollover Cross-Check (`allOutrightDays`, Complete EST Seasons)**: 1-block comparison confirming whether summing expiring + new quarterly contracts during rollover weeks gives the same winner and % diff as front-month only.
        - **Per-Season EST Breakdown (Front-Month)** (`2019-2020`, `2020-2021`, ..., `2026-2027 [PARTIAL]`): table with `Season`, `Complete?`, `Days`, `Avg 7-8`, `Avg 8-9`, `Winner (1h)`, `Diff %`, `Avg 7-8:30`, `Avg 8-9:30`, `Winner (1.5h)`, `Diff %`, plus season win count (`X / 7 complete seasons`).
          - *Why this is essential*: MNQ volume grew ~10x from 2019 to 2026, so per-season tables verify whether the winner is consistent across years rather than skewed by 1–2 recent high-volume years.
        - **EST 30-Minute Bucket Profile (Front-Month, Complete Seasons)**: average volume for each of the 5 buckets (`7:00–7:30`, `7:30–8:00`, `8:00–8:30`, `8:30–9:00`, `9:00–9:30`) so the exact half-hour volume curve is visible.
     3. **Control Results — EDT Front-Month (`frontMonthDays`, Spring/Summer, 8 PM NY = 9 AM Tokyo)**:
        - **Complete EDT Seasons Only**: same `7–8 vs 8–9` and `7–8:30 vs 8–9:30` comparison + 5-bucket 30-minute profile (verifies that volume peaks at 8 PM during summer when 8 PM = 9 AM Tokyo).
5. **`async function main()`**:
   - Runs lightweight self-check assertions (`runSelfChecks()`), calls `const dataset = await parseCsv(CSV_PATH)`, runs post-parse invariant assertions, and calls `compareVolumes(dataset)`.

---

## 5. Step-by-Step Execution Checklist for the Implementing Model

1. **Edit `NQAsiaVolumeAnalysis.ts`**:
   - Replace `OhlcvRow` with the types in Section 4 (`TimeRegime`, `ThirtyMinBuckets`, `NyBucketMatch`, `DailyAsiaBuckets`, `ParseStats`, `ParsedAsiaDataset`).
   - Implement the helpers (`getNthSundayOfMonth`, `getDstTransitionDays`, `isUsEasternDstUtc`, `getPreviousUtcDate`, `getNextUtcDate`, `getSeasonLabel`, `getContractExpiryKey`, `mapUtcToNyBucket`, `isSeasonComplete`).
   - Refactor `parseCsv` into the single-pass streaming per-`(nyDate, symbol)` 30-minute bucket aggregator described in Sections 3.2, 3.4 & 3.5.
   - Implement `getAverageVolume7To8`, `getAverageVolume8To9`, `getAverageVolume7To8_30`, and `getAverageVolume8To9_30`.
   - Implement `compareVolumes` with clean number formatting (`Math.round(...).toLocaleString("en-US")` or 1–2 decimals) and percentage differences (`((a - b) / b) * 100`).
   - Implement `runSelfChecks()` (Section 6) and invoke it in `main()` before running `parseCsv` and `compareVolumes`.
2. **Compile and Run**:
   - From `/Users/nickd/Documents/Trading/Scripts/Local`, run:
     ```bash
     npm start
     ```
   - Verify TypeScript compiles with **0 errors** (`tsc`) and runs cleanly in ~2–5 seconds.

---

## 6. Verification & Invariant Checks (`runSelfChecks` + Post-Run Audit)

Include a `runSelfChecks()` function (using `node:assert/strict`) that verifies all tricky logic before/after parsing:

1. **DST Cross-Check vs `Intl.DateTimeFormat`**:
   - For every year `2019..2026`, compare `isUsEasternDstUtc` against `Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" })` at:
     - 30 min before & 30 min after Spring Forward (`06:30Z` -> EST, `07:30Z` -> EDT)
     - 30 min before & 30 min after Fall Back (`05:30Z` -> EDT, `06:30Z` -> EST)
2. **Bucket Boundary Unit Checks (calling `mapUtcToNyBucket` directly)**:
   - `2024-11-04T00:00:00Z` -> `{ nyDate: "2024-11-03", regime: "EST", season: "2024-2025", bucketIndex: 0 }`
   - `2024-11-04T00:29:00Z` -> `bucketIndex: 0`
   - `2024-11-04T00:30:00Z` -> `bucketIndex: 1`
   - `2024-11-04T02:29:00Z` -> `bucketIndex: 4`
   - `2024-11-04T02:30:00Z` -> `null` (excluded)
   - `2024-11-03T23:59:00Z` -> `null` (excluded; 18:59 EST)
   - `2024-10-31T23:00:00Z` -> `{ nyDate: "2024-10-31", regime: "EDT", season: "2024", bucketIndex: 0 }`
   - `2024-11-01T01:29:00Z` -> `{ nyDate: "2024-10-31", regime: "EDT", season: "2024", bucketIndex: 4 }`
   - `2024-11-01T01:30:00Z` -> `null` (excluded)
3. **Contract Expiry & Average Arithmetic Checks**:
   - `getContractExpiryKey("MNQZ9", 2019)` === `201912` < `getContractExpiryKey("MNQH0", 2019)` === `202003` (handles the 2019→2020 decade rollover cleanly).
   - Synthetic 2-day fixture where Day 1 buckets = `[1, 2, 4, 6, 5]` (`8-9` = `10`) and Day 2 buckets = `[3, 4, 5, 7, 9]` (`8-9` = `12`):
     - `getAverageVolume7To8` === `(3 + 7) / 2 = 5`
     - `getAverageVolume8To9` === `(10 + 12) / 2 = 11`
     - `getAverageVolume7To8_30` === `(7 + 12) / 2 = 9.5`
     - `getAverageVolume8To9_30` === `(15 + 21) / 2 = 18`
4. **Post-Parse Dataset Sanity Checks**:
   - `frontMonthDays.length === allOutrightDays.length`
   - For every day `i` and bucket `b`, `frontMonthDays[i].buckets[b] <= allOutrightDays[i].buckets[b]`
   - No active `nyDate` falls on Friday (`5`) or Saturday (`6`) in `America/New_York` (CME Globex is closed).
   - Additive bucket identity holds on EST days:
     - `Math.abs((avg7To8_30 - avg7To8) - avgBucket2) < 1e-6`
     - `Math.abs((avg8To9_30 - avg8To9) - avgBucket4) < 1e-6`
   - Expected counts on this CSV:
     - Total rows scanned: `4,069,140`
     - EST active days: `637` (7 complete seasons `2019-2020`..`2025-2026`, 1 partial season `2026-2027`)
     - EDT active days: `1,315` clean (`1,316` before excluding degraded day `2020-06-30`; 1 partial season `2019`, 7 complete seasons `2020`..`2026`)

---

## 7. Optional Future Enhancements (Out of Scope for Initial Pass)
- Exclude **Japanese TSE holidays** (e.g., Jan 1–3, National Foundation Day, Emperor's Birthday, Culture Day, Labor Thanksgiving) to isolate pure Tokyo-open days.
- Break down by **day of week** (Sunday evening Globex reopen vs Mon–Thu evenings).
- Add median / trimmed-mean alongside arithmetic mean to measure sensitivity to extreme volatility nights (e.g., election nights or earnings shocks).
