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
import { MAX_HISTORY_MESSAGES, parseChatRequest, respond, type ConversationMessage } from './chat';
import { generateImage, ImageNotProducedError, imagesEnabled, isFlagged } from './images';
import {
  deleteAccount,
  deleteAllConversations,
  deleteConversation,
  findConversation,
  findImage,
  listConversations,
  listMessages,
  saveExchange,
} from './conversations';
import type { AppEnv, UserStatus } from './env';
import { getRouter } from './llm/providers';
import { AllProvidersFailedError } from './llm/router';
import { detectSensitiveTopic, sensitiveTopicResponse } from './sensitive';
import {
  consumeDeepMessage,
  consumeImage,
  consumeMessage,
  currentDay,
  getUsedDeepMessages,
  getUsedImages,
  getUsedMessages,
  refundDeepMessage,
  refundImage,
  refundMessage,
} from './usage';

const STATE_COOKIE = 'oauth_state';
const STATUSES: UserStatus[] = ['pending', 'approved', 'blocked'];

const app = new Hono<AppEnv>().basePath('/api');

/** Document messages are sent to the client parsed, with the title as text. */
function toClientMessage(message: ConversationMessage) {
  const document = message.kind === 'document' ? parseDocument(message.content) : null;
  // The client only needs the names: extracted text stays on the server.
  const attachments = message.attachments
    ? { documents: message.attachments.documents.map((entry) => entry.name), images: message.attachments.images }
    : undefined;

  if (message.imageId) return { role: message.role, content: '', image: { id: message.imageId } };

  return document
    ? { role: message.role, content: document.title, document }
    : { role: message.role, content: message.content, attachments };
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

app.post('/chat', requireUser, requireApproved, async (c) => {
  const user = c.get('user');
  const request = parseChatRequest(await c.req.json().catch(() => null));
  if (!request) return c.json({ error: 'invalid_request' }, 400);

  const db = c.env.DB;
  const day = currentDay();

  if (request.conversationId && !(await findConversation(db, user, request.conversationId))) {
    return c.json({ error: 'not_found' }, 404);
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

  const used = await consumeMessage(db, user, day);
  if (used === null) return c.json({ error: 'daily_limit_reached' }, 429);

  // In-depth answers come from a separate allowance; without it the answer is a standard one.
  let deep = request.deep && (await consumeDeepMessage(db, user, day)) !== null;

  let imageTaken = false;
  let storedImageId: string | null = null;

  try {
    const history = request.conversationId ? await listMessages(db, request.conversationId, MAX_HISTORY_MESSAGES) : [];
    const { attachments } = request;
    const stored = hasAttachments(attachments) ? toStored(attachments) : null;

    const generate = (useDeep: boolean) =>
      respond(
        {
          draft: getRouter(c.env, useDeep ? 'deep' : 'standard'),
          review: getRouter(c.env),
          deep: useDeep,
          images: { enabled: imagesEnabled(c.env), isFlagged: (text) => isFlagged(c.env, text) },
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

    if (result.image) {
      if ((await consumeImage(db, user, day)) === null) {
        await refundMessage(db, user, day);
        return c.json({ error: 'image_limit_reached' }, 429);
      }
      imageTaken = true;

      try {
        const generated = await generateImage(c.env, result.image.prompt);
        imageId = crypto.randomUUID();
        storedImageId = imageId;
        await c.env.IMAGES.put(imageId, generated.bytes, { httpMetadata: { contentType: generated.mimeType } });
        conversation = await saveExchange(
          db,
          user,
          request.conversationId,
          request.message,
          imageMessageContent(result.image.prompt),
          'text',
          stored,
          { id: imageId, mimeType: generated.mimeType },
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
      conversation = result.document
        ? await saveExchange(db, user, request.conversationId, request.message, JSON.stringify(result.document), 'document', stored)
        : await saveExchange(db, user, request.conversationId, request.message, result.text ?? '', 'text', stored);
    }

    return c.json({
      answer: result.document ? result.document.title : result.text,
      document: result.document,
      image: imageId ? { id: imageId } : undefined,
      deep,
      remaining: Math.max(0, user.dailyMessageLimit - used),
      deepRemaining: Math.max(0, user.dailyDeepLimit - (await getUsedDeepMessages(db, user, day))),
      imageRemaining: Math.max(0, user.dailyImageLimit - (await getUsedImages(db, user, day))),
      conversation,
    });
  } catch (error) {
    console.error('chat failed', error);
    await refundMessage(db, user, day);
    if (deep) await refundDeepMessage(db, user, day);
    if (imageTaken) await refundImage(db, user, day);
    // The picture was stored but the exchange was not: do not leave the file behind.
    if (storedImageId) await c.env.IMAGES.delete(storedImageId).catch(() => undefined);
    // Only a provider that may not see attachments was left: say so, the user can retry without files.
    if (error instanceof AllProvidersFailedError && error.attachmentsSkipped) {
      return c.json({ error: 'attachments_unavailable' }, 503);
    }
    return c.json({ error: 'service_unavailable' }, 503);
  }
});

// --- Administration ----------------------------------------------------------

app.get('/admin/users', requireUser, requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, name, status, daily_message_limit AS dailyLimit, daily_deep_limit AS deepLimit, daily_image_limit AS imageLimit,
            created_at AS createdAt
     FROM users ORDER BY status = 'pending' DESC, created_at DESC`,
  ).all<{ email: string }>();
  return c.json({ users: results.map((row) => ({ ...row, isAdmin: isAdminEmail(c.env, row.email) })) });
});

app.patch('/admin/users/:id', requireUser, requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const body = ((await c.req.json().catch(() => null)) ?? {}) as {
    status?: unknown;
    dailyLimit?: unknown;
    deepLimit?: unknown;
    imageLimit?: unknown;
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

  if (!status && dailyLimit === null && deepLimit === null && imageLimit === null) return c.json({ error: 'invalid_request' }, 400);

  await c.env.DB.prepare(
    `UPDATE users SET status = COALESCE(?1, status),
       daily_message_limit = COALESCE(?2, daily_message_limit),
       daily_deep_limit = COALESCE(?3, daily_deep_limit),
       daily_image_limit = COALESCE(?4, daily_image_limit)
     WHERE id = ?5`,
  )
    .bind(status ?? null, dailyLimit, deepLimit, imageLimit, id)
    .run();

  // A user who is no longer approved loses the open sessions too.
  if (status && status !== 'approved') await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();

  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
