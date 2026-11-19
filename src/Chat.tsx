import { Fragment, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { EMPTY_ATTACHMENTS, hasAttachments, type Attachments } from '../shared/attachments';
import { transcribeAudio, type ConversationMessage } from './api';
import { MAX_QUESTIONS_PER_CONVERSATION, QUESTIONS_LEFT_WARNING } from '../shared/conversation';
import { addFiles } from './attachments/read';
import { DocumentView } from './documents/DocumentView';
import { GeneratedImage } from './GeneratedImage';
import { Illustrations } from './Illustrations';
import { ContextNote } from './ContextNote';
import { MediaView } from './MediaView';
import { Markdown } from './Markdown';
import { REMINDER_TEXT, reminderAfter } from './reminder';
import { CloseIcon, MicIcon, PlusIcon, ReasonIcon, SendIcon, StopIcon, VerifiedIcon } from './ui/icons';
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
  /** Dictation (microphone) is offered: professional profile only. */
  dictation: boolean;
  /** Resolves to false when the message was not sent. */
  onSend: (content: string, attachments: Attachments, deep: boolean, verifySources: boolean) => Promise<boolean>;
  /** Checks the sources of an answer given without them; false when it could not be done. */
  onVerifySources: (messageId: number) => Promise<boolean>;
  /** Opens a new, empty chat (used when this one is full). */
  onNewChat: () => void;
  /** Takes back the context change made with an answer. */
  onUndoContext: (messageId: number) => Promise<'done' | 'changed' | 'failed'>;
}

const MAX_MESSAGE_CHARS = 4000;

/** A dictation stops by itself after two minutes. */
const DICTATION_MAX_MS = 120_000;

/** Shown in turn on the empty page. The tool presents itself as a tool. */
const WELCOME = ['Sono uno strumento a tua disposizione', 'Da dove iniziamo?', 'Di cosa hai bisogno?'] as const;

/** Shown in turn while waiting: what the tool is doing, never a person "thinking". */
const LOADING = [
  'Richiesta in corso',
  'Recupero delle informazioni',
  'Verifica dei contenuti',
  'Preparazione della risposta',
] as const;

/** With "Fonti" on, the wait also says that sources are being checked (the dots follow the text). */
const LOADING_WITH_SOURCES = [
  'Richiesta in corso',
  'Recupero delle informazioni',
  'Verifica delle fonti in corso',
  'Verifica dei contenuti',
  'Preparazione della risposta',
] as const;

type AnswerMode = 'normal' | 'deep';

/** The "Fonti" choice is remembered on this device. */
const VERIFY_KEY = 'verify-sources';

function readVerifyChoice(): boolean {
  try {
    return localStorage.getItem(VERIFY_KEY) === '1';
  } catch {
    return false;
  }
}

function Loading({ withSources }: { withSources: boolean }) {
  return (
    <div className="loading" role="status">
      <RotatingText phrases={withSources ? LOADING_WITH_SOURCES : LOADING} interval={2200} />
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
  dictation,
  onSend,
  onVerifySources,
  onNewChat,
  onUndoContext,
}: ChatProps) {
  const [verifySources, setVerifySources] = useState(readVerifyChoice);
  const toggleVerify = () => {
    const next = !verifySources;
    setVerifySources(next);
    try {
      localStorage.setItem(VERIFY_KEY, next ? '1' : '0');
    } catch {
      // Not remembered on this device: the choice still applies now.
    }
  };
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachments>(EMPTY_ATTACHMENTS);
  const [notes, setNotes] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [mode, setMode] = useState<AnswerMode>('normal');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, pending]);

  const empty = messages.length === 0 && !pending;
  const questionsLeft = MAX_QUESTIONS_PER_CONVERSATION - messages.filter((message) => message.role === 'user').length;
  const conversationFull = questionsLeft <= 0;
  // No more requests today, or none left in this chat: the composer is closed.
  const limitReached = remaining <= 0 || conversationFull;
  // "Ragiona" needs the paid model and an allowance left.
  const deepAvailable = deepRemaining > 0 && !freeMode;
  const deep = mode === 'deep' && deepAvailable;
  const cannotSend = pending || reading || recording || transcribing || limitReached || !draft.trim();
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
    if (!(await onSend(content, sent, deep, verifySources))) {
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

  // Dictation: the recognised text is appended to the field and never sent by itself.
  async function toggleDictation() {
    if (recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setNotes(['Il dettato non è supportato da questo browser.']);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNotes(['Accesso al microfono negato: consentilo nelle impostazioni del browser.']);
      return;
    }

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    // A dictation is short; the server also refuses anything above 5 MB.
    const limit = window.setTimeout(() => recorder.state === 'recording' && recorder.stop(), DICTATION_MAX_MS);
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    recorder.onstop = () => {
      window.clearTimeout(limit);
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setRecording(false);
      if (!chunks.length) return;

      setTranscribing(true);
      transcribeAudio(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
        .then((text) => {
          if (!text) {
            setNotes(['Nessun parlato riconosciuto.']);
            return;
          }
          setNotes([]);
          setDraft((current) => `${current}${current && !/\s$/.test(current) ? ' ' : ''}${text}`.slice(0, MAX_MESSAGE_CHARS));
          inputRef.current?.focus();
        })
        .catch(() => setNotes(['Trascrizione non riuscita, riprova.']))
        .finally(() => setTranscribing(false));
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  }

  // Leaving the page releases the microphone.
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder?.state === 'recording') {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stream.getTracks().forEach((track) => track.stop());
        recorder.stop();
      }
    },
    [],
  );

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
      {conversationFull && (
        <p className="notice composer-message" role="status">
          Questa chat ha raggiunto il limite di {MAX_QUESTIONS_PER_CONVERSATION} richieste. Per continuare apri una nuova
          chat.{' '}
          <button type="button" className="link-button" onClick={onNewChat}>
            Nuova chat
          </button>
        </p>
      )}
      {!conversationFull && questionsLeft <= QUESTIONS_LEFT_WARNING && !pending && (
        <p className="composer-message muted" role="status">
          {questionsLeft === 1
            ? 'Ultima richiesta in questa chat.'
            : `Ancora ${questionsLeft} richieste in questa chat.`}
        </p>
      )}
      {remaining <= 0 && !conversationFull && !error && (
        <p className="composer-message muted">Limite giornaliero raggiunto, torna domani.</p>
      )}
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
        {(recording || transcribing) && (
          <p role="status" className="muted composer-reading">
            {recording ? 'Registrazione in corso: premi di nuovo il microfono per terminare' : 'Trascrizione in corso'}
          </p>
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

          {dictation && (
            <button
              type="button"
              className="icon-button composer-mic"
              data-recording={recording || undefined}
              aria-label={recording ? 'Termina il dettato' : 'Detta il testo'}
              title={recording ? 'Termina il dettato' : 'Detta il testo'}
              onClick={() => void toggleDictation()}
              disabled={pending || reading || transcribing || limitReached}
            >
              {recording ? <StopIcon /> : <MicIcon />}
            </button>
          )}

          <button
            type="button"
            className="composer-toggle"
            aria-pressed={verifySources}
            aria-describedby="verify-hint"
            onClick={toggleVerify}
            title="Verifica delle fonti"
            disabled={limitReached}
          >
            <VerifiedIcon size={16} />
            <span className="composer-label">Fonti</span>
          </button>

          <label htmlFor="answer-mode" className="visually-hidden">
            Tipo di risposta
          </label>
          <span className="composer-mode-wrap" data-deep={deep || undefined}>
            <span className="composer-mode-icon">
              <ReasonIcon size={18} />
            </span>
            <select
              id="answer-mode"
              className="composer-mode"
              title="Tipo di risposta"
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

      <p id="verify-hint" className={verifySources ? 'composer-footnote composer-verify-note' : 'visually-hidden'}>
        {verifySources
          ? 'Verifica delle fonti attiva: le risposte sui fatti sono più lente (circa 10–20 secondi).'
          : 'Verifica delle fonti sul web: risposte più lente.'}
      </p>
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
                  <Markdown
                    text={message.content}
                    sources={message.sources}
                    onVerify={message.id !== undefined ? () => onVerifySources(message.id as number) : undefined}
                  />
                ) : (
                  <p>{message.content}</p>
                )}
                {message.role === 'assistant' && message.contextUpdate && (
                  <ContextNote
                    update={message.contextUpdate}
                    onUndo={message.id !== undefined ? () => onUndoContext(message.id as number) : undefined}
                  />
                )}
                {message.role === 'assistant' && message.illustrations && <Illustrations items={message.illustrations} />}
                {message.role === 'assistant' && message.media && <MediaView media={message.media} />}
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
          {pending && <Loading withSources={verifySources} />}
          <div ref={endRef} />
        </div>
      </main>
      <div className="chat-bottom">{composer}</div>
    </>
  );
}
