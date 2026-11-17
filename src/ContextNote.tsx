import { useState } from 'react';
import type { ContextUpdate } from '../shared/context';

/**
 * Under an answer that changed the user's context: what changed, with
 * "Annulla". Changes are applied without asking; this is how they are seen
 * and taken back.
 */
export function ContextNote({
  update,
  onUndo,
}: {
  update: ContextUpdate;
  onUndo?: () => Promise<'done' | 'changed' | 'failed'>;
}) {
  const [state, setState] = useState<'idle' | 'undoing' | 'changed' | 'failed'>('idle');

  async function undo() {
    if (!onUndo) return;
    setState('undoing');
    const result = await onUndo();
    setState(result === 'done' ? 'idle' : result);
  }

  if (update.undone) {
    return (
      <p className="context-note muted" role="status">
        Modifica al contesto annullata.
      </p>
    );
  }

  return (
    <p className="context-note muted" role="status">
      Contesto aggiornato: {update.change.replace(/\.$/, '')}.{' '}
      {state === 'changed' ? (
        <span>Il contesto è cambiato dopo: puoi modificarlo dal Profilo.</span>
      ) : (
        onUndo && (
          <button type="button" className="link-button" onClick={() => void undo()} disabled={state === 'undoing'}>
            {state === 'undoing' ? 'Annullamento…' : 'Annulla'}
          </button>
        )
      )}
      {state === 'failed' && <span className="error"> Non riuscito.</span>}
    </p>
  );
}
