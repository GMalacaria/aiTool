import { useEffect, useState } from 'react';

/** null: follow the system. Otherwise the user's explicit choice, stored on this device. */
export type ColorScheme = 'light' | 'dark' | null;

const KEY = 'color-scheme';

export function readColorScheme(): ColorScheme {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function apply(scheme: ColorScheme): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) meta.content = scheme ?? 'light dark';
}

/** Saves the choice (or removes it to follow the system) and applies it at once. */
export function setColorScheme(scheme: ColorScheme): void {
  try {
    if (scheme) localStorage.setItem(KEY, scheme);
    else localStorage.removeItem(KEY);
  } catch {
    // Not saved: it still applies until the page is reloaded.
  }
  apply(scheme);
}

/** The stored choice, kept in sync with other tabs. */
export function useColorScheme(): [ColorScheme, (scheme: ColorScheme) => void] {
  const [scheme, setScheme] = useState<ColorScheme>(readColorScheme);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== KEY && event.key !== null) return;
      const next = readColorScheme();
      apply(next);
      setScheme(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return [
    scheme,
    (next) => {
      setColorScheme(next);
      setScheme(next);
    },
  ];
}

/** Whether the system currently prefers dark, to label the "System" option. */
export function useSystemPrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return dark;
}

/** True when the page is dark: the user's choice on this device, else the system's. */
function pageIsDark(): boolean {
  if (typeof window === 'undefined') return false;
  const choice = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.content;
  if (choice === 'dark' || choice === 'light') return choice === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Whether the page is currently dark, updated when the system or the setting changes. */
export function usePageIsDark(): boolean {
  const [dark, setDark] = useState(pageIsDark);

  useEffect(() => {
    const update = () => setDark(pageIsDark());
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener('change', update);
    // Settings → Aspetto changes the <meta name="color-scheme"> (also from other tabs).
    const observer = new MutationObserver(update);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) observer.observe(meta, { attributes: true, attributeFilter: ['content'] });
    return () => {
      query.removeEventListener('change', update);
      observer.disconnect();
    };
  }, []);

  return dark;
}
