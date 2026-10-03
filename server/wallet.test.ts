import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReadOnlyWalletPortfolio, normalizeZerionPortfolioResponse, validatePublicWalletAddress } from "./wallet";

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


  it("normalizes indexed token, DeFi, and NFT positions without fabricating missing values", () => {
    const result = normalizeZerionPortfolioResponse({
      positions: { data: [{ id: "token-1", attributes: { quantity: { numeric: "2.5", int: "2500000", decimals: 6 }, value: 100, price: 40, chain_id: "ethereum", fungible_info: { symbol: "USDC", name: "USD Coin" } } }] },
      defi: { data: [{ id: "defi-1", attributes: { quantity: { numeric: "1", int: "1", decimals: 0 }, value: 50, chain_id: "ethereum", fungible_info: { symbol: "LP", name: "LP position" }, protocol: { name: "Example" } } }] },
      nfts: { data: [{ id: "nft-1", attributes: { name: "Collectible", chain_id: "ethereum", collection: { name: "Collection" }, market_data: { prices: {} } } }] },
    }, { network: "ethereum", address: "0x0000000000000000000000000000000000000001", retrievedAt: "2026-01-01T00:00:00.000Z" });
    expect(result.scope).toBe("indexed-portfolio");
    expect(result.assets.map(asset => asset.kind)).toEqual(["token", "defi", "nft"]);
    expect(result.totals.totalValueUsd).toBe(150);
    expect(result.totals.nftValueUsd).toBeNull();
    expect(result.warnings[0]).toContain("no provider valuation");
  });
  afterEach(() => vi.restoreAllMocks());
});
