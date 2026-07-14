import { Hono } from 'hono';
import type { Env } from '../types';
import { getRatesToTWD, RatesUnavailableError } from '../rates';

export const rates = new Hono<{ Bindings: Env }>();

function errorResponse(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

rates.get('/', async (c) => {
  try {
    const { rates: rateMap, fetched_at: fetchedAt } = await getRatesToTWD(c.env.DB);
    return c.json({ base: 'TWD', rates: rateMap, fetched_at: fetchedAt });
  } catch (err) {
    if (err instanceof RatesUnavailableError) {
      return c.json(errorResponse('rates_unavailable', err.message), 503);
    }
    throw err;
  }
});
