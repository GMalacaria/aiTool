import { useCallback, useEffect, useState } from 'react';
import { ApiError, fetchAccount, signOut, type Account } from './api';
import { Login } from './Login';
import { Waiting } from './Waiting';
import { Workspace } from './Workspace';

type Session =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'unavailable' }
  | { status: 'signed_in'; account: Account };

export function App() {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchAccount()
      .then((account) => {
        if (!cancelled) setSession({ status: 'signed_in', account });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const signedOut = error instanceof ApiError && error.code === 'not_signed_in';
        setSession({ status: signedOut ? 'signed_out' : 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut().catch(() => undefined);
    setSession({ status: 'signed_out' });
  }, []);

  const handleSignedOut = useCallback(() => setSession({ status: 'signed_out' }), []);

  switch (session.status) {
    case 'loading':
      return (
        <main className="page">
          <p role="status" className="muted">
            Caricamento
          </p>
        </main>
      );
    case 'unavailable':
      return (
        <main className="page">
          <h1>Kern</h1>
          <p role="alert" className="error">
            Servizio non disponibile. Riprova più tardi.
          </p>
        </main>
      );
    case 'signed_out':
      return <Login />;
    case 'signed_in':
      return session.account.status === 'approved' ? (
        <Workspace account={session.account} onSignOut={handleSignOut} onSignedOut={handleSignedOut} />
      ) : (
        <Waiting account={session.account} onSignOut={handleSignOut} />
      );
  }
}
