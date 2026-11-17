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
import { parseDocument } from '../shared/document';
import { MAX_HISTORY_MESSAGES, parseChatRequest, respond, type ConversationMessage } from './chat';
import {
  deleteAllConversations,
  deleteConversation,
  findConversation,
  listConversations,
  listMessages,
  saveExchange,
} from './conversations';
import type { AppEnv, UserStatus } from './env';
import { getRouter } from './llm/providers';
import { detectSensitiveTopic, sensitiveTopicResponse } from './sensitive';
import {
  consumeDeepMessage,
  consumeMessage,
  currentDay,
  getUsedDeepMessages,
  getUsedMessages,
  refundDeepMessage,
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
  return c.json({
    name: user.name,
    email: user.email,
    status: user.status,
    isAdmin: user.isAdmin,
    dailyLimit: user.dailyMessageLimit,
    remaining: Math.max(0, user.dailyMessageLimit - used),
    deepLimit: user.dailyDeepLimit,
    deepRemaining: Math.max(0, user.dailyDeepLimit - deepUsed),
  });
});

/** Deletes the account with everything attached to it (sessions, usage, conversations). */
app.delete('/me', requireUser, async (c) => {
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(c.get('user').id).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// --- Conversations -----------------------------------------------------------

app.get('/conversations', requireUser, requireApproved, async (c) => {
  return c.json({ conversations: await listConversations(c.env.DB, c.get('user')) });
});

app.delete('/conversations', requireUser, requireApproved, async (c) => {
  await deleteAllConversations(c.env.DB, c.get('user'));
  return c.json({ ok: true });
});

app.get('/conversations/:id', requireUser, requireApproved, async (c) => {
  const conversation = await findConversation(c.env.DB, c.get('user'), c.req.param('id'));
  if (!conversation) return c.json({ error: 'not_found' }, 404);
  const messages = await listMessages(c.env.DB, conversation.id);
  return c.json({ ...conversation, messages: messages.map(toClientMessage) });
});

app.delete('/conversations/:id', requireUser, requireApproved, async (c) => {
  await deleteConversation(c.env.DB, c.get('user'), c.req.param('id'));
  return c.json({ ok: true });
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

  try {
    const history = request.conversationId ? await listMessages(db, request.conversationId, MAX_HISTORY_MESSAGES) : [];
    const { attachments } = request;
    const stored = hasAttachments(attachments) ? toStored(attachments) : null;

    const generate = (useDeep: boolean) =>
      respond(
        { draft: getRouter(c.env, useDeep ? 'deep' : 'standard'), review: getRouter(c.env), deep: useDeep },
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

    const conversation = result.document
      ? await saveExchange(db, user, request.conversationId, request.message, JSON.stringify(result.document), 'document', stored)
      : await saveExchange(db, user, request.conversationId, request.message, result.text, 'text', stored);

    return c.json({
      answer: result.document ? result.document.title : result.text,
      document: result.document,
      deep,
      remaining: Math.max(0, user.dailyMessageLimit - used),
      deepRemaining: Math.max(0, user.dailyDeepLimit - (await getUsedDeepMessages(db, user, day))),
      conversation,
    });
  } catch (error) {
    console.error('chat failed', error);
    await refundMessage(db, user, day);
    if (deep) await refundDeepMessage(db, user, day);
    return c.json({ error: 'service_unavailable' }, 503);
  }
});

// --- Administration ----------------------------------------------------------

app.get('/admin/users', requireUser, requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, name, status, daily_message_limit AS dailyLimit, daily_deep_limit AS deepLimit,
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

  if (!status && dailyLimit === null && deepLimit === null) return c.json({ error: 'invalid_request' }, 400);

  await c.env.DB.prepare(
    `UPDATE users SET status = COALESCE(?1, status),
       daily_message_limit = COALESCE(?2, daily_message_limit),
       daily_deep_limit = COALESCE(?3, daily_deep_limit)
     WHERE id = ?4`,
  )
    .bind(status ?? null, dailyLimit, deepLimit, id)
    .run();

  // A user who is no longer approved loses the open sessions too.
  if (status && status !== 'approved') await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();

  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
