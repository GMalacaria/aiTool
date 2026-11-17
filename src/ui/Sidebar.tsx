import { useId, useRef } from 'react';
import type { Account, ConversationSummary } from '../api';
import { ChevronIcon, NewChatIcon, PencilIcon, SearchIcon, SidebarIcon, TrashIcon } from './icons';

export type View = 'chat' | 'profile' | 'settings' | 'users';

interface SidebarProps {
  account: Account;
  conversations: ConversationSummary[];
  activeId: string | null;
  view: View;
  onNewChat: () => void;
  onOpenConversation: (id: string) => void;
  onRename: (conversation: ConversationSummary) => void;
  onDelete: (conversation: ConversationSummary) => void;
  onSearch: () => void;
  onNavigate: (view: View) => void;
  onSignOut: () => void;
  /** Hides the sidebar (collapses it on wide screens, closes the overlay on phones). */
  onHide: () => void;
}

export const PROFILE_LABEL = { professional: 'Professionale', student: 'Studente' } as const;

export function Sidebar({
  account,
  conversations,
  activeId,
  view,
  onNewChat,
  onOpenConversation,
  onRename,
  onDelete,
  onSearch,
  onNavigate,
  onSignOut,
  onHide,
}: SidebarProps) {
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);

  /** Closes the menu first, so focus does not stay in a hidden popover. */
  const fromMenu = (action: () => void) => () => {
    menuRef.current?.hidePopover();
    action();
  };

  return (
    <aside className="sidebar" aria-label="Chat e account">
      <div className="sidebar-top">
        <span className="brand">Kern</span>
        <button type="button" className="icon-button" aria-label="Cerca nelle chat" title="Cerca (Ctrl+K)" onClick={onSearch}>
          <SearchIcon />
        </button>
        <button type="button" className="icon-button" aria-label="Chiudi la barra laterale" title="Chiudi la barra laterale" onClick={onHide}>
          <SidebarIcon />
        </button>
      </div>

      <button type="button" className="new-chat" onClick={onNewChat}>
        <NewChatIcon size={18} />
        Nuova chat
      </button>

      <nav className="chat-list" aria-label="Chat salvate">
        {conversations.length === 0 && <p className="muted chat-list-empty">Nessuna chat salvata.</p>}
        <ul>
          {conversations.map((conversation) => {
            const active = view === 'chat' && conversation.id === activeId;
            return (
              <li key={conversation.id} className={active ? 'chat-item chat-item-active' : 'chat-item'}>
                <button
                  type="button"
                  className="chat-link"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onOpenConversation(conversation.id)}
                >
                  <span className="chat-title">{conversation.title}</span>
                </button>
                <span className="chat-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Rinomina «${conversation.title}»`}
                    title="Rinomina"
                    onClick={() => onRename(conversation)}
                  >
                    <PencilIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Elimina «${conversation.title}»`}
                    title="Elimina"
                    onClick={() => onDelete(conversation)}
                  >
                    <TrashIcon size={16} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="user-button" popoverTarget={menuId}>
          <span className="user-text">
            <span className="user-name">{account.name}</span>
            <span className="user-profile">Profilo {PROFILE_LABEL[account.profile]}</span>
          </span>
          <ChevronIcon size={16} />
        </button>
        <div id={menuId} ref={menuRef} popover="auto" className="user-menu" aria-label="Account">
          <button type="button" onClick={fromMenu(() => onNavigate('profile'))}>
            Profilo
          </button>
          <button type="button" onClick={fromMenu(() => onNavigate('settings'))}>
            Impostazioni
          </button>
          {account.isAdmin && (
            <button type="button" onClick={fromMenu(() => onNavigate('users'))}>
              Utenti
            </button>
          )}
          <hr />
          <button type="button" onClick={fromMenu(onSignOut)}>
            Esci
          </button>
        </div>
      </div>
    </aside>
  );
}
