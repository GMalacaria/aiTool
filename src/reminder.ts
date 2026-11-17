import type { ConversationMessage } from './api';

/** A reminder follows every Nth question of a conversation. */
export const REMINDER_EVERY = 10;

export const REMINDER_TEXT =
  'Promemoria: stai usando uno strumento di intelligenza artificiale, non una persona. ' +
  'Per questioni personali o delicate rivolgiti a una persona di fiducia o a un professionista.';

/**
 * True when the reminder goes right after the message at `index`: it is the
 * answer to the Nth, 2Nth, … question. It is derived from the messages, so it
 * also appears when an old conversation is reopened, and it is never stored or
 * produced by the model.
 */
export function reminderAfter(messages: ConversationMessage[], index: number): boolean {
  if (messages[index]?.role !== 'assistant') return false;
  const questions = messages.slice(0, index + 1).filter((message) => message.role === 'user').length;
  return questions > 0 && questions % REMINDER_EVERY === 0;
}
