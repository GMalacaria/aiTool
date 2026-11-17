import { useEffect, useState, type ReactNode } from 'react';
import { CheckIcon, CopyIcon } from './ui/icons';

const COPIED_MS = 2000;

/**
 * A block with a copy icon at its top right: text ready to paste elsewhere
 * (an email, a message, instructions) shown as a card, or a code block.
 */
export function CopyBlock({ text, variant, children }: { text: string; variant: 'card' | 'code'; children: ReactNode }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <div className={variant === 'card' ? 'copy-block copy-card' : 'copy-block copy-code'}>
      {children}
      <button
        type="button"
        className="icon-button copy-button"
        onClick={copy}
        aria-label={variant === 'card' ? 'Copia il testo' : 'Copia il codice'}
        title="Copia"
      >
        {state === 'copied' ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
      </button>
      <span className="visually-hidden" role="status">
        {state === 'copied' ? 'Copiato' : state === 'failed' ? 'Copia non riuscita' : ''}
      </span>
    </div>
  );
}
