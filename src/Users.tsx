import { useCallback, useEffect, useState } from 'react';
import { fetchUsers, updateUser, type ManagedUser, type UserStatus } from './api';

interface UsersProps {
  onBack: () => void;
  onFailure: (cause: unknown) => void;
}

const STATUS_LABEL: Record<UserStatus, string> = {
  pending: 'In attesa',
  approved: 'Approvato',
  blocked: 'Bloccato',
};

export function Users({ onBack, onFailure }: UsersProps) {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);

  const reload = useCallback(() => fetchUsers().then(setUsers).catch(onFailure), [onFailure]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function change(
    user: ManagedUser,
    changes: { status?: UserStatus; dailyLimit?: number; deepLimit?: number },
  ) {
    try {
      await updateUser(user.id, changes);
      await reload();
    } catch (cause) {
      onFailure(cause);
    }
  }

  function changeLimit(user: ManagedUser, field: 'dailyLimit' | 'deepLimit', value: string) {
    const limit = Number(value);
    if (value.trim() && Number.isInteger(limit) && limit >= 0 && limit !== user[field]) {
      void change(user, { [field]: limit });
    }
  }

  return (
    <main className="users">
      <div className="users-header">
        <h2>Utenti</h2>
        <button type="button" onClick={onBack}>
          Torna alla chat
        </button>
      </div>

      {users === null && (
        <p role="status" className="muted">
          Caricamento
        </p>
      )}
      {users?.length === 0 && <p className="muted">Nessun utente.</p>}

      <ul className="users-list">
        {users?.map((user) => (
          <li key={user.id}>
            <div>
              <strong>{user.name}</strong>
              <p className="muted">{user.email}</p>
              <p className="muted">Stato: {user.isAdmin ? 'Amministratore' : STATUS_LABEL[user.status]}</p>
            </div>
            <div className="users-actions">
              <label>
                <span className="muted">Messaggi al giorno</span>
                <input
                  type="number"
                  min={0}
                  max={500}
                  defaultValue={user.dailyLimit}
                  key={user.dailyLimit}
                  onBlur={(event) => changeLimit(user, 'dailyLimit', event.target.value)}
                />
              </label>
              <label>
                <span className="muted">Approfondite al giorno</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={user.deepLimit}
                  key={user.deepLimit}
                  onBlur={(event) => changeLimit(user, 'deepLimit', event.target.value)}
                />
              </label>
              {!user.isAdmin && user.status !== 'approved' && (
                <button type="button" className="button-primary" onClick={() => void change(user, { status: 'approved' })}>
                  Approva
                </button>
              )}
              {!user.isAdmin && user.status !== 'blocked' && (
                <button type="button" onClick={() => void change(user, { status: 'blocked' })}>
                  Blocca
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
