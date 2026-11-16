import { describe, expect, it, vi } from 'vitest';
import { answer, MAX_HISTORY_MESSAGES, parseConversation, truncateHistory, type ConversationMessage } from './chat';
import type { ChatMessage, ProviderRouter } from './llm/router';
import { applyReview, REVIEW_SYSTEM_PROMPT, SYSTEM_PROMPT } from './prompts';
import { detectSensitiveTopic } from './sensitive';
import { currentDay } from './usage';

const user = (content: string): ConversationMessage => ({ role: 'user', content });
const assistant = (content: string): ConversationMessage => ({ role: 'assistant', content });

describe('parseConversation', () => {
  it('accepts a conversation ending with a user message and trims content', () => {
    expect(parseConversation({ messages: [user(' a '), assistant('b'), user('c')] })).toEqual([
      user('a'),
      assistant('b'),
      user('c'),
    ]);
  });

  it.each([
    ['missing messages', {}],
    ['empty list', { messages: [] }],
    ['last message from assistant', { messages: [user('a'), assistant('b')] }],
    ['system role', { messages: [{ role: 'system', content: 'x' }, user('a')] }],
    ['blank content', { messages: [user('   ')] }],
    ['too long content', { messages: [user('x'.repeat(4001))] }],
    ['non-object payload', null],
  ])('rejects %s', (_label, payload) => {
    expect(parseConversation(payload)).toBeNull();
  });
});

describe('truncateHistory', () => {
  it('keeps the most recent messages and starts from a user message', () => {
    const conversation = Array.from({ length: 21 }, (_, index) =>
      index % 2 === 0 ? user(`q${index}`) : assistant(`a${index}`),
    );
    const history = truncateHistory(conversation);

    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    expect(history[0].role).toBe('user');
    expect(history.at(-1)).toEqual(user('q20'));
  });
});

describe('applyReview', () => {
  it('keeps the draft when the reviewer approves', () => {
    expect(applyReview('draft', ' OK ')).toBe('draft');
    expect(applyReview('draft', 'ok.')).toBe('draft');
    expect(applyReview('draft', '')).toBe('draft');
  });

  it('uses the rewritten answer otherwise', () => {
    expect(applyReview('Great question! 4', ' 4 ')).toBe('4');
  });
});

describe('answer', () => {
  const routerReturning = (...replies: (string | Error)[]) => {
    const complete = vi.fn(async (_messages: ChatMessage[]) => {
      const reply = replies.shift();
      if (reply instanceof Error || reply === undefined) throw reply ?? new Error('no reply');
      return reply;
    });
    return { router: { complete } as unknown as ProviderRouter, complete };
  };

  it('generates a draft and then reviews it', async () => {
    const { router, complete } = routerReturning('Great question! Rome.', 'Rome.');

    await expect(answer(router, [user('Capital of Italy?')])).resolves.toBe('Rome.');

    const [draftCall, reviewCall] = complete.mock.calls.map(([messages]) => messages);
    expect(draftCall[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(reviewCall[0]).toEqual({ role: 'system', content: REVIEW_SYSTEM_PROMPT });
    expect(reviewCall[1].content).toContain('Capital of Italy?');
    expect(reviewCall[1].content).toContain('Great question! Rome.');
  });

  it('returns the draft when the review pass fails', async () => {
    const { router } = routerReturning('Rome.', new Error('rate limited'));
    await expect(answer(router, [user('Capital of Italy?')])).resolves.toBe('Rome.');
  });

  it('fails when the draft cannot be generated', async () => {
    const { router } = routerReturning(new Error('down'));
    await expect(answer(router, [user('Capital of Italy?')])).rejects.toThrow('down');
  });
});

describe('detectSensitiveTopic', () => {
  it('detects self-harm and violence', () => {
    expect(detectSensitiveTopic('A volte penso di farla finita')).toBe('self_harm');
    expect(detectSensitiveTopic('Mio marito mi picchia')).toBe('violence');
  });

  it('ignores ordinary questions', () => {
    expect(detectSensitiveTopic('Quanto dista la Luna dalla Terra?')).toBeNull();
  });
});

describe('currentDay', () => {
  it('uses the Italian calendar day', () => {
    expect(currentDay(new Date('2026-11-16T22:59:00Z'))).toBe('2026-11-16');
    expect(currentDay(new Date('2026-11-16T23:01:00Z'))).toBe('2026-11-17');
  });
});
