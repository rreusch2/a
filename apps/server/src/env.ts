import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });
dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 4000),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  runWorker: process.env.RUN_WORKER !== 'false',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  nangoHost: (process.env.NANGO_HOST ?? 'https://api.nango.dev').replace(/\/$/, ''),
  nangoSecret: process.env.NANGO_SECRET_KEY ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};

export function assertSupabaseConfigured(): void {
  if (!env.supabaseUrl || !env.supabasePublishableKey || !env.supabaseSecretKey) {
    throw new HttpConfigError(
      'Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY in the root .env file.',
    );
  }
}

export class HttpConfigError extends Error {}
