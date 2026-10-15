import "server-only";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import type { Viewer } from "./db";

export type SessionUser = { id: string; email: string | null };

/**
 * The signed-in user, from a *verified* token (getClaims checks the JWT signature, or asks
 * the Auth server when the project uses a symmetric secret). Never trust ids from the client.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!supabaseConfigured) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, email: (data.claims.email as string | undefined) ?? null };
}

export async function getViewer(): Promise<Viewer> {
  const u = await getSessionUser();
  return u ? { userId: u.id } : null;
}

export class AuthRequired extends Error { constructor() { super("Sign in required"); } }

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new AuthRequired();
  return u;
}

export const unauthorized = () => Response.json({ error: "Please sign in to do that." }, { status: 401 });
