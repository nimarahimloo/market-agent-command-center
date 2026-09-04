# Read-only wallet provider notes

The wallet adapter currently uses public JSON-RPC endpoints for native-balance reads only. This avoids storing credentials and does not provide signing, custody, transfers, or withdrawals.

The Ethereum JSON-RPC reference documents stateless account queries such as `eth_getBalance`: [Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/).

For a future token/DeFi/NFT portfolio expansion, an indexed provider is required rather than a bare RPC endpoint. Candidate official references reviewed: [Etherscan API](https://docs.etherscan.io/introduction), [Alchemy Portfolio API](https://www.alchemy.com/docs/data/portfolio-apis/portfolio-api-endpoints/portfolio-api-endpoints/get-token-balances-by-address), [Moralis Token Balances](https://docs.moralis.com/data-api/evm/wallet/token-balances), and [Zerion API](https://developers.zerion.io/introduction). Credentials, if later required, must be stored as server-side secrets and limited to read-only permissions.
