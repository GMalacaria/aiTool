import { useEffect, useState } from 'react';

type ServiceStatus = 'checking' | 'available' | 'unavailable';

const STATUS_LABEL: Record<ServiceStatus, string> = {
  checking: 'Verifica del servizio in corso',
  available: 'Servizio disponibile',
  unavailable: 'Servizio non disponibile',
};

export function App() {
  const [status, setStatus] = useState<ServiceStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/health', { signal: controller.signal })
      .then((response) => setStatus(response.ok ? 'available' : 'unavailable'))
      .catch(() => {
        if (!controller.signal.aborted) setStatus('unavailable');
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="page">
      <h1>ConoscenzIA</h1>
      <p>Uno strumento per ottenere informazioni. Non è una persona.</p>
      <p role="status" className="status">
        {STATUS_LABEL[status]}
      </p>
    </main>
  );
}
