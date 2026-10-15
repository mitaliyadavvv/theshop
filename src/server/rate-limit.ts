import "server-only";
import { getDb } from "./db";

/** Per-user limits for actions that create work for the server or for brand websites. */
export const LIMITS = {
  maxSubscriptions: 200,
  windows: {
    follow: { max: 30, seconds: 3600 },          // add-brand attempts
    sync: { max: 20, seconds: 3600 },            // manual refreshes
    manual_product: { max: 60, seconds: 3600 },
    save: { max: 600, seconds: 3600 },
  },
  /** A source can't be manually re-synced more often than this, whoever asks. */
  sourceCooldownMinutes: 10,
} as const;

export type RateAction = keyof typeof LIMITS.windows;

/** Sliding-window limit stored in Postgres, so it holds across serverless instances. */
export async function checkRateLimit(userId: string, action: RateAction): Promise<boolean> {
  const { max, seconds } = LIMITS.windows[action];
  const db = getDb();
  const [{ n }] = await db.query<{ n: number }>(
    "select count(*)::int n from rate_limit_events where user_id = $1 and action = $2 and created_at > now() - make_interval(secs => $3)",
    [userId, action, seconds],
  );
  if (n >= max) return false;
  await db.query("insert into rate_limit_events (user_id, action) values ($1, $2)", [userId, action]);
  // Opportunistic cleanup of old events.
  if (Math.random() < 0.02) await db.query("delete from rate_limit_events where created_at < now() - interval '2 days'");
  return true;
}
