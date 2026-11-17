import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MAX_QUESTIONS_PER_CONVERSATION } from '../shared/conversation';
import type { ConversationMessage } from './api';
import { Chat } from './Chat';

const conversation = (exchanges: number): ConversationMessage[] =>
  Array.from({ length: exchanges }, (_, index): ConversationMessage[] => [
    { role: 'user', content: `domanda ${index + 1}` },
    { role: 'assistant', content: `risposta ${index + 1}` },
  ]).flat();

const render = (messages: ConversationMessage[]) =>
  renderToStaticMarkup(
    <Chat
      messages={messages}
      pending={false}
      error={null}
      remaining={5}
      dailyLimit={15}
      deepRemaining={1}
      deepLimit={3}
      imagesEnabled={false}
      imageRemaining={0}
      imageLimit={3}
      tokensUsed={0}
      tokenLimit={1000}
      freeMode={false}
      freeAvailable={true}
      onSend={async () => true}
      onVerifySources={async () => true}
      onNewChat={() => undefined}
      onUndoContext={async () => 'done' as const}
    />,
  );

describe('conversation limit', () => {
  it('says nothing while many requests are left', () => {
    expect(render(conversation(3))).not.toContain('in questa chat');
  });

  it('counts down the last requests', () => {
    expect(render(conversation(MAX_QUESTIONS_PER_CONVERSATION - 3))).toContain('Ancora 3 richieste in questa chat.');
    expect(render(conversation(MAX_QUESTIONS_PER_CONVERSATION - 1))).toContain('Ultima richiesta in questa chat.');
  });

  it('closes a full chat and offers a new one', () => {
    const html = render(conversation(MAX_QUESTIONS_PER_CONVERSATION));
    expect(html).toContain(`limite di ${MAX_QUESTIONS_PER_CONVERSATION} richieste`);
    expect(html).toContain('>Nuova chat</button>');
    expect(html).toMatch(/<textarea[^>]*disabled/);
    expect(html).not.toContain('Limite giornaliero raggiunto');
  });
});
