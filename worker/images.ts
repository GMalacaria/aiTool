import { splitDataUrl } from '../shared/attachments';
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

/** The image to edit goes first, then the instruction. */
function sourcePart(source?: { dataUrl: string }): { inlineData: { mimeType: string; data: string } }[] {
  const parts = source ? splitDataUrl(source.dataUrl) : null;
  return parts ? [{ inlineData: { mimeType: parts.mimeType, data: parts.data } }] : [];
}

export class ImageNotProducedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageNotProducedError';
  }
}

/**
 * Base64 to bytes. Pictures are about a megabyte, and a Worker has a small CPU
 * budget, so the native decoder is used when the runtime has it; the fallback
 * works in chunks to avoid one huge intermediate string.
 */
export function decodeBase64(data: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (value: string) => Uint8Array }).fromBase64;
  if (typeof native === 'function') return native.call(Uint8Array, data);

  const chunks: Uint8Array[] = [];
  const chunkChars = 4 * 16384;
  for (let start = 0; start < data.length; start += chunkChars) {
    const binary = atob(data.slice(start, start + chunkChars));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    chunks.push(bytes);
  }

  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Bytes to base64, with the native encoder when the runtime has it. */
export function encodeBase64(bytes: Uint8Array): string {
  const native = (bytes as unknown as { toBase64?: () => string }).toBase64;
  if (typeof native === 'function') return native.call(bytes);

  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } | null {
  const parts = splitDataUrl(dataUrl);
  return parts ? { bytes: decodeBase64(parts.data), mimeType: parts.mimeType } : null;
}

/** Reads a stored image back as a data URL, or null if the file is gone. */
export async function readImage(
  bucket: R2Bucket,
  id: string,
): Promise<{ dataUrl: string; mimeType: string } | null> {
  const object = await bucket.get(id);
  if (!object) return null;
  const mimeType = object.httpMetadata?.contentType ?? 'image/jpeg';
  const bytes = new Uint8Array(await object.arrayBuffer());
  return { dataUrl: `data:${mimeType};base64,${encodeBase64(bytes)}`, mimeType };
}

/** Moderation of an image to edit; fails closed like `isFlagged`. */
export async function isImageFlagged(
  env: Env,
  dataUrl: string,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<boolean> {
  if (!env.OPENAI_API_KEY) throw new Error('moderation not configured');

  const baseURL = (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const response = await fetchFn(`${baseURL}/moderations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: MODERATION_MODEL, input: [{ type: 'image_url', image_url: { url: dataUrl } }] }),
    signal: AbortSignal.timeout(MODERATION_TIMEOUT_MS * 2),
  });
  if (!response.ok) throw new Error(`moderation answered ${response.status}`);

  const data = (await response.json()) as { results?: { flagged?: unknown }[] };
  const flagged = data.results?.[0]?.flagged;
  if (typeof flagged !== 'boolean') throw new Error('unexpected moderation response');
  return flagged;
}

/**
 * Generates one image from an English description with the Gemini image model,
 * or edits `source` following the instruction when an image is given.
 * Throws ImageNotProducedError when the model answers without an image, e.g.
 * because its own safety filters blocked the request.
 */
export async function generateImage(
  env: Env,
  prompt: string,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
  source?: { dataUrl: string },
): Promise<GeneratedImage> {
  if (!env.GEMINI_IMAGE_API_KEY) throw new Error('image generation not configured');

  const baseURL = (env.GEMINI_IMAGE_BASE_URL ?? DEFAULT_IMAGE_BASE_URL).replace(/\/$/, '');
  const model = env.GEMINI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;

  const response = await fetchFn(`${baseURL}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_IMAGE_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [...sourcePart(source), { text: prompt }] }],
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
