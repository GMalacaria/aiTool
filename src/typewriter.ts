import { useEffect, useState } from 'react';

/** Slowest and fastest reveal: short answers type at a readable pace, long ones never take more than a few seconds. */
const CHARS_PER_SECOND = 90;
const MIN_SECONDS = 0.4;
const MAX_SECONDS = 4;

/** Answers whose reveal has finished, so reopening the page does not type them again. */
const finished = new WeakSet<object>();

/**
 * Spans that must appear whole: a Markdown link or source marker, a fence line
 * (so the block opens as a card or code block at once), and a whole Mermaid
 * block (a half-written diagram would flicker as an error). The text inside
 * copy cards and code blocks is typed like the rest.
 */
const ATOMIC = /!?\[[^\]\n]*\]\([^)\n]*\)|```mermaid[\s\S]*?(?:```|$)|```[^\n]*(?:\n|$)/g;

/** Moves a cut point out of the middle of a link or a fenced block, to its end. */
export function safeCut(text: string, cut: number): number {
  if (cut >= text.length) return text.length;
  for (const match of text.matchAll(ATOMIC)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (cut > start && cut < end) return end;
    if (start >= cut) break;
  }
  return cut;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Reveals `text` progressively, like typing. `owner` identifies the message so a
 * finished reveal is not repeated when the chat is mounted again. With
 * `enabled` false (reopened chats, reduced motion) the whole text is returned.
 */
export function useTypewriter(
  text: string,
  enabled: boolean,
  owner: object,
  onGrow?: () => void,
): { shown: string; done: boolean } {
  const skip = !enabled || finished.has(owner) || reducedMotion();
  const [cut, setCut] = useState(skip ? text.length : 0);

  useEffect(() => {
    if (skip) {
      setCut(text.length);
      return;
    }
    const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, text.length / CHARS_PER_SECOND));
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / (seconds * 1000));
      const next = safeCut(text, Math.floor(progress * text.length));
      setCut(next);
      onGrow?.();
      if (progress < 1) frame = requestAnimationFrame(step);
      else finished.add(owner);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // onGrow is a plain scroll helper: restarting the reveal when it changes would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, skip, owner]);

  const done = cut >= text.length;
  return { shown: done ? text : text.slice(0, cut), done };
}
