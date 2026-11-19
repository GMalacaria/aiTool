import { describe, expect, it, vi } from 'vitest';
import type { Env } from './env';
import { createDictationSession, TranscriptionError } from './transcribe';

const env = (overrides: Partial<Env> = {}): Env => ({ OPENAI_API_KEY: 'openai-key', ...overrides }) as Env;
const asFetch = (fn: unknown) => fn as typeof fetch;

describe('createDictationSession', () => {
  it('asks for a short-lived key bound to an Italian live transcription session', async () => {
    const fetchFn = vi.fn(async () => Response.json({ value: 'ek_123', expires_at: 1_800_000_000, session: {} }));

    await expect(createDictationSession(env(), asFetch(fetchFn))).resolves.toEqual({
      secret: 'ek_123',
      expiresAt: 1_800_000_000,
      url: 'wss://api.openai.com/v1/realtime',
    });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer openai-key');
    const body = JSON.parse(init.body as string);
    expect(body.expires_after).toEqual({ anchor: 'created_at', seconds: 60 });
    expect(body.session.type).toBe('transcription');
    expect(body.session.audio.input.format).toEqual({ type: 'audio/pcm', rate: 24_000 });
    expect(body.session.audio.input.transcription).toEqual({ model: 'gpt-live-transcribe', languages: ['it'] });
    expect(body.session.audio.input.turn_detection).toBeNull();
  });

  it('honours the model and base URL overrides', async () => {
    const fetchFn = vi.fn(async () => Response.json({ value: 'ek', expires_at: 1 }));
    const session = await createDictationSession(
      env({ OPENAI_BASE_URL: 'http://127.0.0.1:8788/v1/', OPENAI_TRANSCRIBE_MODEL: 'other' }),
      asFetch(fetchFn),
    );

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8788/v1/realtime/client_secrets');
    expect(JSON.parse(init.body as string).session.audio.input.transcription.model).toBe('other');
    expect(session.url).toBe('ws://127.0.0.1:8788/v1/realtime');
  });

  it.each([
    ['an error status', () => new Response('x', { status: 500 })],
    ['a body without the key', () => Response.json({ expires_at: 1 })],
  ])('fails on %s', async (_label, reply) => {
    await expect(createDictationSession(env(), asFetch(vi.fn(async () => reply())))).rejects.toBeInstanceOf(TranscriptionError);
  });
});
