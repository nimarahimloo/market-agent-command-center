import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReadOnlyWalletPortfolio, validatePublicWalletAddress } from "./wallet";

describe("read-only wallet safety", () => {
  it("accepts valid EVM public addresses and rejects private-key-like input", () => {
    expect(validatePublicWalletAddress("ethereum", "0x0000000000000000000000000000000000000001")).toBe(true);
    expect(validatePublicWalletAddress("base", "0x123")).toBe(false);
    expect(validatePublicWalletAddress("ethereum", "0x0123456789012345678901234567890123456789012345678901234567890123")).toBe(false);
  });

  it("accepts a Solana public address shape", () => {
    expect(validatePublicWalletAddress("solana", "11111111111111111111111111111111")).toBe(true);
    expect(validatePublicWalletAddress("solana", "seed phrase never belongs here")).toBe(false);
  });

  it("normalizes an RPC native balance and retains provider provenance", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ result: "0xde0b6b3a7640000" }), { status: 200 }));
    const result = await fetchReadOnlyWalletPortfolio({ network: "ethereum", address: "0x0000000000000000000000000000000000000001" });
    expect(result.assets[0]?.amount).toBe("1");
    expect(result.scope).toBe("native-balance-only");
    expect(result.provider).toContain("public JSON-RPC");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  afterEach(() => vi.restoreAllMocks());
});
