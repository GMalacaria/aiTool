import { describe, expect, it, vi } from 'vitest';
import type { Env } from './env';
import { decodeBase64, generateImage, ImageNotProducedError, imagesEnabled, isFlagged, MAX_IMAGE_BYTES } from './images';

const env = (overrides: Partial<Env> = {}): Env =>
  ({ OPENAI_API_KEY: 'openai-key', GEMINI_IMAGE_API_KEY: 'image-key', ...overrides }) as Env;

const asFetch = (fn: unknown) => fn as typeof fetch;
const PNG_BASE64 = btoa('\u0089PNG fake bytes');

const imageResponse = (data: string, mimeType = 'image/png') =>
  Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType, data } }] } }] });

describe('imagesEnabled', () => {
  it('needs the image key', () => {
    expect(imagesEnabled(env())).toBe(true);
    expect(imagesEnabled(env({ GEMINI_IMAGE_API_KEY: undefined }))).toBe(false);
  });
});

describe('isFlagged', () => {
  it('asks the moderation endpoint and returns its verdict', async () => {
    const fetchFn = vi.fn(async () => Response.json({ results: [{ flagged: true }] }));

    await expect(isFlagged(env(), 'text', asFetch(fetchFn))).resolves.toBe(true);

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/moderations');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer openai-key');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'omni-moderation-latest', input: 'text' });

    const clean = vi.fn(async () => Response.json({ results: [{ flagged: false }] }));
    await expect(isFlagged(env(), 'text', asFetch(clean))).resolves.toBe(false);
  });

  it.each([
    ['an error status', () => new Response('x', { status: 500 })],
    ['a malformed body', () => Response.json({ results: [] })],
  ])('fails (closed) on %s', async (_label, reply) => {
    await expect(isFlagged(env(), 'text', asFetch(vi.fn(async () => reply())))).rejects.toThrow();
  });

  it('fails when there is no key to check with', async () => {
    await expect(isFlagged(env({ OPENAI_API_KEY: '' }), 'text')).rejects.toThrow();
  });
});

describe('generateImage', () => {
  it('calls the Gemini image model and decodes the picture', async () => {
    const fetchFn = vi.fn(async () => imageResponse(PNG_BASE64));

    const image = await generateImage(env(), 'a red kite', asFetch(fetchFn));

    expect(image.mimeType).toBe('image/png');
    expect(String.fromCharCode(...image.bytes)).toBe('\u0089PNG fake bytes');

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('image-key');
    expect(JSON.parse(init.body as string)).toEqual({
      contents: [{ parts: [{ text: 'a red kite' }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });
  });

  it('honours the model and endpoint overrides', async () => {
    const fetchFn = vi.fn(async () => imageResponse(PNG_BASE64));
    await generateImage(
      env({ GEMINI_IMAGE_MODEL: 'other-model', GEMINI_IMAGE_BASE_URL: 'http://127.0.0.1:1/v1beta/' }),
      'x',
      asFetch(fetchFn),
    );
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('http://127.0.0.1:1/v1beta/models/other-model:generateContent');
  });

  it('reports a response without a picture, e.g. blocked by the model', async () => {
    const blocked = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: 'I cannot.' }] } }] }));
    await expect(generateImage(env(), 'x', asFetch(blocked))).rejects.toBeInstanceOf(ImageNotProducedError);
  });

  it.each([
    ['an unexpected image type', () => imageResponse(PNG_BASE64, 'image/svg+xml')],
    ['an empty picture', () => imageResponse('')],
    ['an oversized picture', () => imageResponse(btoa('x'.repeat(MAX_IMAGE_BYTES + 1)))],
    ['an error status', () => new Response('x', { status: 400 })],
  ])('rejects %s', async (_label, reply) => {
    await expect(generateImage(env(), 'x', asFetch(vi.fn(async () => reply())))).rejects.toThrow();
  });

  it('needs the image key', async () => {
    await expect(generateImage(env({ GEMINI_IMAGE_API_KEY: undefined }), 'x')).rejects.toThrow();
  });
});

describe('decodeBase64', () => {
  const original = Array.from({ length: 200_000 }, (_, index) => (index * 7) % 256);
  const encoded = btoa(String.fromCharCode(...original.slice(0, 50_000))) + '';
  const sample = new Uint8Array(original.slice(0, 50_000));

  it('decodes with the native decoder when the runtime has it', () => {
    expect([...decodeBase64(encoded)]).toEqual([...sample]);
  });

  it('decodes with the chunked fallback when it does not', () => {
    const constructor = Uint8Array as unknown as { fromBase64?: unknown };
    const native = constructor.fromBase64;
    constructor.fromBase64 = undefined;
    try {
      expect([...decodeBase64(encoded)]).toEqual([...sample]);
      expect(decodeBase64('').length).toBe(0);
    } finally {
      constructor.fromBase64 = native;
    }
  });
});
