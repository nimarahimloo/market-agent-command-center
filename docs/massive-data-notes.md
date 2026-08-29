# Massive historical data notes

The official Massive site states that its REST and WebSocket APIs provide real-time and historical market data, while Flat Files provide bulk historical CSV datasets for backtesting. The documentation groups REST and flat-file coverage under stocks, options, futures, indices, forex, crypto, economy, and alternative datasets.

Official references:

- https://massive.com/
- https://massive.com/docs
- https://massive.com/docs/rest/quickstart
- https://massive.com/docs/flat-files/quickstart

Implementation decision: use the REST API first for bounded historical OHLCV requests inside the web application; keep a provider adapter boundary so bulk Flat Files can be added later for large backtests. The API key must remain server-side. Every response must preserve provider, symbol, range, interval, timezone, adjustment status, retrieval time, and data-quality warnings. Live order routing remains disabled.
