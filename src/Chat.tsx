import { Fragment, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { EMPTY_ATTACHMENTS, hasAttachments, type Attachments } from '../shared/attachments';
import type { ConversationMessage } from './api';
import { addFiles } from './attachments/read';
import { DocumentView } from './documents/DocumentView';
import { GeneratedImage } from './GeneratedImage';
import { Markdown } from './Markdown';
import { REMINDER_TEXT, reminderAfter } from './reminder';
import { CloseIcon, PlusIcon, SendIcon } from './ui/icons';
import { RotatingText } from './ui/RotatingText';

interface ChatProps {
  messages: ConversationMessage[];
  pending: boolean;
  error: string | null;
  remaining: number;
  dailyLimit: number;
  /** In-depth ("Ragiona") answers left today, and the daily allowance. */
  deepRemaining: number;
  deepLimit: number;
  /** Image generation is on, and how many images are left today. */
  imagesEnabled: boolean;
  imageRemaining: number;
  imageLimit: number;
  /** Paid tokens used today and the daily budget; past it only free models answer. */
  tokensUsed: number;
  tokenLimit: number;
  freeMode: boolean;
  freeAvailable: boolean;
  /** Resolves to false when the message was not sent. */
  onSend: (content: string, attachments: Attachments, deep: boolean) => Promise<boolean>;
}

const MAX_MESSAGE_CHARS = 4000;

/** Shown in turn on the empty page. The tool presents itself as a tool. */
const WELCOME = ['Sono uno strumento a tua disposizione', 'Da dove iniziamo?', 'Di cosa hai bisogno?'] as const;

/** Shown in turn while waiting: what the tool is doing, never a person "thinking". */
const LOADING = [
  'Richiesta in corso',
  'Recupero delle informazioni',
  'Verifica dei contenuti',
  'Preparazione della risposta',
] as const;

type AnswerMode = 'normal' | 'deep';

function Loading() {
  return (
    <div className="loading" role="status">
      <RotatingText phrases={LOADING} interval={2200} />
      <span className="loading-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

export function Chat({
  messages,
  pending,
  error,
  remaining,
  dailyLimit,
  deepRemaining,
  deepLimit,
  imagesEnabled,
  imageRemaining,
  imageLimit,
  tokensUsed,
  tokenLimit,
  freeMode,
  freeAvailable,
  onSend,
}: ChatProps) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachments>(EMPTY_ATTACHMENTS);
  const [notes, setNotes] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [mode, setMode] = useState<AnswerMode>('normal');
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, pending]);

  const empty = messages.length === 0 && !pending;
  const limitReached = remaining <= 0;
  // "Ragiona" needs the paid model and an allowance left.
  const deepAvailable = deepRemaining > 0 && !freeMode;
  const deep = mode === 'deep' && deepAvailable;
  const cannotSend = pending || reading || limitReached || !draft.trim();
  const tokenShare = tokenLimit > 0 ? Math.min(100, Math.round((tokensUsed / tokenLimit) * 100)) : 100;

  async function send() {
    const content = draft.trim();
    if (!content || pending || reading || limitReached) return;

    const sent = attachments;
    setDraft('');
    setAttachments(EMPTY_ATTACHMENTS);
    setNotes([]);
    // "Ragiona" applies to one message: it has to be chosen each time.
    setMode('normal');
    // Give the unsent message and its attachments back so they are not lost.
    if (!(await onSend(content, sent, deep))) {
      setDraft(content);
      setAttachments(sent);
    }
    inputRef.current?.focus();
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

  const composer = (
    <form className="composer" onSubmit={handleSubmit}>
      {error && (
        <p role="alert" className="error composer-message">
          {error}
        </p>
      )}
      {limitReached && !error && <p className="composer-message muted">Limite giornaliero raggiunto, torna domani.</p>}
      {freeMode && !limitReached && (
        <p className="notice composer-message" role="status">
          {freeAvailable
            ? 'Hai esaurito i token giornalieri: fino a mezzanotte rispondono modelli gratuiti, meno accurati. «Ragiona» e lettura di allegati non sono disponibili.'
            : 'Hai esaurito i token giornalieri. Torna domani.'}
        </p>
      )}
      {notes.map((note, index) => (
        <p key={index} role="status" className="composer-message muted">
          {note}
        </p>
      ))}

      <div className="composer-box">
        {hasAttachments(attachments) && (
          <ul className="attachments attachments-pending" aria-label="Allegati da inviare">
            {attachments.documents.map((document, index) => (
              <li key={`document-${index}`}>
                <span className="attachment-name" title={document.name}>
                  {document.name}
                </span>
                <button
                  type="button"
                  className="icon-button attachment-remove"
                  aria-label={`Rimuovi ${document.name}`}
                  title="Rimuovi"
                  onClick={() => removeDocument(index)}
                >
                  <CloseIcon size={14} />
                </button>
              </li>
            ))}
            {attachments.images.map((image, index) => (
              <li key={`image-${index}`}>
                <img src={image.dataUrl} alt="" />
                <span className="attachment-name" title={image.name}>
                  {image.name}
                </span>
                <button
                  type="button"
                  className="icon-button attachment-remove"
                  aria-label={`Rimuovi ${image.name}`}
                  title="Rimuovi"
                  onClick={() => removeImage(index)}
                >
                  <CloseIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {reading && (
          <p role="status" className="muted composer-reading">
            Lettura dei file in corso
          </p>
        )}

        <div className="composer-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            hidden
            onChange={(event) => void handleFiles(event)}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Allega immagini o PDF"
            title="Allega immagini o PDF"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending || reading || limitReached}
          >
            <PlusIcon />
          </button>

          <label htmlFor="question" className="visually-hidden">
            Richiesta
          </label>
          <textarea
            ref={inputRef}
            id="question"
            className="composer-input"
            rows={1}
            placeholder="Scrivi la tua richiesta"
            maxLength={MAX_MESSAGE_CHARS}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={limitReached}
            autoFocus
          />

          <label htmlFor="answer-mode" className="visually-hidden">
            Tipo di risposta
          </label>
          <span className="composer-mode-wrap">
            <select
              id="answer-mode"
              className="composer-mode"
              value={deep ? 'deep' : 'normal'}
              onChange={(event) => setMode(event.target.value as AnswerMode)}
              disabled={limitReached}
            >
              <option value="normal">Normale</option>
              <option value="deep" disabled={!deepAvailable}>
                Ragiona {deepRemaining}/{deepLimit}
              </option>
            </select>
          </span>

          {/* On a keyboard Enter sends; the button is shown on touch screens and narrow windows. */}
          <button type="submit" className="send-button" aria-label="Invia" title="Invia" disabled={cannotSend}>
            <SendIcon />
          </button>
        </div>
      </div>

      <p className="composer-footnote muted">
        Messaggi oggi: {remaining}/{dailyLimit}
        {imagesEnabled && imageLimit > 0 && ` · Immagini: ${imageRemaining}/${imageLimit}`}
        {` · Token usati: ${tokenShare}%`}
        <span className="composer-disclaimer"> · Strumento di intelligenza artificiale: può commettere errori.</span>
      </p>
    </form>
  );

  if (empty) {
    return (
      <main className="chat-start">
        <h2 className="welcome">
          <RotatingText phrases={WELCOME} interval={3500} />
        </h2>
        {composer}
      </main>
    );
  }

  return (
    <>
      <main className="chat-messages" aria-live="polite">
        <div className="chat-thread">
          {messages.map((message, index) => (
            <Fragment key={index}>
              <article className={`message message-${message.role}`}>
                <h2 className="visually-hidden">{message.role === 'user' ? 'La tua richiesta' : 'Risposta'}</h2>
                {message.document ? (
                  <DocumentView document={message.document} />
                ) : message.image ? (
                  <GeneratedImage id={message.image.id} request={messages[index - 1]?.content ?? ''} />
                ) : message.role === 'assistant' ? (
                  <Markdown text={message.content} sources={message.sources} />
                ) : (
                  <p>{message.content}</p>
                )}
                {message.role === 'assistant' && message.freeModel && (
                  <p className="free-model-note">Risposta da un modello gratuito, meno accurato.</p>
                )}
                {message.attachments && hasAttachments(message.attachments) && (
                  <ul className="attachments" aria-label="Allegati">
                    {message.attachments.documents.map((name, item) => (
                      <li key={`document-${item}`}>
                        <span className="attachment-name" title={name}>
                          Documento: {name}
                        </span>
                      </li>
                    ))}
                    {message.attachments.images.map((name, item) => {
                      const url = message.attachments?.imageUrls?.[item];
                      return url ? (
                        <li key={`image-${item}`} className="attachment-thumb">
                          <a href={url} target="_blank" rel="noopener noreferrer" title={name}>
                            <img src={url} alt={`Immagine allegata: ${name}`} loading="lazy" />
                          </a>
                        </li>
                      ) : (
                        <li key={`image-${item}`}>
                          <span className="attachment-name" title={name}>
                            Immagine: {name}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </article>
              {reminderAfter(messages, index) && (
                <aside className="reminder" role="note">
                  {REMINDER_TEXT}
                </aside>
              )}
            </Fragment>
          ))}
          {pending && <Loading />}
          <div ref={endRef} />
        </div>
      </main>
      <div className="chat-bottom">{composer}</div>
    </>
  );
}
