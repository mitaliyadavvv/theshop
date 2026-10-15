"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./env";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Browser client — used only for auth calls (sign in/up/out, password reset). Data goes through our API. */
export function supabaseBrowser() {
  if (!client) client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return client;
}
