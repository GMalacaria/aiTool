import { parseDocument, type DocumentSpec } from '../shared/document';
import type { ChatMessage, ProviderRouter } from './llm/router';
import {
  applyReview,
  buildReviewInput,
  DOCUMENT_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from './prompts';

/** Previous messages of the conversation sent to the model along with the new question. */
export const MAX_HISTORY_MESSAGES = 8;
export const MAX_MESSAGE_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 700;
const MAX_DOCUMENT_OUTPUT_TOKENS = 4000;
const DOCUMENT_TIMEOUT_MS = 90_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MessageKind = 'text' | 'document';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  /** For 'document' messages, the JSON document description. */
  content: string;
  kind: MessageKind;
}

export interface ChatRequest {
  /** Null starts a new conversation. */
  conversationId: string | null;
  message: string;
  /** What the answer should be: plain text, or a structured document. */
  format: MessageKind;
}

/** Validates the client payload; returns null when it is not usable. */
export function parseChatRequest(payload: unknown): ChatRequest | null {
  const {
    conversationId = null,
    message,
    format = 'text',
  } = (payload ?? {}) as { conversationId?: unknown; message?: unknown; format?: unknown };

  if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_CHARS) return null;
  if (conversationId !== null && (typeof conversationId !== 'string' || !UUID.test(conversationId))) return null;
  if (format !== 'text' && format !== 'document') return null;

  return { conversationId, message: message.trim(), format };
}

/** Keeps only the most recent turns, starting from a user message: tokens are the scarce resource. */
export function truncateHistory(history: ConversationMessage[]): ConversationMessage[] {
  const recent = history.slice(-MAX_HISTORY_MESSAGES);
  const firstUser = recent.findIndex((message) => message.role === 'user');
  return firstUser === -1 ? [] : recent.slice(firstUser);
}

function buildMessages(systemPrompt: string, history: ConversationMessage[], question: string): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...truncateHistory(history).map(({ role, content }) => ({ role, content })),
    { role: 'user', content: question },
  ];
}

/**
 * Generates the answer to `question`, then runs the anti-sycophancy review on it.
 * `history` holds earlier messages of the same conversation only: nothing is
 * carried over from other conversations.
 */
export async function answer(router: ProviderRouter, history: ConversationMessage[], question: string): Promise<string> {
  const draft = await router.complete(buildMessages(SYSTEM_PROMPT, history, question), {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  try {
    const review = await router.complete(
      [
        { role: 'system', content: REVIEW_SYSTEM_PROMPT },
        { role: 'user', content: buildReviewInput(question, draft) },
      ],
      { maxOutputTokens: MAX_OUTPUT_TOKENS },
    );
    return applyReview(draft, review);
  } catch (error) {
    // The draft already follows the system prompt: better an unreviewed answer than none.
    console.warn('review pass failed', error);
    return draft;
  }
}

/**
 * Asks the model for a structured document. There is no review pass: the
 * output is data rendered by the app, and it is validated against the schema.
 */
export async function createDocument(
  router: ProviderRouter,
  history: ConversationMessage[],
  question: string,
): Promise<DocumentSpec> {
  const raw = await router.complete(buildMessages(DOCUMENT_SYSTEM_PROMPT, history, question), {
    maxOutputTokens: MAX_DOCUMENT_OUTPUT_TOKENS,
    json: true,
    timeoutMs: DOCUMENT_TIMEOUT_MS,
  });

  const document = parseDocument(raw);
  if (!document) throw new Error('model returned an unusable document');
  return document;
}
