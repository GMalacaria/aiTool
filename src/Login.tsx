import { SIGN_IN_URL } from './api';

export function Login() {
  const failed = new URLSearchParams(window.location.search).get('error') === 'sign_in_failed';

  return (
    <main className="page">
      <h1>Kern</h1>
      <p className="muted">Uno strumento per ottenere informazioni. Non è una persona.</p>

      {failed && (
        <p role="alert" className="error">
          Accesso non riuscito. Riprova.
        </p>
      )}

      <a className="button button-primary" href={SIGN_IN_URL}>
        Accedi con Google
      </a>

      <p className="muted">
        Dopo il primo accesso l'account deve essere approvato. Le conversazioni vengono salvate nel tuo account e puoi
        eliminarle in qualsiasi momento.
      </p>
    </main>
  );
}
