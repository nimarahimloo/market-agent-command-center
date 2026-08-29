import { describe, expect, it } from "vitest";
import { parseFlatFileChunks } from "../shared/flatFile";

async function* chunks(text: string) {
  const bytes = new TextEncoder().encode(text);
  for (let index = 0; index < bytes.length; index += 7) yield bytes.slice(index, index + 7);
}

describe("Flat File streaming parser", () => {
  it("parses chunked CSV without requiring the whole file as one chunk", async () => {
    const result = await parseFlatFileChunks(chunks("timestamp,open,high,low,close\n2026-01-01,100,102,99,101\n2026-01-02,101,103,100,102\n"), "csv");
    expect(result.bars).toHaveLength(2);
    expect(result.firstTimestamp).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(result.errors).toEqual([]);
  });

  it("parses NDJSON and flags malformed and duplicate rows", async () => {
    const result = await parseFlatFileChunks(chunks('{"timestamp":1,"open":10,"high":11,"low":9,"close":10}\n{"timestamp":1,"open":10,"high":11,"low":9,"close":10}\nnot-json\n'), "ndjson");
    expect(result.bars).toHaveLength(2);
    expect(result.warnings).toContain("Duplicate timestamp at row 2.");
    expect(result.errors).toContain("Row 3 is not valid NDJSON.");
  });

  it("warns when the declared interval does not match the bars", async () => {
    const result = await parseFlatFileChunks(chunks("timestamp,open,high,low,close\n2026-01-01T00:00:00Z,100,101,99,100\n2026-01-02T00:00:00Z,100,101,99,100\n"), "csv", {}, "hour");
    expect(result.warnings.some(warning => warning.includes("expected hour"))).toBe(true);
  });

  it("reports missing OHLC and ordering/gap quality warnings", async () => {
    const result = await parseFlatFileChunks(chunks("timestamp,open,high,low,close\n2026-01-10,100,101,99,100\n2026-01-01,100,101,99,100\n2026-01-20,100,98,99,100\n"), "csv");
    expect(result.warnings).toEqual(expect.arrayContaining(["Out-of-order timestamp at row 3.", "Invalid OHLC geometry at row 4.", "Flat File interval mismatch or gap near row 4; expected day."]));
  });
});
