import { useCallback, useEffect, useState } from 'react';
import {
  fetchUserUsage,
  fetchUsers,
  updateUser,
  type ManagedUser,
  type Profile,
  type UsageDay,
  type UserChanges,
  type UserStatus,
} from './api';

interface UsersProps {
  onFailure: (cause: unknown) => void;
}

const STATUS_LABEL: Record<UserStatus, string> = {
  pending: 'In attesa',
  approved: 'Approvato',
  blocked: 'Bloccato',
};

const PROFILE_LABEL: Record<Profile, string> = {
  professional: 'Professionale',
  student: 'Studente',
};

type LimitField = 'dailyLimit' | 'deepLimit' | 'imageLimit' | 'tokenLimit';

const LIMITS: { field: LimitField; label: string; max: number }[] = [
  { field: 'dailyLimit', label: 'Messaggi al giorno', max: 500 },
  { field: 'deepLimit', label: 'Approfondite al giorno', max: 100 },
  { field: 'imageLimit', label: 'Immagini al giorno', max: 50 },
  { field: 'tokenLimit', label: 'Token a pagamento al giorno', max: 10_000_000 },
];

const integer = new Intl.NumberFormat('it-IT');
const dollars = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 });
const money = (microUsd: number) => dollars.format(microUsd / 1_000_000);

function UsageTable({ days }: { days: UsageDay[] }) {
  if (!days.length) return <p className="muted">Nessun utilizzo negli ultimi 30 giorni.</p>;

  return (
    <div className="md-table usage-table">
      <table>
        <caption className="visually-hidden">Utilizzo per giorno</caption>
        <thead>
          <tr>
            <th scope="col">Giorno</th>
            <th scope="col">Richieste</th>
            <th scope="col">Approfondite</th>
            <th scope="col">Documenti</th>
            <th scope="col">Immagini</th>
            <th scope="col">Token a pagamento</th>
            <th scope="col">Token gratuiti</th>
            <th scope="col">Costo stimato</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <th scope="row">{day.day}</th>
              <td>
                {day.requests}
                {day.errors > 0 && <span className="muted"> ({day.errors} errori)</span>}
              </td>
              <td>{day.deep}</td>
              <td>{day.documents}</td>
              <td>{day.images}</td>
              <td>{integer.format(day.paidTokens)}</td>
              <td>{integer.format(day.freeTokens)}</td>
              <td>{money(day.costMicroUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserCard({ user, onChange }: { user: ManagedUser; onChange: (changes: UserChanges) => void }) {
  const [usage, setUsage] = useState<UsageDay[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  async function toggleUsage() {
    const next = !open;
    setOpen(next);
    if (next && usage === null) {
      try {
        setUsage(await fetchUserUsage(user.id));
      } catch {
        setLoadFailed(true);
      }
    }
  }

  function changeLimit(field: LimitField, value: string, max: number) {
    const limit = Number(value);
    if (value.trim() && Number.isInteger(limit) && limit >= 0 && limit <= max && limit !== user[field]) {
      onChange({ [field]: limit });
    }
  }

  const tokenShare = user.tokenLimit > 0 ? Math.min(100, Math.round((user.todayPaidTokens / user.tokenLimit) * 100)) : 100;

  const status = user.isAdmin ? 'Amministratore' : STATUS_LABEL[user.status];

  return (
    <li>
      {/* Closed by default: open only the person to look at or change. */}
      <details className="user-item">
        <summary>
          <span className="user-summary">
            <span className="user-summary-name">{user.name}</span>
            <span className="user-summary-meta">
              {user.email} · {status} · {PROFILE_LABEL[user.profile]}
              {` · oggi ${user.todayMessages} msg, ${tokenShare}% token`}
            </span>
          </span>
        </summary>

        <div className="user-body">
          <div className="user-head">
            <p className="muted">Stato: {status}</p>
            <div className="users-actions">
              {!user.isAdmin && user.status !== 'approved' && (
                <button type="button" className="button-primary" onClick={() => onChange({ status: 'approved' })}>
                  Approva
                </button>
              )}
              {!user.isAdmin && user.status !== 'blocked' && (
                <button type="button" onClick={() => onChange({ status: 'blocked' })}>
                  Blocca
                </button>
              )}
            </div>
          </div>

          <div className="user-settings">
            <label>
              <span className="muted">Profilo</span>
              <select value={user.profile} onChange={(event) => onChange({ profile: event.target.value as Profile })}>
                {(Object.keys(PROFILE_LABEL) as Profile[]).map((profile) => (
                  <option key={profile} value={profile}>
                    {PROFILE_LABEL[profile]}
                  </option>
                ))}
              </select>
            </label>
            {LIMITS.map(({ field, label, max }) => (
              <label key={field}>
                <span className="muted">{label}</span>
                <input
                  type="number"
                  min={0}
                  max={max}
                  step={field === 'tokenLimit' ? 1000 : 1}
                  defaultValue={user[field]}
                  key={user[field]}
                  onBlur={(event) => changeLimit(field, event.target.value, max)}
                />
              </label>
            ))}
          </div>

          <dl className="user-usage">
            <div>
              <dt>Oggi</dt>
              <dd>
                {user.todayMessages} messaggi, {user.todayImages} immagini
              </dd>
            </div>
            <div>
              <dt>Token a pagamento oggi</dt>
              <dd>
                {integer.format(user.todayPaidTokens)} di {integer.format(user.tokenLimit)} ({tokenShare}%)
              </dd>
            </div>
            <div>
              <dt>Questo mese</dt>
              <dd>
                {user.monthRequests} richieste, {money(user.monthCostMicroUsd)} stimati
                {user.monthFreeTokens > 0 && `, ${integer.format(user.monthFreeTokens)} token gratuiti`}
              </dd>
            </div>
          </dl>

          <button type="button" onClick={() => void toggleUsage()} aria-expanded={open}>
            {open ? 'Nascondi dettaglio' : 'Dettaglio ultimi 30 giorni'}
          </button>
          {open &&
            (loadFailed ? (
              <p className="error">Dettaglio non disponibile.</p>
            ) : usage === null ? (
              <p role="status" className="muted">
                Caricamento
              </p>
            ) : (
              <UsageTable days={usage} />
            ))}
        </div>
      </details>
    </li>
  );
}

export function Users({ onFailure }: UsersProps) {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);

  const reload = useCallback(() => fetchUsers().then(setUsers).catch(onFailure), [onFailure]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function change(user: ManagedUser, changes: UserChanges) {
    try {
      await updateUser(user.id, changes);
      await reload();
    } catch (cause) {
      onFailure(cause);
    }
  }

  const monthTotal = users?.reduce((total, user) => total + user.monthCostMicroUsd, 0) ?? 0;

  return (
    <main className="users">
      <h2>Utenti</h2>

      {users && (
        <p className="muted">
          Costo stimato del mese per tutti gli utenti: <strong>{money(monthTotal)}</strong> (modelli a pagamento e
          immagini; prezzi indicativi).
        </p>
      )}
      {users === null && (
        <p role="status" className="muted">
          Caricamento
        </p>
      )}
      {users?.length === 0 && <p className="muted">Nessun utente.</p>}

      <ul className="users-list">
        {users?.map((user) => (
          <UserCard key={user.id} user={user} onChange={(changes) => void change(user, changes)} />
        ))}
      </ul>
    </main>
  );
}
