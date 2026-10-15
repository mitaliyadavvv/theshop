import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseConfigured, supabaseUrl } from "./env";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { for (const { name, value, options } of list) store.set(name, value, options); }
        catch { /* called from a Server Component; the proxy refreshes cookies instead */ }
      },
    },
  });
}

export { supabaseConfigured };
