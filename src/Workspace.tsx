import { useCallback, useEffect, useState } from 'react';
import { hasAttachments, type Attachments } from '../shared/attachments';
import {
  ApiError,
  deleteAccount,
  deleteAllConversations,
  deleteConversation,
  fetchConversation,
  fetchConversations,
  renameConversation,
  sendMessage,
  undoContextUpdate,
  verifyMessage,
  type Account,
  type ConversationMessage,
  type ConversationSummary,
} from './api';
import { Chat } from './Chat';
import { markOffered, useInstallMode, wasOffered } from './install';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';
import { ConfirmDialog, RenameDialog } from './ui/ConversationDialogs';
import { NewChatIcon, SidebarIcon } from './ui/icons';
import { InstallDialog } from './ui/InstallDialog';
import { SearchDialog } from './ui/SearchDialog';
import { Sidebar, type View } from './ui/Sidebar';
import { Users } from './Users';

interface WorkspaceProps {
  account: Account;
  onSignOut: () => void;
  /** The session is gone (expired, account deleted or no longer approved). */
  onSignedOut: () => void;
}

const ERROR_TEXT: Record<string, string> = {
  daily_limit_reached: 'Limite giornaliero raggiunto, torna domani.',
  image_limit_reached: 'Limite giornaliero di immagini raggiunto, torna domani.',
  tokens_exhausted: 'Hai esaurito i token giornalieri. Torna domani.',
  free_quota_exhausted:
    'Hai esaurito i token giornalieri e anche i modelli gratuiti hanno raggiunto il loro limite. Torna domani.',
  quota_exhausted: 'Tutti i modelli hanno raggiunto il loro limite. Riprova più tardi.',
  invalid_request: 'Richiesta non valida.',
  not_found: 'Conversazione non trovata.',
  service_unavailable: 'Servizio non disponibile. Riprova più tardi.',
  conversation_limit_reached: 'Questa chat ha raggiunto il limite di richieste. Apri una nuova chat per continuare.',
  sources_unavailable: 'Verifica delle fonti non disponibile in questo momento. Riprova più tardi.',
  attachments_unavailable:
    'In questo momento gli allegati non possono essere letti. Riprova più tardi oppure invia la domanda senza allegati.',
};

/** Below this width the sidebar is an overlay instead of a column. */
const NARROW = '(max-width: 48rem)';
const COLLAPSED_KEY = 'aitool.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function Workspace({ account, onSignOut, onSignedOut }: WorkspaceProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [remaining, setRemaining] = useState(account.remaining);
  const [deepRemaining, setDeepRemaining] = useState(account.deepRemaining);
  const [imageRemaining, setImageRemaining] = useState(account.imageRemaining);
  const [tokensUsed, setTokensUsed] = useState(account.tokensUsed);
  const [freeMode, setFreeMode] = useState(account.freeMode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('chat');
  /** Wide screens: the user can collapse the sidebar (remembered on this device). */
  const [collapsed, setCollapsed] = useState(readCollapsed);
  /** Narrow screens: the sidebar is an overlay, closed by default. */
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const installMode = useInstallMode();
  const [installOpen, setInstallOpen] = useState(false);

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

  // Ctrl+K / Cmd+K opens the search, as in common chat apps.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isNarrow = () => window.matchMedia(NARROW).matches;
  const sidebarVisible = isNarrow() ? overlayOpen : !collapsed;

  function setCollapsedRemembered(value: boolean) {
    setCollapsed(value);
    try {
      localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
    } catch {
      // Not remembered: the choice still applies until the page is reloaded.
    }
  }

  function showSidebar() {
    if (isNarrow()) setOverlayOpen(true);
    else setCollapsedRemembered(false);
  }

  function hideSidebar() {
    if (isNarrow()) setOverlayOpen(false);
    else setCollapsedRemembered(true);
  }

  /** After choosing something in the overlay, get it out of the way. */
  const closeOverlay = () => setOverlayOpen(false);

  function startNewChat() {
    setActiveId(null);
    setMessages([]);
    setError(null);
    setView('chat');
    closeOverlay();
  }

  async function openConversation(id: string) {
    setError(null);
    setView('chat');
    closeOverlay();
    try {
      const conversation = await fetchConversation(id);
      setActiveId(conversation.id);
      setMessages(conversation.messages);
    } catch (cause) {
      handleFailure(cause);
    }
  }

  function navigate(next: View) {
    setView(next);
    closeOverlay();
  }

  /** Returns false when the message was not sent, so the form can give it back. */
  async function send(content: string, attachments: Attachments, deep: boolean, verifySources: boolean): Promise<boolean> {
    const previous = messages;
    const question: ConversationMessage = {
      role: 'user',
      content,
      attachments: hasAttachments(attachments)
        ? {
            documents: attachments.documents.map((document) => document.name),
            images: attachments.images.map((image) => image.name),
            imageUrls: attachments.images.map((image) => image.dataUrl),
          }
        : undefined,
    };
    setMessages([...previous, question]);
    setError(null);
    setPending(true);

    try {
      const result = await sendMessage(activeId, content, attachments, deep, verifySources);
      setMessages([
        ...previous,
        question,
        {
          id: result.messageId ?? undefined,
          role: 'assistant',
          content: result.answer,
          document: result.document,
          image: result.image,
          freeModel: result.answeredByFreeModel,
          sources: result.sources,
          contextUpdate: result.contextUpdate,
          media: result.media,
          illustrations: result.illustrations,
        },
      ]);
      setRemaining(result.remaining);
      if (result.deepRemaining !== undefined) setDeepRemaining(result.deepRemaining);
      if (result.imageRemaining !== undefined) setImageRemaining(result.imageRemaining);
      if (result.tokensUsed !== undefined) setTokensUsed(result.tokensUsed);
      // The next request already runs on free models once the budget is passed.
      if (result.tokensUsed !== undefined && result.tokensUsed >= account.tokenLimit) setFreeMode(true);

      offerInstallOnce();

      const saved = result.conversation;
      if (saved) {
        setActiveId(saved.id);
        setConversations((list) => [saved, ...list.filter((item) => item.id !== saved.id)]);
      }
      return true;
    } catch (cause) {
      setMessages(previous);
      const code = handleFailure(cause);
      if (code === 'daily_limit_reached') setRemaining(0);
      if (code === 'image_limit_reached') setImageRemaining(0);
      if (code === 'tokens_exhausted' || code === 'free_quota_exhausted') setFreeMode(true);
      return false;
    } finally {
      setPending(false);
    }
  }

  /** Checks the sources of an answer afterwards; false when it could not be done. */
  async function verifySources(id: number): Promise<boolean> {
    try {
      const checked = await verifyMessage(id);
      setMessages((list) =>
        list.map((message) => (message.id === id ? { ...message, content: checked.content, sources: checked.sources } : message)),
      );
      return true;
    } catch (cause) {
      handleFailure(cause);
      return false;
    }
  }

  /**
   * After the first answer, propose installation once per device. A short delay
   * lets the answer appear first; nothing opens over another dialog.
   */
  function offerInstallOnce() {
    if (installMode === null || wasOffered()) return;
    markOffered();
    window.setTimeout(() => {
      if (!document.querySelector('dialog[open]')) setInstallOpen(true);
    }, 2500);
  }

  /** "Annulla" under an answer: 'changed' when the context was modified again since. */
  async function undoContext(messageId: number): Promise<'done' | 'changed' | 'failed'> {
    try {
      const update = await undoContextUpdate(messageId);
      setMessages((list) => list.map((message) => (message.id === messageId ? { ...message, contextUpdate: update } : message)));
      return 'done';
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'context_changed') return 'changed';
      handleFailure(cause);
      return 'failed';
    }
  }

  async function rename(conversation: ConversationSummary, title: string) {
    try {
      const saved = await renameConversation(conversation.id, title);
      setConversations((list) => list.map((item) => (item.id === conversation.id ? { ...item, title: saved } : item)));
    } catch (cause) {
      handleFailure(cause);
    }
  }

  async function remove(conversation: ConversationSummary) {
    try {
      await deleteConversation(conversation.id);
      setConversations((list) => list.filter((item) => item.id !== conversation.id));
      if (conversation.id === activeId) startNewChat();
    } catch (cause) {
      handleFailure(cause);
    }
  }

  async function removeAllConversations() {
    try {
      await deleteAllConversations();
      setConversations([]);
      setActiveId(null);
      setMessages([]);
    } catch (cause) {
      handleFailure(cause);
    }
  }

  async function removeAccount() {
    try {
      await deleteAccount();
      onSignedOut();
    } catch (cause) {
      handleFailure(cause);
    }
  }

  return (
    <div className={`workspace${collapsed ? ' sidebar-collapsed' : ''}${overlayOpen ? ' sidebar-overlay-open' : ''}`}>
      <Sidebar
        account={account}
        conversations={conversations}
        activeId={activeId}
        view={view}
        onNewChat={startNewChat}
        onOpenConversation={(id) => void openConversation(id)}
        onRename={setRenaming}
        onDelete={setDeleting}
        onSearch={() => setSearchOpen(true)}
        onNavigate={navigate}
        onSignOut={onSignOut}
        onInstall={installMode ? () => setInstallOpen(true) : undefined}
        onHide={hideSidebar}
      />
      {overlayOpen && <div className="sidebar-scrim" aria-hidden="true" onClick={closeOverlay} />}

      <div className="content">
        {!sidebarVisible && (
          <div className="content-tools">
            <button type="button" className="icon-button" aria-label="Apri la barra laterale" title="Apri la barra laterale" onClick={showSidebar}>
              <SidebarIcon />
            </button>
            <button type="button" className="icon-button" aria-label="Nuova chat" title="Nuova chat" onClick={startNewChat}>
              <NewChatIcon />
            </button>
          </div>
        )}
        <h1 className="visually-hidden">Kern</h1>

        {view === 'users' && account.isAdmin ? (
          <Users onFailure={handleFailure} />
        ) : view === 'profile' ? (
          <Profile account={account} onFailure={handleFailure} />
        ) : view === 'settings' ? (
          <Settings
            hasConversations={conversations.length > 0}
            onDeleteAllConversations={() => void removeAllConversations()}
            onDeleteAccount={() => void removeAccount()}
          />
        ) : (
          <Chat
            messages={messages}
            pending={pending}
            error={error}
            remaining={remaining}
            dailyLimit={account.dailyLimit}
            deepRemaining={deepRemaining}
            deepLimit={account.deepLimit}
            imagesEnabled={account.imagesEnabled}
            imageRemaining={imageRemaining}
            imageLimit={account.imageLimit}
            tokensUsed={tokensUsed}
            tokenLimit={account.tokenLimit}
            freeMode={freeMode}
            freeAvailable={account.freeAvailable}
            dictation={account.profile === 'professional'}
            onSend={send}
            onVerifySources={verifySources}
            onNewChat={startNewChat}
            onUndoContext={undoContext}
          />
        )}
      </div>

      <InstallDialog open={installOpen} mode={installMode} onClose={() => setInstallOpen(false)} />
      <SearchDialog open={searchOpen} onOpenConversation={(id) => void openConversation(id)} onClose={() => setSearchOpen(false)} />
      <RenameDialog conversation={renaming} onRename={(conversation, title) => void rename(conversation, title)} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title="Eliminare la chat?"
        message={deleting ? `«${deleting.title}» verrà eliminata, con le eventuali immagini. L'operazione non si può annullare.` : ''}
        confirmLabel="Elimina"
        onConfirm={() => deleting && void remove(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
