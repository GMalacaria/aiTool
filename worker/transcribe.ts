import type { Env } from './env';

/** Default transcription model; overridable with OPENAI_TRANSCRIBE_MODEL. */
export const DEFAULT_TRANSCRIBE_MODEL = 'gpt-transcribe';

/** A dictation is a few sentences: 5 MB is minutes of compressed audio. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

export class TranscriptionError extends Error {
  constructor(readonly reason: 'unavailable') {
    super(reason);
    this.name = 'TranscriptionError';
  }
}

/** Sends one recording to OpenAI and returns the recognised Italian text. */
export async function transcribe(env: Env, audio: File, fetchFn: typeof fetch = fetch): Promise<string> {
  const baseURL = (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const form = new FormData();
  form.append('file', audio, audio.name || 'recording.webm');
  form.append('model', env.OPENAI_TRANSCRIBE_MODEL ?? DEFAULT_TRANSCRIBE_MODEL);
  form.append('language', 'it');
  form.append('response_format', 'json');

  const response = await fetchFn(`${baseURL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!response.ok) throw new TranscriptionError('unavailable');

  const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof body?.text !== 'string') throw new TranscriptionError('unavailable');
  return body.text.trim();
}
