# MNQ Asia Session Volume Analysis (`7:00–9:30 PM ET`)

Empirical comparison of **MNQ (Micro E-mini Nasdaq-100)** futures volume during the fall/winter EST shift—testing whether **7:00 PM NY** (9:00 AM Tokyo) or **8:00 PM NY** ("ICT killzone") trades higher average volume across 1h, 1.5h, 30m, 15m, 10m, and 5m intervals.

**Dataset**: Databento `GLBX.MDP3` `ohlcv-1m` (`MNQ.FUT`, `2019-05-05` to `2026-11-22`, `4,069,140` rows, `1,952` clean evenings; front-month proxy = `98.11%` of EST outright volume).

---

## Key Takeaways (Complete Seasons: `N = 622` EST, `N = 1,185` EDT)

| Comparison | **EST** (Winter: 9 AM Tokyo = 7 PM NY) | **EDT** (Summer: 9 AM Tokyo = 8 PM NY) |
|---|---|---|
| **1.0h (`7–8` vs `8–9`)** | **`8–9` wins** (`17,192` vs `15,530`, `7–8` is **-9.67%**) — won **7/7** winters | **`8–9` wins** (`23,790` vs `14,939`, `+59.25%` over `7–8`) |
| **1.5h (`7–8:30` vs `8–9:30`)** | **Dead heat** (`24,339` vs `24,146`, **+0.80%**) — `7–8:30` won last **3/3** full winters | **`8–9:30` wins** (`34,833` vs `28,402`, `+22.64%` over `7–8:30`) |

- **Why `8–9 PM EST` still wins the 1-hour window**: Tokyo's 9:00 AM open *does* pull volume earlier in winter (`8–9`'s lead drops from **+59.3%** in EDT to **+10.7%** in EST), but `7:30–8:00` dips while `8:00–9:00` captures both the `8:00` top-of-hour peak and the Hong Kong / Shanghai opens (`8:15–8:30 PM EST`).
- **Granular peak windows in EST**: Across 5m, 10m, and 15m intervals, volume clusters around three opens—**`8:00–8:15`** (#1), **`8:30–8:45`** (#2, HK/Shanghai cash open), and **`7:00–7:15`** (#3, Tokyo cash open)—with **`8:00–8:05 PM`** as the single highest 5-minute bar in both EST (`1,799`) and EDT (`2,992`).
- **Practical takeaway**: For a **1h** winter session, **`8:00–9:00 PM ET`** has consistently more volume. For a **1.5h** winter session, **`7:00–8:30`** and **`8:00–9:30`** are nearly equal (with `7:00–8:30` slightly stronger in `2023–2026`).

---

## 30-Minute Volume Profile (Complete Seasons)

| Window (ET) | EST Avg (`N=622`) | EDT Avg (`N=1,185`) | Market Context (EST) |
|---|---:|---:|---|
| **7:00–7:30 PM** | `8,410` | `7,176` | Tokyo 9:00 AM cash open |
| **7:30–8:00 PM** | `7,120` | `7,763` | Post-open lull |
| **8:00–8:30 PM** | **`8,809`** | **`13,463`** | **Peak bucket** (8:00 mark + 8:15 HK futures open) |
| **8:30–9:00 PM** | `8,384` | `10,327` | HK / Shanghai 9:30 AM cash open |
| **9:00–9:30 PM** | `6,954` | `11,044` | Quietest EST bucket (9:15 HK futures in EDT) |

---

## 15-Minute Interval Volume (Complete Seasons)

| Interval (ET) | EST Avg (`N=622`) | EDT Avg (`N=1,185`) |
|---|---:|---:|
| **7:00–7:15 PM** | `4,495` | `3,751` |
| **7:15–7:30 PM** | `3,915` | `3,425` |
| **7:30–7:45 PM** | `3,517` | `3,629` |
| **7:45–8:00 PM** | `3,604` | `4,134` |
| **8:00–8:15 PM** | **`4,695`** | **`7,498`** |
| **8:15–8:30 PM** | `4,114` | `5,965` |
| **8:30–8:45 PM** | `4,535` | `5,321` |
| **8:45–9:00 PM** | `3,849` | `5,006` |
| **9:00–9:15 PM** | `3,674` | `5,747` |
| **9:15–9:30 PM** | `3,280` | `5,296` |

<details>
<summary><strong>10-Minute Interval Table (15 rows)</strong></summary>

| Interval (ET) | EST Avg (`N=622`) | EDT Avg (`N=1,185`) |
|---|---:|---:|
| 7:00–7:10 PM | `3,212` | `2,616` |
| 7:10–7:20 PM | `2,725` | `2,282` |
| 7:20–7:30 PM | `2,474` | `2,278` |
| 7:30–7:40 PM | `2,441` | `2,459` |
| 7:40–7:50 PM | `2,273` | `2,679` |
| 7:50–8:00 PM | `2,407` | `2,625` |
| **8:00–8:10 PM** | **`3,312`** | **`5,360`** |
| 8:10–8:20 PM | `2,903` | `4,442` |
| 8:20–8:30 PM | `2,594` | `3,661` |
| 8:30–8:40 PM | `3,191` | `3,644` |
| 8:40–8:50 PM | `2,673` | `3,458` |
| 8:50–9:00 PM | `2,519` | `3,224` |
| 9:00–9:10 PM | `2,541` | `4,014` |
| 9:10–9:20 PM | `2,294` | `3,654` |
| 9:20–9:30 PM | `2,119` | `3,376` |

</details>

<details>
<summary><strong>5-Minute Interval Table (30 rows)</strong></summary>

| Interval (ET) | EST Avg (`N=622`) | EDT Avg (`N=1,185`) |
|---|---:|---:|
| 7:00–7:05 PM | `1,781` | `1,398` |
| 7:05–7:10 PM | `1,431` | `1,218` |
| 7:10–7:15 PM | `1,283` | `1,135` |
| 7:15–7:20 PM | `1,441` | `1,147` |
| 7:20–7:25 PM | `1,270` | `1,166` |
| 7:25–7:30 PM | `1,204` | `1,113` |
| 7:30–7:35 PM | `1,274` | `1,298` |
| 7:35–7:40 PM | `1,167` | `1,160` |
| 7:40–7:45 PM | `1,076` | `1,170` |
| 7:45–7:50 PM | `1,197` | `1,509` |
| 7:50–7:55 PM | `1,190` | `1,348` |
| 7:55–8:00 PM | `1,217` | `1,277` |
| **8:00–8:05 PM** | **`1,799`** | **`2,992`** |
| 8:05–8:10 PM | `1,513` | `2,368` |
| 8:10–8:15 PM | `1,383` | `2,138` |
| 8:15–8:20 PM | `1,520` | `2,304` |
| 8:20–8:25 PM | `1,347` | `1,921` |
| 8:25–8:30 PM | `1,247` | `1,741` |
| 8:30–8:35 PM | `1,713` | `1,921` |
| 8:35–8:40 PM | `1,478` | `1,723` |
| 8:40–8:45 PM | `1,344` | `1,677` |
| 8:45–8:50 PM | `1,329` | `1,781` |
| 8:50–8:55 PM | `1,277` | `1,658` |
| 8:55–9:00 PM | `1,242` | `1,566` |
| 9:00–9:05 PM | `1,374` | `2,154` |
| 9:05–9:10 PM | `1,167` | `1,860` |
| 9:10–9:15 PM | `1,133` | `1,734` |
| 9:15–9:20 PM | `1,161` | `1,920` |
| 9:20–9:25 PM | `1,095` | `1,759` |
| 9:25–9:30 PM | `1,023` | `1,617` |

</details>

<details>
<summary><strong>Per-Season EST Breakdown &amp; Full Console Output</strong></summary>

```text
==========================================================================
MNQ ASIA SESSION VOLUME ANALYSIS (7:00-9:30 PM AMERICA/NEW_YORK)
==========================================================================
1. DATASET SUMMARY
  UTC Range              : 2019-05-05T22:03Z -> 2026-11-22T23:59Z
  Total CSV Rows Scanned : 4,069,140
  Outright Rows in Window: 409,831
  Calendar Spreads Skipped: 3,991
  Clean Active Evenings  : 1952 total (637 EST, 1315 EDT)
  Truncated Edge Days    : None
  Zero-Bucket Outage Days: 2020-06-30 (EDT, MNQU0: [0, 0, 3275, 3205, 4096])
  EST Front-Month Share  : 98.11% of total EST outright volume

EST Front-Month Proxy — Complete Seasons Only (N = 622 evenings)
  1.0h | 7:00-8:00:   15,530 vs 8:00-9:00:   17,192 | Winner: 8:00-9:00 (1,662, -9.67% vs 8-9)
  1.5h | 7:00-8:30:   24,339 vs 8:00-9:30:   24,146 | Winner: 7:00-8:30 (193, +0.80% vs 8-9:30)

EST All-Outrights Cross-Check — Complete Seasons Only (N = 622 evenings)
  1.0h | 7:00-8:00:   15,889 vs 8:00-9:00:   17,573 | Winner: 8:00-9:00 (1,683, -9.58% vs 8-9)
  1.5h | 7:00-8:30:   24,882 vs 8:00-9:30:   24,674 | Winner: 7:00-8:30 (208, +0.84% vs 8-9:30)

Per-Season EST Breakdown (Front-Month Proxy):
  Season     | Status   | Days |   Avg 7-8 |   Avg 8-9 | Win (1h) |  Diff % | Avg 7-8:30 | Avg 8-9:30 | Win (1.5h) |  Diff %
  -----------+----------+------+-----------+-----------+----------+---------+------------+------------+------------+--------
  2019-2020  | Complete |   88 |     6,104 |     6,945 | 8-9      | -12.11% |      9,572 |      9,810 | 8-9:30     |  -2.43%
  2020-2021  | Complete |   93 |    13,768 |    16,028 | 8-9      | -14.10% |     21,901 |     22,748 | 8-9:30     |  -3.72%
  2021-2022  | Complete |   89 |    18,218 |    22,045 | 8-9      | -17.36% |     29,174 |     30,663 | 8-9:30     |  -4.85%
  2022-2023  | Complete |   88 |    10,260 |    12,031 | 8-9      | -14.72% |     16,145 |     16,669 | 8-9:30     |  -3.14%
  2023-2024  | Complete |   88 |     9,542 |    10,132 | 8-9      |  -5.83% |     14,779 |     13,931 | 7-8:30     |  +6.08%
  2024-2025  | Complete |   88 |    19,649 |    20,147 | 8-9      |  -2.47% |     30,057 |     28,249 | 7-8:30     |  +6.40%
  2025-2026  | Complete |   88 |    31,240 |    33,030 | 8-9      |  -5.42% |     48,829 |     46,958 | 7-8:30     |  +3.98%
  2026-2027  | PARTIAL  |   15 |   104,371 |   135,218 | 8-9      | -22.81% |    181,211 |    188,058 | 8-9:30     |  -3.64%

  Season Consistency (Complete EST Seasons): 7-8 won 0/7 | 7-8:30 won 3/7
```

</details>

---

## How to Reproduce

Raw market data is omitted due to Databento / CME Group redistribution restrictions.

1. **Download from [Databento](https://databento.com/)**:
   - **Dataset**: `GLBX.MDP3` | **Schema**: `ohlcv-1m` | **Symbol**: `MNQ.FUT` (`parent`)
   - **Range**: `2019-05-05` to present | **Encoding**: `csv` (`pretty_px`, `pretty_ts`, `map_symbols`) | **Compression**: `zstd`
2. **Decompress**:
   ```bash
   zstd -d path/to/glbx-mdp3-*.ohlcv-1m.csv.zst
   ```
3. **Set `CSV_PATH`** at the top of `NQAsiaVolumeAnalysis.ts` to your `.csv` path.
4. **Install & run**:
   ```bash
   npm install
   npm start
   ```
