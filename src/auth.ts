import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from './types';

// Auth cookie name. The value is a deterministic HMAC over a fixed message
// keyed by PASSCODE — so rotating PASSCODE changes the expected value and
// invalidates every previously issued cookie (no server-side session store).
const COOKIE_NAME = 'sa_auth';
const AUTH_MESSAGE = 'simplest-account-auth-v1';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hex = '';
  for (const byte of view) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

// Constant-time comparison of two byte arrays. We fold any length difference
// into the accumulator and always iterate the full span, so the total work
// never depends on the position of the first differing byte. This prevents a
// timing side-channel that could let an attacker recover the secret byte by
// byte. Do NOT replace with `===`/short-circuiting string compare.
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

// Deterministic cookie value: lowercase hex of HMAC-SHA256(PASSCODE, message).
async function computeCookieValue(passcode: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passcode),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(AUTH_MESSAGE));
  return toHex(signature);
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return new Uint8Array(digest);
}

/**
 * Gate for all /api/* routes. Mounted in index.ts as `app.use('/api/*', requireAuth)`,
 * so it also runs for the login request itself — which we must let through
 * unauthenticated, otherwise no one could ever obtain a cookie.
 */
export const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  // Allow the one unauthenticated entry point through.
  if (c.req.method === 'POST' && c.req.path === '/api/auth/login') {
    return next();
  }

  // Defensive: a missing secret must fail closed, never allow-all.
  const passcode = c.env.PASSCODE;
  if (!passcode) {
    return c.json({ error: { code: 'config', message: 'PASSCODE secret not set' } }, 500);
  }

  const cookie = getCookie(c, COOKIE_NAME);
  if (!cookie) {
    return c.json({ error: { code: 'unauthorized', message: 'login required' } }, 401);
  }

  const expected = await computeCookieValue(passcode);
  if (!timingSafeEqual(encoder.encode(cookie), encoder.encode(expected))) {
    return c.json({ error: { code: 'unauthorized', message: 'login required' } }, 401);
  }

  return next();
};

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/login', async (c) => {
  const passcode = c.env.PASSCODE;
  if (!passcode) {
    return c.json({ error: { code: 'config', message: 'PASSCODE secret not set' } }, 500);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'bad_request', message: 'invalid JSON body' } }, 400);
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as { passcode?: unknown }).passcode !== 'string'
  ) {
    return c.json({ error: { code: 'bad_request', message: 'passcode is required' } }, 400);
  }

  const submitted = (body as { passcode: string }).passcode;

  // Hash both the submitted value and the secret to fixed 32-byte digests
  // before comparing. This equalizes lengths (so the compare cannot leak the
  // secret's length) and lets the constant-time compare run over equal spans.
  const [submittedDigest, expectedDigest] = await Promise.all([
    sha256(submitted),
    sha256(passcode),
  ]);

  if (!timingSafeEqual(submittedDigest, expectedDigest)) {
    return c.json({ error: { code: 'bad_passcode', message: 'wrong passcode' } }, 401);
  }

  const cookieValue = await computeCookieValue(passcode);
  setCookie(c, COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  return c.json({ ok: true });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});
