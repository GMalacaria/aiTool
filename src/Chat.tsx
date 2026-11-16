import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError, sendConversation, type Account, type ConversationMessage } from './api';

interface ChatProps {
  accessCode: string;
  account: Account;
  onSignOut: () => void;
}

const MAX_MESSAGE_CHARS = 4000;

const ERROR_TEXT: Record<string, string> = {
  daily_limit_reached: 'Limite giornaliero raggiunto, torna domani.',
  invalid_request: 'Richiesta non valida. Avvia una nuova chat.',
  service_unavailable: 'Servizio non disponibile. Riprova più tardi.',
};

export function Chat({ accessCode, account, onSignOut }: ChatProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [remaining, setRemaining] = useState(account.remaining);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending]);

  const limitReached = remaining <= 0;

  async function send() {
    const content = draft.trim();
    if (!content || pending || limitReached) return;

    const conversation: ConversationMessage[] = [...messages, { role: 'user', content }];
    setMessages(conversation);
    setDraft('');
    setError(null);
    setPending(true);

    try {
      const result = await sendConversation(accessCode, conversation);
      setMessages([...conversation, { role: 'assistant', content: result.answer }]);
      setRemaining(result.remaining);
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : 'service_unavailable';
      if (code === 'invalid_code') {
        onSignOut();
        return;
      }
      if (code === 'daily_limit_reached') setRemaining(0);
      // Give the unsent message back so it is not lost.
      setMessages(messages);
      setDraft(content);
      setError(ERROR_TEXT[code] ?? ERROR_TEXT.service_unavailable);
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  function startNewChat() {
    setMessages([]);
    setError(null);
  }

  return (
    <div className="chat">
      <header className="chat-header">
        <div>
          <h1>ConoscenzIA</h1>
          <p className="muted">Strumento informativo. Non è una persona.</p>
        </div>
        <div className="chat-actions">
          <button type="button" onClick={startNewChat} disabled={pending || messages.length === 0}>
            Nuova chat
          </button>
          <button type="button" onClick={onSignOut}>
            Esci
          </button>
        </div>
      </header>

      <main className="chat-messages" aria-live="polite">
        {messages.length === 0 && <p className="muted">Scrivi una domanda.</p>}
        {messages.map((message, index) => (
          <article key={index} className={`message message-${message.role}`}>
            <h2>{message.role === 'user' ? 'Domanda' : 'Risposta'}</h2>
            <p>{message.content}</p>
          </article>
        ))}
        {pending && (
          <p role="status" className="muted">
            Richiesta in corso
          </p>
        )}
        <div ref={endRef} />
      </main>

      <form className="chat-form" onSubmit={handleSubmit}>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {limitReached && !error && <p className="muted">Limite giornaliero raggiunto, torna domani.</p>}
        <label htmlFor="question" className="visually-hidden">
          Domanda
        </label>
        <textarea
          id="question"
          rows={3}
          maxLength={MAX_MESSAGE_CHARS}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={limitReached}
        />
        <div className="chat-form-footer">
          <span className="muted">
            Messaggi rimasti oggi: {remaining} di {account.dailyLimit}
          </span>
          <button type="submit" disabled={pending || limitReached || !draft.trim()}>
            Invia
          </button>
        </div>
      </form>
    </div>
  );
}
