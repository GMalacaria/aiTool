import { useEffect, useState } from 'react';
import { MAX_CONTEXT_CHARS, MAX_CONTEXT_ITEMS, type ContextSource } from '../../shared/context';
import {
  fetchUserContext,
  pauseUserContext,
  restoreContextVersion,
  saveUserContext,
  type UserContextData,
} from '../api';

const dateTime = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' });

function formatDateTime(value: string): string {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : dateTime.format(date);
}

const SOURCE_LABEL: Record<ContextSource, string> = {
  auto: 'Dalla chat',
  request: 'Su tua richiesta',
  manual: 'Modificato da te',
  undo: 'Annullato',
  restore: 'Ripristinato',
};

/**
 * "Il tuo contesto" in Profilo: what Kern knows about the user, editable by
 * hand, with every earlier version and a switch to pause it.
 */
export function ContextSection({ onFailure }: { onFailure: (cause: unknown) => void }) {
  const [data, setData] = useState<UserContextData | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const load = () =>
    fetchUserContext()
      .then((loaded) => {
        setData(loaded);
        setDraft(loaded.content);
      })
      .catch(onFailure);

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setInvalid(false);
    try {
      await saveUserContext(draft);
      await load();
    } catch (cause) {
      // Too many facts or too long: the field says so, nothing else changes.
      setInvalid(true);
      if (!(cause instanceof Error && cause.message === 'invalid_request')) onFailure(cause);
    } finally {
      setSaving(false);
    }
  }

  async function togglePause(paused: boolean) {
    try {
      await pauseUserContext(paused);
      await load();
    } catch (cause) {
      onFailure(cause);
    }
  }

  async function restore(id: number) {
    try {
      await restoreContextVersion(id);
      await load();
    } catch (cause) {
      onFailure(cause);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="profile-context">
      <h3 id="profile-context">Il tuo contesto</h3>
      <p className="muted">
        Fatti che hai scelto di condividere (lavoro, scuola, strumenti, formato preferito): Kern li usa solo per adattare le
        risposte. Si aggiorna quando scrivi qualcosa di stabile su di te o quando lo chiedi («ricorda che…», «dimentica
        che…»). Non viene cancellato con le chat e lo vedi solo tu.
      </p>

      {data === null ? (
        <p role="status" className="muted">
          Caricamento
        </p>
      ) : (
        <>
          <label className="context-pause">
            <input type="checkbox" checked={data.paused} onChange={(event) => void togglePause(event.target.checked)} />
            Metti in pausa: non viene usato né aggiornato
          </label>

          <label htmlFor="context-text" className="visually-hidden">
            Contesto, un fatto per riga
          </label>
          <textarea
            id="context-text"
            className="context-text"
            rows={6}
            value={draft}
            placeholder="Nessun fatto salvato. Un fatto per riga, per esempio: Insegna matematica alle scuole medie"
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby="context-limits"
            aria-invalid={invalid}
          />
          <p id="context-limits" className={invalid ? 'error' : 'muted'}>
            Un fatto per riga, al massimo {MAX_CONTEXT_ITEMS} fatti e {MAX_CONTEXT_CHARS} caratteri.
          </p>
          <div className="context-actions">
            <button type="button" className="button-primary" onClick={() => void save()} disabled={saving || draft === data.content}>
              Salva
            </button>
            {data.updatedAt && <span className="muted">Ultimo aggiornamento: {formatDateTime(data.updatedAt)}</span>}
          </div>

          {data.versions.length > 0 && (
            <details className="context-history">
              <summary>Cronologia delle modifiche</summary>
              <ol>
                {data.versions.map((version, index) => (
                  <li key={version.id}>
                    <div className="context-version-head">
                      <span>
                        {formatDateTime(version.createdAt)} · {SOURCE_LABEL[version.source]}
                        {version.note && ` · ${version.note}`}
                      </span>
                      {index > 0 && version.content !== data.content && (
                        <button type="button" className="link-button" onClick={() => void restore(version.id)}>
                          Ripristina
                        </button>
                      )}
                    </div>
                    <pre className="context-version-text">{version.content || '(vuoto)'}</pre>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}
