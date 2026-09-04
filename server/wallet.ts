import { z } from "zod";

export const walletNetworkSchema = z.enum(["ethereum", "base", "arbitrum", "polygon", "solana"]);
export type WalletNetwork = z.infer<typeof walletNetworkSchema>;

type EvmNetwork = Exclude<WalletNetwork, "solana">;
const EVM_NETWORKS: Record<EvmNetwork, { chainId: number; symbol: string; rpcUrl: string; explorerUrl: string }> = {
  ethereum: { chainId: 1, symbol: "ETH", rpcUrl: "https://cloudflare-eth.com", explorerUrl: "https://etherscan.io/address/" },
  base: { chainId: 8453, symbol: "ETH", rpcUrl: "https://mainnet.base.org", explorerUrl: "https://basescan.org/address/" },
  arbitrum: { chainId: 42161, symbol: "ETH", rpcUrl: "https://arb1.arbitrum.io/rpc", explorerUrl: "https://arbiscan.io/address/" },
  polygon: { chainId: 137, symbol: "POL", rpcUrl: "https://polygon-rpc.com", explorerUrl: "https://polygonscan.com/address/" },
};

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validatePublicWalletAddress(network: WalletNetwork, address: string) {
  const trimmed = address.trim();
  return network === "solana" ? SOLANA_ADDRESS.test(trimmed) : EVM_ADDRESS.test(trimmed);
}

function formatUnits(value: bigint, decimals: number) {
  let base = BigInt(1);
  for (let index = 0; index < decimals; index += 1) {
    base *= BigInt(10);
  }
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function rpc(url: string, method: string, params: unknown[], timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }), signal: controller.signal });
    if (!response.ok) throw new Error(`Wallet provider HTTP ${response.status}`);
    const payload = await response.json() as { result?: unknown; error?: { message?: string } };
    if (payload.error) throw new Error(payload.error.message || "Wallet provider RPC error");
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchReadOnlyWalletPortfolio(input: { network: WalletNetwork; address: string }) {
  const address = input.address.trim();
  if (!validatePublicWalletAddress(input.network, address)) throw new Error(`Invalid public ${input.network} address`);
  const retrievedAt = new Date().toISOString();
  if (input.network === "solana") {
    const result = await rpc(SOLANA_RPC, "getBalance", [address, { commitment: "confirmed" }]) as { value?: number };
    const lamports = BigInt(result?.value ?? 0);
    return { network: input.network, address, assets: [{ symbol: "SOL", name: "Solana", amount: formatUnits(lamports, 9), rawAmount: lamports.toString(), decimals: 9, kind: "native" as const }], provider: "Solana JSON-RPC", retrievedAt, source: SOLANA_RPC, scope: "native-balance-only" as const, warnings: ["Token, NFT, and DeFi positions are not included by the public RPC adapter."] };
  }
  const network = EVM_NETWORKS[input.network];
  const result = await rpc(network.rpcUrl, "eth_getBalance", [address, "latest"]) as string;
  const wei = BigInt(result || "0x0");
  return { network: input.network, address, assets: [{ symbol: network.symbol, name: network.symbol === "POL" ? "Polygon" : "Native balance", amount: formatUnits(wei, 18), rawAmount: wei.toString(), decimals: 18, kind: "native" as const }], provider: `${input.network} public JSON-RPC`, retrievedAt, source: network.rpcUrl, chainId: network.chainId, explorerUrl: `${network.explorerUrl}${address}`, scope: "native-balance-only" as const, warnings: ["Token, NFT, and DeFi positions are not included by the public RPC adapter."] };
}
