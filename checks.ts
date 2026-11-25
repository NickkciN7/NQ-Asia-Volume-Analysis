import assert from "node:assert/strict";
import type {
  DailyAsiaBuckets,
  ParsedAsiaDataset,
  VolumeCalculators,
} from "./types.js";
import {
  createZeroFiveMinBuckets,
  FIVE_MIN_BUCKET_COUNT,
  formatDate,
  formatFiveMinLabel,
  getContractExpiryKey,
  getDstTransitionDays,
  isSeasonComplete,
  isUsEasternDstUtc,
  mapUtcToNyBucket,
} from "./utils.js";

/** Verifies DST rules, bucket boundaries, expiry keys, labels, and averaging math via assertions. */
export function runSelfChecks(calcs: VolumeCalculators): void {
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

  // 2. Bucket boundary checks on mapUtcToNyBucket (30-min and 5-min indices)
  assert.deepEqual(mapUtcToNyBucket("2024-11-04T00:00:00.000000000Z"), {
    nyDate: "2024-11-03",
    regime: "EST",
    season: "2024-2025",
    bucketIndex: 0,
    fiveMinIndex: 0,
  });
  assert.equal(mapUtcToNyBucket("2024-11-04T00:04:00.000000000Z")?.fiveMinIndex, 0);
  assert.equal(mapUtcToNyBucket("2024-11-04T00:05:00.000000000Z")?.fiveMinIndex, 1);
  assert.equal(mapUtcToNyBucket("2024-11-04T00:29:00.000000000Z")?.bucketIndex, 0);
  assert.equal(mapUtcToNyBucket("2024-11-04T00:30:00.000000000Z")?.bucketIndex, 1);
  assert.equal(mapUtcToNyBucket("2024-11-04T00:59:00.000000000Z")?.fiveMinIndex, 11);
  assert.equal(mapUtcToNyBucket("2024-11-04T01:00:00.000000000Z")?.fiveMinIndex, 12);
  assert.equal(mapUtcToNyBucket("2024-11-04T02:29:00.000000000Z")?.bucketIndex, 4);
  assert.equal(mapUtcToNyBucket("2024-11-04T02:29:00.000000000Z")?.fiveMinIndex, 29);
  assert.equal(mapUtcToNyBucket("2024-11-04T02:30:00.000000000Z"), null);
  assert.equal(mapUtcToNyBucket("2024-11-03T23:59:00.000000000Z"), null);

  assert.deepEqual(mapUtcToNyBucket("2024-10-31T23:00:00.000000000Z"), {
    nyDate: "2024-10-31",
    regime: "EDT",
    season: "2024",
    bucketIndex: 0,
    fiveMinIndex: 0,
  });
  assert.deepEqual(mapUtcToNyBucket("2024-11-01T01:29:00.000000000Z"), {
    nyDate: "2024-10-31",
    regime: "EDT",
    season: "2024",
    bucketIndex: 4,
    fiveMinIndex: 29,
  });
  assert.equal(mapUtcToNyBucket("2024-11-01T01:30:00.000000000Z"), null);

  // 3. 5-minute interval label checks
  assert.equal(formatFiveMinLabel(0), "7:00-7:05 PM");
  assert.equal(formatFiveMinLabel(11), "7:55-8:00 PM");
  assert.equal(formatFiveMinLabel(12), "8:00-8:05 PM");
  assert.equal(formatFiveMinLabel(29), "9:25-9:30 PM");

  // 4. Contract expiry key (including 2019->2020 decade rollover) & average arithmetic
  assert.equal(getContractExpiryKey("MNQZ9", 2019), 201912);
  assert.equal(getContractExpiryKey("MNQH0", 2019), 202003);
  assert.ok(getContractExpiryKey("MNQZ9", 2019) < getContractExpiryKey("MNQH0", 2019));

  const fiveMinDay1 = createZeroFiveMinBuckets();
  fiveMinDay1[0] = 1;
  fiveMinDay1[6] = 2;
  fiveMinDay1[12] = 4;
  fiveMinDay1[18] = 6;
  fiveMinDay1[24] = 5;

  const fiveMinDay2 = createZeroFiveMinBuckets();
  fiveMinDay2[0] = 3;
  fiveMinDay2[6] = 4;
  fiveMinDay2[12] = 5;
  fiveMinDay2[18] = 7;
  fiveMinDay2[24] = 9;

  const fixture: DailyAsiaBuckets[] = [
    {
      nyDate: "2024-11-03",
      regime: "EST",
      season: "2024-2025",
      symbol: "MNQZ4",
      buckets: [1, 2, 4, 6, 5],
      fiveMinBuckets: fiveMinDay1,
    },
    {
      nyDate: "2024-11-04",
      regime: "EST",
      season: "2024-2025",
      symbol: "MNQZ4",
      buckets: [3, 4, 5, 7, 9],
      fiveMinBuckets: fiveMinDay2,
    },
  ];
  assert.equal(calcs.getAverageVolume7To8(fixture), 5);
  assert.equal(calcs.getAverageVolume8To9(fixture), 11);
  assert.equal(calcs.getAverageVolume7To8_30(fixture), 9.5);
  assert.equal(calcs.getAverageVolume8To9_30(fixture), 18);

  const avg5 = calcs.getFiveMinIntervalVolumes(fixture);
  assert.equal(avg5.length, FIVE_MIN_BUCKET_COUNT);
  assert.equal(avg5[0], 2);
  assert.equal(avg5[6], 3);
  assert.equal(avg5[12], 4.5);
  assert.equal(avg5[18], 6.5);
  assert.equal(avg5[24], 7);
}

/** Verifies dataset invariants (no Fri/Sat evenings, monotonic share, additive 30m & 5m buckets). */
export function runPostParseChecks(
  dataset: ParsedAsiaDataset,
  calcs: VolumeCalculators
): void {
  const { frontMonthDays, allOutrightDays, stats } = dataset;
  assert.equal(frontMonthDays.length, allOutrightDays.length);

  for (let i = 0; i < frontMonthDays.length; i++) {
    const front = frontMonthDays[i];
    const all = allOutrightDays[i];
    assert.equal(front.nyDate, all.nyDate);
    assert.equal(front.fiveMinBuckets.length, FIVE_MIN_BUCKET_COUNT);
    assert.equal(all.fiveMinBuckets.length, FIVE_MIN_BUCKET_COUNT);

    // No Friday (5) or Saturday (6) NY evenings (CME Globex closed)
    const dow = new Date(`${front.nyDate}T12:00:00Z`).getUTCDay();
    assert.ok(dow !== 5 && dow !== 6, `Unexpected Fri/Sat evening: ${front.nyDate}`);

    for (let b = 0; b < 5; b++) {
      assert.ok(
        front.buckets[b] <= all.buckets[b],
        `Front-month exceeded all-outright on ${front.nyDate} bucket ${b}`
      );

      // Every group of six 5-minute buckets must sum exactly to its parent 30-minute bucket
      let frontSum5 = 0;
      let allSum5 = 0;
      for (let j = b * 6; j < b * 6 + 6; j++) {
        frontSum5 += front.fiveMinBuckets[j];
        allSum5 += all.fiveMinBuckets[j];
      }
      assert.equal(
        frontSum5,
        front.buckets[b],
        `Front-month 5m sum mismatch on ${front.nyDate} 30m bucket ${b}`
      );
      assert.equal(
        allSum5,
        all.buckets[b],
        `All-outright 5m sum mismatch on ${all.nyDate} 30m bucket ${b}`
      );
    }
  }

  // Additive bucket identities on EST days
  const estDays = frontMonthDays.filter((d) => d.regime === "EST");
  const bucketAvgs = calcs.getAverageBucketVolumes(estDays);
  assert.ok(
    Math.abs(
      calcs.getAverageVolume7To8_30(estDays) -
        calcs.getAverageVolume7To8(estDays) -
        bucketAvgs[2]
    ) < 1e-6
  );
  assert.ok(
    Math.abs(
      calcs.getAverageVolume8To9_30(estDays) -
        calcs.getAverageVolume8To9(estDays) -
        bucketAvgs[4]
    ) < 1e-6
  );

  // Sum of 30 averaged 5-min buckets matches sum of 5 averaged 30-min buckets for EST & EDT complete
  for (const regime of ["EST", "EDT"] as const) {
    const completeDays = frontMonthDays.filter(
      (d) =>
        d.regime === regime &&
        isSeasonComplete(d.season, regime, stats.minUtcMinute, stats.maxUtcMinute)
    );
    const totalFrom30m = calcs
      .getAverageBucketVolumes(completeDays)
      .reduce((a, b) => a + b, 0);
    const totalFrom5m = calcs
      .getFiveMinIntervalVolumes(completeDays)
      .reduce((a, b) => a + b, 0);
    assert.ok(
      Math.abs(totalFrom5m - totalFrom30m) < 1e-6,
      `5m vs 30m average total mismatch for ${regime}`
    );
  }
}
