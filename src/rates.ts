import type { Env } from './types';

export const SUPPORTED_CURRENCIES = ['TWD', 'USD', 'JPY', 'EUR', 'CNY'] as const;

export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(x: unknown): x is Currency {
  return typeof x === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(x);
}

export class RatesUnavailableError extends Error {
  constructor(message = 'exchange rate source unreachable') {
    super(message);
    this.name = 'RatesUnavailableError';
  }
}

interface FxRateRow {
  pair: string;
  rate: number;
  rate_utc: string;
  fetched_at: string;
}

type RterResponse = Record<string, { Exrate: number; UTC: string }>;

const CACHE_TTL_MS = 60 * 60 * 1000;
const RTER_URL = 'https://tw.rter.info/capi.php';

// Currencies other than TWD/USD are looked up via the "USD<currency>" pair
// from the rter.info API (all pairs are USD-based).
const NON_USD_CURRENCIES = SUPPORTED_CURRENCIES.filter((c) => c !== 'TWD' && c !== 'USD');

function pairFor(currency: Currency): string {
  return `USD${currency}`;
}

function rateToTwdFromUsdBased(currency: Currency, usdTwd: number, usdPair: number): number | null {
  // rate to TWD for currency C = USDTWD / USDC (TWD = 1, USD = USDTWD)
  if (currency === 'TWD') return 1;
  if (currency === 'USD') return usdTwd;
  if (!Number.isFinite(usdPair) || usdPair <= 0) return null;
  return usdTwd / usdPair;
}

function buildRatesFromRows(rows: FxRateRow[]): { rates: Record<Currency, number>; fetched_at: string } | null {
  const byPair = new Map<string, FxRateRow>();
  for (const row of rows) {
    byPair.set(row.pair, row);
  }

  // The anchor pair is USDTWD (stored under pairFor('TWD')) — NOT pairFor('USD'),
  // which would be the degenerate USDUSD=1 and silently turn every rate into
  // a to-USD rate instead of to-TWD.
  const usdTwdRow = byPair.get(pairFor('TWD'));
  if (!usdTwdRow || !Number.isFinite(usdTwdRow.rate) || usdTwdRow.rate <= 0) {
    return null;
  }

  const rates: Partial<Record<Currency, number>> = { TWD: 1, USD: usdTwdRow.rate };
  let oldestFetchedAt: string | null = null;

  for (const currency of NON_USD_CURRENCIES) {
    const row = byPair.get(pairFor(currency));
    if (!row || !Number.isFinite(row.rate) || row.rate <= 0) {
      return null;
    }
    const rate = rateToTwdFromUsdBased(currency, usdTwdRow.rate, row.rate);
    if (rate === null || !Number.isFinite(rate) || rate <= 0) {
      return null;
    }
    rates[currency] = rate;
  }

  for (const row of rows) {
    if (oldestFetchedAt === null || row.fetched_at < oldestFetchedAt) {
      oldestFetchedAt = row.fetched_at;
    }
  }

  // All supported currencies must be present in the cache.
  for (const currency of SUPPORTED_CURRENCIES) {
    if (rates[currency] === undefined) {
      return null;
    }
  }

  return {
    rates: rates as Record<Currency, number>,
    fetched_at: oldestFetchedAt ?? new Date(0).toISOString(),
  };
}

async function readCache(db: Env['DB']): Promise<FxRateRow[]> {
  const { results } = await db
    .prepare('SELECT pair, rate, rate_utc, fetched_at FROM fx_rates')
    .all<FxRateRow>();
  return results;
}

function isFresh(rows: FxRateRow[]): boolean {
  if (rows.length === 0) return false;
  let newestFetchedAt: string | null = null;
  for (const row of rows) {
    if (newestFetchedAt === null || row.fetched_at > newestFetchedAt) {
      newestFetchedAt = row.fetched_at;
    }
  }
  if (newestFetchedAt === null) return false;
  const age = Date.now() - new Date(newestFetchedAt).getTime();
  return Number.isFinite(age) && age < CACHE_TTL_MS;
}

async function fetchFromSource(): Promise<RterResponse | null> {
  try {
    const res = await fetch(RTER_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (typeof data !== 'object' || data === null) return null;
    return data as RterResponse;
  } catch {
    return null;
  }
}

async function upsertCache(db: Env['DB'], data: RterResponse, fetchedAt: string): Promise<boolean> {
  const usdTwdEntry = data[pairFor('TWD')];
  if (
    !usdTwdEntry ||
    typeof usdTwdEntry.Exrate !== 'number' ||
    !Number.isFinite(usdTwdEntry.Exrate) ||
    usdTwdEntry.Exrate <= 0
  ) {
    return false;
  }

  const statements = [];

  statements.push(
    db
      .prepare(
        `INSERT INTO fx_rates (pair, rate, rate_utc, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(pair) DO UPDATE SET rate = excluded.rate, rate_utc = excluded.rate_utc, fetched_at = excluded.fetched_at`
      )
      .bind(pairFor('TWD'), usdTwdEntry.Exrate, usdTwdEntry.UTC, fetchedAt)
  );

  for (const currency of NON_USD_CURRENCIES) {
    const pair = pairFor(currency);
    const entry = data[pair];
    if (!entry || typeof entry.Exrate !== 'number' || !Number.isFinite(entry.Exrate) || entry.Exrate <= 0) {
      return false;
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO fx_rates (pair, rate, rate_utc, fetched_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(pair) DO UPDATE SET rate = excluded.rate, rate_utc = excluded.rate_utc, fetched_at = excluded.fetched_at`
        )
        .bind(pair, entry.Exrate, entry.UTC, fetchedAt)
    );
  }

  await db.batch(statements);
  return true;
}

export async function getRatesToTWD(
  db: Env['DB']
): Promise<{ rates: Record<Currency, number>; fetched_at: string }> {
  const cachedRows = await readCache(db);

  if (isFresh(cachedRows)) {
    const built = buildRatesFromRows(cachedRows);
    if (built) return built;
  }

  const fetched = await fetchFromSource();

  if (fetched) {
    const fetchedAt = new Date().toISOString();
    const ok = await upsertCache(db, fetched, fetchedAt);
    if (ok) {
      const freshRows = await readCache(db);
      const built = buildRatesFromRows(freshRows);
      if (built) return built;
    }
  }

  // Fetch failed or produced unusable data — fall back to stale cache if any.
  const staleBuilt = buildRatesFromRows(cachedRows);
  if (staleBuilt) return staleBuilt;

  throw new RatesUnavailableError();
}
