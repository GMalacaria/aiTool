import { describe, expect, it, vi } from 'vitest';
import { normalizeContext, parseContextUpdate } from '../shared/context';
import { CONTEXT_PAUSED_TEXT, respond, type Routers } from './chat';
import { parseProposal } from './context';
import type { ChatMessage, ProviderRouter } from './llm/router';
import { CONTEXT_SYSTEM_PROMPT, INTENT_SYSTEM_PROMPT, parseIntent, parseRemember, SYSTEM_PROMPT } from './prompts';

describe('normalizeContext', () => {
  it('keeps one fact per line without bullets', () => {
    expect(normalizeContext('- Insegna matematica\n\n* Usa Excel  \n1. Preferisce elenchi')).toBe(
      'Insegna matematica\nUsa Excel\nPreferisce elenchi',
    );
  });

  it('rejects a context over the limits', () => {
    expect(normalizeContext(Array.from({ length: 21 }, (_, i) => `fatto ${i}`).join('\n'))).toBeNull();
    expect(normalizeContext('x'.repeat(201))).toBeNull();
  });
});

describe('parseProposal', () => {
  it('reports no change when the list is the same', () => {
    expect(parseProposal('{"content":"Usa Excel","change":"Aggiunto","reply":""}', 'Usa Excel')).toEqual({
      content: 'Usa Excel',
      change: '',
      reply: '',
    });
  });

  it('keeps the current context when the proposal is unusable', () => {
    expect(parseProposal(JSON.stringify({ content: 'x'.repeat(500), change: 'c', reply: 'r' }), 'Usa Excel').content).toBe(
      'Usa Excel',
    );
  });
});

describe('intent words', () => {
  it('reads context and remember', () => {
    expect(parseIntent('context')).toBe('context');
    expect(parseIntent('text remember')).toBe('text');
    expect(parseRemember('text remember')).toBe(true);
    expect(parseRemember('text')).toBe(false);
  });

  it('parses a stored update', () => {
    expect(parseContextUpdate('{"versionId":3,"change":"Aggiunto: usa Excel"}')).toEqual({ versionId: 3, change: 'Aggiunto: usa Excel' });
    expect(parseContextUpdate('{"versionId":"3"}')).toBeNull();
  });
});

function routers(intent: string, context: string, paused = false) {
  const save = vi.fn(async () => 42);
  const draft = vi.fn(async (_messages: ChatMessage[]) => 'Risposta.');
  const standard = vi.fn(async (messages: ChatMessage[]) => {
    if (messages[0].content === INTENT_SYSTEM_PROMPT) return intent;
    if (messages[0].content === CONTEXT_SYSTEM_PROMPT) return context;
    return 'OK';
  });
  const value: Routers = {
    draft: { complete: draft } as unknown as ProviderRouter,
    review: { complete: standard } as unknown as ProviderRouter,
    deep: false,
    context: { content: 'Usa Excel', paused, save },
  };
  return { value, save, draft };
}

describe('respond with a context', () => {
  it('adds the context to the answer prompt', async () => {
    const { value, draft } = routers('text', '{}');
    await respond(value, [], 'Come faccio una somma?');
    const system = draft.mock.calls[0][0][0].content as string;
    expect(system.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(system).toContain('<user_context>\nUsa Excel\n</user_context>');
  });

  it('applies an explicit request and reports it', async () => {
    const { value, save } = routers(
      'context',
      JSON.stringify({ content: 'Usa Excel\nInsegna matematica', change: 'Aggiunto: insegna matematica', reply: 'Fatto.' }),
    );
    await expect(respond(value, [], 'Ricorda che insegno matematica')).resolves.toEqual({
      text: 'Fatto.',
      contextUpdate: { versionId: 42, change: 'Aggiunto: insegna matematica' },
    });
    expect(save).toHaveBeenCalledWith('Usa Excel\nInsegna matematica', 'request', 'Aggiunto: insegna matematica');
  });

  it('updates the context quietly when a lasting fact is noticed', async () => {
    const { value, save } = routers(
      'text remember',
      JSON.stringify({ content: 'Usa Excel\nStudia in 3ª liceo', change: 'Aggiunto: studia in 3ª liceo', reply: '' }),
    );
    await expect(respond(value, [], 'Sono in terza liceo, spiegami i logaritmi')).resolves.toEqual({
      text: 'Risposta.',
      contextUpdate: { versionId: 42, change: 'Aggiunto: studia in 3ª liceo' },
    });
    expect(save).toHaveBeenCalledWith('Usa Excel\nStudia in 3ª liceo', 'auto', 'Aggiunto: studia in 3ª liceo');
  });

  it('neither uses nor updates a paused context', async () => {
    const paused = routers('text remember', '{"content":"Altro","change":"x","reply":""}', true);
    await expect(respond(paused.value, [], 'Sono in terza liceo')).resolves.toEqual({ text: 'Risposta.' });
    expect(paused.save).not.toHaveBeenCalled();
    expect(paused.draft.mock.calls[0][0][0].content).not.toContain('user_context');

    const asked = routers('context', '{}', true);
    await expect(respond(asked.value, [], 'Ricorda che uso Excel')).resolves.toEqual({ text: CONTEXT_PAUSED_TEXT });
  });

  it('still answers when the context update fails', async () => {
    const { value, save } = routers('text remember', 'not json');
    await expect(respond(value, [], 'Sono in terza liceo')).resolves.toEqual({ text: 'Risposta.' });
    expect(save).not.toHaveBeenCalled();
  });
});
