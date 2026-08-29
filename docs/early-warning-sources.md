# Early-warning source notes

GDELT DOC 2.0 provides a full-text search API over global news coverage, supports JSON output, and describes coverage across 65 languages with historical search windows. It is suitable for broad discovery and event clustering, but it should be treated as an alert/discovery source rather than a guarantee of first publication or trading advantage.

CNBC publishes official RSS/feed entry points for markets, business, investing, technology, politics, and related sections. Its page also states that market data may be delayed and points to market-data terms and licensing. Any production ingestion should preserve source URL, publication timestamp, retrieval timestamp, source tier, and licensing status.

Design implication: the radar should use multiple tiers—official agency/company releases, exchange/provider data, reputable financial media, and broad discovery feeds—then show corroboration and freshness instead of claiming complete internet coverage.
