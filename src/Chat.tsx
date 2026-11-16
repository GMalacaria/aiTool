import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { EMPTY_ATTACHMENTS, hasAttachments, type Attachments } from '../shared/attachments';
import type { AnswerFormat, ConversationMessage } from './api';
import { addFiles } from './attachments/read';
import { DocumentView } from './documents/DocumentView';

interface ChatProps {
  messages: ConversationMessage[];
  pending: boolean;
  error: string | null;
  remaining: number;
  dailyLimit: number;
  /** Resolves to false when the message was not sent. */
  onSend: (content: string, format: AnswerFormat, attachments: Attachments) => Promise<boolean>;
}

const MAX_MESSAGE_CHARS = 4000;

export function Chat({ messages, pending, error, remaining, dailyLimit, onSend }: ChatProps) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachments>(EMPTY_ATTACHMENTS);
  const [notes, setNotes] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending]);

  const limitReached = remaining <= 0;
  const cannotSend = pending || reading || limitReached || !draft.trim();

  async function send(format: AnswerFormat = 'text') {
    const content = draft.trim();
    if (!content || pending || reading || limitReached) return;

    const sent = attachments;
    setDraft('');
    setAttachments(EMPTY_ATTACHMENTS);
    setNotes([]);
    // Give the unsent message and its attachments back so they are not lost.
    if (!(await onSend(content, format, sent))) {
      setDraft(content);
      setAttachments(sent);
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

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    // Allow choosing the same file again later.
    event.target.value = '';
    if (!files.length) return;

    setReading(true);
    try {
      const result = await addFiles(attachments, files);
      setAttachments(result.attachments);
      setNotes(result.notes);
    } finally {
      setReading(false);
    }
  }

  function removeDocument(index: number) {
    setAttachments({ ...attachments, documents: attachments.documents.filter((_, item) => item !== index) });
  }

  function removeImage(index: number) {
    setAttachments({ ...attachments, images: attachments.images.filter((_, item) => item !== index) });
  }

  return (
    <>
      <main className="chat-messages" aria-live="polite">
        {messages.length === 0 && <p className="muted">Scrivi una domanda.</p>}
        {messages.map((message, index) => (
          <article key={index} className={`message message-${message.role}`}>
            <h2>{message.role === 'user' ? 'Domanda' : message.document ? 'Documento' : 'Risposta'}</h2>
            {message.document ? <DocumentView document={message.document} /> : <p>{message.content}</p>}
            {message.attachments && hasAttachments(message.attachments) && (
              <ul className="attachments" aria-label="Allegati">
                {message.attachments.documents.map((name, item) => (
                  <li key={`document-${item}`}>Documento: {name}</li>
                ))}
                {message.attachments.images.map((name, item) => (
                  <li key={`image-${item}`}>Immagine: {name}</li>
                ))}
              </ul>
            )}
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

        {hasAttachments(attachments) && (
          <ul className="attachments attachments-pending" aria-label="Allegati da inviare">
            {attachments.documents.map((document, index) => (
              <li key={`document-${index}`}>
                <span>Documento: {document.name}</span>
                <button type="button" aria-label={`Rimuovi ${document.name}`} onClick={() => removeDocument(index)}>
                  Rimuovi
                </button>
              </li>
            ))}
            {attachments.images.map((image, index) => (
              <li key={`image-${index}`}>
                <img src={image.dataUrl} alt="" />
                <span>{image.name}</span>
                <button type="button" aria-label={`Rimuovi ${image.name}`} onClick={() => removeImage(index)}>
                  Rimuovi
                </button>
              </li>
            ))}
          </ul>
        )}
        {reading && (
          <p role="status" className="muted">
            Lettura dei file in corso
          </p>
        )}
        {notes.map((note, index) => (
          <p key={index} role="status" className="muted">
            {note}
          </p>
        ))}

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
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              hidden
              onChange={(event) => void handleFiles(event)}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={pending || reading || limitReached}>
              Allega
            </button>
            <button type="button" onClick={() => void send('document')} disabled={cannotSend}>
              Crea documento
            </button>
            <button type="submit" className="button-primary" disabled={cannotSend}>
              Invia
            </button>
          </div>
        </div>
        <p className="muted">
          «Allega» aggiunge immagini o PDF alla domanda. «Crea documento» produce un file con testo, tabelle, grafici o
          test, scaricabile in PDF o Excel.
        </p>
      </form>
    </>
  );
}
