import { Hono } from 'hono';
import type { Env } from '../types';

export const transactions = new Hono<{ Bindings: Env }>();

interface TransactionRow {
  id: number;
  type: string;
  category_id: number;
  category_name: string;
  amount_cents: number;
  note: string;
  occurred_on: string;
}

interface TransactionRowNoName {
  id: number;
  type: string;
  category_id: number;
  amount_cents: number;
  note: string;
  occurred_on: string;
  created_at: string;
}

interface CategoryLookupRow {
  id: number;
  type: string;
  is_active: number;
}

interface TxBody {
  type?: unknown;
  category_id?: unknown;
  amount_cents?: unknown;
  note?: unknown;
  occurred_on?: unknown;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function errorResponse(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function isValidType(type: unknown): type is 'income' | 'expense' {
  return type === 'income' || type === 'expense';
}

function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_RE.test(dateStr)) return false;
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

async function fetchTransactionWithCategory(
  db: Env['DB'],
  id: number
): Promise<TransactionRow | null> {
  const row = await db
    .prepare(
      `SELECT t.id, t.type, t.category_id, c.name AS category_name, t.amount_cents, t.note, t.occurred_on
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.id = ?`
    )
    .bind(id)
    .first<TransactionRow>();
  return row ?? null;
}

transactions.get('/', async (c) => {
  const month = c.req.query('month');
  if (!month || !MONTH_RE.test(month)) {
    return c.json(errorResponse('validation_error', "month is required in 'YYYY-MM' format"), 400);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.type, t.category_id, c.name AS category_name, t.amount_cents, t.note, t.occurred_on
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.occurred_on LIKE ?
     ORDER BY t.occurred_on DESC, t.id DESC`
  )
    .bind(`${month}-%`)
    .all<TransactionRow>();

  return c.json({ transactions: results });
});

transactions.post('/', async (c) => {
  const body = await c.req.json<TxBody>().catch((): TxBody => ({}));

  const { type, category_id: categoryId, amount_cents: amountCents, occurred_on: occurredOn } = body;
  const note = typeof body.note === 'string' ? body.note : '';

  if (!isValidType(type)) {
    return c.json(errorResponse('validation_error', "type must be 'income' or 'expense'"), 400);
  }
  if (typeof categoryId !== 'number' || !Number.isInteger(categoryId)) {
    return c.json(errorResponse('validation_error', 'category_id must be an integer'), 400);
  }
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
    return c.json(errorResponse('validation_error', 'amount_cents must be a positive integer'), 400);
  }
  if (typeof occurredOn !== 'string' || !isValidCalendarDate(occurredOn)) {
    return c.json(errorResponse('validation_error', "occurred_on must be a valid 'YYYY-MM-DD' date"), 400);
  }

  const category = await c.env.DB.prepare(
    'SELECT id, type, is_active FROM categories WHERE id = ?'
  )
    .bind(categoryId)
    .first<CategoryLookupRow>();

  if (!category || category.is_active !== 1) {
    return c.json(errorResponse('validation_error', 'category not found or inactive'), 400);
  }
  if (category.type !== type) {
    return c.json(errorResponse('category_mismatch', 'category type does not match transaction type'), 400);
  }

  const inserted = await c.env.DB.prepare(
    `INSERT INTO transactions (type, category_id, amount_cents, note, occurred_on)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id`
  )
    .bind(type, categoryId, amountCents, note, occurredOn)
    .first<{ id: number }>();

  if (!inserted) {
    return c.json(errorResponse('internal', 'failed to create transaction'), 500);
  }

  const created = await fetchTransactionWithCategory(c.env.DB, inserted.id);
  return c.json(created, 201);
});

transactions.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) {
    return c.json(errorResponse('validation_error', 'invalid id'), 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id, type, category_id, amount_cents, note, occurred_on, created_at FROM transactions WHERE id = ?'
  )
    .bind(id)
    .first<TransactionRowNoName>();

  if (!existing) {
    return c.json(errorResponse('not_found', 'transaction not found'), 404);
  }

  const body = await c.req.json<TxBody>().catch((): TxBody => ({}));

  let type = existing.type as 'income' | 'expense';
  let categoryId = existing.category_id;
  let amountCents = existing.amount_cents;
  let note = existing.note;
  let occurredOn = existing.occurred_on;

  if (body.type !== undefined) {
    if (!isValidType(body.type)) {
      return c.json(errorResponse('validation_error', "type must be 'income' or 'expense'"), 400);
    }
    type = body.type;
  }
  if (body.category_id !== undefined) {
    if (typeof body.category_id !== 'number' || !Number.isInteger(body.category_id)) {
      return c.json(errorResponse('validation_error', 'category_id must be an integer'), 400);
    }
    categoryId = body.category_id;
  }
  if (body.amount_cents !== undefined) {
    if (
      typeof body.amount_cents !== 'number' ||
      !Number.isInteger(body.amount_cents) ||
      body.amount_cents <= 0
    ) {
      return c.json(errorResponse('validation_error', 'amount_cents must be a positive integer'), 400);
    }
    amountCents = body.amount_cents;
  }
  if (body.note !== undefined) {
    if (typeof body.note !== 'string') {
      return c.json(errorResponse('validation_error', 'note must be a string'), 400);
    }
    note = body.note;
  }
  if (body.occurred_on !== undefined) {
    if (typeof body.occurred_on !== 'string' || !isValidCalendarDate(body.occurred_on)) {
      return c.json(errorResponse('validation_error', "occurred_on must be a valid 'YYYY-MM-DD' date"), 400);
    }
    occurredOn = body.occurred_on;
  }

  if (body.category_id !== undefined || body.type !== undefined) {
    const category = await c.env.DB.prepare(
      'SELECT id, type, is_active FROM categories WHERE id = ?'
    )
      .bind(categoryId)
      .first<CategoryLookupRow>();

    if (!category || category.is_active !== 1) {
      return c.json(errorResponse('validation_error', 'category not found or inactive'), 400);
    }
    if (category.type !== type) {
      return c.json(errorResponse('category_mismatch', 'category type does not match transaction type'), 400);
    }
  }

  await c.env.DB.prepare(
    `UPDATE transactions
     SET type = ?, category_id = ?, amount_cents = ?, note = ?, occurred_on = ?
     WHERE id = ?`
  )
    .bind(type, categoryId, amountCents, note, occurredOn, id)
    .run();

  const updated = await fetchTransactionWithCategory(c.env.DB, id);
  return c.json(updated);
});

transactions.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) {
    return c.json(errorResponse('validation_error', 'invalid id'), 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM transactions WHERE id = ?')
    .bind(id)
    .first<{ id: number }>();

  if (!existing) {
    return c.json(errorResponse('not_found', 'transaction not found'), 404);
  }

  await c.env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});
