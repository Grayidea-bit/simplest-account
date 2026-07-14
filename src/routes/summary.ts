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

interface CategorySummary {
  category_id: number;
  category_name: string;
  total: number;
  pct: number;
}

interface SummaryAggregate {
  income_total: number;
  expense_total: number;
  balance: number;
  by_category: CategorySummary[];
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function errorResponse(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

// Mirrors the calendar-validity check in transactions.ts (not exported there).
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

// Shared aggregation for both month mode and date-range mode. `whereClause` is a
// raw SQL fragment (unqualified `occurred_on` works against both queries below,
// since `categories` has no such column) bound with `params` in order.
async function computeSummary(
  db: Env['DB'],
  whereClause: string,
  params: readonly string[]
): Promise<SummaryAggregate> {
  const { results: totalsResults } = await db
    .prepare(
      `SELECT type, COALESCE(SUM(base_cents), 0) AS total
       FROM transactions
       WHERE ${whereClause}
       GROUP BY type`
    )
    .bind(...params)
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

  const { results: byCategoryResults } = await db
    .prepare(
      `SELECT t.category_id AS category_id, c.name AS category_name, SUM(t.base_cents) AS total
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE ${whereClause} AND t.type = 'expense'
       GROUP BY t.category_id, c.name
       ORDER BY total DESC`
    )
    .bind(...params)
    .all<CategoryTotalRow>();

  const byCategory = byCategoryResults.map((row) => ({
    category_id: row.category_id,
    category_name: row.category_name,
    total: row.total,
    pct: expenseTotal === 0 ? 0 : Math.round((row.total / expenseTotal) * 1000) / 10,
  }));

  return {
    income_total: incomeTotal,
    expense_total: expenseTotal,
    balance: incomeTotal - expenseTotal,
    by_category: byCategory,
  };
}

summary.get('/', async (c) => {
  const month = c.req.query('month');
  const start = c.req.query('start');
  const end = c.req.query('end');

  if (start !== undefined && end !== undefined) {
    if (!isValidCalendarDate(start) || !isValidCalendarDate(end)) {
      return c.json(
        errorResponse('validation_error', "start and end must be valid 'YYYY-MM-DD' dates"),
        400
      );
    }
    if (start > end) {
      return c.json(errorResponse('validation_error', 'start must not be after end'), 400);
    }

    const aggregate = await computeSummary(c.env.DB, 'occurred_on BETWEEN ? AND ?', [start, end]);
    return c.json({ start, end, ...aggregate });
  }

  if (month !== undefined && MONTH_RE.test(month)) {
    const aggregate = await computeSummary(c.env.DB, 'occurred_on LIKE ?', [`${month}-%`]);
    return c.json({ month, ...aggregate });
  }

  return c.json(
    errorResponse(
      'validation_error',
      "provide either 'month' in 'YYYY-MM' format, or both 'start' and 'end' in 'YYYY-MM-DD' format"
    ),
    400
  );
});
