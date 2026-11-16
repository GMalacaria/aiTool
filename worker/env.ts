export interface Env {
  DB: D1Database;
  OPENAI_API_KEY: string;
  /** Optional override, used to point the OpenAI provider at a local mock. */
  OPENAI_BASE_URL?: string;
}

export interface User {
  id: number;
  name: string;
  dailyMessageLimit: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: User };
};
