// api.ts — typed fetch layer. Every network call in the app goes through here.
// Nothing else in the codebase should call fetch() directly against /api.

export type TxType = 'income' | 'expense';

export interface Category {
  id: number;
  name: string;
  type: TxType;
  sort_order: number;
}

export interface Transaction {
  id: number;
  type: TxType;
  category_id: number;
  category_name: string;
  amount_cents: number;
  currency: string;
  fx_rate: number;
  base_cents: number;
  note: string | null;
  occurred_on: string; // YYYY-MM-DD
}

export interface SummaryCategoryShare {
  category_id: number;
  category_name: string;
  total: number;
  pct: number;
}

export interface Summary {
  month?: string;
  start?: string;
  end?: string;
  income_total: number;
  expense_total: number;
  balance: number;
  by_category: SummaryCategoryShare[];
}

/** An explicit start/end (both inclusive, YYYY-MM-DD) date range. */
export interface DateRange {
  start: string;
  end: string;
}

export interface NewTransactionInput {
  type: TxType;
  category_id: number;
  amount_cents: number;
  currency?: string;
  note?: string;
  occurred_on: string;
}

export interface PatchTransactionInput {
  type?: TxType;
  category_id?: number;
  amount_cents?: number;
  currency?: string;
  note?: string | null;
  occurred_on?: string;
}

export interface RatesResponse {
  base: string;
  rates: Record<string, number>;
  fetched_at: string;
}

export interface PatchCategoryInput {
  name?: string;
  sort_order?: number;
}

/** Thrown for every failed request. `status` is 0 for network-level failures. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

interface ApiErrorBody {
  error: { code: string; message: string };
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as Record<string, unknown>).error;
  if (typeof err !== 'object' || err === null) return false;
  const rec = err as Record<string, unknown>;
  return typeof rec.code === 'string' && typeof rec.message === 'string';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    if (init?.body) headers['Content-Type'] = 'application/json';
    res = await fetch(path, { credentials: 'include', ...init, headers });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.');
  }

  const raw = await res.text();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    if (isApiErrorBody(parsed)) {
      throw new ApiError(res.status, parsed.error.code, parsed.error.message);
    }
    if (res.status === 401) {
      throw new ApiError(401, 'unauthorized', 'Not logged in.');
    }
    throw new ApiError(res.status, 'unknown_error', res.statusText || 'Request failed.');
  }

  return parsed as T;
}

// ---- auth ----

export function login(passcode: string): Promise<{ ok: true }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ passcode }) });
}

export function logout(): Promise<void> {
  return request('/api/auth/logout', { method: 'POST' });
}

// ---- categories ----

export async function getCategories(): Promise<Category[]> {
  const res = await request<{ categories: Category[] }>('/api/categories');
  return res.categories;
}

export function createCategory(name: string, type: TxType): Promise<Category> {
  return request('/api/categories', { method: 'POST', body: JSON.stringify({ name, type }) });
}

export function patchCategory(id: number, patch: PatchCategoryInput): Promise<Category> {
  return request(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteCategory(id: number): Promise<{ deleted: 'soft' | 'hard' }> {
  return request(`/api/categories/${id}`, { method: 'DELETE' });
}

// ---- transactions ----

export async function getTransactions(month: string): Promise<Transaction[]> {
  const res = await request<{ transactions: Transaction[] }>(
    `/api/transactions?month=${encodeURIComponent(month)}`,
  );
  return res.transactions;
}

export function createTransaction(input: NewTransactionInput): Promise<Transaction> {
  return request('/api/transactions', { method: 'POST', body: JSON.stringify(input) });
}

export function patchTransaction(id: number, patch: PatchTransactionInput): Promise<Transaction> {
  return request(`/api/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteTransaction(id: number): Promise<{ ok: true }> {
  return request(`/api/transactions/${id}`, { method: 'DELETE' });
}

// ---- summary ----

/** Fetches a summary for a whole month ("YYYY-MM") or an explicit {start,end} range (both inclusive). */
export function getSummary(period: string | DateRange): Promise<Summary> {
  if (typeof period === 'string') {
    return request(`/api/summary?month=${encodeURIComponent(period)}`);
  }
  return request(
    `/api/summary?start=${encodeURIComponent(period.start)}&end=${encodeURIComponent(period.end)}`,
  );
}

// ---- rates ----

export function getRates(): Promise<RatesResponse> {
  return request('/api/rates');
}

// ---- money helpers ----

/** Canonical currency order for UI display; TWD (base) always first. */
export const CURRENCY_ORDER = ['TWD', 'USD', 'JPY', 'EUR', 'CNY'] as const;

const CURRENCY_SYMBOLS: Record<string, string> = {
  TWD: 'NT$',
  USD: 'US$',
  JPY: '¥',
  EUR: '€',
  CNY: 'CN¥',
};

/** Symbol used inside the currency picker (TWD shows "NT$" there, unlike plain "$" elsewhere). */
export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

/** Parses user input like "120", "120.5", "1,204.30" into integer cents. Returns null if invalid. */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Formats integer cents as "$1,234.56". `signed` adds a leading + for positive amounts. */
export function formatCents(cents: number, signed = false): string {
  const sign = cents < 0 ? '-' : signed && cents > 0 ? '+' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const dollarsStr = dollars.toLocaleString('en-US');
  const centsStr = remainder.toString().padStart(2, '0');
  return `${sign}$${dollarsStr}.${centsStr}`;
}

/**
 * Formats integer cents in a given currency with its symbol, e.g. "US$12.50", "¥1,200".
 * JPY has no minor unit, so it renders with no decimals (storage remains cents ×100).
 */
export function formatCurrencyCents(cents: number, currency: string, signed = false): string {
  const symbol = currencySymbol(currency);
  const sign = cents < 0 ? '-' : signed && cents > 0 ? '+' : '';
  const abs = Math.abs(cents);
  if (currency === 'JPY') {
    const units = Math.round(abs / 100);
    return `${sign}${symbol}${units.toLocaleString('en-US')}`;
  }
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const dollarsStr = dollars.toLocaleString('en-US');
  const centsStr = remainder.toString().padStart(2, '0');
  return `${sign}${symbol}${dollarsStr}.${centsStr}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${names[(m ?? 1) - 1]} ${y}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const base = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + delta, 1));
  const yy = base.getUTCFullYear();
  const mm = (base.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${yy}-${mm}`;
}

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
}

export function todayIso(): string {
  const now = new Date();
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const dd = now.getDate().toString().padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function formatIsoUtc(d: Date): string {
  const yy = d.getUTCFullYear();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function parseIsoUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/** A single-day range (start === end === the given date). */
export function dayRange(iso: string): DateRange {
  return { start: iso, end: iso };
}

/** The Monday–Sunday week (Taiwan convention) containing the given date. */
export function weekRange(iso: string): DateRange {
  const date = parseIsoUtc(iso);
  const dow = date.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: formatIsoUtc(monday), end: formatIsoUtc(sunday) };
}
