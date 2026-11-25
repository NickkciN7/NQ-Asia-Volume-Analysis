# Refactoring & 5-Minute Intervals Plan (`NQAsiaVolumeAnalysis`)

## 1. Goals

1. **Modularize and reorganize the codebase** so `NQAsiaVolumeAnalysis.ts` (~823 lines) is split cleanly by responsibility and ordered top-to-bottom in **chronological execution order** (the Clean Code "Stepdown Rule") **without removing or altering any existing working logic**.
2. **Add 5-minute interval volume output (`7:00 PM – 9:30 PM ET`) for both EST and EDT**, computed in the **same single CSV streaming pass**, and printed as a simple, clean side-by-side table (no winner/comparison columns needed).

---

## 2. Target File Architecture (Zero Circular Dependencies)

All files live in `/Users/nickd/Documents/Trading/Scripts/Local/NQAsiaVolumeAnalysis/`:

```text
types.ts  <--  utils.ts  <--  checks.ts  <--  NQAsiaVolumeAnalysis.ts
```

> **CRITICAL TYPESCRIPT IMPORT RULE (`"module": "nodenext"`)**:
> `tsconfig.json` uses `"module": "nodenext"` and `"moduleResolution": "nodenext"`.
> Every relative import between local `.ts` files **MUST use the `.js` extension** (NOT `.ts` and NOT extensionless), e.g.:
> - `import type { DailyAsiaBuckets } from "./types.js";`
> - `import { mapUtcToNyBucket } from "./utils.js";`
> - `import { runSelfChecks, runPostParseChecks } from "./checks.js";`
>
> Keep `package.json` (`"start": "tsc && node dist/NQAsiaVolumeAnalysis.js"`) and `tsconfig.json` unchanged.

### File Responsibilities

| File | Purpose | Approx Size |
|---|---|---|
| `types.ts` | All shared TypeScript type aliases and interfaces (no runtime code). | ~65 lines |
| `utils.ts` | Reusable pure/memoized helpers: US DST & date math, CME contract expiry key, `mapUtcToNyBucket`, bucket array helpers, and number/label formatters. | ~230 lines |
| `checks.ts` | `runSelfChecks` (unit assertions) and `runPostParseChecks` (dataset invariants). Accepts calculator functions as an argument so there is **no circular import** back to `NQAsiaVolumeAnalysis.ts`. | ~150 lines |
| `NQAsiaVolumeAnalysis.ts` | Entry point & domain pipeline ordered chronologically: `main` → `parseCsv` → `compareVolumes` (+ its average/print helpers) → `printFiveMinIntervals` (+ `getFiveMinIntervalVolumes`). | ~340 lines |

---

## 3. Specification by File

### 3.1 `types.ts`

Move all existing types/interfaces here (`export` every one) and extend them minimally for the 30 five-minute buckets (`7:00 PM – 9:30 PM ET` = `150 min / 5 min = 30` buckets):

```ts
export type TimeRegime = "EST" | "EDT";

/** [19:00-19:30, 19:30-20:00, 20:00-20:30, 20:30-21:00, 21:00-21:30] in America/New_York */
export type ThirtyMinBuckets = [number, number, number, number, number];

/** 30 five-minute buckets covering [19:00-19:05, 19:05-19:10, ..., 21:25-21:30] in America/New_York */
export type FiveMinBuckets = number[];

export interface NyBucketMatch {
  nyDate: string;          // "YYYY-MM-DD" in America/New_York
  regime: TimeRegime;      // "EST" or "EDT"
  season: string;          // e.g. "2019-2020" for EST, "2020" for EDT
  bucketIndex: number;     // 0..4  (30-minute bucket index)
  fiveMinIndex: number;    // 0..29 (5-minute bucket index)
}

export interface RawSymbolBuckets {
  thirtyMin: ThirtyMinBuckets;
  fiveMin: FiveMinBuckets;
}

export interface RawEveningAccumulator {
  regime: TimeRegime;
  season: string;
  bySymbol: Map<string, RawSymbolBuckets>;
}

export interface DailyAsiaBuckets {
  nyDate: string;
  regime: TimeRegime;
  season: string;
  symbol: string;
  buckets: ThirtyMinBuckets;
  fiveMinBuckets: FiveMinBuckets; // length 30
}

export interface ParseStats {
  totalRows: number;
  windowOutrightRows: number;
  spreadRowsSkipped: number;
  minUtcMinute: string;
  maxUtcMinute: string;
  truncatedEdgeDays: string[];
  zeroBucketDays: DailyAsiaBuckets[];
}

export interface ParsedAsiaDataset {
  frontMonthDays: DailyAsiaBuckets[];
  allOutrightDays: DailyAsiaBuckets[];
  stats: ParseStats;
}

export interface VolumeCalculators {
  getAverageVolume7To8: (days: DailyAsiaBuckets[]) => number;
  getAverageVolume8To9: (days: DailyAsiaBuckets[]) => number;
  getAverageVolume7To8_30: (days: DailyAsiaBuckets[]) => number;
  getAverageVolume8To9_30: (days: DailyAsiaBuckets[]) => number;
  getAverageBucketVolumes: (days: DailyAsiaBuckets[]) => ThirtyMinBuckets;
  getFiveMinIntervalVolumes: (days: DailyAsiaBuckets[]) => FiveMinBuckets;
}
```

---

### 3.2 `utils.ts`

Move all reusable helper functions (with their succinct JSDocs and caches) into `utils.ts`, grouped cleanly into sections:

1. **Constants & Bucket Helpers**:
   - `export const FIVE_MIN_BUCKET_COUNT = 30;`
   - `export function createZeroFiveMinBuckets(): FiveMinBuckets` -> returns `new Array<number>(FIVE_MIN_BUCKET_COUNT).fill(0)`.
   - `export function sumBuckets(buckets: ThirtyMinBuckets): number` -> existing implementation unchanged.
2. **US DST & Calendar Date Helpers** (keep exact existing logic & memoization caches `dstDaysCache`, `prevUtcDateCache`, `nextUtcDateCache`):
   - `getNthSundayOfMonth(year, month1Based, n)` (internal or exported)
   - `export function getDstTransitionDays(year)`
   - `export function isUsEasternDstUtc(year, month, day, utcHour)`
   - `shiftUtcDate(utcDateStr, deltaDays)` (internal or exported)
   - `export function getPreviousUtcDate(utcDateStr)`
   - `export function getNextUtcDate(utcDateStr)`
   - `export function formatDate(year, month, day)`
   - `export function getSeasonLabel(nyDate, regime)`
   - `export function isSeasonComplete(season, regime, minUtcMinute, maxUtcMinute)`
3. **Contract & Timestamp Mapping Helpers**:
   - `export function getContractExpiryKey(symbol, nyYear)` -> existing implementation unchanged.
   - `export function mapUtcToNyBucket(tsEvent: string): NyBucketMatch | null`:
     - Keep all existing fast-path UTC checks and NY hour/date conversion unchanged.
     - Compute both indices once `nyHour` and `utcMinute` are verified in `[19:00, 21:30)`:
       ```ts
       const bucketIndex = (nyHour - 19) * 2 + (utcMinute >= 30 ? 1 : 0);       // 0..4
       const fiveMinIndex = (nyHour - 19) * 12 + Math.floor(utcMinute / 5);    // 0..29
       ```
     - Return `{ nyDate, regime, season, bucketIndex, fiveMinIndex }`.
4. **Formatting Helpers**:
   - `export function fmtInt(n: number): string` -> existing implementation unchanged.
   - `export function fmtPct(diffPct: number): string` -> existing implementation unchanged.
   - `export function formatFiveMinLabel(index: number): string`:
     ```ts
     /** Formats a 5-minute bucket index (0..29) as e.g. "7:00-7:05 PM" or "7:55-8:00 PM". */
     export function formatFiveMinLabel(index: number): string {
       const startMins = 7 * 60 + index * 5;
       const endMins = startMins + 5;
       const fmtHm = (m: number): string =>
         `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
       return `${fmtHm(startMins)}-${fmtHm(endMins)} PM`;
     }
     ```

---

### 3.3 `checks.ts`

Move `runSelfChecks` and `runPostParseChecks` here so assertion noise is out of the main script while keeping 100% test coverage:

- Signature:
  - `export function runSelfChecks(calcs: VolumeCalculators): void`
  - `export function runPostParseChecks(dataset: ParsedAsiaDataset, calcs: VolumeCalculators): void`
- Keep **every existing assertion** (note: in `runSelfChecks`, update the two `assert.deepEqual(mapUtcToNyBucket(...), ...)` expected objects to include `fiveMinIndex: 0` for `19:00` and `fiveMinIndex: 29` for `21:29`, and add `fiveMinBuckets: createZeroFiveMinBuckets()` or 30-element test arrays on the 2-day synthetic `fixture`).
- **Add new assertions for the 5-minute intervals**:
  1. In `runSelfChecks`:
     - `assert.equal(mapUtcToNyBucket("2024-11-04T00:00:00.000000000Z")?.fiveMinIndex, 0);` (`7:00 PM EST`)
     - `assert.equal(mapUtcToNyBucket("2024-11-04T00:04:00.000000000Z")?.fiveMinIndex, 0);` (`7:04 PM EST`)
     - `assert.equal(mapUtcToNyBucket("2024-11-04T00:05:00.000000000Z")?.fiveMinIndex, 1);` (`7:05 PM EST`)
     - `assert.equal(mapUtcToNyBucket("2024-11-04T00:59:00.000000000Z")?.fiveMinIndex, 11);` (`7:59 PM EST`)
     - `assert.equal(mapUtcToNyBucket("2024-11-04T01:00:00.000000000Z")?.fiveMinIndex, 12);` (`8:00 PM EST`)
     - `assert.equal(mapUtcToNyBucket("2024-11-04T02:29:00.000000000Z")?.fiveMinIndex, 29);` (`9:29 PM EST`)
     - `assert.equal(formatFiveMinLabel(0), "7:00-7:05 PM");`
     - `assert.equal(formatFiveMinLabel(11), "7:55-8:00 PM");`
     - `assert.equal(formatFiveMinLabel(12), "8:00-8:05 PM");`
     - `assert.equal(formatFiveMinLabel(29), "9:25-9:30 PM");`
  2. In `runPostParseChecks`:
     - For every day `i` in `frontMonthDays` and `allOutrightDays`:
       - `assert.equal(front.fiveMinBuckets.length, 30);`
       - `assert.equal(all.fiveMinBuckets.length, 30);`
       - Verify every group of 6 consecutive 5-minute buckets sums **exactly** to its parent 30-minute bucket `k` (`0..4`):
         ```ts
         for (let k = 0; k < 5; k++) {
           let sum5 = 0;
           for (let j = k * 6; j < k * 6 + 6; j++) {
             sum5 += front.fiveMinBuckets[j];
           }
           assert.equal(sum5, front.buckets[k]);
         }
         ```

---

### 3.4 `NQAsiaVolumeAnalysis.ts` (Chronological Top-Down Order + 5-Minute Feature)

Organize `NQAsiaVolumeAnalysis.ts` strictly in **top-down chronological call order** so a reader can read the file from top to bottom like a story.

> **HOISTING SAFETY RULE**:
> Declare all `import`s and `const CSV_PATH` at the very top of the file, use `function` / `async function` declarations (NOT `const fn = () =>`) for all functions below `main()`, and keep the top-level `main().catch(...)` execution trigger at the **very bottom** of the file so no `const` Temporal Dead Zone error is ever possible.

#### Exact Top-to-Bottom Layout of `NQAsiaVolumeAnalysis.ts`:

1. **Imports, Original Explanatory Comment Block, and `CSV_PATH` Constant**
2. **Entry Point (`main`)**:
   ```ts
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
   }
   ```
3. **Stage 1 — Single-Pass CSV Ingestion (`parseCsv`)**:
   - Keep all existing streaming, fast-path pre-filtering, spread skipping, truncated-edge guard, and monotonic front-month selection logic intact.
   - For each `(nyDate, symbol)` accumulator, initialize `{ thirtyMin: [0, 0, 0, 0, 0], fiveMin: createZeroFiveMinBuckets() }` and add `volume` to both:
     ```ts
     symBuckets.thirtyMin[match.bucketIndex] += volume;
     symBuckets.fiveMin[match.fiveMinIndex] += volume;
     ```
   - Sum `allFiveMinBuckets` (`0..29`) across all outright symbols on that evening alongside `allBuckets` (`0..4`), and copy `[...bestBuckets.fiveMin]` into `frontRecord.fiveMinBuckets`.
   - **IMPORTANT GUARD RULE**: Keep the partial-outage check **strictly on the 30-minute buckets** (`if (frontRecord.buckets.some((v) => v === 0))`), **NOT** on `fiveMinBuckets`! (Thin 2019 launch evenings can legitimately have 0 trades in a single 5-minute slot without being a feed outage.)
4. **Stage 2 — Comparison Report (`compareVolumes` followed immediately by the functions it calls)**:
   1. `compareVolumes(dataset)` — existing Sections 1, 2, and 3 unchanged.
   2. `printComparisonBlock(title, days)` — existing implementation unchanged.
   3. `getAverageVolume7To8(days)` — existing implementation unchanged.
   4. `getAverageVolume8To9(days)` — existing implementation unchanged.
   5. `getAverageVolume7To8_30(days)` — existing implementation unchanged.
   6. `getAverageVolume8To9_30(days)` — existing implementation unchanged.
   7. `printBucketProfile(title, days)` — existing implementation unchanged.
   8. `getAverageBucketVolumes(days)` — existing implementation unchanged.
5. **Stage 3 — 5-Minute Interval Table (`printFiveMinIntervals` + `getFiveMinIntervalVolumes`)**:
   1. **`printFiveMinIntervals(dataset: ParsedAsiaDataset): void`**:
      - Filter `frontMonthDays` to **Complete Seasons Only** for both `EST` (`estFrontComplete`, `N = 622`) and `EDT` (`edtFrontComplete`, `N = 1,185`), matching the 30-minute profiles in Sections 2 and 3 so partial `2026-2027` doesn't skew EST vs EDT and every 6 rows sum to the 30-minute profile above.
      - Call `getFiveMinIntervalVolumes(estFrontComplete)` and `getFiveMinIntervalVolumes(edtFrontComplete)`.
      - Print Section 4 as a clean side-by-side table of all 30 five-minute intervals (`7:00-7:05 PM` through `9:25-9:30 PM`), with a light separator every 6 rows (every 30 minutes) for readability and **no winner/comparison columns**:
        ```text
        ==========================================================================
        4. 5-MINUTE INTERVAL VOLUME (7:00-9:30 PM ET, FRONT-MONTH COMPLETE SEASONS)
        ==========================================================================
          Interval (ET)   | EST Avg Vol (N=622) | EDT Avg Vol (N=1185)
          ----------------+---------------------+---------------------
          7:00-7:05 PM    |               X,XXX |                X,XXX
          ...
          7:25-7:30 PM    |               X,XXX |                X,XXX
          ----------------+---------------------+---------------------
          7:30-7:35 PM    |               X,XXX |                X,XXX
          ...
          9:25-9:30 PM    |               X,XXX |                X,XXX
        ```
   2. **`getFiveMinIntervalVolumes(days: DailyAsiaBuckets[]): FiveMinBuckets`**:
      - Pure calculation function: if `days.length === 0`, return `createZeroFiveMinBuckets()`.
      - Sum `d.fiveMinBuckets[i]` for `i = 0..29` across `days`, divide each by `days.length`, and return the 30-element array.
6. **Bottom of File — Execution Trigger**:
   ```ts
   main().catch((err) => {
     console.error(err);
     process.exit(1);
   });
   ```

---

## 4. Step-by-Step Execution Checklist for the Implementing Model

1. **Create `types.ts`** with all exported types and interfaces from Section 3.1.
2. **Create `utils.ts`** with all exported helpers, caches, JSDocs, `FIVE_MIN_BUCKET_COUNT`, `createZeroFiveMinBuckets`, `formatFiveMinLabel`, and the `fiveMinIndex` addition in `mapUtcToNyBucket` (Section 3.2). Ensure `./types.js` is used in imports.
3. **Create `checks.ts`** with `runSelfChecks(calcs)` and `runPostParseChecks(dataset, calcs)`, keeping all existing assertions and adding the 5-minute assertions from Section 3.3. Ensure `./types.js` and `./utils.js` are used in imports.
4. **Update `NQAsiaVolumeAnalysis.ts`** in the exact chronological top-down order from Section 3.4, adding succinct JSDocs on the two new functions (`printFiveMinIntervals` and `getFiveMinIntervalVolumes`) and keeping JSDocs on all existing functions.
5. **Compile and Run**:
   ```bash
   cd /Users/nickd/Documents/Trading/Scripts/Local/NQAsiaVolumeAnalysis
   npm start
   ```
6. **Verify Zero Regressions**:
   - `tsc` exits with `0` errors.
   - All assertions in `runSelfChecks` and `runPostParseChecks` pass.
   - Sections 1–3 print the **exact same numbers** as before:
     - `Total CSV Rows Scanned : 4,069,140`
     - `Clean Active Evenings  : 1952 total (637 EST, 1315 EDT)`
     - `EST Front-Month Share  : 98.11%`
     - EST Complete (`N = 622`): `7:00-8:00` = `15,530`, `8:00-9:00` = `17,192`; `7:00-8:30` = `24,339`, `8:00-9:30` = `24,146`
     - EDT Complete (`N = 1185`): `7:00-8:00` = `14,939`, `8:00-9:00` = `23,790`; `7:00-8:30` = `28,402`, `8:00-9:30` = `34,833`
   - Section 4 prints all 30 five-minute intervals (`7:00-7:05 PM` through `9:25-9:30 PM`) for both EST (`N=622`) and EDT (`N=1185`), and each 6-row half-hour group sums (modulo integer rounding) to the 30-minute bucket averages in Sections 2 and 3.
