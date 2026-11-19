/**
 * Puts the live transcription together. Each closed segment is an item: its
 * text grows with the partial pieces (deltas) while the user speaks, and is
 * replaced by the final text when the service completes it. Items are kept in
 * the order they first appeared, because completions can arrive out of order.
 */
export class LiveTranscript {
  private readonly items = new Map<string, { text: string; done: boolean }>();

  private item(id: string) {
    let item = this.items.get(id);
    if (!item) {
      item = { text: '', done: false };
      this.items.set(id, item);
    }
    return item;
  }

  /** A segment was closed: its final text is now awaited. */
  committed(id: string): void {
    this.item(id);
  }

  delta(id: string, piece: string): void {
    const item = this.item(id);
    if (!item.done) item.text += piece;
  }

  completed(id: string, text: string): void {
    const item = this.item(id);
    item.text = text;
    item.done = true;
  }

  /** The service could not finish a segment: what arrived so far is kept. */
  failed(id: string): void {
    this.item(id).done = true;
  }

  /** Every closed segment has its final text. */
  get settled(): boolean {
    return [...this.items.values()].every((item) => item.done);
  }

  get text(): string {
    return [...this.items.values()]
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join(' ');
  }
}

/** Appends dictated text to what was already written, with one space between them. */
export function joinDraft(before: string, dictated: string): string {
  if (!dictated) return before;
  if (!before) return dictated;
  return /\s$/.test(before) ? before + dictated : `${before} ${dictated}`;
}
