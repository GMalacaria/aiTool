import { describe, expect, it, vi } from 'vitest';
import { answer, MAX_HISTORY_MESSAGES, parseChatRequest, truncateHistory, type ConversationMessage } from './chat';
import { titleFrom } from './conversations';
import type { ChatMessage, ProviderRouter } from './llm/router';
import { applyReview, REVIEW_SYSTEM_PROMPT, SYSTEM_PROMPT } from './prompts';
import { detectSensitiveTopic } from './sensitive';
import { currentDay } from './usage';

const user = (content: string): ConversationMessage => ({ role: 'user', content });
const assistant = (content: string): ConversationMessage => ({ role: 'assistant', content });
const CONVERSATION_ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('parseChatRequest', () => {
  it('accepts a new conversation and trims the message', () => {
    expect(parseChatRequest({ message: ' hello ' })).toEqual({ conversationId: null, message: 'hello' });
  });

  it('accepts an existing conversation id', () => {
    expect(parseChatRequest({ conversationId: CONVERSATION_ID, message: 'hi' })).toEqual({
      conversationId: CONVERSATION_ID,
      message: 'hi',
    });
  });

  it.each([
    ['missing message', {}],
    ['blank message', { message: '   ' }],
    ['too long message', { message: 'x'.repeat(4001) }],
    ['non-string message', { message: 42 }],
    ['malformed conversation id', { conversationId: 'abc', message: 'hi' }],
    ['non-object payload', null],
  ])('rejects %s', (_label, payload) => {
    expect(parseChatRequest(payload)).toBeNull();
  });
});

describe('truncateHistory', () => {
  it('keeps the most recent messages and starts from a user message', () => {
    const history = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0 ? user(`q${index}`) : assistant(`a${index}`),
    );
    const truncated = truncateHistory(history);

    expect(truncated.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    expect(truncated[0].role).toBe('user');
    expect(truncated.at(-1)).toEqual(assistant('a19'));
  });

  it('returns nothing for an empty history', () => {
    expect(truncateHistory([])).toEqual([]);
  });
});

describe('titleFrom', () => {
  it('collapses whitespace and shortens long questions', () => {
    expect(titleFrom('  How\nare   things? ')).toBe('How are things?');
    expect(titleFrom('x'.repeat(100))).toHaveLength(60);
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

  it('sends the conversation history, then reviews the draft', async () => {
    const { router, complete } = routerReturning('Great question! Rome.', 'Rome.');
    const history = [user('Hi'), assistant('Hello.')];

    await expect(answer(router, history, 'Capital of Italy?')).resolves.toBe('Rome.');

    const [draftCall, reviewCall] = complete.mock.calls.map(([messages]) => messages);
    expect(draftCall).toEqual([{ role: 'system', content: SYSTEM_PROMPT }, ...history, user('Capital of Italy?')]);
    expect(reviewCall[0]).toEqual({ role: 'system', content: REVIEW_SYSTEM_PROMPT });
    expect(reviewCall[1].content).toContain('Capital of Italy?');
    expect(reviewCall[1].content).toContain('Great question! Rome.');
  });

  it('returns the draft when the review pass fails', async () => {
    const { router } = routerReturning('Rome.', new Error('rate limited'));
    await expect(answer(router, [], 'Capital of Italy?')).resolves.toBe('Rome.');
  });

  it('fails when the draft cannot be generated', async () => {
    const { router } = routerReturning(new Error('down'));
    await expect(answer(router, [], 'Capital of Italy?')).rejects.toThrow('down');
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
