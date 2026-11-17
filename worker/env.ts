export interface Env {
  DB: D1Database;
  /** Generated images. */
  IMAGES: R2Bucket;
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
  /**
   * Image generation (Gemini image model). A paid key: images are not part of
   * the free tier. Without it the feature is off. Kept apart from GEMINI_API_KEY,
   * the free-tier text fallback.
   */
  GEMINI_IMAGE_API_KEY?: string;
  GEMINI_IMAGE_MODEL?: string;
  GEMINI_IMAGE_BASE_URL?: string;
  /**
   * Verified sources: the model that checks each sentence against the cited
   * pages (Gemini, with the paid key above, or the free key when there is none).
   */
  GEMINI_VERIFY_MODEL?: string;
  /** App-wide cap on answers with web search per day (all users together). Default 300; 0 turns sources off. */
  SOURCES_DAILY_LIMIT?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Optional overrides, used to point Google sign-in at a local mock. */
  GOOGLE_AUTH_URL?: string;
  GOOGLE_TOKEN_URL?: string;
  /** Comma-separated emails that are approved automatically and can manage users. */
  ADMIN_EMAILS?: string;
}

export type UserStatus = 'pending' | 'approved' | 'blocked';

/** 'student': the tool guides towards the solution instead of giving it. */
export type Profile = 'professional' | 'student';
export const PROFILES: Profile[] = ['professional', 'student'];

export interface User {
  id: number;
  email: string;
  name: string;
  status: UserStatus;
  profile: Profile;
  isAdmin: boolean;
  dailyMessageLimit: number;
  /** Daily allowance of in-depth answers, on top of the general limit. */
  dailyDeepLimit: number;
  /** Daily allowance of generated images. */
  dailyImageLimit: number;
  /** Paid-model tokens per day; beyond it only free-tier models answer. */
  dailyTokenLimit: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: User };
};
