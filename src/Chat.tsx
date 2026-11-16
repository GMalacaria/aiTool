import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AnswerFormat, ConversationMessage } from './api';
import { DocumentView } from './documents/DocumentView';

interface ChatProps {
  messages: ConversationMessage[];
  pending: boolean;
  error: string | null;
  remaining: number;
  dailyLimit: number;
  /** Resolves to false when the message was not sent. */
  onSend: (content: string, format: AnswerFormat) => Promise<boolean>;
}

const MAX_MESSAGE_CHARS = 4000;

export function Chat({ messages, pending, error, remaining, dailyLimit, onSend }: ChatProps) {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending]);

  const limitReached = remaining <= 0;

  async function send(format: AnswerFormat = 'text') {
    const content = draft.trim();
    if (!content || pending || limitReached) return;

    setDraft('');
    // Give the unsent message back so it is not lost.
    if (!(await onSend(content, format))) setDraft(content);
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

  return (
    <>
      <main className="chat-messages" aria-live="polite">
        {messages.length === 0 && <p className="muted">Scrivi una domanda.</p>}
        {messages.map((message, index) => (
          <article key={index} className={`message message-${message.role}`}>
            <h2>{message.role === 'user' ? 'Domanda' : message.document ? 'Documento' : 'Risposta'}</h2>
            {message.document ? <DocumentView document={message.document} /> : <p>{message.content}</p>}
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
        <p className="muted">
          «Crea documento» produce un file con testo, tabelle, grafici o test, scaricabile in PDF o Excel.
        </p>
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
            Messaggi rimasti oggi: {remaining} di {dailyLimit}
          </span>
          <div className="chat-form-buttons">
            <button type="button" onClick={() => void send('document')} disabled={pending || limitReached || !draft.trim()}>
              Crea documento
            </button>
            <button type="submit" className="button-primary" disabled={pending || limitReached || !draft.trim()}>
              Invia
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
