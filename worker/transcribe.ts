import { DICTATION_SAMPLE_RATE } from '../shared/dictation';
import type { Env } from './env';

/** Live transcription model (OpenAI Realtime API); overridable with OPENAI_TRANSCRIBE_MODEL. */
export const DEFAULT_TRANSCRIBE_MODEL = 'gpt-live-transcribe';

/** How long the temporary key can be used to open the connection. */
const SECRET_TTL_SECONDS = 60;

export interface DictationSession {
  /** Temporary key, valid for one transcription session only: the real key never leaves the server. */
  secret: string;
  /** Unix seconds after which the key can no longer open a connection. */
  expiresAt: number;
  /** WebSocket address the browser connects to. */
  url: string;
}

export class TranscriptionError extends Error {
  constructor() {
    super('transcription unavailable');
    this.name = 'TranscriptionError';
  }
}

/**
 * Asks OpenAI for a short-lived key bound to an Italian transcription session.
 * The browser then sends the microphone audio to OpenAI directly: the audio
 * never passes through the Worker (whose CPU budget could not handle it).
 */
export async function createDictationSession(env: Env, fetchFn: typeof fetch = fetch): Promise<DictationSession> {
  const baseURL = (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const response = await fetchFn(`${baseURL}/realtime/client_secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: SECRET_TTL_SECONDS },
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: DICTATION_SAMPLE_RATE },
            noise_reduction: { type: 'near_field' },
            transcription: { model: env.OPENAI_TRANSCRIBE_MODEL ?? DEFAULT_TRANSCRIBE_MODEL, languages: ['it'] },
            // The model has no server-side turn detection: the browser detects pauses and commits each segment.
            turn_detection: null,
          },
        },
      },
    }),
  });
  if (!response.ok) throw new TranscriptionError();

  const body = (await response.json().catch(() => null)) as { value?: unknown; expires_at?: unknown } | null;
  if (typeof body?.value !== 'string' || !body.value || typeof body.expires_at !== 'number') {
    throw new TranscriptionError();
  }
  return {
    secret: body.value,
    expiresAt: body.expires_at,
    url: `${baseURL.replace(/^http/, 'ws')}/realtime`,
  };
}
