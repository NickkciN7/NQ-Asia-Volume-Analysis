import fs from "node:fs";
import readline from "node:readline";

// USA's time change in fall brings confusion about what time Asia session starts for trading nq futures.
// During summer etc it is 8 pm new york time that lines up with 9 am tokyo time. But in fall USA goes back 1 hour,
// So now 7 pm new york time syncs with 9 am tokyo time. Some believe it should still be 8 pm because of "ICT killzones"
// This script aims to determine what time frame actually has more volume traded on mnq.
// We shall compare 7-8 vs 8-9. And compare 7-8:30 vs 8-9:30 (as for example many trade 1.5 hours in new york).

const CSV_PATH =
  "/Users/nickd/Documents/Trading/databento/GLBX-20261124-4LBPW74B7H/glbx-mdp3-20161122-20261122.ohlcv-1m.csv";

interface OhlcvRow {
  ts_event: string;
  rtype: number;
  publisher_id: number;
  instrument_id: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
}

/**
 * Stream-parses the Databento OHLCV CSV file up to an optional row limit.
 */
async function parseCsv(filePath: string, limit?: number): Promise<OhlcvRow[]> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows: OhlcvRow[] = [];
  let isHeader = true;

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (isHeader) {
      isHeader = false;
      continue;
    }

    const [
      ts_event,
      rtype,
      publisher_id,
      instrument_id,
      open,
      high,
      low,
      close,
      volume,
      symbol,
    ] = line.split(",");

    rows.push({
      ts_event,
      rtype: Number(rtype),
      publisher_id: Number(publisher_id),
      instrument_id: Number(instrument_id),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      symbol: symbol.trim(),
    });

    if (limit !== undefined && rows.length >= limit) {
      rl.close();
      stream.destroy();
      break;
    }
  }

  return rows;
}

// Note these are all eastern time

function getAverageVolume7To8() {}

function getAverageVolume8To9() {}

function getAverageVolume7To8_30() {}

function getAverageVolume8To9_30() {}

function compareVolumes() {}

async function main() {
  const rows = await parseCsv(CSV_PATH, 5);
  console.log(`Loaded ${rows.length} rows:`);
  console.log(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
