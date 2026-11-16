import type { Account } from './api';

interface WaitingProps {
  account: Account;
  onSignOut: () => void;
}

export function Waiting({ account, onSignOut }: WaitingProps) {
  return (
    <main className="page">
      <h1>ConoscenzIA</h1>
      <p role="status">
        {account.status === 'blocked'
          ? 'Questo account non è abilitato.'
          : 'Account in attesa di approvazione. Potrai usare lo strumento dopo che sarà stato approvato.'}
      </p>
      <p className="muted">Accesso effettuato come {account.email}.</p>
      <button type="button" onClick={onSignOut}>
        Esci
      </button>
    </main>
  );
}
