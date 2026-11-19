import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { buildAuthUrl, exchangeCode } from './auth/google';
import {
  createSession,
  deleteSession,
  isAdminEmail,
  randomToken,
  requireAdmin,
  requireApproved,
  requireSameOrigin,
  requireUser,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  upsertUser,
} from './auth/session';
import { hasAttachments, toStored } from '../shared/attachments';
import { IMAGE_REFUSAL_FALLBACK, imageMessageContent } from './prompts';
import { parseDocument } from '../shared/document';
import { MAX_QUESTIONS_PER_CONVERSATION } from '../shared/conversation';
import { normalizeContext, parseContextUpdate } from '../shared/context';
import { parseIllustrations } from '../shared/illustrations';
import { parseMedia } from '../shared/media';
import { parseSources } from '../shared/sources';
import {
  generateTitle,
  MAX_HISTORY_MESSAGES,
  parseChatRequest,
  respond,
  type ConversationMessage,
  type LoadedImage,
} from './chat';
import {
  dataUrlToBytes,
  generateImage,
  ImageNotProducedError,
  imagesEnabled,
  isFlagged,
  isImageFlagged,
  readImage,
} from './images';
import {
  deleteAccount,
  deleteAllConversations,
  deleteConversation,
  findConversation,
  countQuestions,
  findAnswer,
  findContextUpdate,
  findImage,
  lastAnswerId,
  listConversations,
  listMessages,
  MAX_TITLE_CHARS,
  renameConversation,
  saveCheckedAnswer,
  saveContextUpdate,
  searchConversations,
  saveExchange,
} from './conversations';
import { PROFILES, type AppEnv, type Env, type UserStatus } from './env';
import { getRouter, hasFreeProviders, OPENAI_MODELS, OPENAI_PRICES, type Tier } from './llm/providers';
import { DEFAULT_GEMINI_BASE_URL, DEFAULT_VERIFY_MODEL, verifyAnswer, type SourcesConfig } from './sources';
import { UsageMeter } from './meter';
import {
  getContext,
  listContextVersions,
  restoreContextVersion,
  saveContext,
  setContextPaused,
  undoContextVersion,
} from './context';
import { streaks, usageTotals } from './stats';
import { AllProvidersFailedError } from './llm/router';
import { detectSensitiveTopic, sensitiveTopicResponse } from './sensitive';
import {
  consumeDeepMessage,
  consumeImage,
  consumeMessage,
  currentDay,
  getUsedDeepMessages,
  getUsedImages,
  getPaidTokens,
  getSearchesToday,
  getUsedMessages,
  recordUsage,
  refundDeepMessage,
  refundImage,
  refundMessage,
} from './usage';

const STATE_COOKIE = 'oauth_state';
/** Stored images sent to the model again in a follow-up, newest first. */
const MAX_HISTORY_IMAGES = 4;

/**
 * Loads the most recent stored images of the conversation (attached by the
 * user or generated) so the model can look at them again and edits can start
 * from them. Missing files are skipped.
 */
async function loadHistoryImages(bucket: R2Bucket, history: ConversationMessage[]): Promise<void> {
  let budget = MAX_HISTORY_IMAGES;
  for (const message of [...history].reverse()) {
    if (budget <= 0) break;
    const wanted =
      message.role === 'assistant'
        ? message.imageId
          ? [{ id: message.imageId, name: 'generated image' }]
          : []
        : (message.attachments?.images ?? []).filter((image): image is { id: string; name: string } => Boolean(image.id));

    const loaded: LoadedImage[] = [];
    for (const image of wanted.slice(0, budget)) {
      const data = await readImage(bucket, image.id);
      if (data) loaded.push({ id: image.id, name: image.name, ...data });
    }
    if (loaded.length) message.imageData = loaded;
    budget -= loaded.length;
  }
}
const STATUSES: UserStatus[] = ['pending', 'approved', 'blocked'];
const DEFAULT_SOURCES_DAILY_LIMIT = 300;

/**
 * Web search with verified sources, paid by the owner. Off in free mode (the
 * paid model is not used there) and once the app-wide daily cap is reached.
 */
async function sourcesConfig(env: Env, db: D1Database, day: string, tier: Tier, freeMode: boolean): Promise<SourcesConfig | undefined> {
  if (freeMode || !env.OPENAI_API_KEY) return undefined;
  const parsed = Number(env.SOURCES_DAILY_LIMIT);
  const cap = env.SOURCES_DAILY_LIMIT !== undefined && Number.isFinite(parsed) ? parsed : DEFAULT_SOURCES_DAILY_LIMIT;
  if (cap <= 0 || (await getSearchesToday(db, day)) >= cap) return undefined;

  const verifyKey = env.GEMINI_IMAGE_API_KEY ?? env.GEMINI_API_KEY;
  return {
    openaiKey: env.OPENAI_API_KEY,
    openaiBaseURL: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: OPENAI_MODELS[tier],
    price: OPENAI_PRICES[tier],
    verify: verifyKey
      ? {
          apiKey: verifyKey,
          baseURL: (env.GEMINI_IMAGE_BASE_URL ?? DEFAULT_GEMINI_BASE_URL).replace(/\/$/, ''),
          model: env.GEMINI_VERIFY_MODEL ?? DEFAULT_VERIFY_MODEL,
          paid: Boolean(env.GEMINI_IMAGE_API_KEY),
        }
      : undefined,
  };
}

const app = new Hono<AppEnv>().basePath('/api');

/** Document messages are sent to the client parsed, with the title as text. */
function toClientMessage(message: ConversationMessage) {
  const document = message.kind === 'document' ? parseDocument(message.content) : null;
  // The client only needs the names: extracted text stays on the server.
  const attachments = message.attachments
    ? {
        documents: message.attachments.documents.map((entry) => entry.name),
        images: message.attachments.images.map((image) => image.name),
        imageUrls: message.attachments.images.map((image) => (image.id ? `/api/images/${image.id}` : null)),
      }
    : undefined;

  const freeModel = message.freeModel ? true : undefined;
  const sources = message.sources ? (parseSources(message.sources) ?? undefined) : undefined;
  const contextUpdate = message.contextUpdate ? (parseContextUpdate(message.contextUpdate) ?? undefined) : undefined;
  const media = message.media ? (parseMedia(message.media) ?? undefined) : undefined;
  const illustrations = message.illustrations ? (parseIllustrations(message.illustrations) ?? undefined) : undefined;
  const id = message.id;
  if (message.imageId) return { id, role: message.role, content: '', image: { id: message.imageId }, contextUpdate };

  return document
    ? { id, role: message.role, content: document.title, document, freeModel, contextUpdate }
    : { id, role: message.role, content: message.content, attachments, freeModel, sources, contextUpdate, media, illustrations };
}

app.use(requireSameOrigin);

app.get('/health', (c) => c.json({ status: 'ok' }));

// --- Sign-in -----------------------------------------------------------------

app.get('/auth/google/start', (c) => {
  const url = new URL(c.req.url);
  const state = randomToken(16);

  setCookie(c, STATE_COOKIE, state, {
    path: '/api/auth',
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'Lax',
    maxAge: 600,
  });
  return c.redirect(buildAuthUrl(c.env, `${url.origin}/api/auth/google/callback`, state));
});

app.get('/auth/google/callback', async (c) => {
  const url = new URL(c.req.url);
  const expectedState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/api/auth' });

  const code = c.req.query('code');
  if (!code || !expectedState || c.req.query('state') !== expectedState) return c.redirect('/?error=sign_in_failed');

  try {
    const profile = await exchangeCode(c.env, code, `${url.origin}/api/auth/google/callback`);
    const user = await upsertUser(c.env, profile);
    const token = await createSession(c.env.DB, user.id);

    setCookie(c, SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return c.redirect('/');
  } catch (error) {
    console.error('sign-in failed', error);
    return c.redirect('/?error=sign_in_failed');
  }
});

app.post('/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(c.env.DB, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// --- Account -----------------------------------------------------------------

app.get('/me', requireUser, async (c) => {
  const user = c.get('user');
  const approved = user.status === 'approved';
  const used = approved ? await getUsedMessages(c.env.DB, user, currentDay()) : 0;
  const deepUsed = approved ? await getUsedDeepMessages(c.env.DB, user, currentDay()) : 0;
  const imagesUsed = approved ? await getUsedImages(c.env.DB, user, currentDay()) : 0;
  const tokensUsed = approved ? await getPaidTokens(c.env.DB, user, currentDay()) : 0;
  return c.json({
    name: user.name,
    email: user.email,
    status: user.status,
    isAdmin: user.isAdmin,
    dailyLimit: user.dailyMessageLimit,
    remaining: Math.max(0, user.dailyMessageLimit - used),
    deepLimit: user.dailyDeepLimit,
    deepRemaining: Math.max(0, user.dailyDeepLimit - deepUsed),
    imagesEnabled: imagesEnabled(c.env),
    imageLimit: user.dailyImageLimit,
    imageRemaining: Math.max(0, user.dailyImageLimit - imagesUsed),
    profile: user.profile,
    tokenLimit: user.dailyTokenLimit,
    tokensUsed,
    freeMode: tokensUsed >= user.dailyTokenLimit,
    freeAvailable: hasFreeProviders(c.env),
  });
});

/** Lifetime figures for the Profile page. Counted from the usage log, which started on 2026-11-17. */
app.get('/me/stats', requireUser, requireApproved, async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT created_at AS createdAt FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ createdAt: string }>();
  const { days, ...totals } = await usageTotals(c.env.DB, user);

  return c.json({
    createdAt: row?.createdAt ?? null,
    ...totals,
    tokens: totals.paidTokens + totals.freeTokens,
    activeDays: days.length,
    streak: streaks(days, currentDay()),
  });
});

/** Deletes the account with everything attached to it (sessions, usage, conversations). */
app.delete('/me', requireUser, async (c) => {
  await deleteAccount(c.env.DB, c.env.IMAGES, c.get('user'));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// --- Conversations -----------------------------------------------------------

app.get('/conversations', requireUser, requireApproved, async (c) => {
  return c.json({ conversations: await listConversations(c.env.DB, c.get('user')) });
});

app.delete('/conversations', requireUser, requireApproved, async (c) => {
  await deleteAllConversations(c.env.DB, c.env.IMAGES, c.get('user'));
  return c.json({ ok: true });
});

/** Searches titles and message text of the user's conversations. Registered before /:id. */
app.get('/conversations/search', requireUser, requireApproved, async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  if (query.length < 2 || query.length > 100) return c.json({ results: [] });
  return c.json({ results: await searchConversations(c.env.DB, c.get('user'), query) });
});

app.patch('/conversations/:id', requireUser, requireApproved, async (c) => {
  const body = ((await c.req.json().catch(() => null)) ?? {}) as { title?: unknown };
  const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : '';
  if (!title || title.length > MAX_TITLE_CHARS) return c.json({ error: 'invalid_request' }, 400);

  const renamed = await renameConversation(c.env.DB, c.get('user'), c.req.param('id'), title);
  return renamed ? c.json({ ok: true, title }) : c.json({ error: 'not_found' }, 404);
});

app.get('/conversations/:id', requireUser, requireApproved, async (c) => {
  const conversation = await findConversation(c.env.DB, c.get('user'), c.req.param('id'));
  if (!conversation) return c.json({ error: 'not_found' }, 404);
  const messages = await listMessages(c.env.DB, conversation.id);
  return c.json({ ...conversation, messages: messages.map(toClientMessage) });
});

app.delete('/conversations/:id', requireUser, requireApproved, async (c) => {
  await deleteConversation(c.env.DB, c.env.IMAGES, c.get('user'), c.req.param('id'));
  return c.json({ ok: true });
});

/** A generated image, only for its owner. The bytes are never shared or cached publicly. */
app.get('/images/:id', requireUser, requireApproved, async (c) => {
  const id = c.req.param('id');
  const image = await findImage(c.env.DB, c.get('user'), id);
  const object = image ? await c.env.IMAGES.get(id) : null;
  if (!image || !object) return c.json({ error: 'not_found' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': image.mimeType,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
});

/**
 * The preview picture of a video, fetched by the server: opening a chat never
 * contacts YouTube from the browser until the user taps play.
 */
app.get('/media/youtube/:id/thumbnail', requireUser, requireApproved, async (c) => {
  const id = c.req.param('id');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return c.json({ error: 'not_found' }, 404);
  const response = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, { signal: AbortSignal.timeout(8_000) }).catch(
    () => null,
  );
  const type = response?.headers.get('Content-Type') ?? '';
  if (!response?.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return c.json({ error: 'not_found' }, 404);

  return new Response(response.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
});

app.post('/chat', requireUser, requireApproved, async (c) => {
  const user = c.get('user');
  const request = parseChatRequest(await c.req.json().catch(() => null));
  if (!request) return c.json({ error: 'invalid_request' }, 400);

  const db = c.env.DB;
  const day = currentDay();

  if (request.conversationId && !(await findConversation(db, user, request.conversationId))) {
    return c.json({ error: 'not_found' }, 404);
  }
  // A full conversation takes no more requests: the user opens a new chat. Nothing is consumed.
  if (request.conversationId && (await countQuestions(db, request.conversationId)) >= MAX_QUESTIONS_PER_CONVERSATION) {
    return c.json({ error: 'conversation_limit_reached' }, 409);
  }

  // Sensitive exchanges get a fixed answer, cost nothing and are never stored.
  const topic = detectSensitiveTopic(request.message);
  if (topic) {
    const used = await getUsedMessages(db, user, day);
    return c.json({
      answer: sensitiveTopicResponse(topic),
      remaining: Math.max(0, user.dailyMessageLimit - used),
      conversation: null,
    });
  }

  // Past the daily budget of paid tokens only free-tier models answer; without them, nothing does.
  const paidTokensBefore = await getPaidTokens(db, user, day);
  const freeMode = paidTokensBefore >= user.dailyTokenLimit;
  if (freeMode && !hasFreeProviders(c.env)) return c.json({ error: 'tokens_exhausted' }, 429);

  const used = await consumeMessage(db, user, day);
  if (used === null) return c.json({ error: 'daily_limit_reached' }, 429);

  // In-depth answers come from a separate allowance, and need the paid model.
  let deep = !freeMode && request.deep && (await consumeDeepMessage(db, user, day)) !== null;
  const meter = new UsageMeter();
  let usageKind: 'text' | 'deep' | 'document' | 'image' | 'error' = 'error';
  const saveUsage = () =>
    recordUsage(db, user, day, usageKind, freeMode ? 'free' : 'paid', meter).catch((error: unknown) =>
      console.error('usage not recorded', error),
    );

  let imageTaken = false;
  let storedImageId: string | null = null;
  // Attached images written to R2 for this request: removed again if the exchange is not saved.
  let uploadedImages: string[] = [];

  try {
    const history = request.conversationId ? await listMessages(db, request.conversationId, MAX_HISTORY_MESSAGES) : [];
    await loadHistoryImages(c.env.IMAGES, history);
    const { attachments } = request;

    // A new conversation gets a short title, made from the question alone while the answer is written.
    const titlePromise = request.conversationId
      ? Promise.resolve(null)
      : generateTitle(getRouter(c.env, 'standard', freeMode), request.message, meter);

    // The context is personal: free providers never receive it, so it is not used in free mode.
    const userContext = freeMode ? null : await getContext(db, user.id);
    const generate = async (useDeep: boolean) =>
      respond(
        {
          draft: getRouter(c.env, useDeep ? 'deep' : 'standard', freeMode),
          review: getRouter(c.env, 'standard', freeMode),
          deep: useDeep,
          meter,
          // Only when the user asked for verified sources: the search makes the answer slower.
          sources: request.verifySources
            ? await sourcesConfig(c.env, db, day, useDeep ? 'deep' : 'standard', freeMode)
            : undefined,
          context: userContext
            ? {
                content: userContext.content,
                paused: userContext.paused,
                save: (content, source, note) => saveContext(db, user.id, content, source, note),
              }
            : undefined,
          profile: user.profile,
          illustrations: {
            isFlagged: (text) => isFlagged(c.env, text),
            commonsURL: c.env.COMMONS_API_URL,
            userAgent: c.env.WIKIMEDIA_USER_AGENT,
          },
          media: {
            isFlagged: (text) => isFlagged(c.env, text),
            youtubeKey: c.env.YOUTUBE_API_KEY,
            youtubeBaseURL: c.env.YOUTUBE_BASE_URL,
            nominatimBaseURL: c.env.NOMINATIM_BASE_URL,
            userAgent: c.env.NOMINATIM_USER_AGENT,
            // Only a photo request searches the web, paid by the owner like verified sources.
            search: () => sourcesConfig(c.env, db, day, 'standard', freeMode),
          },
          images: {
            enabled: imagesEnabled(c.env),
            isFlagged: (text) => isFlagged(c.env, text),
            isImageFlagged: (dataUrl) => isImageFlagged(c.env, dataUrl),
          },
        },
        history,
        request.message,
        attachments,
      );

    let result: Awaited<ReturnType<typeof generate>>;
    try {
      result = await generate(deep);
    } catch (error) {
      if (!deep) throw error;
      // The in-depth model is unavailable: give the allowance back and answer normally.
      console.warn('in-depth model failed, falling back', error);
      await refundDeepMessage(db, user, day);
      deep = false;
      result = await generate(false);
    }

    // An image request does not use the in-depth allowance.
    if (result.image && deep) {
      await refundDeepMessage(db, user, day);
      deep = false;
    }

    let conversation;
    let imageId: string | null = null;

    // The attached images are kept, so they can be shown and edited later without attaching them again.
    const files: { id: string; mimeType: string }[] = [];
    for (const image of attachments.images) {
      const decoded = dataUrlToBytes(image.dataUrl);
      if (!decoded) continue;
      const id = crypto.randomUUID();
      await c.env.IMAGES.put(id, decoded.bytes, { httpMetadata: { contentType: decoded.mimeType } });
      uploadedImages.push(id);
      files.push({ id, mimeType: decoded.mimeType });
    }
    const stored = hasAttachments(attachments) ? toStored(attachments, files) : null;

    if (result.image) {
      if ((await consumeImage(db, user, day)) === null) {
        await refundMessage(db, user, day);
        return c.json({ error: 'image_limit_reached' }, 429);
      }
      imageTaken = true;

      try {
        const generated = await generateImage(c.env, result.image.prompt, undefined, result.image.source);
        meter.addImage();
        imageId = crypto.randomUUID();
        storedImageId = imageId;
        await c.env.IMAGES.put(imageId, generated.bytes, { httpMetadata: { contentType: generated.mimeType } });
        conversation = await saveExchange(
          db,
          user,
          request.conversationId,
          request.message,
          imageMessageContent(result.image.prompt, result.image.source?.label),
          'text',
          stored,
          { id: imageId, mimeType: generated.mimeType },
          meter.answeredByFreeModel,
          await titlePromise,
          null,
          result.contextUpdate ?? null,
        );
        storedImageId = null;
      } catch (error) {
        if (!(error instanceof ImageNotProducedError)) throw error;
        // The model refused or returned no picture (its own safety filters): a normal answer, no image used.
        console.warn('image not produced', error);
        await refundImage(db, user, day);
        imageTaken = false;
        imageId = null;
        result = { text: IMAGE_REFUSAL_FALLBACK };
      }
    }

    if (!conversation) {
      const free = meter.answeredByFreeModel;
      conversation = result.document
        ? await saveExchange(db, user, request.conversationId, request.message, JSON.stringify(result.document), 'document', stored, null, free, await titlePromise, null, result.contextUpdate ?? null)
        : await saveExchange(db, user, request.conversationId, request.message, result.text ?? '', 'text', stored, null, free, await titlePromise, result.sources ?? null, result.contextUpdate ?? null, result.media ?? null, result.illustrations ?? null);
    }

    uploadedImages = [];
    usageKind = imageId ? 'image' : result.document ? 'document' : deep ? 'deep' : 'text';
    await saveUsage();

    return c.json({
      messageId: await lastAnswerId(db, conversation.id),
      answer: result.document ? result.document.title : result.text,
      document: result.document,
      image: imageId ? { id: imageId } : undefined,
      sources: result.text !== undefined ? (result.sources ?? undefined) : undefined,
      contextUpdate: result.contextUpdate,
      media: result.media,
      illustrations: result.illustrations,
      deep,
      remaining: Math.max(0, user.dailyMessageLimit - used),
      deepRemaining: Math.max(0, user.dailyDeepLimit - (await getUsedDeepMessages(db, user, day))),
      imageRemaining: Math.max(0, user.dailyImageLimit - (await getUsedImages(db, user, day))),
      freeMode,
      answeredByFreeModel: meter.answeredByFreeModel,
      tokensUsed: paidTokensBefore + meter.paidTokens,
      tokenLimit: user.dailyTokenLimit,
      conversation,
    });
  } catch (error) {
    console.error('chat failed', error);
    // Tokens spent before the failure are real cost: they are recorded too.
    usageKind = 'error';
    await saveUsage();
    await refundMessage(db, user, day);
    if (deep) await refundDeepMessage(db, user, day);
    if (imageTaken) await refundImage(db, user, day);
    // The picture was stored but the exchange was not: do not leave the file behind.
    if (storedImageId) await c.env.IMAGES.delete(storedImageId).catch(() => undefined);
    if (uploadedImages.length) await c.env.IMAGES.delete(uploadedImages).catch(() => undefined);
    // Only a provider that may not see attachments was left: say so, the user can retry without files.
    if (error instanceof AllProvidersFailedError && error.attachmentsSkipped) {
      return c.json({ error: 'attachments_unavailable' }, 503);
    }
    // Every model is out of quota: in free mode that means the free tiers are used up too.
    if (error instanceof AllProvidersFailedError && error.rateLimited) {
      return c.json({ error: freeMode ? 'free_quota_exhausted' : 'quota_exhausted' }, 429);
    }
    return c.json({ error: 'service_unavailable' }, 503);
  }
});

// --- User context ------------------------------------------------------------
// What the user chose to share about themselves. Only the user can read or change it.

app.get('/me/context', requireUser, requireApproved, async (c) => {
  const user = c.get('user');
  const [context, versions] = await Promise.all([getContext(c.env.DB, user.id), listContextVersions(c.env.DB, user.id)]);
  return c.json({ ...context, versions });
});

/** Edited by hand in Profilo. */
app.put('/me/context', requireUser, requireApproved, async (c) => {
  const body = ((await c.req.json().catch(() => null)) ?? {}) as { content?: unknown };
  const content = typeof body.content === 'string' ? normalizeContext(body.content) : null;
  if (content === null) return c.json({ error: 'invalid_request' }, 400);
  const user = c.get('user');
  const current = await getContext(c.env.DB, user.id);
  if (content !== current.content) await saveContext(c.env.DB, user.id, content, 'manual', 'Modificato dal Profilo');
  return c.json({ content });
});

app.patch('/me/context', requireUser, requireApproved, async (c) => {
  const body = ((await c.req.json().catch(() => null)) ?? {}) as { paused?: unknown };
  if (typeof body.paused !== 'boolean') return c.json({ error: 'invalid_request' }, 400);
  await setContextPaused(c.env.DB, c.get('user').id, body.paused);
  return c.json({ paused: body.paused });
});

app.post('/me/context/versions/:id/restore', requireUser, requireApproved, async (c) => {
  const id = Number(c.req.param('id'));
  const content = Number.isInteger(id) ? await restoreContextVersion(c.env.DB, c.get('user').id, id) : null;
  return content === null ? c.json({ error: 'not_found' }, 404) : c.json({ content });
});

/** "Annulla" under an answer: takes back the context change made with it, if nothing changed since. */
app.post('/messages/:id/context-undo', requireUser, requireApproved, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const update = Number.isInteger(id) ? parseContextUpdate(await findContextUpdate(c.env.DB, user, id)) : null;
  if (!update) return c.json({ error: 'not_found' }, 404);
  if (update.undone) return c.json({ contextUpdate: update });

  const restored = await undoContextVersion(c.env.DB, user.id, update.versionId);
  if (restored === null) return c.json({ error: 'context_changed' }, 409);
  const undone = { ...update, undone: true };
  await saveContextUpdate(c.env.DB, id, undone);
  return c.json({ contextUpdate: undone });
});

/**
 * Checks the sources of an answer written without search, on the user's
 * request. Paid by the owner: it uses no allowance, only the app-wide cap.
 */
app.post('/messages/:id/verify', requireUser, requireApproved, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const answer = Number.isInteger(id) ? await findAnswer(c.env.DB, user, id) : null;
  if (!answer) return c.json({ error: 'not_found' }, 404);

  const current = answer.sources ? parseSources(answer.sources) : null;
  // Already checked (or never factual): nothing to do, the stored answer is returned.
  if (answer.kind !== 'text' || !current?.unchecked) {
    return c.json({ content: answer.content, sources: current ?? undefined });
  }

  const day = currentDay();
  const config = await sourcesConfig(c.env, c.env.DB, day, 'standard', false);
  if (!config) return c.json({ error: 'sources_unavailable' }, 503);

  const meter = new UsageMeter();
  try {
    const checked = await verifyAnswer(config, answer.question, answer.content, meter);
    await saveCheckedAnswer(c.env.DB, answer.id, checked.text, checked.sources);
    await recordUsage(c.env.DB, user, day, 'verify', 'paid', meter);
    return c.json({ content: checked.text, sources: checked.sources ?? undefined });
  } catch (error) {
    console.error('source check failed', error);
    await recordUsage(c.env.DB, user, day, 'error', 'paid', meter).catch(() => undefined);
    return c.json({ error: 'sources_unavailable' }, 503);
  }
});

// --- Administration ----------------------------------------------------------

app.get('/admin/users', requireUser, requireAdmin, async (c) => {
  const day = currentDay();
  const monthStart = `${day.slice(0, 7)}-01`;
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.status, u.profile,
            u.daily_message_limit AS dailyLimit, u.daily_deep_limit AS deepLimit,
            u.daily_image_limit AS imageLimit, u.daily_token_limit AS tokenLimit,
            u.created_at AS createdAt,
            COALESCE(d.messages, 0) AS todayMessages, COALESCE(d.paid_tokens, 0) AS todayPaidTokens,
            COALESCE(d.images, 0) AS todayImages,
            COALESCE(m.cost, 0) AS monthCostMicroUsd, COALESCE(m.requests, 0) AS monthRequests,
            COALESCE(m.free_tokens, 0) AS monthFreeTokens,
            COALESCE(m.searches, 0) AS monthSearches, COALESCE(m.sources_cost, 0) AS monthSourcesCostMicroUsd
     FROM users u
     LEFT JOIN daily_usage d ON d.user_id = u.id AND d.day = ?1
     LEFT JOIN (
       SELECT user_id, SUM(cost_micro_usd) AS cost, COUNT(*) AS requests,
              SUM(free_input_tokens + free_output_tokens) AS free_tokens,
              SUM(searches) AS searches, SUM(sources_cost_micro_usd) AS sources_cost
       FROM usage_events WHERE day >= ?2 GROUP BY user_id
     ) m ON m.user_id = u.id
     ORDER BY u.status = 'pending' DESC, u.created_at DESC`,
  )
    .bind(day, monthStart)
    .all<{ email: string }>();
  return c.json({ users: results.map((row) => ({ ...row, isAdmin: isAdminEmail(c.env, row.email) })) });
});

/** Day-by-day usage of one user, newest first. */
app.get('/admin/users/:id/usage', requireUser, requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const days = Math.min(Math.max(Number(c.req.query('days')) || 30, 1), 366);
  if (!Number.isInteger(id)) return c.json({ error: 'invalid_request' }, 400);

  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  const { results } = await c.env.DB.prepare(
    `SELECT day,
            COUNT(*) AS requests,
            SUM(CASE WHEN kind = 'text' THEN 1 ELSE 0 END) AS text,
            SUM(CASE WHEN kind = 'deep' THEN 1 ELSE 0 END) AS deep,
            SUM(CASE WHEN kind = 'document' THEN 1 ELSE 0 END) AS documents,
            SUM(images) AS images,
            SUM(CASE WHEN kind = 'error' THEN 1 ELSE 0 END) AS errors,
            SUM(CASE WHEN mode = 'free' THEN 1 ELSE 0 END) AS freeModeRequests,
            SUM(paid_input_tokens + paid_output_tokens) AS paidTokens,
            SUM(free_input_tokens + free_output_tokens) AS freeTokens,
            SUM(cost_micro_usd) AS costMicroUsd,
            SUM(searches) AS searches,
            SUM(sources_cost_micro_usd) AS sourcesCostMicroUsd
     FROM usage_events WHERE user_id = ? AND day >= ?
     GROUP BY day ORDER BY day DESC`,
  )
    .bind(id, currentDay(since))
    .all();
  return c.json({ days: results });
});

app.patch('/admin/users/:id', requireUser, requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const body = ((await c.req.json().catch(() => null)) ?? {}) as {
    status?: unknown;
    dailyLimit?: unknown;
    deepLimit?: unknown;
    imageLimit?: unknown;
    tokenLimit?: unknown;
    profile?: unknown;
  };

  const target = Number.isInteger(id)
    ? await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(id).first<{ email: string }>()
    : null;
  if (!target) return c.json({ error: 'not_found' }, 404);

  // Administrators are always approved: their status cannot be changed.
  const status = isAdminEmail(c.env, target.email) ? undefined : STATUSES.find((candidate) => candidate === body.status);
  const limit = (value: unknown, max: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
  const dailyLimit = limit(body.dailyLimit, 500);
  const deepLimit = limit(body.deepLimit, 100);
  const imageLimit = limit(body.imageLimit, 50);
  const tokenLimit = limit(body.tokenLimit, 10_000_000);
  const profile = PROFILES.find((candidate) => candidate === body.profile) ?? null;

  if (!status && dailyLimit === null && deepLimit === null && imageLimit === null && tokenLimit === null && !profile) return c.json({ error: 'invalid_request' }, 400);

  await c.env.DB.prepare(
    `UPDATE users SET status = COALESCE(?1, status),
       daily_message_limit = COALESCE(?2, daily_message_limit),
       daily_deep_limit = COALESCE(?3, daily_deep_limit),
       daily_image_limit = COALESCE(?4, daily_image_limit),
       daily_token_limit = COALESCE(?5, daily_token_limit),
       profile = COALESCE(?6, profile)
     WHERE id = ?7`,
  )
    .bind(status ?? null, dailyLimit, deepLimit, imageLimit, tokenLimit, profile, id)
    .run();

  // A user who is no longer approved loses the open sessions too.
  if (status && status !== 'approved') await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();

  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
