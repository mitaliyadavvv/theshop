import dns from "node:dns/promises";
import net from "node:net";
import { SourceError } from "./types";

// Standard crawler convention ("Mozilla/5.0 (compatible; Name/version; …)"): identifies us
// honestly as a bot. A bare token UA gets 429'd by Shopify's edge before robots.txt even applies.
export const USER_AGENT = "Mozilla/5.0 (compatible; TheShopDiscovery/0.1; personal catalogue reader; respects robots.txt)";
const MIN_GAP_MS = 1200;         // per-host politeness delay
// Many stores sit behind one shared edge (Shopify rate-limits per client IP across
// stores), so also space out requests globally.
const GLOBAL_GAP_MS = 1500;
let lastGlobal = 0;
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

const lastHit = new Map<string, number>();
const robotsCache = new Map<string, { at: number; rules: { allow: boolean; path: string }[] }>();

/* ---------------------------------------------------------------------------
 * SSRF guard. Users can make the server fetch URLs, so every request — and every
 * redirect hop — must resolve to a public address on a standard port.
 * ------------------------------------------------------------------------- */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

export async function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new SourceError("Only http(s) URLs can be fetched.", "blocked");
  if (u.port && u.port !== "443" && u.port !== "80") throw new SourceError("Only standard web ports can be fetched.", "blocked");
  if (u.username || u.password) throw new SourceError("URLs with credentials are not allowed.", "blocked");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => {
    throw new SourceError(`Couldn't resolve ${host}.`, "network");
  });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new SourceError("That address points to a private network and can't be fetched.", "blocked");
  }
}

/** fetch() with the SSRF guard applied to the URL and every redirect. */
async function safeFetch(url: string, init: RequestInit, hops = 5): Promise<Response> {
  let current = url;
  for (let i = 0; i <= hops; i++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    return res;
  }
  throw new SourceError("Too many redirects.", "network");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function politeWait(host: string) {
  const last = lastHit.get(host) ?? 0;
  const wait = Math.max(last + MIN_GAP_MS, lastGlobal + GLOBAL_GAP_MS) - Date.now();
  lastGlobal = Date.now() + Math.max(wait, 0);
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

/** Minimal robots.txt support: groups for "*" (and our agent token), Allow/Disallow with * and $. */
function parseRobots(txt: string) {
  const rules: { allow: boolean; path: string }[] = [];
  let applies = false;
  let inAgentBlock = false;
  for (const line of txt.split(/\r?\n/)) {
    const l = line.replace(/#.*/, "").trim();
    if (!l) continue;
    const [k, ...rest] = l.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!inAgentBlock) applies = false;
      inAgentBlock = true;
      if (val === "*" || /theshopdiscovery/i.test(val)) applies = true;
      continue;
    }
    inAgentBlock = false;
    if (!applies) continue;
    if (key === "disallow" && val) rules.push({ allow: false, path: val });
    if (key === "allow" && val) rules.push({ allow: true, path: val });
  }
  return rules;
}

function ruleMatches(rule: string, pathWithQuery: string) {
  const re = new RegExp("^" + rule.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*").replace(/\\\$$/, "$"));
  return re.test(pathWithQuery);
}

export async function robotsAllows(url: string): Promise<boolean> {
  const u = new URL(url);
  let entry = robotsCache.get(u.origin);
  if (!entry || Date.now() - entry.at > 6 * 3600_000) {
    let rules: { allow: boolean; path: string }[] = [];
    try {
      await politeWait(u.host);
      const res = await safeFetch(`${u.origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) rules = parseRobots(await res.text());
    } catch { /* unreachable robots.txt = no rules */ }
    entry = { at: Date.now(), rules };
    robotsCache.set(u.origin, entry);
  }
  const target = u.pathname + u.search;
  // Longest matching rule wins (Google semantics); Allow wins ties.
  let best: { allow: boolean; len: number } | null = null;
  for (const r of entry.rules) {
    if (ruleMatches(r.path, target) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) {
      best = { allow: r.allow, len: r.path.length };
    }
  }
  return best ? best.allow : true;
}

export type JsonResponse<T> = { data: T; headers: Headers; status: number };

/** GET JSON with robots check, per-host rate limiting, timeout and retry/backoff on 429/5xx. */
export async function getJson<T>(url: string, opts: { skipRobots?: boolean; retries?: number } = {}): Promise<JsonResponse<T>> {
  const u = new URL(url);
  if (!opts.skipRobots && !(await robotsAllows(url))) {
    throw new SourceError(`robots.txt disallows ${u.pathname}`, "robots");
  }
  let lastErr: unknown;
  const retries = opts.retries ?? MAX_RETRIES;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await politeWait(u.host);
    let res: Response;
    try {
      res = await safeFetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (e instanceof SourceError && e.kind === "blocked") throw e;
      lastErr = new SourceError(`Network error: ${(e as Error).message}`, "network");
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (process.env.SYNC_DEBUG) console.log(`[http] ${res.status} ${u.host}${u.pathname}${u.search} (attempt ${attempt + 1}) retry-after=${res.headers.get("retry-after") ?? "-"}`);
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      lastErr = new SourceError(`HTTP ${res.status}`, res.status === 429 ? "rate_limited" : "http", res.status);
      if (attempt < retries) await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 75) * 1000 : 1500 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new SourceError(`HTTP ${res.status} for ${u.pathname}`, "http", res.status);
    const text = await res.text();
    try {
      return { data: JSON.parse(text) as T, headers: res.headers, status: res.status };
    } catch {
      throw new SourceError(`Expected JSON from ${u.pathname} but got something else`, "parse", res.status);
    }
  }
  throw lastErr instanceof Error ? lastErr : new SourceError("Request failed", "network");
}

export async function getText(url: string): Promise<string | null> {
  const u = new URL(url);
  if (!(await robotsAllows(url))) return null;
  await politeWait(u.host);
  try {
    const res = await safeFetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Errors that mean "try later", as opposed to "this platform isn't here". */
export const isTransient = (e: unknown) =>
  e instanceof SourceError && (e.kind === "rate_limited" || e.kind === "network" || (e.kind === "http" && (e.status ?? 0) >= 500));
