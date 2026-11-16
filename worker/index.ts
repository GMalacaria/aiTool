import { Hono } from 'hono';
import { requireUser } from './auth';
import { answer, parseConversation } from './chat';
import type { AppEnv } from './env';
import { getRouter } from './llm/providers';
import { detectSensitiveTopic, sensitiveTopicResponse } from './sensitive';
import { consumeMessage, currentDay, getUsedMessages, refundMessage } from './usage';

const app = new Hono<AppEnv>().basePath('/api');

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/me', requireUser, async (c) => {
  const user = c.get('user');
  const used = await getUsedMessages(c.env.DB, user, currentDay());
  return c.json({
    name: user.name,
    dailyLimit: user.dailyMessageLimit,
    remaining: Math.max(0, user.dailyMessageLimit - used),
  });
});

app.post('/chat', requireUser, async (c) => {
  const user = c.get('user');
  const conversation = parseConversation(await c.req.json().catch(() => null));
  if (!conversation) return c.json({ error: 'invalid_request' }, 400);

  const day = currentDay();
  const question = conversation[conversation.length - 1].content;

  const topic = detectSensitiveTopic(question);
  if (topic) {
    const used = await getUsedMessages(c.env.DB, user, day);
    return c.json({
      answer: sensitiveTopicResponse(topic),
      remaining: Math.max(0, user.dailyMessageLimit - used),
    });
  }

  const used = await consumeMessage(c.env.DB, user, day);
  if (used === null) return c.json({ error: 'daily_limit_reached' }, 429);

  try {
    const text = await answer(getRouter(c.env), conversation);
    return c.json({ answer: text, remaining: Math.max(0, user.dailyMessageLimit - used) });
  } catch (error) {
    console.error('chat failed', error);
    await refundMessage(c.env.DB, user, day);
    return c.json({ error: 'service_unavailable' }, 503);
  }
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
