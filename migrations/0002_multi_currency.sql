-- 0002_multi_currency: per-transaction currency + entry-time fx snapshot + fx rate cache

ALTER TABLE transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'TWD';
ALTER TABLE transactions ADD COLUMN fx_rate REAL NOT NULL DEFAULT 1.0;
ALTER TABLE transactions ADD COLUMN base_cents INTEGER NOT NULL DEFAULT 0;

UPDATE transactions SET base_cents = amount_cents;

CREATE TABLE fx_rates (
  pair TEXT PRIMARY KEY,
  rate REAL NOT NULL,
  rate_utc TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
