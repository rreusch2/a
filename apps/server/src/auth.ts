import type { NextFunction, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserClient } from './db.js';
import { HttpConfigError } from './env.js';
import { HttpError } from './http.js';

export interface AuthedRequest extends Request {
  user: { id: string; email: string | null };
  supabase: SupabaseClient;
  accessToken: string;
}

export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token) throw new HttpError(401, 'Sign in required.');
    const supabase = createUserClient(token);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, 'Sign in required.');
    const authed = req as AuthedRequest;
    authed.user = { id: data.user.id, email: data.user.email ?? null };
    authed.supabase = supabase;
    authed.accessToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

export function asAuthed(req: Request): AuthedRequest {
  return req as AuthedRequest;
}

export function sendError(error: unknown, res: Response): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof HttpConfigError) {
    res.status(503).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  console.error(error);
  res.status(500).json({ error: message });
}
