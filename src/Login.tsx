import { useState, type FormEvent } from 'react';
import { ApiError } from './api';

interface LoginProps {
  onSubmit: (code: string) => Promise<void>;
}

export function Login({ onSubmit }: LoginProps) {
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim() || pending) return;

    setPending(true);
    setError(null);
    try {
      await onSubmit(code.trim());
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'invalid_code'
          ? 'Codice non valido.'
          : 'Servizio non disponibile. Riprova più tardi.',
      );
      setPending(false);
    }
  }

  return (
    <main className="page">
      <h1>ConoscenzIA</h1>
      <p className="muted">Uno strumento per ottenere informazioni. Non è una persona.</p>

      <form className="login" onSubmit={handleSubmit}>
        <label htmlFor="access-code">Codice di accesso</label>
        <input
          id="access-code"
          type="password"
          autoComplete="current-password"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          aria-describedby={error ? 'access-code-error' : undefined}
          aria-invalid={error ? true : undefined}
        />
        {error && (
          <p id="access-code-error" role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending || !code.trim()}>
          Entra
        </button>
      </form>
    </main>
  );
}
