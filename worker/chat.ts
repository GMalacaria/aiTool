import {
  hasAttachments,
  parseAttachments,
  type Attachments,
  type DocumentAttachment,
  type StoredAttachments,
} from '../shared/attachments';
import { parseDocument, type DocumentSpec } from '../shared/document';
import type { ChatMessage, ContentPart, ProviderRouter } from './llm/router';
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
  /** Attachments stored with a user message (document text, image names). */
  attachments: StoredAttachments | null;
}

export interface ChatRequest {
  /** Null starts a new conversation. */
  conversationId: string | null;
  message: string;
  /** What the answer should be: plain text, or a structured document. */
  format: MessageKind;
  attachments: Attachments;
}

/** Validates the client payload; returns null when it is not usable. */
export function parseChatRequest(payload: unknown): ChatRequest | null {
  const {
    conversationId = null,
    message,
    format = 'text',
    attachments: rawAttachments,
  } = (payload ?? {}) as { conversationId?: unknown; message?: unknown; format?: unknown; attachments?: unknown };

  if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_CHARS) return null;
  if (conversationId !== null && (typeof conversationId !== 'string' || !UUID.test(conversationId))) return null;
  if (format !== 'text' && format !== 'document') return null;

  const attachments = parseAttachments(rawAttachments);
  if (!attachments) return null;

  return { conversationId, message: message.trim(), format, attachments };
}

/** Keeps only the most recent turns, starting from a user message: tokens are the scarce resource. */
export function truncateHistory(history: ConversationMessage[]): ConversationMessage[] {
  const recent = history.slice(-MAX_HISTORY_MESSAGES);
  const firstUser = recent.findIndex((message) => message.role === 'user');
  return firstUser === -1 ? [] : recent.slice(firstUser);
}

function withDocuments(text: string, documents: DocumentAttachment[]): string {
  const blocks = documents.map(
    // The closing tag is removed from the text so a file cannot end its own block early.
    (document) =>
      `<attached_document name="${document.name}">\n${document.text.replaceAll('</attached_document>', '')}\n</attached_document>`,
  );
  return [...blocks, text].join('\n\n');
}

/** A past user message: document text is sent again, images are no longer available. */
function historyContent(message: ConversationMessage): string {
  if (!message.attachments) return message.content;
  const images = message.attachments.images.length
    ? `\n\n[Images attached to this message, no longer available: ${message.attachments.images.join(', ')}]`
    : '';
  return withDocuments(message.content, message.attachments.documents) + images;
}

/** The new question, with document text inline and images as separate parts. */
export function questionContent(question: string, attachments: Attachments): string | ContentPart[] {
  const text = withDocuments(question, attachments.documents);
  if (!attachments.images.length) return text;
  return [
    { type: 'text', text },
    ...attachments.images.map((image): ContentPart => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
  ];
}

function buildMessages(
  systemPrompt: string,
  history: ConversationMessage[],
  question: string,
  attachments: Attachments,
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...truncateHistory(history).map((message) => ({ role: message.role, content: historyContent(message) })),
    { role: 'user', content: questionContent(question, attachments) },
  ];
}

/** What the reviewer sees as the user's message: attachments are only mentioned. */
function reviewQuestion(question: string, attachments: Attachments): string {
  if (!hasAttachments(attachments)) return question;
  const names = [...attachments.documents.map((document) => document.name), ...attachments.images.map((image) => image.name)];
  return `${question}\n\n[The user attached: ${names.join(', ')}]`;
}

/**
 * Generates the answer to `question`, then runs the anti-sycophancy review on it.
 * `history` holds earlier messages of the same conversation only: nothing is
 * carried over from other conversations.
 */
export async function answer(
  router: ProviderRouter,
  history: ConversationMessage[],
  question: string,
  attachments: Attachments = { documents: [], images: [] },
): Promise<string> {
  const draft = await router.complete(buildMessages(SYSTEM_PROMPT, history, question, attachments), {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  try {
    const review = await router.complete(
      [
        { role: 'system', content: REVIEW_SYSTEM_PROMPT },
        { role: 'user', content: buildReviewInput(reviewQuestion(question, attachments), draft) },
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
  attachments: Attachments = { documents: [], images: [] },
): Promise<DocumentSpec> {
  const raw = await router.complete(buildMessages(DOCUMENT_SYSTEM_PROMPT, history, question, attachments), {
    maxOutputTokens: MAX_DOCUMENT_OUTPUT_TOKENS,
    json: true,
    timeoutMs: DOCUMENT_TIMEOUT_MS,
  });

  const document = parseDocument(raw);
  if (!document) throw new Error('model returned an unusable document');
  return document;
}
