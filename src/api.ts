import type { AttachmentNames, Attachments } from '../shared/attachments';
import type { DocumentSpec } from '../shared/document';
import type { AnswerSources } from '../shared/sources';

export type UserStatus = 'pending' | 'approved' | 'blocked';
export type Profile = 'professional' | 'student';

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
  /** Image generation is configured on the server. */
  imagesEnabled: boolean;
  imageLimit: number;
  imageRemaining: number;
  profile: Profile;
  /** Paid tokens per day; past it only free models answer. */
  tokenLimit: number;
  tokensUsed: number;
  freeMode: boolean;
  /** Free models are configured on the server. */
  freeAvailable: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  /** For document answers, the document title. */
  content: string;
  document?: DocumentSpec;
  /** A generated image shown with the answer. */
  image?: { id: string };
  /** The answer was written by a free-tier model. */
  freeModel?: boolean;
  /** Names of the files attached to a question. */
  attachments?: AttachmentNames;
  /** Verified sources: the legend for the markers in the text. */
  sources?: AnswerSources;
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
  imageRemaining?: number;
  freeMode?: boolean;
  answeredByFreeModel?: boolean;
  tokensUsed?: number;
  tokenLimit?: number;
  /** Present when the answer is a generated image. */
  image?: { id: string };
  /** Present when the answer is a document. */
  document?: DocumentSpec;
  /** Present when the answer was written with web search. */
  sources?: AnswerSources;
  remaining: number;
  /** Null when the exchange was not stored (fixed answers on sensitive topics). */
  conversation: ConversationSummary | null;
}

export interface ManagedUser {
  id: number;
  email: string;
  name: string;
  status: UserStatus;
  profile: Profile;
  isAdmin: boolean;
  dailyLimit: number;
  deepLimit: number;
  imageLimit: number;
  tokenLimit: number;
  createdAt: string;
  todayMessages: number;
  todayPaidTokens: number;
  todayImages: number;
  monthCostMicroUsd: number;
  monthRequests: number;
  monthFreeTokens: number;
  /** Web searches this month and what searching and checking sources cost (paid by the owner). */
  monthSearches: number;
  monthSourcesCostMicroUsd: number;
}

export interface UsageDay {
  day: string;
  requests: number;
  text: number;
  deep: number;
  documents: number;
  images: number;
  errors: number;
  freeModeRequests: number;
  paidTokens: number;
  freeTokens: number;
  costMicroUsd: number;
  searches: number;
  sourcesCostMicroUsd: number;
}

export type UserChanges = Partial<Pick<ManagedUser, 'status' | 'profile' | 'dailyLimit' | 'deepLimit' | 'imageLimit' | 'tokenLimit'>>;

const KNOWN_ERRORS = [
  'not_signed_in',
  'not_approved',
  'forbidden',
  'not_found',
  'daily_limit_reached',
  'image_limit_reached',
  'tokens_exhausted',
  'free_quota_exhausted',
  'quota_exhausted',
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

export const imageUrl = (id: string) => `/api/images/${encodeURIComponent(id)}`;

export const SIGN_IN_URL = '/api/auth/google/start';

export const fetchAccount = () => request<Account>('/me');
export interface ProfileStats {
  createdAt: string | null;
  messages: number;
  deep: number;
  documents: number;
  images: number;
  tokens: number;
  paidTokens: number;
  freeTokens: number;
  /** First day in the usage log; totals start there. */
  since: string | null;
  activeDays: number;
  streak: { longest: number; current: number };
}

export const fetchProfileStats = () => request<ProfileStats>('/me/stats');
export const signOut = () => request<void>('/auth/logout', 'POST');
export const deleteAccount = () => request<void>('/me', 'DELETE');

export const fetchConversations = () =>
  request<{ conversations: ConversationSummary[] }>('/conversations').then((body) => body.conversations);
export const fetchConversation = (id: string) =>
  request<ConversationSummary & { messages: ConversationMessage[] }>(`/conversations/${id}`);
export const deleteConversation = (id: string) => request<void>(`/conversations/${id}`, 'DELETE');
export const renameConversation = (id: string, title: string) =>
  request<{ title: string }>(`/conversations/${id}`, 'PATCH', { title }).then((body) => body.title);

export interface SearchResult extends ConversationSummary {
  /** Excerpt of a matching message; null when only the title matched. */
  snippet: string | null;
}

export const searchConversations = (query: string) =>
  request<{ results: SearchResult[] }>(`/conversations/search?q=${encodeURIComponent(query)}`).then((body) => body.results);
export const deleteAllConversations = () => request<void>('/conversations', 'DELETE');

export const sendMessage = (
  conversationId: string | null,
  message: string,
  attachments: Attachments,
  deep: boolean,
) => request<ChatResult>('/chat', 'POST', { conversationId, message, attachments, deep });

export const fetchUsers = () => request<{ users: ManagedUser[] }>('/admin/users').then((body) => body.users);
export const fetchUserUsage = (id: number, days = 30) =>
  request<{ days: UsageDay[] }>(`/admin/users/${id}/usage?days=${days}`).then((body) => body.days);
export const updateUser = (id: number, changes: UserChanges) =>
  request<void>(`/admin/users/${id}`, 'PATCH', changes);
