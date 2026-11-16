export interface Account {
  name: string;
  dailyLimit: number;
  remaining: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  answer: string;
  remaining: number;
}

export type ApiErrorCode = 'invalid_code' | 'daily_limit_reached' | 'service_unavailable' | 'invalid_request';

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode) {
    super(code);
    this.name = 'ApiError';
  }
}

const KNOWN_ERRORS: ApiErrorCode[] = ['invalid_code', 'daily_limit_reached', 'service_unavailable', 'invalid_request'];

async function request<T>(path: string, accessCode: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${accessCode}` },
    });
  } catch {
    throw new ApiError('service_unavailable');
  }

  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    const code = KNOWN_ERRORS.find((known) => known === body?.error);
    throw new ApiError(code ?? 'service_unavailable');
  }
  return body as T;
}

export function fetchAccount(accessCode: string): Promise<Account> {
  return request<Account>('/me', accessCode);
}

export function sendConversation(accessCode: string, messages: ConversationMessage[]): Promise<ChatResult> {
  return request<ChatResult>('/chat', accessCode, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
}
