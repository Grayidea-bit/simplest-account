import { Hono } from 'hono';
import type { Env } from './types';
import { authRoutes, requireAuth } from './auth';
import { categories } from './routes/categories';
import { transactions } from './routes/transactions';
import { summary } from './routes/summary';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', requireAuth);

app.route('/api/auth', authRoutes);
app.route('/api/categories', categories);
app.route('/api/transactions', transactions);
app.route('/api/summary', summary);

app.notFound((c) => {
  return c.json({ error: { code: 'not_found', message: 'resource not found' } }, 404);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
});

export default app;
