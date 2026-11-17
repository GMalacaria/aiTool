export interface Env {
  DB: D1Database;
  OPENAI_API_KEY: string;
  /** Optional override, used to point the OpenAI provider at a local mock. */
  OPENAI_BASE_URL?: string;
  /** Optional free-tier fallbacks, used when OpenAI fails. Each is enabled by its key. */
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /** Optional overrides of the fallbacks' endpoints and models. */
  GROQ_BASE_URL?: string;
  GROQ_MODEL?: string;
  GEMINI_BASE_URL?: string;
  GEMINI_MODEL?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Optional overrides, used to point Google sign-in at a local mock. */
  GOOGLE_AUTH_URL?: string;
  GOOGLE_TOKEN_URL?: string;
  /** Comma-separated emails that are approved automatically and can manage users. */
  ADMIN_EMAILS?: string;
}

export type UserStatus = 'pending' | 'approved' | 'blocked';

export interface User {
  id: number;
  email: string;
  name: string;
  status: UserStatus;
  isAdmin: boolean;
  dailyMessageLimit: number;
  /** Daily allowance of in-depth answers, on top of the general limit. */
  dailyDeepLimit: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: User };
};
