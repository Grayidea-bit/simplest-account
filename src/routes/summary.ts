import { Hono } from 'hono';
import type { Env } from '../types';

export const summary = new Hono<{ Bindings: Env }>();

interface TotalsRow {
  type: string;
  total: number;
}

interface CategoryTotalRow {
  category_id: number;
  category_name: string;
  total: number;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function errorResponse(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

summary.get('/', async (c) => {
  const month = c.req.query('month');
  if (!month || !MONTH_RE.test(month)) {
    return c.json(errorResponse('validation_error', "month is required in 'YYYY-MM' format"), 400);
  }

  const likePattern = `${month}-%`;

  const { results: totalsResults } = await c.env.DB.prepare(
    `SELECT type, COALESCE(SUM(base_cents), 0) AS total
     FROM transactions
     WHERE occurred_on LIKE ?
     GROUP BY type`
  )
    .bind(likePattern)
    .all<TotalsRow>();

  let incomeTotal = 0;
  let expenseTotal = 0;
  for (const row of totalsResults) {
    if (row.type === 'income') {
      incomeTotal = row.total;
    } else if (row.type === 'expense') {
      expenseTotal = row.total;
    }
  }

  const { results: byCategoryResults } = await c.env.DB.prepare(
    `SELECT t.category_id AS category_id, c.name AS category_name, SUM(t.base_cents) AS total
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE t.occurred_on LIKE ? AND t.type = 'expense'
     GROUP BY t.category_id, c.name
     ORDER BY total DESC`
  )
    .bind(likePattern)
    .all<CategoryTotalRow>();

  const byCategory = byCategoryResults.map((row) => ({
    category_id: row.category_id,
    category_name: row.category_name,
    total: row.total,
    pct: expenseTotal === 0 ? 0 : Math.round((row.total / expenseTotal) * 1000) / 10,
  }));

  return c.json({
    month,
    income_total: incomeTotal,
    expense_total: expenseTotal,
    balance: incomeTotal - expenseTotal,
    by_category: byCategory,
  });
});
