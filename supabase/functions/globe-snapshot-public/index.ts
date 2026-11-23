// globe-snapshot-public: public read-only GET for the Globe page's live snapshot.
// Supabase Edge Function (Deno, vanilla fetch, no external imports).
//
// The Globe page (pipvant-globe.html) fetches its snapshot with a plain
// GET and no auth headers (see window.PV_CONFIG.snapshotUrl in the
// page's <script id="pv-data"> block). This function serves exactly
// that: it reads the single snapshot row (key='latest') from
// public.globe_snapshot and returns the RAW snapshot JSON object
// (mode, generatedAt, mask, firms[], countries[], traders,
// hidden_countries) — not array-wrapped, so the page's validSnapshot
// accepts it and globe_guard.py prints OK.
//
// Deploy with JWT verification OFF for this function only
// (Supabase dashboard: Edge Functions > globe-snapshot-public >
// Settings, or `supabase functions deploy globe-snapshot-public
// --no-verify-jwt`). The rebuild function (globe-snapshot, POST-only,
// service role) stays protected; this one only ever returns the
// already-public aggregate snapshot — no user identity, no exact
// location, no account data. Counts under the mask are null.
//
// The snapshot itself is rebuilt daily by globe-snapshot (cron
// 0 5 * * *, 05:00 UTC) and on demand. This function never writes.
// If the row is missing or malformed it answers 503 (the page then
// falls back to its cached snapshot, or to the embedded demo data).
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
// NEVER log tokens, keys, or user data.

const SNAP_KEY = "latest";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "GET") {
    return json(405, { ok: false, error: "GET only" });
  }

  const sbUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sbUrl || !svcKey) {
    return json(503, { ok: false, error: "snapshot not configured" });
  }

  try {
    const r = await fetch(
      sbUrl.replace(/\/$/, "") +
        "/rest/v1/globe_snapshot?select=snapshot&key=eq." + SNAP_KEY,
      {
        headers: {
          apikey: svcKey,
          Authorization: "Bearer " + svcKey,
          "Content-Type": "application/json",
        },
      },
    );
    if (!r.ok) {
      return json(503, { ok: false, error: "snapshot read failed" });
    }
    const rows = await r.json();
    const snap = Array.isArray(rows) && rows.length ? rows[0].snapshot : null;
    if (!snap || typeof snap !== "object" ||
        !Array.isArray(snap.firms) || !Array.isArray(snap.countries)) {
      return json(503, { ok: false, error: "snapshot not available" });
    }
    // Return the raw snapshot object (the exact shape the page and
    // globe_guard.py expect). Extra fields the rebuild stores
    // (total, traders, hidden_countries, restricted/allowed) are
    // kept: the page ignores what it does not use.
    return json(200, snap);
  } catch (e) {
    console.warn(
      "globe-snapshot-public failed:",
      e && e.message ? e.message : e,
    );
    return json(503, { ok: false, error: "snapshot read failed" });
  }
});
