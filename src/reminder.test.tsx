import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from './api';
import { Chat } from './Chat';
import { REMINDER_EVERY, REMINDER_TEXT, reminderAfter } from './reminder';

const conversation = (exchanges: number): ConversationMessage[] =>
  Array.from({ length: exchanges }, (_, index): ConversationMessage[] => [
    { role: 'user', content: `domanda ${index + 1}` },
    { role: 'assistant', content: `risposta ${index + 1}` },
  ]).flat();

describe('reminderAfter', () => {
  it('follows the answer to every Nth question, and only that', () => {
    const messages = conversation(2 * REMINDER_EVERY + 1);
    const positions = messages.map((_, index) => index).filter((index) => reminderAfter(messages, index));

    expect(positions).toEqual([2 * REMINDER_EVERY - 1, 4 * REMINDER_EVERY - 1]);
    expect(messages[positions[0]]).toEqual({ role: 'assistant', content: `risposta ${REMINDER_EVERY}` });
  });

  it('does not show one after a question that is still unanswered', () => {
    const messages = conversation(REMINDER_EVERY - 1);
    messages.push({ role: 'user', content: 'domanda' });
    expect(messages.some((_, index) => reminderAfter(messages, index))).toBe(false);
  });

  it('is empty for short conversations', () => {
    const messages = conversation(REMINDER_EVERY - 1);
    expect(messages.some((_, index) => reminderAfter(messages, index))).toBe(false);
    expect(reminderAfter([], 0)).toBe(false);
  });
});

describe('Chat reminder', () => {
  const render = (messages: ConversationMessage[]) =>
    renderToStaticMarkup(
      <Chat messages={messages} pending={false} error={null} remaining={5} dailyLimit={15} deepRemaining={1} deepLimit={3} imagesEnabled={false} imageRemaining={0} imageLimit={3} tokensUsed={0} tokenLimit={1000} freeMode={false} freeAvailable={true} onSend={async () => true} />,
    );

  it('shows the reminder once per block of questions', () => {
    const html = render(conversation(REMINDER_EVERY));
    expect(html.split(REMINDER_TEXT)).toHaveLength(2);
    expect(html).toContain('role="note"');

    // The reminder comes right after the answer, before anything else.
    expect(html.indexOf(`risposta ${REMINDER_EVERY}`)).toBeLessThan(html.indexOf(REMINDER_TEXT));
  });

  it('shows nothing in a short conversation', () => {
    expect(render(conversation(REMINDER_EVERY - 1))).not.toContain(REMINDER_TEXT);
  });
});
