import { Hono } from 'hono';
import type { Env } from '../types';

export const categories = new Hono<{ Bindings: Env }>();

interface CategoryRow {
  id: number;
  name: string;
  type: string;
  sort_order: number;
}

interface CategoryRowActive extends CategoryRow {
  is_active: number;
}

function errorResponse(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function isValidType(type: unknown): type is 'income' | 'expense' {
  return type === 'income' || type === 'expense';
}

categories.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, type, sort_order FROM categories WHERE is_active = 1 ORDER BY type, sort_order, id'
  ).all<CategoryRow>();
  return c.json({ categories: results });
});

categories.post('/', async (c) => {
  const body = await c.req
    .json<{ name?: unknown; type?: unknown }>()
    .catch((): { name?: unknown; type?: unknown } => ({}));
  const rawName = body.name;
  const type = body.type;

  if (typeof rawName !== 'string') {
    return c.json(errorResponse('validation_error', 'name is required'), 400);
  }
  const name = rawName.trim();
  if (name.length === 0 || name.length > 50) {
    return c.json(errorResponse('validation_error', 'name must be 1-50 characters'), 400);
  }
  if (!isValidType(type)) {
    return c.json(errorResponse('validation_error', "type must be 'income' or 'expense'"), 400);
  }

  const maxRow = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM categories WHERE type = ?'
  )
    .bind(type)
    .first<{ next_order: number }>();
  const sortOrder = maxRow?.next_order ?? 1;

  const inserted = await c.env.DB.prepare(
    'INSERT INTO categories (name, type, sort_order, is_active) VALUES (?, ?, ?, 1) RETURNING id, name, type, sort_order'
  )
    .bind(name, type, sortOrder)
    .first<CategoryRow>();

  return c.json(inserted, 201);
});

categories.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) {
    return c.json(errorResponse('validation_error', 'invalid id'), 400);
  }

  const body = await c.req
    .json<{ name?: unknown; sort_order?: unknown }>()
    .catch((): { name?: unknown; sort_order?: unknown } => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT id, name, type, sort_order, is_active FROM categories WHERE id = ?'
  )
    .bind(id)
    .first<CategoryRowActive>();

  if (!existing || existing.is_active !== 1) {
    return c.json(errorResponse('not_found', 'category not found'), 404);
  }

  let name = existing.name;
  let sortOrder = existing.sort_order;

  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return c.json(errorResponse('validation_error', 'name must be a string'), 400);
    }
    const trimmed = body.name.trim();
    if (trimmed.length === 0 || trimmed.length > 50) {
      return c.json(errorResponse('validation_error', 'name must be 1-50 characters'), 400);
    }
    name = trimmed;
  }

  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== 'number' || !Number.isInteger(body.sort_order)) {
      return c.json(errorResponse('validation_error', 'sort_order must be an integer'), 400);
    }
    sortOrder = body.sort_order;
  }

  const updated = await c.env.DB.prepare(
    'UPDATE categories SET name = ?, sort_order = ? WHERE id = ? RETURNING id, name, type, sort_order'
  )
    .bind(name, sortOrder, id)
    .first<CategoryRow>();

  return c.json(updated);
});

categories.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) {
    return c.json(errorResponse('validation_error', 'invalid id'), 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id, name, type, sort_order, is_active FROM categories WHERE id = ?'
  )
    .bind(id)
    .first<CategoryRowActive>();

  if (!existing || existing.is_active !== 1) {
    return c.json(errorResponse('not_found', 'category not found'), 404);
  }

  const refCount = await c.env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM transactions WHERE category_id = ?'
  )
    .bind(id)
    .first<{ cnt: number }>();

  if (refCount && refCount.cnt > 0) {
    await c.env.DB.prepare('UPDATE categories SET is_active = 0 WHERE id = ?').bind(id).run();
    return c.json({ deleted: 'soft' });
  }

  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return c.json({ deleted: 'hard' });
});
