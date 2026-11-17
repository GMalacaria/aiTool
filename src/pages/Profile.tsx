import { useEffect, useState } from 'react';
import { fetchAccount, fetchProfileStats, type Account, type ProfileStats } from '../api';
import { PROFILE_LABEL } from '../ui/Sidebar';

interface ProfileProps {
  account: Account;
  onFailure: (cause: unknown) => void;
}

const integer = new Intl.NumberFormat('it-IT');
const longDate = new Intl.DateTimeFormat('it-IT', { dateStyle: 'long' });

function formatDate(value: string | null): string {
  if (!value) return '—';
  // SQLite timestamps are UTC without a zone marker.
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : longDate.format(date);
}

const days = (count: number) => (count === 1 ? '1 giorno' : `${integer.format(count)} giorni`);

export function Profile({ account, onFailure }: ProfileProps) {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  // Today's figures are read again: they change with every message.
  const [today, setToday] = useState<Account>(account);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchProfileStats(), fetchAccount()])
      .then(([loadedStats, loadedAccount]) => {
        if (cancelled) return;
        setStats(loadedStats);
        setToday(loadedAccount);
      })
      .catch((cause: unknown) => {
        if (!cancelled) onFailure(cause);
      });
    return () => {
      cancelled = true;
    };
  }, [onFailure]);

  const tokenShare =
    today.tokenLimit > 0 ? Math.min(100, Math.round((today.tokensUsed / today.tokenLimit) * 100)) : 100;

  return (
    <main className="page-view">
      <h2>Profilo</h2>

      <section className="settings-section" aria-labelledby="profile-account">
        <h3 id="profile-account">Account</h3>
        <dl className="facts">
          <div>
            <dt>Nome</dt>
            <dd>{account.name}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{account.email}</dd>
          </div>
          <div>
            <dt>Account creato il</dt>
            <dd>{stats ? formatDate(stats.createdAt) : '…'}</dd>
          </div>
          <div>
            <dt>Profilo</dt>
            <dd>{PROFILE_LABEL[account.profile]}</dd>
          </div>
        </dl>
      </section>

      <section className="settings-section" aria-labelledby="profile-today">
        <h3 id="profile-today">Disponibili oggi</h3>
        <ul className="stat-grid">
          <li>
            <span className="stat-value">
              {today.remaining} <span className="stat-of">di {today.dailyLimit}</span>
            </span>
            <span className="stat-label">Messaggi</span>
          </li>
          <li>
            <span className="stat-value">{100 - tokenShare}%</span>
            <span className="stat-label">Token rimasti</span>
            <meter className="stat-meter" min={0} max={100} low={20} high={50} optimum={100} value={100 - tokenShare}>
              {100 - tokenShare}%
            </meter>
          </li>
          {today.imagesEnabled && (
            <li>
              <span className="stat-value">
                {today.imageRemaining} <span className="stat-of">di {today.imageLimit}</span>
              </span>
              <span className="stat-label">Immagini</span>
            </li>
          )}
          <li>
            <span className="stat-value">
              {today.deepRemaining} <span className="stat-of">di {today.deepLimit}</span>
            </span>
            <span className="stat-label">Risposte approfondite</span>
          </li>
        </ul>
        {today.freeMode && (
          <p className="notice">Token giornalieri esauriti: fino a mezzanotte rispondono i modelli gratuiti.</p>
        )}
      </section>

      <section className="settings-section" aria-labelledby="profile-totals">
        <h3 id="profile-totals">Utilizzo complessivo</h3>
        {stats === null ? (
          <p role="status" className="muted">
            Caricamento
          </p>
        ) : (
          <>
            <ul className="stat-grid">
              <li>
                <span className="stat-value">{integer.format(stats.messages)}</span>
                <span className="stat-label">Messaggi inviati</span>
              </li>
              <li>
                <span className="stat-value">{integer.format(stats.deep)}</span>
                <span className="stat-label">Risposte approfondite</span>
              </li>
              <li>
                <span className="stat-value">{integer.format(stats.images)}</span>
                <span className="stat-label">Immagini create</span>
              </li>
              <li>
                <span className="stat-value">{integer.format(stats.tokens)}</span>
                <span className="stat-label">Token utilizzati</span>
              </li>
              <li>
                <span className="stat-value">{days(stats.streak.longest)}</span>
                <span className="stat-label">Serie più lunga</span>
              </li>
              <li>
                <span className="stat-value">{days(stats.streak.current)}</span>
                <span className="stat-label">Serie attuale</span>
              </li>
            </ul>
            <p className="muted">
              {stats.since
                ? `Conteggi dal ${formatDate(stats.since)}, data del primo utilizzo registrato. Le serie contano i giorni consecutivi con almeno una domanda.`
                : 'Nessun utilizzo registrato finora.'}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
