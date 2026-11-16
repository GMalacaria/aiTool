import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { buildAuthUrl, exchangeCode, parseIdToken } from './google';
import { isAdminEmail } from './session';

const CLIENT_ID = 'client-id';
const NOW = 1_800_000_000_000;

const env = (overrides: Partial<Env> = {}): Env =>
  ({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'client-secret', ...overrides }) as Env;

const encode = (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const idToken = (claims: Record<string, unknown> = {}) =>
  `${encode({ alg: 'RS256' })}.${encode({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1234567890',
    email: 'Person@Example.com',
    email_verified: true,
    name: 'Përson Näme',
    exp: NOW / 1000 + 60,
    ...claims,
  })}.signature`;

describe('buildAuthUrl', () => {
  it('builds the Google authorization URL', () => {
    const url = new URL(buildAuthUrl(env(), 'https://app.test/api/auth/google/callback', 'state-1'));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: 'https://app.test/api/auth/google/callback',
      response_type: 'code',
      scope: 'openid email profile',
      state: 'state-1',
      prompt: 'select_account',
    });
  });
});

describe('parseIdToken', () => {
  it('returns the profile with a lower-cased email', () => {
    expect(parseIdToken(idToken(), CLIENT_ID, NOW)).toEqual({
      sub: '1234567890',
      email: 'person@example.com',
      name: 'Përson Näme',
    });
  });

  it('falls back to the email when the name is missing', () => {
    expect(parseIdToken(idToken({ name: undefined }), CLIENT_ID, NOW).name).toBe('person@example.com');
  });

  it.each([
    ['another issuer', { iss: 'https://evil.test' }],
    ['another audience', { aud: 'someone-else' }],
    ['an expired token', { exp: NOW / 1000 - 1 }],
    ['an unverified email', { email_verified: false }],
    ['a missing subject', { sub: '' }],
    ['a missing email', { email: undefined }],
  ])('rejects %s', (_label, claims) => {
    expect(() => parseIdToken(idToken(claims), CLIENT_ID, NOW)).toThrow();
  });

  it('rejects a malformed token', () => {
    expect(() => parseIdToken('not-a-jwt', CLIENT_ID, NOW)).toThrow();
  });
});

describe('exchangeCode', () => {
  it('posts the code to the token endpoint and parses the ID token', async () => {
    const fetchFn = vi.fn(async () => Response.json({ id_token: idToken({ exp: Date.now() / 1000 + 60 }) }));

    const profile = await exchangeCode(env(), 'the-code', 'https://app.test/cb', fetchFn as unknown as typeof fetch);

    expect(profile.email).toBe('person@example.com');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      code: 'the-code',
      client_id: CLIENT_ID,
      client_secret: 'client-secret',
      redirect_uri: 'https://app.test/cb',
      grant_type: 'authorization_code',
    });
  });

  it('fails when the token endpoint refuses the code', async () => {
    const fetchFn = vi.fn(async () => new Response('bad', { status: 400 }));
    await expect(exchangeCode(env(), 'x', 'https://app.test/cb', fetchFn as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe('isAdminEmail', () => {
  it('matches the configured emails ignoring case and spaces', () => {
    const configured = env({ ADMIN_EMAILS: ' Owner@Example.com , second@example.com ' });
    expect(isAdminEmail(configured, 'owner@example.com')).toBe(true);
    expect(isAdminEmail(configured, 'SECOND@example.com')).toBe(true);
    expect(isAdminEmail(configured, 'other@example.com')).toBe(false);
  });

  it('has no admins when nothing is configured', () => {
    expect(isAdminEmail(env(), 'owner@example.com')).toBe(false);
  });
});
