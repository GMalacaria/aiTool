import type { Env } from '../env';

const DEFAULT_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}

export function buildAuthUrl(env: Env, redirectUri: string, state: string): string {
  const url = new URL(env.GOOGLE_AUTH_URL ?? DEFAULT_AUTH_URL);
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/** Exchanges the authorization code for the signed-in user's profile. */
export async function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<GoogleProfile> {
  const response = await fetchFn(env.GOOGLE_TOKEN_URL ?? DEFAULT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) throw new Error(`token endpoint answered ${response.status}`);

  const { id_token: idToken } = (await response.json()) as { id_token?: unknown };
  if (typeof idToken !== 'string') throw new Error('missing id_token');
  return parseIdToken(idToken, env.GOOGLE_CLIENT_ID);
}

/**
 * Validates the claims of an ID token. The signature is not checked: the token
 * comes straight from the token endpoint over TLS, which OpenID Connect allows
 * to rely on instead (Core 1.0, section 3.1.3.7).
 */
export function parseIdToken(idToken: string, clientId: string, now: number = Date.now()): GoogleProfile {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('malformed id_token');

  const claims = JSON.parse(decodeBase64Url(payload)) as Record<string, unknown>;

  if (typeof claims.iss !== 'string' || !ISSUERS.includes(claims.iss)) throw new Error('unexpected issuer');
  if (claims.aud !== clientId) throw new Error('unexpected audience');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) throw new Error('expired id_token');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('email not verified');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('missing subject');
  if (typeof claims.email !== 'string' || !claims.email) throw new Error('missing email');

  const email = claims.email.toLowerCase();
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email;
  return { sub: claims.sub, email, name: name.slice(0, 100) };
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
