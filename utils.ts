import type {
  FiveMinBuckets,
  NyBucketMatch,
  ThirtyMinBuckets,
  TimeRegime,
} from "./types.js";

// ============================================================================
// Constants & Bucket Helpers
// ============================================================================

export const FIVE_MIN_BUCKET_COUNT = 30;

/** Creates a zero-initialized 30-element array for 5-minute buckets (7:00-9:30 PM ET). */
export function createZeroFiveMinBuckets(): FiveMinBuckets {
  return new Array<number>(FIVE_MIN_BUCKET_COUNT).fill(0);
}

/** Returns the total volume across all five 30-minute buckets for one evening. */
export function sumBuckets(buckets: ThirtyMinBuckets): number {
  return buckets[0] + buckets[1] + buckets[2] + buckets[3] + buckets[4];
}

// ============================================================================
// US DST & Calendar Date Helpers
// ============================================================================

const dstDaysCache = new Map<number, { springDay: number; fallDay: number }>();
const prevUtcDateCache = new Map<string, string>();
const nextUtcDateCache = new Map<string, string>();

/** Returns the day-of-month (1-31) for the nth Sunday in a given month. */
export function getNthSundayOfMonth(year: number, month1Based: number, n: number): number {
  const firstDayOfWeek = new Date(Date.UTC(year, month1Based - 1, 1)).getUTCDay(); // 0 = Sun
  const firstSunday = 1 + ((7 - firstDayOfWeek) % 7);
  return firstSunday + (n - 1) * 7;
}

/** Returns cached March spring-forward and November fall-back days for a year. */
export function getDstTransitionDays(year: number): { springDay: number; fallDay: number } {
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
export function isUsEasternDstUtc(
  year: number,
  month: number,
  day: number,
  utcHour: number
): boolean {
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
export function shiftUtcDate(utcDateStr: string, deltaDays: -1 | 1): string {
  const year = Number(utcDateStr.slice(0, 4));
  const month = Number(utcDateStr.slice(5, 7));
  const day = Number(utcDateStr.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day + deltaDays)).toISOString().slice(0, 10);
}

/** Returns the cached previous UTC calendar date for a "YYYY-MM-DD" string. */
export function getPreviousUtcDate(utcDateStr: string): string {
  let cached = prevUtcDateCache.get(utcDateStr);
  if (!cached) {
    cached = shiftUtcDate(utcDateStr, -1);
    prevUtcDateCache.set(utcDateStr, cached);
  }
  return cached;
}

/** Returns the cached next UTC calendar date for a "YYYY-MM-DD" string. */
export function getNextUtcDate(utcDateStr: string): string {
  let cached = nextUtcDateCache.get(utcDateStr);
  if (!cached) {
    cached = shiftUtcDate(utcDateStr, 1);
    nextUtcDateCache.set(utcDateStr, cached);
  }
  return cached;
}

/** Formats numeric year, month, and day values as "YYYY-MM-DD". */
export function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Returns the seasonal grouping key ("YYYY-YYYY" for EST winter, "YYYY" for EDT). */
export function getSeasonLabel(nyDate: string, regime: TimeRegime): string {
  const nyYear = Number(nyDate.slice(0, 4));
  if (regime === "EDT") {
    return String(nyYear);
  }
  const nyMonth = Number(nyDate.slice(5, 7));
  return nyMonth >= 11 ? `${nyYear}-${nyYear + 1}` : `${nyYear - 1}-${nyYear}`;
}

/** Checks whether the CSV time span covers an entire EST or EDT season. */
export function isSeasonComplete(
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
// Contract & Timestamp Bucket Mapping Helpers
// ============================================================================

/**
 * Resolves a single-digit CME quarterly contract symbol (e.g. "MNQZ9", "MNQH0")
 * into a sortable YYYYMM expiry key using the current nyYear.
 */
export function getContractExpiryKey(symbol: string, nyYear: number): number {
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
 * America/New_York 30-minute (0..4) and 5-minute (0..29) buckets in [19:00, 21:30),
 * or null if outside window.
 */
export function mapUtcToNyBucket(tsEvent: string): NyBucketMatch | null {
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
  const fiveMinIndex = (nyHour - 19) * 12 + Math.floor(utcMinute / 5);
  const season = getSeasonLabel(nyDate, regime);
  return { nyDate, regime, season, bucketIndex, fiveMinIndex };
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/** Rounds and formats a numeric volume with US comma grouping. */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Formats a percentage difference with an explicit sign and two decimal places. */
export function fmtPct(diffPct: number): string {
  const sign = diffPct >= 0 ? "+" : "";
  return `${sign}${diffPct.toFixed(2)}%`;
}

/** Formats an interval bucket index as e.g. "7:00-7:10 PM" for any intervalMinutes dividing 150. */
export function formatIntervalLabel(index: number, intervalMinutes: number): string {
  const startMins = 7 * 60 + index * intervalMinutes;
  const endMins = startMins + intervalMinutes;
  const fmtHm = (m: number): string =>
    `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return `${fmtHm(startMins)}-${fmtHm(endMins)} PM`;
}

/** Formats a 5-minute bucket index (0..29) as e.g. "7:00-7:05 PM" or "7:55-8:00 PM". */
export function formatFiveMinLabel(index: number): string {
  return formatIntervalLabel(index, 5);
}
