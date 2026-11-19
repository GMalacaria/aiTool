import { createDictationSession } from '../api';
import { DICTATION_SAMPLE_RATE } from '../../shared/dictation';
import { startCapture, toBase64, type Capture } from './capture';
import { PauseDetector } from './pauses';
import { LiveTranscript } from './transcript';

/** A dictation stops by itself after two minutes. */
const MAX_DURATION_MS = 120_000;
/** After the user stops, how long to wait for the last segment's final text. */
const SETTLE_TIMEOUT_MS = 4000;
const CONNECT_TIMEOUT_MS = 10_000;
/** Audio held while the connection opens (100 ms frames): enough for a slow network. */
const MAX_QUEUED_MESSAGES = 150;

/** 'unavailable': the connection could not be opened; 'error': it broke while dictating. */
export type DictationEnd = 'user' | 'silence' | 'no-speech' | 'limit' | 'unavailable' | 'error';

export type DictationFailure = 'unsupported' | 'denied' | 'unavailable';

export class DictationError extends Error {
  constructor(readonly reason: DictationFailure) {
    super(reason);
    this.name = 'DictationError';
  }
}

export interface DictationCallbacks {
  /** The whole dictated text so far (partial pieces included). */
  onText: (text: string) => void;
  /** The microphone is open and the user can speak. */
  onListening: () => void;
  /** No more audio is sent; the last text may still arrive. */
  onFinishing: () => void;
  onEnd: (reason: DictationEnd) => void;
}

export interface LiveDictation {
  /** Stops listening and waits for the last text. */
  stop(): void;
  /** Stops at once, dropping what has not arrived (leaving the page). */
  cancel(): void;
}

export function dictationSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioWorkletNode !== 'undefined' &&
    typeof WebSocket !== 'undefined'
  );
}

interface ServiceEvent {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
}

/**
 * Live dictation: the microphone is streamed to OpenAI's transcription service
 * with a short-lived key from the server, and the text comes back while the user
 * speaks. Pauses close segments and a long silence ends the dictation.
 *
 * Listening starts as soon as the microphone is open: what is said while the
 * connection opens is held and sent once it is ready, so the first words are
 * not lost. Must be called from a click: browsers only allow audio started by
 * the user.
 */
export async function startLiveDictation(callbacks: DictationCallbacks): Promise<LiveDictation> {
  if (!dictationSupported()) throw new DictationError('unsupported');

  // Created inside the click, before any wait, or Safari keeps it suspended.
  const context = new AudioContext();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    void context.close().catch(() => undefined);
    throw new DictationError('denied');
  }

  const transcript = new LiveTranscript();
  const detector = new PauseDetector(performance.now());
  const held: string[] = [];
  const queue: string[] = [];
  let socket: WebSocket | null = null;
  let capture: Capture | null = null;
  let state: 'listening' | 'finishing' | 'ended' = 'listening';
  let finishReason: DictationEnd = 'user';
  let settleTimer = 0;
  let limitTimer = 0;

  // State changes inside callbacks: read it through a function so TypeScript does not narrow it.
  const ended = () => state === 'ended';

  const release = () => {
    capture?.stop();
    capture = null;
    stream.getTracks().forEach((track) => track.stop());
    if (context.state !== 'closed') void context.close().catch(() => undefined);
  };

  // Messages wait in order until the connection is open.
  const send = (event: object) => {
    const message = JSON.stringify(event);
    if (socket?.readyState === WebSocket.OPEN) socket.send(message);
    else if (queue.length < MAX_QUEUED_MESSAGES) queue.push(message);
  };

  const end = (reason: DictationEnd) => {
    if (state === 'ended') return;
    state = 'ended';
    window.clearTimeout(limitTimer);
    window.clearTimeout(settleTimer);
    release();
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
    }
    callbacks.onEnd(reason);
  };

  const finish = (reason: DictationEnd) => {
    if (state !== 'listening') return;
    state = 'finishing';
    finishReason = reason;
    release();
    callbacks.onFinishing();
    // The words said before stopping still need their segment closed.
    const open = detector.openSegment;
    if (open) send({ type: 'input_audio_buffer.commit' });
    // Nothing sent and nothing awaited: done.
    if (!open && transcript.settled && queue.length === 0) {
      end(reason);
      return;
    }
    settleTimer = window.setTimeout(() => end(reason), SETTLE_TIMEOUT_MS + (socket ? 0 : CONNECT_TIMEOUT_MS));
  };

  const onMessage = (message: MessageEvent<string>) => {
    let event: ServiceEvent;
    try {
      event = JSON.parse(message.data) as ServiceEvent;
    } catch {
      return;
    }
    const id = event.item_id;
    switch (event.type) {
      case 'input_audio_buffer.committed':
        if (id) transcript.committed(id);
        break;
      case 'conversation.item.input_audio_transcription.delta':
        if (id && event.delta) transcript.delta(id, event.delta);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (id) transcript.completed(id, event.transcript ?? '');
        break;
      case 'conversation.item.input_audio_transcription.failed':
        if (id) transcript.failed(id);
        break;
      case 'error':
        // e.g. a segment too short to close: not a reason to stop dictating.
        console.warn('dictation service error', event.error?.message);
        return;
      default:
        return;
    }
    callbacks.onText(transcript.text);
    if (state === 'finishing' && transcript.settled) end(finishReason);
  };

  try {
    capture = await startCapture(context, stream, DICTATION_SAMPLE_RATE, ({ pcm, level }) => {
      if (state !== 'listening') return;
      const decision = detector.frame(level, performance.now());
      // Recent silent frames are held, so speech is sent with what came just before it.
      held.push(toBase64(pcm));
      if (held.length > 4) held.shift();
      for (const audio of held.slice(held.length - decision.send)) send({ type: 'input_audio_buffer.append', audio });
      if (decision.send) held.length = 0;
      if (decision.commit) send({ type: 'input_audio_buffer.commit' });
      if (decision.stop) finish(decision.stop);
    });
  } catch {
    release();
    throw new DictationError('unsupported');
  }
  limitTimer = window.setTimeout(() => finish('limit'), MAX_DURATION_MS);
  callbacks.onListening();

  // The connection opens while the user already speaks.
  void (async () => {
    try {
      const session = await createDictationSession();
      if (ended()) return;
      const opened = await connect(session.url, session.secret);
      if (ended()) {
        opened.close();
        return;
      }
      socket = opened;
      socket.onmessage = onMessage;
      socket.onclose = () => end(state === 'finishing' ? finishReason : 'error');
      for (const message of queue.splice(0)) socket.send(message);
    } catch (error) {
      console.warn('dictation connection failed', error);
      end('unavailable');
    }
  })();

  return {
    stop: () => finish('user'),
    cancel: () => end('user'),
  };
}

function connect(url: string, secret: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // Browsers cannot set headers on a WebSocket: the key travels as a subprotocol.
    const socket = new WebSocket(url, ['realtime', `openai-insecure-api-key.${secret}`]);
    const timer = window.setTimeout(() => {
      socket.close();
      reject(new DictationError('unavailable'));
    }, CONNECT_TIMEOUT_MS);
    socket.onopen = () => {
      window.clearTimeout(timer);
      resolve(socket);
    };
    socket.onerror = () => {
      window.clearTimeout(timer);
      reject(new DictationError('unavailable'));
    };
  });
}
