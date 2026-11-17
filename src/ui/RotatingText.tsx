import { useEffect, useState } from 'react';

interface RotatingTextProps {
  phrases: readonly string[];
  /** Milliseconds each phrase stays on screen. */
  interval: number;
  className?: string;
}

/**
 * Cycles through phrases with a short fade (none with reduced motion). It is
 * decorative: screen readers get the first phrase once, not every change.
 */
export function RotatingText({ phrases, interval, className }: RotatingTextProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (phrases.length < 2) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % phrases.length), interval);
    return () => clearInterval(timer);
  }, [phrases.length, interval]);

  return (
    <span className={className}>
      <span className="visually-hidden">{phrases[0]}</span>
      <span key={index} className="rotating-phrase" aria-hidden="true">
        {phrases[index]}
      </span>
    </span>
  );
}
