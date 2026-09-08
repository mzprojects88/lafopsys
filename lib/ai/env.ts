function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name} — add it to .env.local (and to Vercel for production).`);
  }
  return value;
}

/** Server-only. The key is never sent to the browser. */
export function openaiApiKey(): string {
  return required("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
}

export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

/** Which model answers; changeable without a deploy. */
export function openaiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function openaiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
