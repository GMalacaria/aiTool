import {
  hasAttachments,
  parseAttachments,
  splitDataUrl,
  type Attachments,
  type DocumentAttachment,
  type StoredAttachments,
} from '../shared/attachments';
import { parseDocument, type DocumentSpec } from '../shared/document';
import { stripMarkers, type AnswerSources } from '../shared/sources';
import type { ChatMessage, ContentPart, ProviderRouter } from './llm/router';
import {
  applyReview,
  buildIntentInput,
  buildReviewInput,
  DEEP_INSTRUCTION,
  DOCUMENT_SYSTEM_PROMPT,
  INTENT_SYSTEM_PROMPT,
  IMAGE_PROMPT_SYSTEM_PROMPT,
  IMAGE_REFUSAL_FALLBACK,
  buildImagePlanInput,
  parseImagePlan,
  parseIntent,
  REVIEW_SYSTEM_PROMPT,
  SEARCH_INSTRUCTION,
  type Intent,
  STUDENT_DOCUMENT_INSTRUCTION,
  STUDENT_INSTRUCTION,
  STUDENT_REVIEW_INSTRUCTION,
  SYSTEM_PROMPT,
  TITLE_SYSTEM_PROMPT,
  cleanTitle,
} from './prompts';
import type { Profile } from './env';
import type { UsageMeter } from './meter';
import { answerWithSources, type SourcesConfig } from './sources';

/** Previous messages of the conversation sent to the model along with the new question. */
export const MAX_HISTORY_MESSAGES = 8;
export const MAX_MESSAGE_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 700;
const MAX_DEEP_OUTPUT_TOKENS = 1800;
const MAX_DOCUMENT_OUTPUT_TOKENS = 4000;
const MAX_INTENT_OUTPUT_TOKENS = 200;
const MAX_IMAGE_PLAN_OUTPUT_TOKENS = 600;
const MAX_SOURCE_IMAGES = 5;
const LONG_TIMEOUT_MS = 90_000;
const INTENT_TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MessageKind = 'text' | 'document';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  /** For 'document' messages, the JSON document description. */
  content: string;
  kind: MessageKind;
  /** Attachments stored with a user message (document text, image names). */
  attachments: StoredAttachments | null;
  /** The generated image shown with an assistant message. */
  imageId?: string | null;
  /** 1 when the answer came from a free-tier model. */
  freeModel?: number;
  /** Verified sources of the answer, as stored JSON. */
  sources?: string | null;
  /**
   * Images of this message loaded from storage for the model: the user's
   * attached images, or the image generated as this answer.
   */
  imageData?: LoadedImage[];
}

/** A stored image read back from R2, ready to send to a model. */
export interface LoadedImage {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
}

/** An image the user may want to edit, with how the planner sees it. */
interface SourceImage {
  label: string;
  dataUrl: string;
  mimeType: string;
}

export interface ChatRequest {
  /** Null starts a new conversation. */
  conversationId: string | null;
  message: string;
  attachments: Attachments;
  /** The user asked for a more in-depth answer. */
  deep: boolean;
}

/** Validates the client payload; returns null when it is not usable. */
export function parseChatRequest(payload: unknown): ChatRequest | null {
  const {
    conversationId = null,
    message,
    attachments: rawAttachments,
    deep = false,
  } = (payload ?? {}) as {
    conversationId?: unknown;
    message?: unknown;
    attachments?: unknown;
    deep?: unknown;
  };

  if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_CHARS) return null;
  if (conversationId !== null && (typeof conversationId !== 'string' || !UUID.test(conversationId))) return null;
  if (typeof deep !== 'boolean') return null;

  const attachments = parseAttachments(rawAttachments);
  if (!attachments) return null;

  return { conversationId, message: message.trim(), attachments, deep };
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

/**
 * A stored message as the model should see it. User messages get their document
 * text again and, when `withImages` and they were loaded, their images; other
 * images are only mentioned. A document created earlier is raw JSON when the
 * model is about to write a document, so it can be changed; for a text answer
 * it is labelled, so the model does not imitate the JSON.
 */
function historyMessage(message: ConversationMessage, target: MessageKind, withImages: boolean): ChatMessage {
  if (message.role === 'assistant') {
    const content =
      message.kind === 'document' && target !== 'document'
        ? `[A document was created and shown to the user. Its content, as JSON:]\n${message.content}`
        : stripMarkers(message.content);
    return { role: 'assistant', content };
  }

  if (!message.attachments) return { role: 'user', content: message.content };

  const loaded = withImages ? (message.imageData ?? []) : [];
  const notSent = message.attachments.images.filter((image) => !loaded.some((item) => item.id === image.id));
  const note = notSent.length
    ? `\n\n[Images attached to this message, not shown here: ${notSent.map((image) => image.name).join(', ')}]`
    : '';
  const text = withDocuments(message.content, message.attachments.documents) + note;

  if (!loaded.length) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...loaded.map((image): ContentPart => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
    ],
  };
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
  target: MessageKind,
  /** Send stored images again (for answers); planners only need their labels. */
  withImages = true,
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...truncateHistory(history).map((message) => historyMessage(message, target, withImages)),
    { role: 'user', content: questionContent(question, withImages ? attachments : { ...attachments, images: [] }) },
  ];
}

/** Images that an edit can start from, newest first: attached now, then earlier ones in this conversation. */
export function sourceImages(history: ConversationMessage[], attachments: Attachments): SourceImage[] {
  const sources: SourceImage[] = attachments.images.map((image) => ({
    label: `attached now: ${image.name}`,
    dataUrl: image.dataUrl,
    mimeType: splitDataUrl(image.dataUrl)?.mimeType ?? 'image/jpeg',
  }));

  for (const message of [...truncateHistory(history)].reverse()) {
    for (const image of message.imageData ?? []) {
      const label =
        message.role === 'assistant'
          ? `generated earlier: ${message.content.replace(/^Image (generated|edited)[^:]*: /, '').slice(0, 160)}`
          : `attached earlier: ${image.name}`;
      sources.push({ label, dataUrl: image.dataUrl, mimeType: image.mimeType });
    }
  }
  return sources.slice(0, MAX_SOURCE_IMAGES);
}

/**
 * What the reviewer sees as the user's message: files are only mentioned, never
 * shown, but it must know they exist, or it would "correct" facts about them.
 */
function reviewQuestion(question: string, attachments: Attachments, history: ConversationMessage[] = []): string {
  const earlier = truncateHistory(history).flatMap((message) => [
    ...(message.attachments?.documents ?? []).map((document) => document.name),
    ...(message.imageData ?? []).map((image) => image.name),
  ]);
  const notes = [
    ...(hasAttachments(attachments) ? [`[The user attached: ${attachmentNames(attachments).join(', ')}]`] : []),
    ...(earlier.length ? [`[Files and images from earlier in the conversation, visible to the writer: ${earlier.join(', ')}]`] : []),
  ];
  return notes.length ? `${question}\n\n${notes.join('\n')}` : question;
}

/** True when the model will see the content of attached files, now or from earlier messages. */
function usesAttachments(history: ConversationMessage[], attachments: Attachments): boolean {
  return hasAttachments(attachments) || truncateHistory(history).some((message) => message.attachments !== null);
}

function attachmentNames(attachments: Attachments): string[] {
  return [...attachments.documents.map((document) => document.name), ...attachments.images.map((image) => image.name)];
}

export interface Routers {
  /** Writes the answer: the standard model, or the in-depth one. */
  draft: ProviderRouter;
  /** Always the standard model: intent detection and the review pass. */
  review: ProviderRouter;
  deep: boolean;
  /** Collects the tokens of every call, for the usage log and the daily budget. */
  meter?: UsageMeter;
  /** 'student' turns the tool into a tutor that does not hand out solutions. */
  profile?: Profile;
  /** Web search with verified sources; absent means factual questions are answered without them. */
  sources?: SourcesConfig;
  /** Image generation; absent or disabled means the feature is off. */
  images?: {
    enabled: boolean;
    /** True when the text is flagged by moderation; rejects when moderation is unavailable. */
    isFlagged: (text: string) => Promise<boolean>;
    /** The same for an image to edit (a data URL). */
    isImageFlagged: (dataUrl: string) => Promise<boolean>;
  };
}

export type Reply =
  | { text: string; sources?: AnswerSources | null; document?: undefined; image?: undefined }
  | { document: DocumentSpec; text?: undefined; image?: undefined; sources?: undefined }
  /**
   * An allowed image request: the English description for a new picture, or the
   * edit instruction together with the image to edit.
   */
  | { image: { prompt: string; source?: SourceImage }; text?: undefined; document?: undefined; sources?: undefined };

export const IMAGES_OFF_TEXT = 'La creazione di immagini non è attiva.';
export const IMAGE_NO_SOURCE_TEXT =
  'Non trovo l’immagine da modificare in questa conversazione. Allegala di nuovo e ripeti la richiesta.';
export const IMAGES_UNAVAILABLE_TEXT = 'La creazione di immagini non è disponibile in questo momento. Riprova più tardi.';

function previousAnswer(history: ConversationMessage[]): 'text' | 'document' | 'image' {
  const last = history.at(-1);
  if (last?.kind === 'document') return 'document';
  return last?.imageId ? 'image' : 'text';
}

/**
 * Decides from the message alone whether the user wants a document. There is
 * no button for it. When in doubt, or if the call fails, the answer is text.
 */
export async function detectIntent(
  router: ProviderRouter,
  history: ConversationMessage[],
  question: string,
  attachments: Attachments,
  meter?: UsageMeter,
): Promise<Intent> {
  try {
    const reply = await router.complete(
      [
        { role: 'system', content: INTENT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildIntentInput(question, previousAnswer(history), attachmentNames(attachments)),
        },
      ],
      { maxOutputTokens: MAX_INTENT_OUTPUT_TOKENS, fast: true, timeoutMs: INTENT_TIMEOUT_MS, meter, purpose: 'intent' },
    );
    return parseIntent(reply);
  } catch (error) {
    console.warn('intent detection failed', error);
    return 'text';
  }
}

/**
 * Answers `question`, with text or with a document depending on what the
 * message asks for. `history` holds earlier messages of the same conversation
 * only: nothing is carried over from other conversations.
 *
 * Most messages want text, so the text draft starts while the intent is being
 * detected and is simply dropped in the rarer document case. The in-depth
 * model is too expensive to run speculatively: there the two steps are serial.
 */
export async function respond(
  routers: Routers,
  history: ConversationMessage[],
  question: string,
  attachments: Attachments = { documents: [], images: [] },
): Promise<Reply> {
  const intent = detectIntent(routers.review, history, question, attachments, routers.meter);

  const speculativeDraft = routers.deep ? null : draftText(routers, history, question, attachments);
  // A failure is reported only if this draft ends up being used.
  speculativeDraft?.catch(() => undefined);

  const detected = await intent;
  if (detected === 'document') {
    return {
      document: await createDocument(routers.draft, history, question, attachments, routers.meter, routers.profile),
    };
  }
  if (detected === 'image') return planImage(routers, history, question, attachments);

  if (detected === 'search' && routers.sources) {
    try {
      return await searchText(routers, routers.sources, history, question, attachments);
    } catch (error) {
      // Without search the question is still answered, only without sources.
      console.warn('web search failed, answering without sources', error);
    }
  }

  const draft = await (speculativeDraft ?? draftText(routers, history, question, attachments));
  return { text: await reviewText(routers, question, attachments, draft, history) };
}

/**
 * Checks an image request and prepares the generator's prompt. Images are never
 * produced unchecked: if moderation or the planner is unavailable the answer is
 * a refusal, not an unchecked image.
 */
async function planImage(
  routers: Routers,
  history: ConversationMessage[],
  question: string,
  attachments: Attachments,
): Promise<Reply> {
  const images = routers.images;
  if (!images?.enabled) return { text: IMAGES_OFF_TEXT };

  // The planner sees the conversation as text (documents included) and only the labels of the images.
  const sources = sourceImages(history, attachments);
  const planned = buildImagePlanInput(question, sources.map((source) => source.label));

  try {
    if (await images.isFlagged(question)) return { text: IMAGE_REFUSAL_FALLBACK };

    const raw = await routers.review.complete(
      buildMessages(IMAGE_PROMPT_SYSTEM_PROMPT, history, planned, { documents: attachments.documents, images: [] }, 'text', false),
      {
        maxOutputTokens: MAX_IMAGE_PLAN_OUTPUT_TOKENS,
        meter: routers.meter,
        purpose: 'plan',
        json: true,
        fast: true,
        timeoutMs: INTENT_TIMEOUT_MS * 2,
        containsAttachments: usesAttachments(history, attachments),
      },
    );
    const plan = parseImagePlan(raw);
    if (!plan) return { text: IMAGE_REFUSAL_FALLBACK };
    if (!plan.allowed) return { text: plan.refusal };

    // The description sent to the generator is checked as well.
    if (await images.isFlagged(plan.prompt)) return { text: IMAGE_REFUSAL_FALLBACK };

    if (plan.mode === 'edit') {
      const source = plan.source !== null ? sources[plan.source - 1] : undefined;
      // An edit with nothing to edit: say so instead of inventing a new picture.
      if (!source) return { text: IMAGE_NO_SOURCE_TEXT };
      if (await images.isImageFlagged(source.dataUrl)) return { text: IMAGE_REFUSAL_FALLBACK };
      return { image: { prompt: plan.prompt, source } };
    }
    return { image: { prompt: plan.prompt } };
  } catch (error) {
    console.warn('image request could not be checked', error);
    return { text: IMAGES_UNAVAILABLE_TEXT };
  }
}

/** A factual answer written with web search, checked sentence by sentence against its sources. */
async function searchText(
  routers: Routers,
  config: SourcesConfig,
  history: ConversationMessage[],
  question: string,
  attachments: Attachments,
): Promise<Reply> {
  const systemPrompt = [
    SYSTEM_PROMPT,
    SEARCH_INSTRUCTION,
    ...(routers.deep ? [DEEP_INSTRUCTION] : []),
    ...(routers.profile === 'student' ? [STUDENT_INSTRUCTION] : []),
  ].join('\n');
  const result = await answerWithSources(config, buildMessages(systemPrompt, history, question, attachments, 'text'), {
    deep: routers.deep,
    // Reasoning and the search itself share the output budget of the Responses API.
    maxOutputTokens: routers.deep ? MAX_DEEP_OUTPUT_TOKENS * 2 : MAX_OUTPUT_TOKENS * 3,
    meter: routers.meter,
    documents: attachments.documents,
    review: (draft) => reviewText(routers, question, attachments, draft, history),
  });
  return { text: result.text, sources: result.sources };
}

function draftText(
  routers: Routers,
  history: ConversationMessage[],
  question: string,
  attachments: Attachments,
): Promise<string> {
  const systemPrompt = [
    SYSTEM_PROMPT,
    ...(routers.deep ? [DEEP_INSTRUCTION] : []),
    ...(routers.profile === 'student' ? [STUDENT_INSTRUCTION] : []),
  ].join('\n');
  return routers.draft.complete(buildMessages(systemPrompt, history, question, attachments, 'text'), {
    meter: routers.meter,
    purpose: 'draft',
    maxOutputTokens: routers.deep ? MAX_DEEP_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS,
    timeoutMs: routers.deep ? LONG_TIMEOUT_MS : undefined,
    containsAttachments: usesAttachments(history, attachments),
  });
}

/** Anti-sycophancy review of a text draft: returns the draft or its rewrite. */
async function reviewText(
  routers: Routers,
  question: string,
  attachments: Attachments,
  draft: string,
  history: ConversationMessage[] = [],
): Promise<string> {
  try {
    const review = await routers.review.complete(
      [
        {
          role: 'system',
          content:
            routers.profile === 'student' ? `${REVIEW_SYSTEM_PROMPT}\n${STUDENT_REVIEW_INSTRUCTION}` : REVIEW_SYSTEM_PROMPT,
        },
        { role: 'user', content: buildReviewInput(reviewQuestion(question, attachments, history), draft) },
      ],
      {
        maxOutputTokens: routers.deep ? MAX_DEEP_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS,
        meter: routers.meter,
        purpose: 'review',
      },
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
  meter?: UsageMeter,
  profile?: Profile,
): Promise<DocumentSpec> {
  const systemPrompt =
    profile === 'student' ? `${DOCUMENT_SYSTEM_PROMPT}\n${STUDENT_DOCUMENT_INSTRUCTION}` : DOCUMENT_SYSTEM_PROMPT;
  const raw = await router.complete(buildMessages(systemPrompt, history, question, attachments, 'document'), {
    meter,
    purpose: 'document',
    maxOutputTokens: MAX_DOCUMENT_OUTPUT_TOKENS,
    json: true,
    timeoutMs: LONG_TIMEOUT_MS,
    containsAttachments: usesAttachments(history, attachments),
  });

  const document = parseDocument(raw);
  if (!document) throw new Error('model returned an unusable document');
  return document;
}

/** A very short title for a new conversation; null if it cannot be made (the caller falls back to the question). */
export async function generateTitle(router: ProviderRouter, question: string, meter?: UsageMeter): Promise<string | null> {
  try {
    const reply = await router.complete(
      [
        { role: 'system', content: TITLE_SYSTEM_PROMPT },
        { role: 'user', content: question.slice(0, 1000) },
      ],
      { maxOutputTokens: 60, fast: true, timeoutMs: INTENT_TIMEOUT_MS, meter, purpose: 'title' },
    );
    return cleanTitle(reply);
  } catch (error) {
    console.warn('title not generated', error);
    return null;
  }
}
