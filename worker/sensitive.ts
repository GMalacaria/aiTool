export type SensitiveTopic = 'self_harm' | 'violence';

/**
 * Deliberately simple keyword matching on the user's message. It will produce
 * false positives (e.g. a history question mentioning suicide); for this
 * product a fixed pointer to real services is the safer failure mode.
 */
const PATTERNS: Record<SensitiveTopic, RegExp> = {
  self_harm:
    /suicid|farla finita|togliermi la vita|ammazzarmi|uccidermi|non voglio pi[uù] vivere|voglio morire|autolesion|farmi del male|tagliarmi/i,
  violence:
    /mi picchia|mi mena|mi maltratta|mi minaccia|violenza domestica|violenza sessuale|stupr|abusa di me|abusat[oa]|molestat[oa]|stalking/i,
};

/** User-facing fixed answers (Italian UI copy). */
const RESPONSES: Record<SensitiveTopic, string> = {
  self_harm: [
    'Questo strumento non può aiutare in una situazione come questa. Parlane con una persona.',
    '',
    '• Emergenza o pericolo immediato: 112',
    '• Telefono Amico Italia: 02 2327 2327 (tutti i giorni)',
    '• Telefono Azzurro, per bambini e ragazzi: 19696',
    '',
    'Se puoi, rivolgiti anche a un familiare, a una persona di fiducia o al tuo medico.',
  ].join('\n'),
  violence: [
    'Questo strumento non può aiutare in una situazione come questa. Rivolgiti a persone e servizi reali.',
    '',
    '• Emergenza o pericolo immediato: 112',
    '• Numero antiviolenza e stalking: 1522 (gratuito, attivo 24 ore su 24)',
    '• Telefono Azzurro, per bambini e ragazzi: 19696',
  ].join('\n'),
};

export function detectSensitiveTopic(text: string): SensitiveTopic | null {
  for (const topic of Object.keys(PATTERNS) as SensitiveTopic[]) {
    if (PATTERNS[topic].test(text)) return topic;
  }
  return null;
}

export function sensitiveTopicResponse(topic: SensitiveTopic): string {
  return RESPONSES[topic];
}
