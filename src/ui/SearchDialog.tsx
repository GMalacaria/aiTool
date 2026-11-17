import { useEffect, useState } from 'react';
import { searchConversations, type SearchResult } from '../api';
import { Modal } from './Modal';

interface SearchDialogProps {
  open: boolean;
  onOpenConversation: (id: string) => void;
  onClose: () => void;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

export function SearchDialog({ open, onOpenConversation, onClose }: SearchDialogProps) {
  return (
    <Modal open={open} title="Cerca nelle chat" onClose={onClose} className="search-modal">
      {/* Mounted only while open, so every search starts empty. */}
      {open && <SearchPanel onOpenConversation={onOpenConversation} onClose={onClose} />}
    </Modal>
  );
}

function SearchPanel({ onOpenConversation, onClose }: Omit<SearchDialogProps, 'open'>) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [failed, setFailed] = useState(false);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_CHARS) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchConversations(trimmed)
        .then((found) => {
          if (!cancelled) {
            setResults(found);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  return (
    <div className="modal-body search-body">
      <label htmlFor="search-chats" className="visually-hidden">
        Testo da cercare
      </label>
      <input
        id="search-chats"
        type="search"
        placeholder="Cerca nei titoli e nei messaggi"
        autoFocus
        data-autofocus
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="search-results" aria-live="polite">
        {failed && <p className="error">Ricerca non disponibile. Riprova.</p>}
        {!failed && trimmed.length < MIN_CHARS && <p className="muted">Scrivi almeno {MIN_CHARS} caratteri.</p>}
        {!failed && results?.length === 0 && <p className="muted">Nessuna chat trovata.</p>}
        {!failed && results && results.length > 0 && (
          <ul>
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenConversation(result.id);
                    onClose();
                  }}
                >
                  <span className="search-title">{result.title}</span>
                  {result.snippet && <span className="search-snippet">{result.snippet}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </div>
  );
}
