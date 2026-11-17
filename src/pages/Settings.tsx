import { useState } from 'react';
import { ConfirmDialog } from '../ui/ConversationDialogs';

interface SettingsProps {
  hasConversations: boolean;
  onDeleteAllConversations: () => void;
  onDeleteAccount: () => void;
}

export function Settings({ hasConversations, onDeleteAllConversations, onDeleteAccount }: SettingsProps) {
  const [confirm, setConfirm] = useState<'history' | 'account' | null>(null);

  return (
    <main className="page-view">
      <h2>Impostazioni</h2>

      <section className="settings-section" aria-labelledby="settings-data">
        <h3 id="settings-data">Dati</h3>
        <div className="settings-row">
          <div>
            <p>Elimina tutta la cronologia</p>
            <p className="muted">Cancella tutte le chat salvate, comprese le immagini generate.</p>
          </div>
          <button type="button" onClick={() => setConfirm('history')} disabled={!hasConversations}>
            Elimina cronologia
          </button>
        </div>
        <div className="settings-row">
          <div>
            <p>Elimina account</p>
            <p className="muted">Cancella l'account, tutte le chat, le immagini e i dati di utilizzo.</p>
          </div>
          <button type="button" className="button-danger" onClick={() => setConfirm('account')}>
            Elimina account
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirm === 'history'}
        title="Eliminare tutta la cronologia?"
        message="Tutte le chat salvate e le immagini generate verranno cancellate. L'operazione non si può annullare."
        confirmLabel="Elimina cronologia"
        onConfirm={onDeleteAllConversations}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'account'}
        title="Eliminare l'account?"
        message="L'account, tutte le chat, le immagini e i dati di utilizzo verranno cancellati. L'operazione non si può annullare."
        confirmLabel="Elimina account"
        onConfirm={onDeleteAccount}
        onClose={() => setConfirm(null)}
      />
    </main>
  );
}
