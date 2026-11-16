import type { ChatMessage, ProviderRouter } from './llm/router';
import { applyReview, buildReviewInput, REVIEW_SYSTEM_PROMPT, SYSTEM_PROMPT } from './prompts';

/** Previous messages of the conversation sent to the model along with the new question. */
export const MAX_HISTORY_MESSAGES = 8;
export const MAX_MESSAGE_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 700;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  /** Null starts a new conversation. */
  conversationId: string | null;
  message: string;
}

/** Validates the client payload; returns null when it is not usable. */
export function parseChatRequest(payload: unknown): ChatRequest | null {
  const { conversationId = null, message } = (payload ?? {}) as { conversationId?: unknown; message?: unknown };

  if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_CHARS) return null;
  if (conversationId !== null && (typeof conversationId !== 'string' || !UUID.test(conversationId))) return null;

  return { conversationId, message: message.trim() };
}

/** Keeps only the most recent turns, starting from a user message: tokens are the scarce resource. */
export function truncateHistory(history: ConversationMessage[]): ConversationMessage[] {
  const recent = history.slice(-MAX_HISTORY_MESSAGES);
  const firstUser = recent.findIndex((message) => message.role === 'user');
  return firstUser === -1 ? [] : recent.slice(firstUser);
}

/**
 * Generates the answer to `question`, then runs the anti-sycophancy review on it.
 * `history` holds earlier messages of the same conversation only: nothing is
 * carried over from other conversations.
 */
export async function answer(router: ProviderRouter, history: ConversationMessage[], question: string): Promise<string> {
  const draftMessages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...truncateHistory(history),
    { role: 'user', content: question },
  ];
  const draft = await router.complete(draftMessages, { maxOutputTokens: MAX_OUTPUT_TOKENS });

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
