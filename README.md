# MNQ Asia Session Volume Analysis (`7:00–9:30 PM ET`)

Empirical comparison of **MNQ (Micro E-mini Nasdaq-100)** futures volume during the fall/winter EST shift—testing whether **7:00 PM NY** (which aligns with **9:00 AM Tokyo**) or **8:00 PM NY** ("ICT killzone") trades higher average volume over 1-hour (`7–8` vs `8–9`) and 1.5-hour (`7–8:30` vs `8–9:30`) windows.

Data source: Databento `GLBX.MDP3` `ohlcv-1m` for `MNQ.FUT` (`2019-05-05` to `2026-11-22`, `4,069,140` rows, `1,952` clean evenings).

---

## Results Summary

### 1. EST (Fall/Winter — when 7:00 PM NY = 9:00 AM Tokyo)

Across all **7 complete winter seasons** (`N = 622` evenings, front-month proxy = `98.11%` of outright EST volume):

- **1-Hour Comparison (`7:00–8:00` vs `8:00–9:00 PM EST`): `8:00–9:00 PM` wins consistently.**
  - Average contracts: **`17,192`** (`8–9`) vs **`15,530`** (`7–8`) — `7–8` is **9.67% lower**.
  - **`8:00–9:00 PM` won 7 out of 7 complete EST seasons** (and `8/8` including partial `2026-2027`), and also wins in the all-outrights cross-check (`17,573` vs `15,889`).

- **1.5-Hour Comparison (`7:00–8:30` vs `8:00–9:30 PM EST`): Virtually a tie, with a recent shift toward `7:00–8:30`.**
  - Pooled average: **`24,339`** (`7–8:30`) vs **`24,146`** (`8–9:30`) — `7–8:30` is **+0.80% higher**.
  - **2019–2023 (4 seasons)**: `8:00–9:30` won every season (`-2.43%` to `-4.85%`).
  - **2023–2026 (last 3 complete seasons)**: `7:00–8:30` won every season (`+6.08%`, `+6.40%`, `+3.98%`).
  - **2026–2027 (partial, first 15 evenings)**: `8:00–9:30` leads (`188,058` vs `181,211`, `-3.64%`).

### 2. 30-Minute EST Volume Profile (Complete Seasons, `N = 622`)

| Window (ET) | Avg Volume | Market Context |
|---|---:|---|
| **7:00–7:30 PM** | `8,410` | Clear **Tokyo 9:00 AM open** spike |
| **7:30–8:00 PM** | `7,120` | Post-open lull |
| **8:00–8:30 PM** | **`8,809`** | **Highest 30-minute bucket** (shared by both 1.5h windows) |
| **8:30–9:00 PM** | `8,384` | Sustained volume (**Hong Kong / Shanghai 9:30 AM open** at 8:30 PM EST) |
| **9:00–9:30 PM** | `6,954` | Quietest 30-minute bucket |

- In **1-hour** windows, `7–8` is dragged down by the `7:30–8:00` dip (`7,120`), whereas `8–9` captures both the `8:00–8:30` peak (`8,809`) and the `8:30–9:00` HK/China open (`8,384`).
- In **1.5-hour** windows, both intervals include the `8:00–8:30` peak, so it comes down to `7:00–8:00` (`15,530`) vs `8:30–9:30` (`15,338`), where the `9:00–9:30` drop-off makes them nearly equal—with `7:00–8:30` edging ahead in the last 3 full winters.

### 3. Control Group: EDT vs EST Comparison (`N = 1,185` EDT evenings)

- **`8:00–9:00` beats `7:00–8:00` by `+59.25%` in EDT** (`23,790` vs `14,939`), compared to only **`+10.70%` in EST** (`17,192` vs `15,530`).
- **`8:00–9:30` beats `7:00–8:30` by `+22.64%` in EDT** (`34,833` vs `28,402`), compared to a **tie (`-0.79%`) in EST** (`24,146` vs `24,339`).
- **Why the gap shrinks in EST**: When US clocks fall back, the `8:00–8:30 PM` bucket drops **34.6%** (`13,463` → `8,809`) while `7:00–7:30 PM` rises **17.2%** (`7,176` → `8,410`), and `9:00–9:30 PM` drops **37.0%** (`11,044` → `6,954`) as Hong Kong/China's 9:15–9:30 AM open shifts from `9:15–9:30 PM EDT` to `8:15–8:30 PM EST`.
- This confirms Tokyo's 9:00 AM open meaningfully pulls volume earlier in winter—`8:00–9:00 PM EST` keeps a smaller 1-hour edge mainly because `8:15–9:00 PM EST` catches the Hong Kong/China open.

### 4. Practical Takeaway

- For a **1-hour** winter (EST) Asia window, **`8:00–9:00 PM ET` has reliably higher volume** than `7:00–8:00 PM ET`.
- For a **1.5-hour** winter (EST) Asia window, **`7:00–8:30 PM ET` and `8:00–9:30 PM ET` have nearly identical total volume**, with `7:00–8:30` slightly stronger in recent full seasons because `7:00–7:30` beats `9:00–9:30`.

---

## Full Console Output

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

==========================================================================
2. PRIMARY RESULTS — EST (FALL/WINTER: 7:00 PM NY = 9:00 AM TOKYO)
==========================================================================

EST Front-Month Proxy — Complete Seasons Only (N = 622 evenings)
  1.0h | 7:00-8:00:   15,530 vs 8:00-9:00:   17,192 | Winner: 8:00-9:00 (1,662, -9.67% vs 8-9)
  1.5h | 7:00-8:30:   24,339 vs 8:00-9:30:   24,146 | Winner: 7:00-8:30 (193, +0.80% vs 8-9:30)

EST Front-Month Proxy — All EST Days (incl. partial seasons) (N = 637 evenings)
  1.0h | 7:00-8:00:   17,622 vs 8:00-9:00:   19,972 | Winner: 8:00-9:00 (2,349, -11.76% vs 8-9)
  1.5h | 7:00-8:30:   28,033 vs 8:00-9:30:   28,006 | Winner: 7:00-8:30 (27, +0.10% vs 8-9:30)

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

EST 30-Minute Bucket Profile (Front-Month Proxy, Complete Seasons) (N = 622 evenings)
  7:00-7:30 PM :    8,410  #############################
  7:30-8:00 PM :    7,120  ########################
  8:00-8:30 PM :    8,809  ##############################
  8:30-9:00 PM :    8,384  #############################
  9:00-9:30 PM :    6,954  ########################

==========================================================================
3. CONTROL GROUP — EDT (SPRING/SUMMER: 8:00 PM NY = 9:00 AM TOKYO)
==========================================================================

EDT Front-Month Proxy — Complete Seasons Only (N = 1185 evenings)
  1.0h | 7:00-8:00:   14,939 vs 8:00-9:00:   23,790 | Winner: 8:00-9:00 (8,851, -37.20% vs 8-9)
  1.5h | 7:00-8:30:   28,402 vs 8:00-9:30:   34,833 | Winner: 8:00-9:30 (6,431, -18.46% vs 8-9:30)

EDT 30-Minute Bucket Profile (Front-Month Proxy, Complete Seasons) (N = 1185 evenings)
  7:00-7:30 PM :    7,176  ################
  7:30-8:00 PM :    7,763  #################
  8:00-8:30 PM :   13,463  ##############################
  8:30-9:00 PM :   10,327  #######################
  9:00-9:30 PM :   11,044  #########################
```

---

## How to Reproduce (Data Download & Setup)

Raw market data is not included in this repository due to Databento / CME Group redistribution restrictions.

1. **Download the dataset from [Databento](https://databento.com/)** using these query parameters:
   - **Dataset**: `GLBX.MDP3` (CME Globex MDP 3.0)
   - **Schema**: `ohlcv-1m`
   - **Symbol**: `MNQ.FUT` (Parent symbology)
   - **Date Range**: `2019-05-05` (MNQ launch) to present
   - **Encoding**: `csv` (with `pretty_px`, `pretty_ts`, and `map_symbols` enabled)
   - **Compression**: `zstd` (or none)
2. **Decompress** (if downloaded as `.csv.zst`):
   ```bash
   zstd -d path/to/glbx-mdp3-*.ohlcv-1m.csv.zst
   ```
3. **Point the script to your CSV**:
   Update `CSV_PATH` at the top of `NQAsiaVolumeAnalysis.ts` to the path of your uncompressed `.csv` file.
4. **Install dependencies and run** from the project root:
   ```bash
   npm install
   npm start
   ```
