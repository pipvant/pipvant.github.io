// broker-sync: automatic broker account linking for PIPVANT (v10, Phase 1:
// TradeLocker only). Mirrors pip-coach's auth + response style.
// POST {action:'link'|'sync'|'disconnect', ...}
// Auth: the caller's Supabase JWT (Authorization: Bearer <jwt>). The uid
// comes from /auth/v1/user — a client-supplied user_id is NEVER trusted.
// DB access uses the service role key (bypasses RLS), exactly like
// pip-coach's quota writes — but every query is still filtered by the
// verified uid, so a caller can only ever touch their own rows.
//
// TradeLocker model (verified against the live docs 2026-11-19,
// API version 2.11.0 — see V10-BACKEND.md for the endpoint list):
// - Auth is JWT: POST /auth/jwt/token (email+password+server) returns
//   {accessToken, refreshToken, expireDate} (201). The password is
//   exchanged ONCE and discarded; only the encrypted refresh token is
//   stored. POST /auth/jwt/refresh {refreshToken} rotates both tokens.
// - There is NO deals endpoint and NO realized-P&L field anywhere in
//   the public API. A "trade" is a closed POSITION: filled orders in
//   GET /trade/accounts/{accountId}/ordersHistory grouped by
//   positionId. P&L is computed from entry/exit prices x qty x lotSize
//   (lotSize from GET /trade/instruments/{id}). The formula is the
//   standard one but is UNVERIFIED against a real account — the first
//   live test must compare computed P&L with TradeLocker's own figures.
// - ordersHistory rows are string arrays; the column order comes from
//   GET /trade/config (ordersHistoryConfig.columns) at sync time, with
//   the documented order as fallback. Never hard-code the order alone.
// - Every /trade/* call needs the accNum header (from
//   GET /auth/jwt/all-accounts) and the Bearer access token.
//
// Synced trades are written to the SAME public.trades rows the app's
// loader reads (sbLoadTrades), with source='sync' and
// external_id='tradelocker:<positionId>' — so journal, dashboard P&L,
// analytics and discipline score treat them exactly like manual trades.
// No parallel trades store exists anywhere in this function.
//
// Secrets needed: BROKER_SYNC_KEY (Edge Function secret) — a
// base64-encoded random 32-byte key. Generate at deploy time with:
//   openssl rand -base64 32
// Never commit a real key. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
// SUPABASE_ANON_KEY are injected automatically by Supabase.
// Requires the v15 migration (public.broker_connections,
// trades.external_id, trades.source).
//
// NEVER log credentials, tokens, or the encryption key. This file
// contains no console.log of request bodies at all.

const TL_DEMO = "https://demo.tradelocker.com/backend-api";
const TL_LIVE = "https://live.tradelocker.com/backend-api";
const SYNC_COOLDOWN_MS = 15 * 60 * 1000; // 15 min between manual syncs
const MAX_HISTORY_CALLS = 60; // bounds the ordersHistory window walk
const INSERT_BATCH = 50;
// The app's own placeholder price (sbMapTrade in the v8 build): used
// only when a closed position genuinely has no prices at all.
const FALLBACK_PRICE = 0.00000001;
// ordersHistory column order, from the /trade/config example in the
// live docs (updated 2026-03-26). Used ONLY if the live /trade/config
// fetch fails — the sync always prefers the live column list.
const DEFAULT_HISTORY_COLUMNS = [
  "id", "tradableInstrumentId", "routeId", "qty", "side", "type",
  "status", "filledQty", "avgPrice", "price", "stopPrice", "validity",
  "expireDate", "createdDate", "lastModified", "isOpen", "positionId",
  "stopLoss", "stopLossType", "takeProfit", "takeProfitType",
  "strategyId",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fail(status, error, extra) {
  return json(status, Object.assign({ ok: false, error }, extra || {}));
}

// ---------- base64 helpers (Deno has atob/btoa) ----------
function b64encode(bytes) {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}

function b64decode(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------- AES-GCM token encryption ----------
// Key: BROKER_SYNC_KEY, base64 of 32 random bytes. 12-byte random IV
// per value; stored form is base64(iv || ciphertext). Self-contained:
// no dependency on Vault availability, key never in code.
let cachedKey = null;
async function cryptoKey() {
  if (cachedKey) return cachedKey;
  const raw = Deno.env.get("BROKER_SYNC_KEY");
  if (!raw) throw new Error("no_key");
  let bytes;
  try {
    bytes = b64decode(raw.trim());
  } catch {
    throw new Error("bad_key");
  }
  if (bytes.length !== 32) throw new Error("bad_key");
  cachedKey = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  return cachedKey;
}

async function encryptToken(plain) {
  const key = await cryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plain);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return b64encode(out);
}

async function decryptToken(stored) {
  const key = await cryptoKey();
  const bytes = b64decode(stored);
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

// ---------- TradeLocker client ----------
// Returns {ok, status, data} — data is parsed JSON or null. Network
// failures surface as {ok:false, status:0, data:null}.
async function tl(base, method, path, accessToken, opts) {
  const o = opts || {};
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = "Bearer " + accessToken;
  if (o.accNum !== undefined && o.accNum !== null) headers["accNum"] = String(o.accNum);
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers,
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: null };
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

function tlBase(env) {
  return env === "demo" ? TL_DEMO : TL_LIVE;
}

// ---------- Supabase REST (service role) ----------
function sbRest(sbUrl, sbService, method, path, body, extraHeaders) {
  const headers = {
    apikey: sbService,
    Authorization: "Bearer " + sbService,
    "Content-Type": "application/json",
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return fetch(sbUrl + "/rest/v1/" + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function sbJson(res) {
  try { return await res.json(); } catch { return null; }
}

// ---------- ordersHistory parsing ----------
// Turns string-array rows into objects using the live column list
// (or DEFAULT_HISTORY_COLUMNS as fallback).
function parseHistoryRows(rows, columns) {
  const idx = {};
  columns.forEach((c, i) => { idx[c] = i; });
  const get = (row, name) => {
    const i = idx[name];
    if (i === undefined || i >= row.length) return null;
    const v = row[i];
    return v === undefined || v === "" ? null : v;
  };
  const num = (row, name) => {
    const v = get(row, name);
    if (v === null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  return rows.map((row) => ({
    id: get(row, "id"),
    instrumentId: get(row, "tradableInstrumentId"),
    routeId: get(row, "routeId"),
    qty: num(row, "qty"),
    side: get(row, "side"),
    status: get(row, "status"),
    filledQty: num(row, "filledQty"),
    avgPrice: num(row, "avgPrice"),
    price: num(row, "price"),
    createdDate: num(row, "createdDate"),
    lastModified: num(row, "lastModified"),
    positionId: get(row, "positionId"),
    stopLoss: num(row, "stopLoss"),
  }));
}

// Fetch the full orders history, walking time windows. The endpoint
// caps rows per request (hasMore=true when more remain); windows are
// split in half until every window fits, which works regardless of
// the server's row sort order. from/to are unix ms (UTC).
async function fetchAllHistory(base, accountId, accNum, accessToken) {
  const rows = [];
  const seen = new Set();
  const queue = [{ from: 0, to: Date.now() }];
  let calls = 0;
  let truncated = false;
  while (queue.length && calls < MAX_HISTORY_CALLS) {
    const w = queue.shift();
    calls++;
    const r = await tl(base, "GET",
      "/trade/accounts/" + accountId + "/ordersHistory?from=" + w.from + "&to=" + w.to,
      accessToken, { accNum });
    if (!r.ok || !r.data || !r.data.d || !Array.isArray(r.data.d.ordersHistory)) {
      // One failed window must not kill the whole sync: keep what we
      // have and flag the truncation to the caller.
      truncated = true;
      continue;
    }
    for (const row of r.data.d.ordersHistory) {
      const key = Array.isArray(row) ? row[0] : null;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      rows.push(row);
    }
    if (r.data.d.hasMore) {
      const mid = Math.floor((w.from + w.to) / 2);
      if (mid <= w.from) { truncated = true; continue; }
      queue.push({ from: w.from, to: mid }, { from: mid + 1, to: w.to });
    }
  }
  if (queue.length) truncated = true;
  return { rows, truncated };
}

// Group filled orders into closed positions and build trades rows.
// Returns {trades, openPositions, errors}. A position is a trade only
// when its net filled qty is zero (fully closed); still-open positions
// are skipped silently — they import once closed. A trade whose P&L
// cannot be computed (no lotSize for its instrument) is skipped and
// counted as an error: a guessed P&L is worse than no trade.
async function buildTrades(parsed, instruments, detailFetcher) {
  const trades = [];
  let openPositions = 0;
  let errors = 0;
  const groups = new Map();
  for (const o of parsed) {
    if (!o.status || o.status.toLowerCase() !== "filled") continue;
    if (!o.positionId) { errors++; continue; }
    if (!groups.has(o.positionId)) groups.set(o.positionId, []);
    groups.get(o.positionId).push(o);
  }
  for (const [positionId, orders] of groups) {
    orders.sort((a, b) => (a.createdDate || 0) - (b.createdDate || 0));
    let net = 0;
    for (const o of orders) {
      const q = o.filledQty !== null ? o.filledQty : o.qty;
      if (q === null) continue;
      net += (o.side === "buy" ? 1 : -1) * q;
    }
    if (Math.abs(net) > 1e-9) { openPositions++; continue; } // still open
    const entrySide = orders[0].side;
    if (entrySide !== "buy" && entrySide !== "sell") { errors++; continue; }
    const entries = orders.filter((o) => o.side === entrySide);
    const closes = orders.filter((o) => o.side !== entrySide);
    if (!entries.length || !closes.length) { errors++; continue; }
    const instrumentId = orders[0].instrumentId;
    const instrument = instruments.get(String(instrumentId));
    if (!instrument) { errors++; continue; } // unknown symbol: never invent one
    const vwap = (list) => {
      let sum = 0, wsum = 0;
      for (const o of list) {
        const q = o.filledQty !== null ? o.filledQty : o.qty;
        const p = o.avgPrice !== null ? o.avgPrice : o.price;
        if (q === null || p === null) continue;
        sum += p * q;
        wsum += q;
      }
      return wsum > 0 ? sum / wsum : null;
    };
    const entryPrice = vwap(entries);
    const exitPrice = vwap(closes);
    const entryQty = entries.reduce((s, o) => s + ((o.filledQty !== null ? o.filledQty : o.qty) || 0), 0);
    const closeMs = Math.max.apply(null, closes.map((o) => o.lastModified || o.createdDate || 0));
    if (!closeMs) { errors++; continue; }
    // P&L: price move x qty (lots) x lotSize (units per lot), signed
    // by direction. Quoting-currency caveat: the result is in the
    // instrument's quoting currency; for non-USD-quoted instruments
    // (e.g. GBPJPY) the stored $ figure will be off until an FX step
    // is added. See V10-BACKEND.md.
    let pnl = 0;
    if (entryPrice !== null && exitPrice !== null) {
      const details = await detailFetcher(String(instrumentId), orders[0].routeId);
      const lotSize = details ? details.lotSize : null;
      if (!lotSize || lotSize <= 0) { errors++; continue; }
      const dir = entrySide === "buy" ? 1 : -1;
      pnl = Math.round(dir * (exitPrice - entryPrice) * entryQty * lotSize * 100) / 100;
    }
    // else: no prices at all — keep pnl 0 with the app's placeholder
    // prices (per spec); the trade still imports with real dates/qty.
    let stopPrice = null;
    for (const o of entries) {
      if (o.stopLoss !== null && o.stopLoss > 0) { stopPrice = o.stopLoss; break; }
    }
    let rMultiple = null;
    if (stopPrice !== null && entryPrice !== null && exitPrice !== null) {
      const risk = entrySide === "buy"
        ? entryPrice - stopPrice
        : stopPrice - entryPrice;
      if (risk > 0) {
        const gain = entrySide === "buy" ? exitPrice - entryPrice : entryPrice - exitPrice;
        const r = gain / risk;
        if (Number.isFinite(r)) rMultiple = Math.round(r * 10) / 10;
      }
    }
    trades.push({
      external_id: "tradelocker:" + positionId,
      source: "sync",
      symbol: instrument,
      direction: entrySide === "buy" ? "long" : "short",
      pnl,
      notes: null,
      setup: null,
      tag: null,
      r_multiple: rMultiple,
      session: null,
      emotion: null,
      opened_at: new Date(closeMs).toISOString(),
      entry_price: entryPrice !== null ? entryPrice : FALLBACK_PRICE,
      exit_price: exitPrice !== null ? exitPrice : FALLBACK_PRICE,
      stop_price: stopPrice,
      position_size: entryQty > 0 ? entryQty : 1,
      account_id: null,
    });
  }
  return { trades, openPositions, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "POST only");
  const sbUrl = Deno.env.get("SUPABASE_URL");
  const sbService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const sbAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!sbUrl || !sbService || !sbAnon) {
    return fail(500, "Broker sync is not configured.");
  }
  // 1. verify the caller's JWT -> user id (never trust client user_id)
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /i, "");
  if (!token) return fail(401, "Sign in to link an account.");
  const who = await fetch(sbUrl + "/auth/v1/user", {
    headers: { apikey: sbAnon, Authorization: "Bearer " + token },
  });
  if (!who.ok) return fail(401, "Session expired, sign in again.");
  const user = await who.json();
  const uid = user.id;
  if (!uid) return fail(401, "Session expired, sign in again.");
  let body;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request.");
  }
  const action = body.action;
  const connRest = sbUrl + "/rest/v1/broker_connections";
  const svc = {
    apikey: sbService,
    Authorization: "Bearer " + sbService,
    "Content-Type": "application/json",
  };

  // ---------- link ----------
  if (action === "link") {
    if (body.platform !== "tradelocker") {
      return fail(400, "Unsupported platform.");
    }
    const email = typeof body.email === "string" ? body.email.trim() : "";
    let password = typeof body.password === "string" ? body.password : "";
    const server = typeof body.server === "string" ? body.server.trim() : "";
    const env = body.env === "demo" ? "demo" : "live";
    if (!email || !password || !server) {
      password = "";
      return fail(400, "Email, password and server are required.");
    }
    let keyOk = true;
    try { await cryptoKey(); } catch { keyOk = false; }
    if (!keyOk) {
      password = "";
      return fail(500, "Broker sync is not configured.");
    }
    const base = tlBase(env);
    // Exchange the password for tokens ONCE, then drop it.
    const tok = await tl(base, "POST", "/auth/jwt/token", null, {
      body: { email, password, server },
    });
    password = "";
    if (!tok.ok) {
      if (tok.status === 400 || tok.status === 401 || tok.status === 403) {
        return fail(401, "Invalid TradeLocker credentials.");
      }
      return fail(502, "Could not reach TradeLocker. Try again.");
    }
    const accessToken = tok.data && tok.data.accessToken;
    const refreshToken = tok.data && tok.data.refreshToken;
    if (!accessToken || !refreshToken) {
      return fail(502, "Could not reach TradeLocker. Try again.");
    }
    // Which account? The user may hold several on one login.
    const accs = await tl(base, "GET", "/auth/jwt/all-accounts", accessToken);
    if (!accs.ok || !accs.data || !Array.isArray(accs.data.accounts)) {
      return fail(502, "Could not reach TradeLocker. Try again.");
    }
    const accounts = accs.data.accounts;
    if (!accounts.length) {
      return fail(400, "No TradeLocker accounts found on this server.");
    }
    let picked = null;
    if (body.account_id !== undefined && body.account_id !== null && body.account_id !== "") {
      picked = accounts.find((a) => String(a.id) === String(body.account_id)) || null;
      if (!picked) return fail(400, "Account not found on this server.");
    } else if (accounts.length === 1) {
      picked = accounts[0];
    } else {
      // The UI asks the user to pick one, then re-calls link with
      // account_id (and the password again — it is never stored).
      return fail(409, "Choose which account to link.", {
        code: "multiple_accounts",
        accounts: accounts.map((a) => ({
          id: String(a.id),
          name: a.name || ("#" + a.id),
          accNum: a.accNum,
          currency: a.currency || null,
        })),
      });
    }
    const accountLabel = "TradeLocker #" + picked.id + (env === "demo" ? " (Demo)" : "");
    let encrypted;
    try {
      encrypted = await encryptToken(refreshToken);
    } catch {
      return fail(500, "Broker sync is not configured.");
    }
    // Re-linking the same account refreshes its token in place.
    const existing = await fetch(
      connRest + "?user_id=eq." + encodeURIComponent(uid)
        + "&platform=eq.tradelocker"
        + "&broker_account_id=eq." + encodeURIComponent(String(picked.id))
        + "&select=id",
      { headers: svc },
    );
    const existingRows = existing.ok ? await existing.json() : [];
    const row = {
      platform: "tradelocker",
      account_label: accountLabel,
      broker_account_id: String(picked.id),
      acc_num: picked.accNum !== undefined && picked.accNum !== null ? String(picked.accNum) : null,
      env,
      refresh_token_encrypted: encrypted,
      status: "active",
      last_sync_at: null,
    };
    let connId = null;
    if (existingRows.length) {
      connId = existingRows[0].id;
      const upd = await sbRest(sbUrl, sbService, "PATCH",
        "broker_connections?id=eq." + encodeURIComponent(connId)
          + "&user_id=eq." + encodeURIComponent(uid),
        row);
      if (!upd.ok) return fail(500, "Could not save the connection. Try again.");
    } else {
      const ins = await sbRest(sbUrl, sbService, "POST", "broker_connections",
        Object.assign({ user_id: uid }, row),
        { Prefer: "return=representation" });
      const created = await sbJson(ins);
      if (!ins.ok || !created || !created[0]) {
        return fail(500, "Could not save the connection. Try again.");
      }
      connId = created[0].id;
    }
    return json(200, {
      ok: true,
      connection: {
        id: connId,
        platform: "tradelocker",
        account_label: accountLabel,
        status: "active",
        last_sync_at: null,
      },
    });
  }

  // ---------- sync ----------
  if (action === "sync") {
    const connectionId = typeof body.connection_id === "string" ? body.connection_id : "";
    if (!connectionId) return fail(400, "Connection required.");
    const got = await fetch(
      connRest + "?id=eq." + encodeURIComponent(connectionId)
        + "&user_id=eq." + encodeURIComponent(uid)
        + "&select=*",
      { headers: svc },
    );
    const rows = got.ok ? await got.json() : [];
    const conn = rows.length ? rows[0] : null;
    if (!conn) return fail(404, "Connection not found.");
    if (conn.status !== "active") {
      return fail(401, "TradeLocker session expired. Reconnect your account.");
    }
    if (conn.platform !== "tradelocker") {
      return fail(400, "Unsupported platform.");
    }
    // 15-minute guard (same cadence TradeZella allows for manual refresh).
    if (conn.last_sync_at) {
      const elapsed = Date.now() - new Date(conn.last_sync_at).getTime();
      if (elapsed < SYNC_COOLDOWN_MS) {
        return fail(429, "Synced recently. Try again in a few minutes.", {
          code: "too_soon",
          retry_after_seconds: Math.ceil((SYNC_COOLDOWN_MS - elapsed) / 1000),
        });
      }
    }
    const base = tlBase(conn.env || "live");
    let refreshToken;
    try {
      if (!conn.refresh_token_encrypted) throw new Error("no_token");
      refreshToken = await decryptToken(conn.refresh_token_encrypted);
    } catch {
      await sbRest(sbUrl, sbService, "PATCH",
        "broker_connections?id=eq." + encodeURIComponent(conn.id)
          + "&user_id=eq." + encodeURIComponent(uid),
        { status: "error" });
      return fail(401, "TradeLocker session expired. Reconnect your account.");
    }
    // Refresh the access token. TradeLocker rotates the refresh token
    // too — the new one is stored immediately (the old one dies).
    const ref = await tl(base, "POST", "/auth/jwt/refresh", null, {
      body: { refreshToken },
    });
    if (!ref.ok) {
      if (ref.status === 400 || ref.status === 401 || ref.status === 403) {
        await sbRest(sbUrl, sbService, "PATCH",
          "broker_connections?id=eq." + encodeURIComponent(conn.id)
            + "&user_id=eq." + encodeURIComponent(uid),
          { status: "error" });
        return fail(401, "TradeLocker session expired. Reconnect your account.");
      }
      return fail(502, "Could not reach TradeLocker. Try again.");
    }
    const accessToken = ref.data && ref.data.accessToken;
    const newRefresh = ref.data && ref.data.refreshToken;
    if (!accessToken || !newRefresh) {
      return fail(502, "Could not reach TradeLocker. Try again.");
    }
    let newEncrypted;
    try {
      newEncrypted = await encryptToken(newRefresh);
    } catch {
      return fail(500, "Broker sync is not configured.");
    }
    // Re-derive accNum every sync (it can shift if accounts change).
    const accs = await tl(base, "GET", "/auth/jwt/all-accounts", accessToken);
    if (!accs.ok || !accs.data || !Array.isArray(accs.data.accounts)) {
      return fail(502, "Could not reach TradeLocker. Try again.");
    }
    const mine = accs.data.accounts.find((a) => String(a.id) === String(conn.broker_account_id));
    if (!mine) {
      await sbRest(sbUrl, sbService, "PATCH",
        "broker_connections?id=eq." + encodeURIComponent(conn.id)
          + "&user_id=eq." + encodeURIComponent(uid),
        { status: "error" });
      return fail(401, "TradeLocker account not found. Reconnect your account.");
    }
    const accNum = mine.accNum;
    const accountId = String(conn.broker_account_id);
    // Column order for ordersHistory rows: live config first.
    let columns = DEFAULT_HISTORY_COLUMNS;
    const cfg = await tl(base, "GET", "/trade/config", accessToken, { accNum });
    const liveCols = cfg.ok && cfg.data && cfg.data.d
      && cfg.data.d.ordersHistoryConfig && cfg.data.d.ordersHistoryConfig.columns;
    if (Array.isArray(liveCols) && liveCols.length > 10) {
      columns = liveCols.map((c) => c.id).filter(Boolean);
    }
    // Instrument id -> symbol name.
    const ins = await tl(base, "GET", "/trade/accounts/" + accountId + "/instruments",
      accessToken, { accNum });
    if (!ins.ok || !ins.data || !ins.data.d || !Array.isArray(ins.data.d.instruments)) {
      return fail(502, "Could not reach TradeLocker. Try again.");
    }
    const instruments = new Map();
    for (const it of ins.data.d.instruments) {
      if (it.tradableInstrumentId !== undefined && it.name) {
        instruments.set(String(it.tradableInstrumentId), it.name);
      }
    }
    // Instrument details (lotSize), fetched lazily per instrument.
    const detailCache = new Map();
    const detailFetcher = async (instrumentId, routeId) => {
      if (detailCache.has(instrumentId)) return detailCache.get(instrumentId);
      let out = null;
      if (routeId !== null && routeId !== undefined) {
        const d = await tl(base, "GET",
          "/trade/instruments/" + instrumentId + "?routeId=" + encodeURIComponent(String(routeId)),
          accessToken, { accNum });
        if (d.ok && d.data && d.data.d) {
          out = { lotSize: typeof d.data.d.lotSize === "number" ? d.data.d.lotSize : null };
        }
      }
      detailCache.set(instrumentId, out);
      return out;
    };
    const hist = await fetchAllHistory(base, accountId, accNum, accessToken);
    const parsed = parseHistoryRows(hist.rows, columns);
    const built = await buildTrades(parsed, instruments, detailFetcher);
    let errors = built.errors + (hist.truncated ? 1 : 0);
    // Dedup: which external_ids does this user already have?
    const ex = await fetch(
      sbUrl + "/rest/v1/trades?select=external_id&user_id=eq." + encodeURIComponent(uid)
        + "&external_id=not.is.null",
      { headers: svc },
    );
    const exRows = ex.ok ? await ex.json() : [];
    const have = new Set(exRows.map((r) => r.external_id));
    let imported = 0;
    let skipped = 0;
    const fresh = [];
    for (const t of built.trades) {
      if (have.has(t.external_id)) skipped++;
      else fresh.push(Object.assign({ user_id: uid }, t));
    }
    // Insert in batches; a failed batch falls back to one-by-one so a
    // single bad row cannot block the rest. A 409 means the trade
    // appeared between our check and the insert — count it skipped.
    const insertOne = async (row) => {
      const r = await sbRest(sbUrl, sbService, "POST", "trades", row);
      if (r.ok) { imported++; return; }
      if (r.status === 409) { skipped++; return; }
      errors++;
    };
    for (let i = 0; i < fresh.length; i += INSERT_BATCH) {
      const batch = fresh.slice(i, i + INSERT_BATCH);
      const r = await sbRest(sbUrl, sbService, "POST", "trades", batch);
      if (r.ok) {
        imported += batch.length;
      } else if (r.status === 409) {
        for (const row of batch) await insertOne(row);
      } else {
        for (const row of batch) await insertOne(row);
      }
    }
    const nowIso = new Date().toISOString();
    await sbRest(sbUrl, sbService, "PATCH",
      "broker_connections?id=eq." + encodeURIComponent(conn.id)
        + "&user_id=eq." + encodeURIComponent(uid),
      { refresh_token_encrypted: newEncrypted, last_sync_at: nowIso, status: "active",
        acc_num: accNum !== undefined && accNum !== null ? String(accNum) : conn.acc_num });
    return json(200, {
      ok: true,
      imported,
      skipped,
      errors,
      last_sync_at: nowIso,
    });
  }

  // ---------- disconnect ----------
  if (action === "disconnect") {
    const connectionId = typeof body.connection_id === "string" ? body.connection_id : "";
    if (!connectionId) return fail(400, "Connection required.");
    // The token dies with the row. Idempotent: deleting a row that is
    // already gone (or never belonged to this user) still returns ok.
    await sbRest(sbUrl, sbService, "DELETE",
      "broker_connections?id=eq." + encodeURIComponent(connectionId)
        + "&user_id=eq." + encodeURIComponent(uid));
    return json(200, { ok: true });
  }

  return fail(400, "Unknown action.");
});
