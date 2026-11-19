import { describe, expect, it, vi } from 'vitest';
import type { Env } from './env';
import { transcribe, TranscriptionError } from './transcribe';

const env = (overrides: Partial<Env> = {}): Env => ({ OPENAI_API_KEY: 'openai-key', ...overrides }) as Env;
const asFetch = (fn: unknown) => fn as typeof fetch;
const audio = new File([new Uint8Array([1, 2, 3])], 'recording.webm', { type: 'audio/webm' });

describe('transcribe', () => {
  it('sends the recording to the transcription endpoint in Italian and returns the trimmed text', async () => {
    const fetchFn = vi.fn(async () => Response.json({ text: '  Ciao a tutti.  ' }));

    await expect(transcribe(env(), audio, asFetch(fetchFn))).resolves.toBe('Ciao a tutti.');

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer openai-key');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(form.get('language')).toBe('it');
    expect(form.get('file')).toBeInstanceOf(File);
  });

  it('honours the model and base URL overrides', async () => {
    const fetchFn = vi.fn(async () => Response.json({ text: 'x' }));
    await transcribe(env({ OPENAI_BASE_URL: 'http://mock/v1/', OPENAI_TRANSCRIBE_MODEL: 'other' }), audio, asFetch(fetchFn));

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://mock/v1/audio/transcriptions');
    expect((init.body as FormData).get('model')).toBe('other');
  });

  it.each([
    ['an error status', () => new Response('x', { status: 500 })],
    ['a malformed body', () => Response.json({ nope: true })],
  ])('fails on %s', async (_label, reply) => {
    await expect(transcribe(env(), audio, asFetch(vi.fn(async () => reply())))).rejects.toBeInstanceOf(TranscriptionError);
  });
});
