export type TimeRegime = "EST" | "EDT";

/** [19:00-19:30, 19:30-20:00, 20:00-20:30, 20:30-21:00, 21:00-21:30] in America/New_York */
export type ThirtyMinBuckets = [number, number, number, number, number];

/** 30 five-minute buckets covering [19:00-19:05, 19:05-19:10, ..., 21:25-21:30] in America/New_York */
export type FiveMinBuckets = number[];

export interface NyBucketMatch {
  nyDate: string; // "YYYY-MM-DD" in America/New_York
  regime: TimeRegime; // "EST" or "EDT"
  season: string; // e.g. "2019-2020" for EST, "2020" for EDT
  bucketIndex: number; // 0..4 (30-minute bucket index)
  fiveMinIndex: number; // 0..29 (5-minute bucket index)
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
  nyDate: string; // "YYYY-MM-DD" in America/New_York
  regime: TimeRegime; // "EST" (fall/winter) or "EDT" (spring/summer)
  season: string; // e.g. "2019-2020" for EST, "2020" for EDT
  symbol: string; // e.g. "MNQZ6" for frontMonthDays, or "ALL_OUTRIGHTS" for allOutrightDays
  buckets: ThirtyMinBuckets;
  fiveMinBuckets: FiveMinBuckets; // length 30
}

export interface ParseStats {
  totalRows: number;
  windowOutrightRows: number;
  spreadRowsSkipped: number;
  minUtcMinute: string; // "YYYY-MM-DDTHH:MM"
  maxUtcMinute: string; // "YYYY-MM-DDTHH:MM"
  truncatedEdgeDays: string[];
  zeroBucketDays: DailyAsiaBuckets[];
}

export interface ParsedAsiaDataset {
  frontMonthDays: DailyAsiaBuckets[]; // Primary: monotonic volume-selected front-month proxy
  allOutrightDays: DailyAsiaBuckets[]; // Cross-check: sum of all outright quarterly contracts
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
