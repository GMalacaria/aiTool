import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, Env, User, UserStatus } from '../env';
import type { GoogleProfile } from './google';

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function randomToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return [...data].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isAdminEmail(env: Env, email: string): boolean {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  status: UserStatus;
  daily_message_limit: number;
}

function toUser(env: Env, row: UserRow): User {
  const isAdmin = isAdminEmail(env, row.email);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    // Admins can never lock themselves out.
    status: isAdmin ? 'approved' : row.status,
    isAdmin,
    dailyMessageLimit: row.daily_message_limit,
  };
}

/** Creates the user on first sign-in (pending approval) and refreshes name/email afterwards. */
export async function upsertUser(env: Env, profile: GoogleProfile): Promise<User> {
  const row = await env.DB.prepare(
    `INSERT INTO users (google_sub, email, name, status) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = excluded.name
     RETURNING id, email, name, status, daily_message_limit`,
  )
    .bind(profile.sub, profile.email, profile.name, isAdminEmail(env, profile.email) ? 'approved' : 'pending')
    .first<UserRow>();

  if (!row) throw new Error('user upsert returned no row');
  return toUser(env, row);
}

/** Returns the session token to put in the cookie; only its hash is stored. */
export async function createSession(db: D1Database, userId: number, now: number = Date.now()): Promise<string> {
  const token = randomToken();
  const nowSeconds = Math.floor(now / 1000);

  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowSeconds),
    db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(token), userId, nowSeconds + SESSION_MAX_AGE_SECONDS),
  ]);
  return token;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

export async function findUserBySession(env: Env, token: string, now: number = Date.now()): Promise<User | null> {
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.status, u.daily_message_limit
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Math.floor(now / 1000))
    .first<UserRow>();

  return row ? toUser(env, row) : null;
}

/** Any signed-in user, whatever the approval status. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = token ? await findUserBySession(c.env, token) : null;
  if (!user) return c.json({ error: 'not_signed_in' }, 401);

  c.set('user', user);
  await next();
});

export const requireApproved = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user').status !== 'approved') return c.json({ error: 'not_approved' }, 403);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user').isAdmin) return c.json({ error: 'forbidden' }, 403);
  await next();
});

/**
 * The session cookie is SameSite=Lax; on top of that, state-changing requests
 * must come from the app's own origin.
 */
export const requireSameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (!origin || origin !== new URL(c.req.url).origin) return c.json({ error: 'forbidden' }, 403);
  }
  await next();
});
