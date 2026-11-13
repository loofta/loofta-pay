/* eslint-disable */
// Ported from apps/mini-app (Next route handlers) so the live data runs on the long-lived backend.
// Vercel is serverless and cannot hold the PumpPortal websocket or the shared caches and request queue.
/**
 * Live feed of Pump launches and graduations from PumpPortal's websocket (PUMPPORTAL_API_KEY,
 * server only). New coins arrive the moment they are created, with no polling and no rate limit.
 *
 * One connection per server process, kept on globalThis so hot reloads do not open a second one.
 * It needs a long-lived Node server (next start, Fly, Railway), not a serverless function.
 *
 * What the stream gives for free: name, symbol, creator, starting market cap, graduation events.
 * What it does not: holders or risk numbers (Solana Tracker adds those), and per-coin trades, which
 * PumpPortal only sends when the API key's wallet holds at least 0.02 SOL.
 */

const URL = "wss://pumpportal.fun/api/data";
const MAX_COINS = 600;
const META_GATEWAYS = ["https://ipfs.filebase.io/ipfs/", "https://gateway.pinata.cloud/ipfs/", "https://4everland.io/ipfs/"];
const CID = /(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{40,100})/;

export interface StreamCoin {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  /** Market cap in SOL at the last event we saw. */
  mcapSol: number;
  createdAt: number;
  migrated: boolean;
  image: string;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
}

interface State {
  ws: WebSocket | null;
  coins: Map<string, StreamCoin>;
  connecting: boolean;
  retry: number;
  lastMessageAt: number;
  metaQueue: string[];
  metaRunning: number;
}

const g = globalThis as unknown as { __pumpStream?: State };
const state: State = (g.__pumpStream ??= { ws: null, coins: new Map(), connecting: false, retry: 0, lastMessageAt: 0, metaQueue: [], metaRunning: 0 });

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

/** Socials live in the coin's metadata JSON on IPFS. Fetched a few at a time, never blocking the stream. */
async function loadMeta(mint: string, uri: string) {
  const cid = uri.match(CID)?.[1];
  const coin = state.coins.get(mint);
  if (!cid || !coin) return;
  try {
    const json = await Promise.any(
      META_GATEWAYS.map(async (gw) => {
        const res = await fetch(gw + cid, { signal: AbortSignal.timeout(6_000) });
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as Record<string, unknown>;
      }),
    );
    coin.website = str(json.website);
    coin.twitter = str(json.twitter);
    coin.telegram = str(json.telegram);
  } catch {
    /* no metadata yet, the coin still shows */
  }
}

function pumpMeta(mint: string, uri: string) {
  state.metaQueue.push(`${mint}|${uri}`);
  const next = () => {
    while (state.metaRunning < 4 && state.metaQueue.length > 0) {
      const [m, u] = state.metaQueue.shift()!.split("|");
      state.metaRunning++;
      void loadMeta(m, u).finally(() => {
        state.metaRunning--;
        next();
      });
    }
  };
  next();
}

function onMessage(raw: string) {
  state.lastMessageAt = Date.now();
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(raw);
  } catch {
    return;
  }
  const mint = typeof d.mint === "string" ? d.mint : null;
  if (!mint) return;
  if (d.txType === "create") {
    if (state.coins.has(mint)) return;
    state.coins.set(mint, {
      mint,
      name: str(d.name) ?? "Unnamed",
      symbol: str(d.symbol) ?? "",
      creator: typeof d.traderPublicKey === "string" ? d.traderPublicKey : "",
      mcapSol: typeof d.marketCapSol === "number" ? d.marketCapSol : 0,
      createdAt: Date.now(),
      migrated: false,
      // Pump serves its own copy of the picture. It can lag a few seconds on brand new coins, and the app falls back to initials.
      image: `https://images.pump.fun/coin-image/${mint}?variant=86x86`,
      website: null,
      twitter: null,
      telegram: null,
    });
    if (typeof d.uri === "string") pumpMeta(mint, d.uri);
    // Keep memory bounded: drop the oldest coins.
    if (state.coins.size > MAX_COINS) {
      const oldest = [...state.coins.keys()].slice(0, state.coins.size - MAX_COINS);
      for (const k of oldest) state.coins.delete(k);
    }
  } else if (d.txType === "migrate" || d.pool === "pump-amm") {
    const c = state.coins.get(mint);
    if (c) c.migrated = true;
    else state.coins.set(mint, { mint, name: "", symbol: "", creator: "", mcapSol: 0, createdAt: Date.now(), migrated: true, image: `https://images.pump.fun/coin-image/${mint}?variant=86x86`, website: null, twitter: null, telegram: null });
  }
}

function connect() {
  const key = process.env.PUMPPORTAL_API_KEY;
  if (!key || state.connecting || (state.ws && state.ws.readyState <= 1)) return;
  state.connecting = true;
  const ws = new WebSocket(`${URL}?api-key=${key}`);
  state.ws = ws;
  ws.onopen = () => {
    state.connecting = false;
    state.retry = 0;
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
    ws.send(JSON.stringify({ method: "subscribeMigration" }));
  };
  ws.onmessage = (m) => onMessage(String(m.data));
  const lost = () => {
    state.connecting = false;
    if (state.ws === ws) state.ws = null;
    // Back off up to 30 seconds. The next request also reconnects, so a quiet server heals itself.
    state.retry = Math.min(30_000, 1_000 * 2 ** state.retry);
  };
  ws.onclose = lost;
  ws.onerror = lost;
}

/** The coins seen on the stream, newest first. Opens the connection on first use. */
export function streamCoins(): StreamCoin[] {
  connect();
  // A socket that has gone silent for 3 minutes is treated as dead and reopened.
  if (state.ws && state.lastMessageAt && Date.now() - state.lastMessageAt > 180_000) {
    try {
      state.ws.close();
    } catch {
      /* already closed */
    }
    state.ws = null;
    connect();
  }
  return [...state.coins.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** True once the stream has delivered at least one message. */
export function streamLive(): boolean {
  return !!state.ws && state.ws.readyState === 1 && state.lastMessageAt > 0;
}

export function migratedMints(): Set<string> {
  const out = new Set<string>();
  for (const c of state.coins.values()) if (c.migrated) out.add(c.mint);
  return out;
}
