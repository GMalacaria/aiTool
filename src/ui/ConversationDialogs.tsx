import { useState, type FormEvent } from 'react';
import type { ConversationSummary } from '../api';
import { Modal } from './Modal';

export const MAX_TITLE_CHARS = 80;

interface RenameDialogProps {
  conversation: ConversationSummary | null;
  onRename: (conversation: ConversationSummary, title: string) => void;
  onClose: () => void;
}

export function RenameDialog({ conversation, onRename, onClose }: RenameDialogProps) {
  return (
    <Modal open={conversation !== null} title="Rinomina la chat" onClose={onClose}>
      {/* Keyed by conversation so the field starts from its current title each time. */}
      {conversation && <RenameForm key={conversation.id} conversation={conversation} onRename={onRename} onClose={onClose} />}
    </Modal>
  );
}

function RenameForm({
  conversation,
  onRename,
  onClose,
}: {
  conversation: ConversationSummary;
  onRename: RenameDialogProps['onRename'];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(conversation.title);
  const trimmed = title.replace(/\s+/g, ' ').trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed) return;
    if (trimmed !== conversation.title) onRename(conversation, trimmed);
    onClose();
  }

  return (
    <form className="modal-body" onSubmit={submit}>
      <label htmlFor="rename-title" className="visually-hidden">
        Nuovo titolo
      </label>
      <input
        id="rename-title"
        type="text"
        value={title}
        maxLength={MAX_TITLE_CHARS}
        autoFocus
        data-autofocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Annulla
        </button>
        <button type="submit" className="button-primary" disabled={!trimmed}>
          Salva
        </button>
      </div>
    </form>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

/** A destructive confirmation: the safe choice has the focus. */
export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="modal-body">
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" autoFocus data-autofocus onClick={onClose}>
            Annulla
          </button>
          <button
            type="button"
            className="button-danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
