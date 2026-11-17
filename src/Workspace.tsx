import { useCallback, useEffect, useState } from 'react';
import { hasAttachments, type Attachments } from '../shared/attachments';
import {
  ApiError,
  deleteAccount,
  deleteAllConversations,
  deleteConversation,
  fetchConversation,
  fetchConversations,
  sendMessage,
  type Account,
  type ConversationMessage,
  type ConversationSummary,
} from './api';
import { Chat } from './Chat';
import { Users } from './Users';

interface WorkspaceProps {
  account: Account;
  onSignOut: () => void;
  /** The session is gone (expired, account deleted or no longer approved). */
  onSignedOut: () => void;
}

const ERROR_TEXT: Record<string, string> = {
  daily_limit_reached: 'Limite giornaliero raggiunto, torna domani.',
  invalid_request: 'Richiesta non valida.',
  not_found: 'Conversazione non trovata.',
  service_unavailable: 'Servizio non disponibile. Riprova più tardi.',
};

export function Workspace({ account, onSignOut, onSignedOut }: WorkspaceProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [remaining, setRemaining] = useState(account.remaining);
  const [deepRemaining, setDeepRemaining] = useState(account.deepRemaining);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'chat' | 'users'>('chat');
  const [panelOpen, setPanelOpen] = useState(false);

  /** Shows the error, or leaves the workspace when the session is no longer valid. */
  const handleFailure = useCallback(
    (cause: unknown) => {
      const code = cause instanceof ApiError ? cause.code : 'service_unavailable';
      if (code === 'not_signed_in' || code === 'not_approved') {
        onSignedOut();
        return code;
      }
      setError(ERROR_TEXT[code] ?? ERROR_TEXT.service_unavailable);
      return code;
    },
    [onSignedOut],
  );

  useEffect(() => {
    let cancelled = false;
    fetchConversations()
      .then((list) => {
        if (!cancelled) setConversations(list);
      })
      .catch((cause: unknown) => {
        if (!cancelled) handleFailure(cause);
      });
    return () => {
      cancelled = true;
    };
  }, [handleFailure]);

  function startNewChat() {
    setActiveId(null);
    setMessages([]);
    setError(null);
    setView('chat');
    setPanelOpen(false);
  }

  async function openConversation(id: string) {
    setError(null);
    setView('chat');
    setPanelOpen(false);
    try {
      const conversation = await fetchConversation(id);
      setActiveId(conversation.id);
      setMessages(conversation.messages);
    } catch (cause) {
      handleFailure(cause);
    }
  }

  /** Returns false when the message was not sent, so the form can give it back. */
  async function send(content: string, attachments: Attachments, deep: boolean): Promise<boolean> {
    const previous = messages;
    const question: ConversationMessage = {
      role: 'user',
      content,
      attachments: hasAttachments(attachments)
        ? {
            documents: attachments.documents.map((document) => document.name),
            images: attachments.images.map((image) => image.name),
          }
        : undefined,
    };
    setMessages([...previous, question]);
    setError(null);
    setPending(true);

    try {
      const result = await sendMessage(activeId, content, attachments, deep);
      setMessages([...previous, question, { role: 'assistant', content: result.answer, document: result.document }]);
      setRemaining(result.remaining);
      if (result.deepRemaining !== undefined) setDeepRemaining(result.deepRemaining);

      const saved = result.conversation;
      if (saved) {
        setActiveId(saved.id);
        setConversations((list) => [saved, ...list.filter((item) => item.id !== saved.id)]);
      }
      return true;
    } catch (cause) {
      setMessages(previous);
      if (handleFailure(cause) === 'daily_limit_reached') setRemaining(0);
      return false;
    } finally {
      setPending(false);
    }
  }

  async function removeConversation(conversation: ConversationSummary) {
    if (!window.confirm(`Eliminare la conversazione "${conversation.title}"? L'operazione non si può annullare.`)) return;
    try {
      await deleteConversation(conversation.id);
      setConversations((list) => list.filter((item) => item.id !== conversation.id));
      if (conversation.id === activeId) startNewChat();
    } catch (cause) {
      handleFailure(cause);
    }
  }

  async function removeAllConversations() {
    if (!window.confirm("Eliminare tutta la cronologia? L'operazione non si può annullare.")) return;
    try {
      await deleteAllConversations();
      setConversations([]);
      startNewChat();
    } catch (cause) {
      handleFailure(cause);
    }
  }

  async function removeAccount() {
    if (!window.confirm("Eliminare l'account e tutte le conversazioni? L'operazione non si può annullare.")) return;
    try {
      await deleteAccount();
      onSignedOut();
    } catch (cause) {
      handleFailure(cause);
    }
  }

  return (
    <div className="workspace">
      <aside className={`panel${panelOpen ? ' panel-open' : ''}`} aria-label="Cronologia e account">
        <div className="panel-top">
          <button type="button" className="button-primary" onClick={startNewChat}>
            Nuova chat
          </button>
          <button type="button" className="panel-close" onClick={() => setPanelOpen(false)}>
            Chiudi
          </button>
        </div>

        <nav className="history" aria-label="Cronologia">
          {conversations.length === 0 && <p className="muted">Nessuna conversazione salvata.</p>}
          <ul>
            {conversations.map((conversation) => (
              <li key={conversation.id} className={conversation.id === activeId ? 'history-active' : undefined}>
                <button
                  type="button"
                  className="history-open"
                  aria-current={conversation.id === activeId ? 'true' : undefined}
                  onClick={() => void openConversation(conversation.id)}
                >
                  {conversation.title}
                </button>
                <button
                  type="button"
                  className="history-delete"
                  aria-label={`Elimina la conversazione "${conversation.title}"`}
                  onClick={() => void removeConversation(conversation)}
                >
                  Elimina
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="panel-bottom">
          {conversations.length > 0 && (
            <button type="button" onClick={() => void removeAllConversations()}>
              Elimina tutta la cronologia
            </button>
          )}
          {account.isAdmin && (
            <button
              type="button"
              onClick={() => {
                setView('users');
                setPanelOpen(false);
              }}
            >
              Utenti
            </button>
          )}
          <p className="muted account-email">{account.email}</p>
          <div className="panel-row">
            <button type="button" onClick={onSignOut}>
              Esci
            </button>
            <button type="button" onClick={() => void removeAccount()}>
              Elimina account
            </button>
          </div>
        </div>
      </aside>

      <div className="content">
        <header className="content-header">
          <button type="button" className="panel-toggle" onClick={() => setPanelOpen(true)}>
            Cronologia
          </button>
          <div>
            <h1>ConoscenzIA</h1>
            <p className="muted">Strumento informativo. Non è una persona.</p>
          </div>
        </header>

        {view === 'users' ? (
          <Users onBack={() => setView('chat')} onFailure={handleFailure} />
        ) : (
          <Chat
            messages={messages}
            pending={pending}
            error={error}
            remaining={remaining}
            dailyLimit={account.dailyLimit}
            deepRemaining={deepRemaining}
            onSend={send}
          />
        )}
      </div>
    </div>
  );
}
