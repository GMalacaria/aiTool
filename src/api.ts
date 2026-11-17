import type { AttachmentNames, Attachments } from '../shared/attachments';
import type { DocumentSpec } from '../shared/document';

export type UserStatus = 'pending' | 'approved' | 'blocked';

export interface Account {
  name: string;
  email: string;
  status: UserStatus;
  isAdmin: boolean;
  dailyLimit: number;
  remaining: number;
  /** Daily allowance of in-depth answers. */
  deepLimit: number;
  deepRemaining: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  /** For document answers, the document title. */
  content: string;
  document?: DocumentSpec;
  /** Names of the files attached to a question. */
  attachments?: AttachmentNames;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatResult {
  answer: string;
  /** Absent on fixed answers, which do not touch the allowances. */
  deepRemaining?: number;
  /** Present when the answer is a document. */
  document?: DocumentSpec;
  remaining: number;
  /** Null when the exchange was not stored (fixed answers on sensitive topics). */
  conversation: ConversationSummary | null;
}

export interface ManagedUser {
  id: number;
  email: string;
  name: string;
  status: UserStatus;
  isAdmin: boolean;
  dailyLimit: number;
  deepLimit: number;
  createdAt: string;
}

const KNOWN_ERRORS = [
  'not_signed_in',
  'not_approved',
  'forbidden',
  'not_found',
  'daily_limit_reached',
  'service_unavailable',
  'attachments_unavailable',
  'invalid_request',
] as const;

export type ApiErrorCode = (typeof KNOWN_ERRORS)[number];

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode) {
    super(code);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, method = 'GET', payload?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    throw new ApiError('service_unavailable');
  }

  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new ApiError(KNOWN_ERRORS.find((known) => known === body?.error) ?? 'service_unavailable');
  }
  return body as T;
}

export const SIGN_IN_URL = '/api/auth/google/start';

export const fetchAccount = () => request<Account>('/me');
export const signOut = () => request<void>('/auth/logout', 'POST');
export const deleteAccount = () => request<void>('/me', 'DELETE');

export const fetchConversations = () =>
  request<{ conversations: ConversationSummary[] }>('/conversations').then((body) => body.conversations);
export const fetchConversation = (id: string) =>
  request<ConversationSummary & { messages: ConversationMessage[] }>(`/conversations/${id}`);
export const deleteConversation = (id: string) => request<void>(`/conversations/${id}`, 'DELETE');
export const deleteAllConversations = () => request<void>('/conversations', 'DELETE');

export const sendMessage = (
  conversationId: string | null,
  message: string,
  attachments: Attachments,
  deep: boolean,
) => request<ChatResult>('/chat', 'POST', { conversationId, message, attachments, deep });

export const fetchUsers = () => request<{ users: ManagedUser[] }>('/admin/users').then((body) => body.users);
export const updateUser = (id: number, changes: { status?: UserStatus; dailyLimit?: number; deepLimit?: number }) =>
  request<void>(`/admin/users/${id}`, 'PATCH', changes);
