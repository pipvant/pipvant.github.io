// globe-snapshot: daily rebuild of the Globe page's live snapshot.
// Supabase Edge Function (Deno, vanilla fetch, no external imports
// except the bundled ISO map). Mirrors broker-sync's auth + response
// style: raw fetch against REST/Auth, Deno.serve, CORS, JSON replies.
//
// What it does (once a day, see the schedule note in v16):
//  1. Reads the 34 real firms from public.firms (name, headquarters,
//     last_verified_at, countries_restricted).
//  2. Lists auth users (Admin API, service role) and keeps only the
//     ACTIVE ones: last_sign_in_at within the last 90 days.
//     ("Active" = connected in the last 90 days — founder decision
//     2026-11-22. Single constant ACTIVE_DAYS below.)
//  3. Reads profiles.country (set by IP auto-detection in the app,
//     with a manual picker override) and accounts.firm (synced from
//     the account form) for those users.
//  4. Counts. COUNTING RULE (founder decision 2026-11-22): a user
//     counts in a country when ACTIVE (signed in within 90 days)
//     AND they have profiles.country set. A firm account is NOT
//     required for the country total — a registered PIPVANT user IS
//     a trader on the map; the firm account only says WHICH firm.
//     Each country entry carries `total` (active users with that
//     country, masked <5 as null) plus `traders` (per-firm counts,
//     masked <5). For a country that deserves it — real traders, a
//     partner firm headquartered there, or one of the world's
//     important countries — `traders` lists EVERY
//     firm that supports the country (from the firms table's
//     allowed/restricted lists), with the real per-firm count where
//     a trader holds an account at that firm and null otherwise —
//     so the country appears on the globe with its supporting
//     firms, and the arcs are live (founder decision 2026-11-23).
//     A user counts once per firm (multiple accounts at the same
//     firm count once) and once per country (their profile country
//     only). A firm that restricts a country contributes 0 there.
//     Counts below the mask (5) are sent as null, never as a number.
//  5. Validates the snapshot, then upserts the single row
//     (key='latest') in public.globe_snapshot.
//
// Privacy: the snapshot contains NO user identity, NO exact location,
// NO account data — only firm aggregates and masked country counts.
// The page must never receive a raw per-user list. A country with
// fewer than 5 traders shows "<5" on the page, never a percentage.
//
// Firms with no resolvable headquarters are OMITTED from the
// snapshot (they cannot be placed on the map); they stay in the
// firms table. Firm type is "Prop firm" for all 34 — no firm in the
// table is verifiably a Broker, so none is labelled one. Platforms
// are [] (the firms table has no platforms); the page hides the
// platforms row when the list is empty. Do NOT invent platforms,
// types, or headquarters.
//
// Deploy: the user deploys this from the Supabase dashboard
// (Edge Functions > Deploy, folder supabase/functions/globe-snapshot).
// Then schedule it daily (Edge Functions > globe-snapshot > Schedule,
// cron "0 5 * * *", 05:00 UTC). No secret is stored in this file.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
// Optional secret GLOBE_REBUILD_SECRET (Edge Function secret): when
// set, the scheduled call must send it as x-globe-secret (or
// Authorization: Bearer <secret>); when unset, any POST rebuilds.
// NEVER log tokens, keys, or user data.

import ISO_NUM from "./iso_num.json" with { type: "json" };

const MASK = 5;
const ACTIVE_DAYS = 90;
const HIDDEN_COUNTRIES = []; // ISO alpha-2 codes to hide, e.g. ["XX"]
const SNAP_KEY = "latest";
const PAGE = 1000;

// The firms table mixes 2-letter codes ("MA") and full country
// names ("Morocco") in countries_restricted / countries_allowed
// (today only "Morocco" appears as a name). Availability checks
// use 2-letter codes, so names are normalised to codes here; the
// snapshot therefore always carries codes. Unknown names are
// dropped (they cannot be matched reliably).
const NAME_TO_CODE = { Morocco: "MA" };
function normCountryList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (/^[A-Z]{2}$/.test(t)) out.push(t);
    else if (NAME_TO_CODE[t]) out.push(NAME_TO_CODE[t]);
  }
  return out;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-globe-secret",
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

// ---------- headquarters lookup (geography, not data) ----------
// firms.headquarters is a free-text string ("USA", "Dubai, UAE",
// "Miami, Florida, USA", "Saint Lucia / Dubai, UAE", ...).
// Take the FIRST location when several are named (the primary HQ),
// then match a city when one is named, else the country's capital.
// Returns {name, lon, lat} or null when nothing resolves.
const HQ_CITIES = [
  ["boca raton", "Boca Raton", -80.09, 26.36],
  ["miami", "Miami", -80.19, 25.76],
  ["dover", "Dover", -75.52, 39.16],
  ["delaware", "Dover", -75.52, 39.16],
  ["limassol", "Limassol", 33.03, 34.67],
  ["port louis", "Port Louis", 57.55, -20.16],
  ["dubai", "Dubai", 55.27, 25.2],
  ["hong kong", "Hong Kong", 114.17, 22.32],
];
const HQ_COUNTRIES = [
  ["saint lucia", "Castries", -60.98, 14.01],
  ["saint vincent", "Kingstown", -61.27, 13.16],
  ["czech", "Prague", 14.42, 50.07],
  ["israel", "Jerusalem", 35.21, 31.77],
  ["singapore", "Singapore", 103.85, 1.35],
  ["australia", "Canberra", 149.13, -35.28],
  ["mauritius", "Port Louis", 57.55, -20.16],
  ["cyprus", "Nicosia", 33.38, 35.19],
  ["united arab emirates", "Abu Dhabi", 54.37, 24.45],
  ["uae", "Abu Dhabi", 54.37, 24.45],
  ["united kingdom", "London", -0.12, 51.5],
  ["uk", "London", -0.12, 51.5],
  ["united states", "Washington, DC", -77.04, 38.9],
  ["usa", "Washington, DC", -77.04, 38.9],
];
function hqLookup(hq) {
  if (!hq || typeof hq !== "string") return null;
  const primary = hq.split("/")[0].trim().toLowerCase();
  if (!primary || primary === "(none)") return null;
  for (const [pat, name, lon, lat] of HQ_CITIES) {
    if (primary.includes(pat)) return { name, lon, lat };
  }
  for (const [pat, name, lon, lat] of HQ_COUNTRIES) {
    if (primary.includes(pat)) return { name, lon, lat };
  }
  return null;
}

// ---------- HQ country (Firms layer "deserving countries") ----------
// Maps a firm's PRIMARY headquarters (first location named, same
// rule as hqLookup) to an ISO alpha-2 country code. A firm is based
// in exactly one country; that country "deserves" a place on the
// Firms layer because a real PIPVANT partner firm is headquartered
// there. Derived from the firms table headquarters strings — no
// invented countries. (Founder decision 2026-11-23: the Firms view
// shows the countries that deserve it, with the firms that support
// them — not just the one country that has traders.)
const HQ_COUNTRY = [
  ["saint lucia", "LC"],
  ["saint vincent", "VC"],
  ["czech", "CZ"],
  ["israel", "IL"],
  ["singapore", "SG"],
  ["australia", "AU"],
  ["mauritius", "MU"],
  ["port louis", "MU"],
  ["cyprus", "CY"],
  ["limassol", "CY"],
  ["hong kong", "HK"],
  ["united arab emirates", "AE"],
  ["uae", "AE"],
  ["dubai", "AE"],
  ["united kingdom", "GB"],
  ["uk", "GB"],
  ["united states", "US"],
  ["usa", "US"],
  ["miami", "US"],
  ["delaware", "US"],
  ["dover", "US"],
  ["boca raton", "US"],
];
function hqCountry(hq) {
  if (!hq || typeof hq !== "string") return null;
  const primary = hq.split("/")[0].trim().toLowerCase();
  if (!primary || primary === "(none)") return null;
  for (const [pat, code] of HQ_COUNTRY) {
    if (primary.includes(pat)) return code;
  }
  return null;
}

function normName(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------- short stable firm ids ----------
// The snapshot's firm `id` is rendered by the Globe page as the arc
// badge letter and the detail-panel `.mono` chip. A UUID (36 chars)
// overflows both. Use a short slug from the firm name instead:
// deterministic (same firm name -> same id on every rebuild) and
// unique (a colliding slug gets -2, -3, ...; firm order is stable
// because the firms query is order=name). The page only ever uses
// the id as a key and as a display initial, so a slug is safe.
const usedShortIds = new Set();
function shortId(name) {
  let base = (name || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "firm";
  let id = base, n = 2;
  while (usedShortIds.has(id)) { id = base + "-" + n; n++; }
  usedShortIds.add(id);
  return id;
}

// ---------- snapshot validation (brief section 6) ----------
function validSnapshot(snap) {
  if (!snap || typeof snap !== "object") return "not an object";
  if (typeof snap.generatedAt !== "number" || snap.generatedAt <= 0) {
    return "bad generatedAt";
  }
  if (snap.mask !== MASK) return "bad mask";
  if (snap.mode !== "live") return "bad mode";
  if (!Array.isArray(snap.firms) || !Array.isArray(snap.countries)) {
    return "firms/countries not arrays";
  }
  if (!snap.traders || typeof snap.traders.total !== "number" ||
      snap.traders.total < 0) return "bad traders.total";
  for (const f of snap.firms) {
    if (!f.id || !f.name || !f.hq) return "firm missing id/name/hq";
    if (typeof f.hq.lon !== "number" || typeof f.hq.lat !== "number") {
      return "firm hq not numeric";
    }
    if (f.hq.lon < -180 || f.hq.lon > 180 || f.hq.lat < -90 ||
        f.hq.lat > 90) return "firm hq out of range";
    if (f.verifiedAt != null &&
        (typeof f.verifiedAt !== "number" || f.verifiedAt <= 0)) {
      return "firm bad verifiedAt";
    }
    if (f.status !== "live" && f.status !== "soon" &&
        f.status !== "paused") return "firm bad status";
  }
  for (const c of snap.countries) {
    if (typeof c.iso !== "string" || !/^\d{3}$/.test(c.iso)) {
      return "country bad iso";
    }
    if (!c.traders || typeof c.traders !== "object") {
      return "country bad traders";
    }
    for (const k of Object.keys(c.traders)) {
      const v = c.traders[k];
      if (v !== null &&
          (!Number.isInteger(v) || v < 0)) return "country bad count";
    }
    // Country total: the active-user count for this country
    // (masked <5 as null). Must be null or a non-negative integer.
    if (c.total !== null && c.total !== undefined &&
        (!Number.isInteger(c.total) || c.total < 0)) {
      return "country bad total";
    }
  }
  return null;
}

// ---------- REST helpers (service role) ----------
async function restGet(base, headers, path) {
  const out = [];
  let offset = 0;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const url = base + path + sep + "limit=" + PAGE + "&offset=" + offset;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      throw new Error("rest " + r.status + " " + path.split("?")[0]);
    }
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") return fail(405, "POST only");

  // Optional trigger secret (see header). When set, the caller must
  // send it; when unset, any POST rebuilds (rebuilds are idempotent
  // and publish only public aggregates).
  const secret = Deno.env.get("GLOBE_REBUILD_SECRET");
  if (secret) {
    const got = req.headers.get("x-globe-secret") ||
      (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (got !== secret) return fail(401, "bad secret");
  }

  const sbUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sbUrl || !svcKey) {
    return fail(500, "Globe snapshot is not configured.");
  }
  const restBase = sbUrl.replace(/\/$/, "") + "/rest/v1";
  const svc = {};
  svc["apikey"] = svcKey;
  svc["Authorization"] = "Bearer " + svcKey;
  svc["Content-Type"] = "application/json";
  const started = Date.now();

  try {
    // 1. Firms (public table, read via service role for consistency).
    // countries_allowed is read too: it drives "supported" (a firm
    // with a non-empty allowed list ONLY supports those countries).
    const firms = await restGet(
      restBase, svc,
      "/firms?select=id,name,website,headquarters,last_verified_at,countries_restricted,countries_allowed&order=name",
    );

    // 2. Active users via the Auth Admin API (paginated).
    const cutoff = started - ACTIVE_DAYS * 864e5;
    const activeIds = new Set();
    let page = 1;
    for (;;) {
      const r = await fetch(
        sbUrl.replace(/\/$/, "") +
          "/auth/v1/admin/users?page=" + page + "&per_page=" + PAGE,
        { headers: svc },
      );
      if (!r.ok) throw new Error("admin users " + r.status);
      const body = await r.json();
      const users = Array.isArray(body) ? body : body.users || [];
      if (!users.length) break;
      for (const u of users) {
        const last = u.last_sign_in_at ? Date.parse(u.last_sign_in_at) : NaN;
        if (!Number.isNaN(last) && last >= cutoff) activeIds.add(u.id);
      }
      if (users.length < PAGE) break;
      page++;
    }

    // 3. Profiles: country per user (only rows with a country set).
    const profiles = await restGet(
      restBase, svc,
      "/profiles?select=user_id,country&country=not.is.null",
    );
    const countryByUser = new Map();
    for (const p of profiles) {
      if (p.user_id && typeof p.country === "string" &&
          /^[A-Z]{2}$/.test(p.country)) {
        countryByUser.set(p.user_id, p.country);
      }
    }

    // 4. Accounts: firm per user (only rows with a firm set).
    const accounts = await restGet(
      restBase, svc,
      "/accounts?select=user_id,firm&firm=not.is.null",
    );
    const firmsByUser = new Map(); // user_id -> Set(normalized firm name)
    for (const a of accounts) {
      if (!a.user_id || !a.firm) continue;
      const n = normName(a.firm);
      if (!n) continue;
      if (!firmsByUser.has(a.user_id)) firmsByUser.set(a.user_id, new Set());
      firmsByUser.get(a.user_id).add(n);
    }

    // 5. Firm lookup by normalized name + HQ resolution.
    const firmByName = new Map();
    const snapFirms = [];
    const skippedNoHq = [];
    for (const f of firms) {
      const hq = hqLookup(f.headquarters);
      if (!hq) {
        skippedNoHq.push(f.name);
        continue; // cannot be placed on the map; stays in firms table
      }
      const verifiedAt = f.last_verified_at
        ? Date.parse(f.last_verified_at)
        : null;
      const entry = {
        id: shortId(f.name),
        name: f.name,
        type: "Prop firm",
        status: "live",
        platforms: [],
        hq: { name: hq.name, lon: hq.lon, lat: hq.lat },
        connectUrl: f.website || "",
      };
      if (verifiedAt && !Number.isNaN(verifiedAt)) {
        entry.verifiedAt = verifiedAt;
      }
      // Availability (drives "supported countries" colouring and the
      // country panel's firm list on the globe page). Only sent when
      // non-empty; the page treats a missing list as unrestricted.
      // allowed (non-empty) = ONLY those countries; restricted =
      // everywhere except those.
      if (Array.isArray(f.countries_restricted) &&
          f.countries_restricted.length) {
        const nr = normCountryList(f.countries_restricted);
        if (nr.length) entry.restricted = nr;
      }
      if (Array.isArray(f.countries_allowed) &&
          f.countries_allowed.length) {
        const na = normCountryList(f.countries_allowed);
        if (na.length) entry.allowed = na;
      }
      snapFirms.push(entry);
      firmByName.set(normName(f.name), entry);
    }

    // 6. Aggregate.
    // COUNTING RULE (founder decision 2026-11-22): a user counts in a
    // country when they are ACTIVE (signed in within 90 days) AND
    // they have profiles.country set. A firm account is NOT required
    // for the country total — a registered PIPVANT user IS a trader
    // on the map; the firm account only says WHICH firm, not WHETHER
    // they are a user. The per-firm breakdown ("Traders by firm")
    // still requires a firm account.
    // countryUsers[isoNumeric] = active users with that country.
    // counts[isoNumeric][firmId] = active users with that country
    //   AND an account at that firm.
    const counts = new Map();
    const countryUsers = new Map();
    let usersCounted = 0;
    for (const uid of activeIds) {
      const a2 = countryByUser.get(uid);
      if (!a2) continue; // no country: not on the map
      const num = ISO_NUM[a2];
      if (!num) continue;
      if (HIDDEN_COUNTRIES.includes(a2)) continue;
      countryUsers.set(num, (countryUsers.get(num) || 0) + 1);
      usersCounted++;
      const userFirms = firmsByUser.get(uid);
      if (!userFirms || userFirms.size === 0) continue;
      for (const fname of userFirms) {
        const firm = firmByName.get(fname);
        if (!firm) continue; // firm name not in the firms table
        if (!counts.has(num)) counts.set(num, new Map());
        const byFirm = counts.get(num);
        byFirm.set(firm.id, (byFirm.get(firm.id) || 0) + 1);
      }
    }

    // Availability maps (for firm support + counting), keyed by the
    // SHORT snapshot id (not the firms-table UUID — firmSupports is
    // called with the slug id from the per-firm counts, so the keys
    // must match). The entries already carry normalized lists.
    // allowed (non-empty) = ONLY those countries; restricted =
    // everywhere except those; neither = everywhere.
    const restrictedByFirm = new Map();
    const allowedByFirm = new Map();
    for (const e of snapFirms) {
      if (Array.isArray(e.restricted) && e.restricted.length) {
        restrictedByFirm.set(e.id, new Set(e.restricted));
      }
      if (Array.isArray(e.allowed) && e.allowed.length) {
        allowedByFirm.set(e.id, new Set(e.allowed));
      }
    }
    function firmSupports(firmId, a2) {
      const allowed = allowedByFirm.get(firmId);
      if (allowed) return allowed.has(a2);
      const restricted = restrictedByFirm.get(firmId);
      if (restricted) return !restricted.has(a2);
      return true;
    }
    const snapCountries = [];
    let total = 0;
    // Reverse map (numeric -> alpha-2) for the restriction check.
    const NUM_TO_A2 = {};
    for (const [k, v] of Object.entries(ISO_NUM)) NUM_TO_A2[v] = k;
    // "Deserving countries" (founder decision 2026-11-23): the Firms
    // view shows the countries that deserve it — (a) countries with
    // real traders, (b) countries where a real partner firm is
    // headquartered, and (c) the world's important countries
    // (major economies, financial centres, large trading nations),
    // so a user from any major country finds theirs instead of
    // feeling left out. The Traders view is driven by real traders
    // only (a country with no traders has tot 0, so it stays dark
    // green there), while the Firms view colours every country in
    // DATA blue by its firm count. 24 of 34 firms support everywhere
    // (no allowed/restricted list), so "every supported country"
    // would be all ~249 countries — a solid blue globe, not
    // organised. The important-countries set below is the organised,
    // honest set: every one is a real major country and every firm
    // listed for it really supports it.
    const IMPORTANT_COUNTRIES = [
      "US", "CA", "MX", // North America
      "BR", "AR", "CL", "CO", "PE", // South America
      "GB", "DE", "FR", "ES", "IT", "NL", "CH", "SE", "NO", "DK",
      "BE", "AT", "IE", "PT", "PL", "CZ", "HU", "RO", "GR", "CY", // Europe
      "TR", "RU", "UA", // Turkey / Russia / Ukraine
      "AE", "SA", "QA", "KW", "IL", "JO", // Middle East
      "EG", "MA", "DZ", "TN", "ZA", "NG", "KE", "GH", // Africa
      "IN", "PK", "BD", "LK", // South Asia
      "CN", "JP", "KR", "TW", "HK", // East Asia
      "SG", "MY", "TH", "VN", "ID", "PH", // Southeast Asia
      "AU", "NZ", // Oceania
      "LC", "VC", "MU", // Small HQ countries (firm headquarters)
    ];
    const hqIso = new Set();
    for (const f of firms) {
      const code = hqCountry(f.headquarters);
      if (code && ISO_NUM[code]) hqIso.add(ISO_NUM[code]);
    }
    const importantIso = new Set();
    for (const code of IMPORTANT_COUNTRIES) {
      if (ISO_NUM[code]) importantIso.add(ISO_NUM[code]);
    }
    // Union of countries: those with users (countryUsers), those
    // with firm counts, HQ countries, and important countries. A
    // country appears when it has >=1 user, even with no firm
    // account (its per-firm breakdown is then empty), or when a
    // firm is HQ'd there, or when it is an important country.
    const allIso = new Set([
      ...countryUsers.keys(), ...counts.keys(), ...hqIso, ...importantIso,
    ]);
    for (const iso of [...allIso].sort()) {
      const a2 = NUM_TO_A2[iso] || null;
      const userTotal = countryUsers.get(iso) || 0;
      const traders = {};
      const byFirm = counts.get(iso);
      if (byFirm) {
        for (const [firmId, n] of byFirm) {
          if (a2 && !firmSupports(firmId, a2)) continue;
          traders[firmId] = n < MASK ? null : n;
        }
      }
      // Supporting firms (founder decision 2026-11-23): for a
      // country that deserves it — real traders, or a firm HQ —
      // list EVERY firm that supports the country (firms table
      // allowed/restricted), not just the firms the traders hold
      // accounts at. The per-firm count stays the real count
      // (masked <5 -> null); a supporting firm with no traders
      // here gets null, shown as "<5" — honest, the real count is
      // under 5. This is what makes the country appear on the
      // globe with its supporting firms, and what makes the arcs
      // live: selecting the country draws arcs to its supporting
      // firms' HQs; focusing a firm draws arcs to every country
      // in DATA that lists it. Countries with no traders and no
      // firm HQ never reach this loop, so they stay absent (0) —
      // no "<5" is invented for them.
      if (a2 && (userTotal > 0 || hqIso.has(iso) || importantIso.has(iso))) {
        for (const f of snapFirms) {
          if (f.status === "paused") continue;
          if (Object.prototype.hasOwnProperty.call(traders, f.id)) continue;
          if (!firmSupports(f.id, a2)) continue;
          traders[f.id] = null;
        }
      }
      if (userTotal <= 0 && Object.keys(traders).length === 0) continue;
      // Country total (masked <5). The global total sums the real
      // per-country user counts (an aggregate, not a per-country
      // figure, so it is not masked).
      const entry = { iso, traders };
      entry.total = userTotal < MASK ? null : userTotal;
      total += userTotal;
      snapCountries.push(entry);
    }

    const snap = {
      generatedAt: started,
      mask: MASK,
      mode: "live",
      hidden_countries: HIDDEN_COUNTRIES,
      firms: snapFirms,
      countries: snapCountries,
      traders: { total },
    };

    const bad = validSnapshot(snap);
    if (bad) {
      console.warn("globe-snapshot: invalid snapshot, not writing:", bad);
      return fail(500, "invalid snapshot: " + bad);
    }

    // 7. Upsert the single snapshot row.
    const up = await fetch(
      restBase + "/globe_snapshot?on_conflict=key",
      {
        method: "POST",
        headers: { ...svc, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          key: SNAP_KEY,
          snapshot: snap,
          mode: "live",
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!up.ok) {
      const t = await up.text().catch(() => "");
      throw new Error("upsert " + up.status + " " + t.slice(0, 200));
    }

    return json(200, {
      ok: true,
      generatedAt: started,
      firms: snapFirms.length,
      countries: snapCountries.length,
      tradersTotal: total,
      usersCounted,
      activeUsers: activeIds.size,
      skippedNoHq,
      ms: Date.now() - started,
    });
  } catch (e) {
    console.warn("globe-snapshot failed:", e && e.message ? e.message : e);
    return fail(500, "rebuild failed");
  }
});
