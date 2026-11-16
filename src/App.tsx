import { useCallback, useEffect, useState } from 'react';
import { ApiError, fetchAccount, type Account } from './api';
import { Chat } from './Chat';
import { Login } from './Login';

const STORAGE_KEY = 'aitool.accessCode';

function readStoredCode(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeCode(code: string | null): void {
  try {
    if (code === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage unavailable (e.g. private mode): the code just won't be remembered.
  }
}

type Session = { status: 'loading' } | { status: 'signed_out' } | { status: 'signed_in'; code: string; account: Account };

export function App() {
  const [session, setSession] = useState<Session>(() =>
    readStoredCode() ? { status: 'loading' } : { status: 'signed_out' },
  );

  useEffect(() => {
    const code = readStoredCode();
    if (!code) return;

    let cancelled = false;
    fetchAccount(code)
      .then((account) => {
        if (!cancelled) setSession({ status: 'signed_in', code, account });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.code === 'invalid_code') storeCode(null);
        setSession({ status: 'signed_out' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (code: string) => {
    const account = await fetchAccount(code);
    storeCode(code);
    setSession({ status: 'signed_in', code, account });
  }, []);

  const signOut = useCallback(() => {
    storeCode(null);
    setSession({ status: 'signed_out' });
  }, []);

  if (session.status === 'loading') {
    return (
      <main className="page">
        <p role="status" className="muted">
          Caricamento
        </p>
      </main>
    );
  }

  if (session.status === 'signed_out') return <Login onSubmit={signIn} />;

  return <Chat accessCode={session.code} account={session.account} onSignOut={signOut} />;
}
