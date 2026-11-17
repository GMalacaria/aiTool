import type { Env } from './env';

const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-lite-image';
const DEFAULT_IMAGE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODERATION_MODEL = 'omni-moderation-latest';
const IMAGE_TIMEOUT_MS = 60_000;
const MODERATION_TIMEOUT_MS = 10_000;
/** Largest image kept, in bytes; Gemini images are well below this. */
export const MAX_IMAGE_BYTES = 6_000_000;

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function imagesEnabled(env: Env): boolean {
  return Boolean(env.GEMINI_IMAGE_API_KEY);
}

/**
 * Asks OpenAI's moderation endpoint (free) whether the text is acceptable.
 * Returns true when it is flagged. It fails closed: when moderation cannot be
 * reached the caller must refuse, because images are never produced unchecked.
 */
export async function isFlagged(
  env: Env,
  text: string,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<boolean> {
  if (!env.OPENAI_API_KEY) throw new Error('moderation not configured');

  const baseURL = (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const response = await fetchFn(`${baseURL}/moderations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: MODERATION_MODEL, input: text }),
    signal: AbortSignal.timeout(MODERATION_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`moderation answered ${response.status}`);

  const data = (await response.json()) as { results?: { flagged?: unknown }[] };
  const flagged = data.results?.[0]?.flagged;
  if (typeof flagged !== 'boolean') throw new Error('unexpected moderation response');
  return flagged;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: string;
}

export class ImageNotProducedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageNotProducedError';
  }
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Generates one image from an English description with the Gemini image model.
 * Throws ImageNotProducedError when the model answers without an image, e.g.
 * because its own safety filters blocked the request.
 */
export async function generateImage(
  env: Env,
  prompt: string,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<GeneratedImage> {
  if (!env.GEMINI_IMAGE_API_KEY) throw new Error('image generation not configured');

  const baseURL = (env.GEMINI_IMAGE_BASE_URL ?? DEFAULT_IMAGE_BASE_URL).replace(/\/$/, '');
  const model = env.GEMINI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;

  const response = await fetchFn(`${baseURL}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_IMAGE_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`image model answered ${response.status} ${(await response.text()).slice(0, 200)}`);

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: unknown; data?: unknown } }[] } }[];
  };
  const inline = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
  if (!inline || typeof inline.data !== 'string') throw new ImageNotProducedError('no image in the response');

  const mimeType = typeof inline.mimeType === 'string' ? inline.mimeType : '';
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) throw new Error(`unexpected image type ${mimeType}`);

  const bytes = decodeBase64(inline.data);
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error(`unexpected image size ${bytes.length}`);
  return { bytes, mimeType };
}
