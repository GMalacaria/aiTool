import type { ChatMessage, ProviderRouter } from './llm/router';
import { applyReview, buildReviewInput, REVIEW_SYSTEM_PROMPT, SYSTEM_PROMPT } from './prompts';

export const MAX_HISTORY_MESSAGES = 8;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_CONVERSATION_MESSAGES = 60;
const MAX_OUTPUT_TOKENS = 700;

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Validates the client payload; returns null when it is not a usable conversation. */
export function parseConversation(payload: unknown): ConversationMessage[] | null {
  const messages = (payload as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_CONVERSATION_MESSAGES) return null;

  const conversation: ConversationMessage[] = [];
  for (const message of messages) {
    const { role, content } = (message ?? {}) as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string' || !content.trim() || content.length > MAX_MESSAGE_CHARS) return null;
    conversation.push({ role, content: content.trim() });
  }

  return conversation.at(-1)?.role === 'user' ? conversation : null;
}

/** Keeps only the most recent turns: tokens are the scarce resource. */
export function truncateHistory(conversation: ConversationMessage[]): ConversationMessage[] {
  const recent = conversation.slice(-MAX_HISTORY_MESSAGES);
  const firstUser = recent.findIndex((message) => message.role === 'user');
  return recent.slice(firstUser);
}

/** Generates the answer, then runs the anti-sycophancy review on it. */
export async function answer(router: ProviderRouter, conversation: ConversationMessage[]): Promise<string> {
  const history = truncateHistory(conversation);
  const question = history[history.length - 1].content;

  const draftMessages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];
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
