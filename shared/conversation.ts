/**
 * A conversation ends after this many requests: a new chat has to be opened.
 * Against long, companion-like conversations (the reminder appears every 10
 * requests, so this is the third one) and against growing token use. The
 * model only sees the last few messages anyway.
 */
export const MAX_QUESTIONS_PER_CONVERSATION = 30;

/** From this many requests left, the chat says how many remain. */
export const QUESTIONS_LEFT_WARNING = 5;
