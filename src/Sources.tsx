import { useEffect, useId, useRef, useState } from 'react';
import type { AnswerSources, Marker, SourceItem } from '../shared/sources';

/*
 * Where `popover="hint"` is not supported it falls back to "manual", which a
 * click would never close: switch these toggletips to "auto" as they open.
 * It must happen in `beforetoggle`, which does not bubble: a capturing listener.
 */
if (typeof document !== 'undefined') {
  const probe = document.createElement('div');
  probe.setAttribute('popover', 'hint');
  if ((probe as HTMLElement & { popover?: string }).popover !== 'hint') {
    document.addEventListener(
      'beforetoggle',
      (event) => {
        const target = event.target as HTMLElement;
        if ((event as ToggleEvent).newState === 'open' && target.classList?.contains('citation-tip')) {
          target.setAttribute('popover', 'auto');
        }
      },
      true,
    );
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function sourceLabel(item: SourceItem): string {
  return item.kind === 'web' ? item.title : `Allegato: ${item.name}`;
}

/** A [n] marker: opens the source in a new tab. */
function SourceLink({ n, item }: { n: number; item: SourceItem | undefined }) {
  if (!item) return <span className="citation">[{n}]</span>;
  if (item.kind === 'file') {
    return (
      <span className="citation" title={sourceLabel(item)}>
        [{n}]
      </span>
    );
  }
  return (
    <a
      className="citation"
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${item.title} — ${hostOf(item.url)}`}
      aria-label={`Fonte ${n}: ${item.title}`}
    >
      [{n}]
    </a>
  );
}

/**
 * A [?] marker, or [n?] when the writer cited source n but it could not be
 * read: a toggletip that opens on hover or focus where `interestfor`
 * exists, and on click or tap everywhere.
 */
function UncheckedMarker({ n, item }: { n?: number; item?: SourceItem }) {
  const id = useId();
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const element = tip.current;
    if (!element) return;
    const sync = (event: Event) => setOpen((event as ToggleEvent).newState === 'open');
    element.addEventListener('toggle', sync);
    return () => element.removeEventListener('toggle', sync);
  }, []);

  return (
    <>
      <button
        type="button"
        className="citation citation-unchecked"
        aria-label={n ? `Affermazione non verificata, fonte ${n} non leggibile: dettagli` : 'Affermazione non verificata: dettagli'}
        aria-expanded={open}
        popoverTarget={id}
        popoverTargetAction="show"
        {...({ interestfor: id } as Record<string, string>)}
      >
        [{n ?? ''}?]
      </button>
      <span id={id} ref={tip} className="citation-tip" role="tooltip" {...({ popover: 'hint' } as Record<string, string>)}>
        {item ? (
          <>
            Affermazione non verificata: la fonte [{n}] indicata non è leggibile.{' '}
            {item.kind === 'web' && (
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                Apri {hostOf(item.url)}
              </a>
            )}
          </>
        ) : (
          'Affermazione non verificata: nessuna fonte leggibile la conferma.'
        )}
      </span>
    </>
  );
}

export function MarkerView({ marker, sources }: { marker: Marker; sources?: AnswerSources }) {
  if (marker.type === 'source') return <SourceLink n={marker.n} item={sources?.items[marker.n - 1]} />;
  if (marker.type === 'unreadable') return <UncheckedMarker n={marker.n} item={sources?.items[marker.n - 1]} />;
  return <UncheckedMarker />;
}

/** The numbered list of sources under an answer. */
export function SourceLegend({ sources, unreadable }: { sources: AnswerSources; unreadable: Set<number> }) {
  return (
    <section className="source-legend" aria-label="Fonti">
      <h3>{sources.verified ? 'Fonti' : 'Fonti consultate (verifica non disponibile)'}</h3>
      <ol>
        {sources.items.map((item, index) => (
          <li key={index}>
            {item.kind === 'web' ? (
              <>
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </a>
                <span className="muted"> · {hostOf(item.url)}</span>
              </>
            ) : (
              <span>Allegato: {item.name}</span>
            )}
            {unreadable.has(index + 1) && <span className="muted"> · non leggibile, non verificata</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Under a factual answer written without search: says so, and offers the check. */
export function UncheckedNotice({ onVerify }: { onVerify?: () => Promise<boolean> }) {
  const [state, setState] = useState<'idle' | 'checking' | 'failed'>('idle');

  async function verify() {
    if (!onVerify) return;
    setState('checking');
    // On success the answer is replaced and this notice disappears.
    if (!(await onVerify())) setState('failed');
  }

  return (
    <section className="source-legend source-unchecked" aria-label="Fonti">
      {state === 'checking' ? (
        <p role="status" className="loading">
          Verifica delle fonti in corso
          <span className="loading-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </p>
      ) : (
        <p>
          Fonti non verificate: risposta scritta senza cercare sul web.{' '}
          {onVerify && (
            <button type="button" className="link-button" onClick={() => void verify()}>
              Verifica fonti
            </button>
          )}
          {state === 'failed' && <span className="error"> Verifica non riuscita.</span>}
        </p>
      )}
    </section>
  );
}
