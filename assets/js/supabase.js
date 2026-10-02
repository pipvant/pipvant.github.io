/* ============================================================
   PIPVANT — Supabase client + auth helpers
   ------------------------------------------------------------
   Exposes window.PV:
     PV.ok        — true when the cloud client is usable
     PV.user      — current user object or null
     PV.ready     — Promise resolving to the user once known
     PV.signUp / PV.signIn / PV.signOut
     PV.onAuth(cb)
     PV.from(table)   — supabase query builder
     PV.storage()     — storage client
     PV.friendly(err) — human-readable error message
     PV.paintNav()    — toggles [data-auth] nav items
   Degrades gracefully when the CDN or network is unavailable:
   every page keeps working in local/offline mode.
   ============================================================ */
(function () {
  'use strict';
  var cfg = window.PV_CONFIG || {};

  var PV = window.PV = {
    ok: false,
    client: null,
    user: null,
    ready: null,
    _cbs: []
  };

  PV.friendly = function (err) {
    if (!err) return 'Something went wrong.';
    var m = String(err.message || err).toLowerCase();
    if (!navigator.onLine || m.indexOf('failed to fetch') >= 0 || m.indexOf('networkerror') >= 0 || m.indexOf('network request failed') >= 0)
      return 'Network error — check your connection and try again.';
    if (err.code === '23505') return 'duplicate';
    if (err.status === 401 || err.status === 403 || m.indexOf('row-level security') >= 0 || m.indexOf('violates row-level') >= 0)
      return 'Please sign in to do that.';
    if (m.indexOf('invalid login credentials') >= 0) return 'Incorrect email or password.';
    if (m.indexOf('user already registered') >= 0 || m.indexOf('already exists') >= 0)
      return 'This email is already registered — try logging in instead.';
    if (m.indexOf('email not confirmed') >= 0) return 'Please confirm your email first — check your inbox for the link.';
    if (m.indexOf('password') >= 0 && m.indexOf('characters') >= 0) return 'Password must be at least 6 characters.';
    if (m.indexOf('valid email') >= 0) return 'Please enter a valid email address.';
    return err.message || 'Something went wrong.';
  };

  PV.paintNav = function () {
    var authed = !!PV.user;
    document.querySelectorAll('[data-auth]').forEach(function (el) {
      var need = el.getAttribute('data-auth'); // 'in' or 'out'
      el.hidden = (need === 'in') ? !authed : authed;
    });
  };
  PV.onAuth = function (cb) { PV._cbs.push(cb); };

  if (window.supabase && window.supabase.createClient && cfg.url && cfg.anonKey) {
    try {
      PV.client = window.supabase.createClient(cfg.url, cfg.anonKey);
      PV.ok = true;
    } catch (e) { PV.ok = false; }
  }

  if (PV.ok) {
    PV.ready = PV.client.auth.getSession().then(function (res) {
      PV.user = (res.data && res.data.session) ? res.data.session.user : null;
      PV.paintNav();
      return PV.user;
    }).catch(function () { PV.user = null; PV.paintNav(); return null; });

    PV.client.auth.onAuthStateChange(function (_evt, session) {
      PV.user = session ? session.user : null;
      PV.paintNav();
      PV._cbs.forEach(function (cb) { try { cb(PV.user); } catch (e) {} });
    });

    PV.signUp = function (email, pw) { return PV.client.auth.signUp({ email: email, password: pw }); };
    PV.signIn = function (email, pw) { return PV.client.auth.signInWithPassword({ email: email, password: pw }); };
    PV.signOut = function () { return PV.client.auth.signOut(); };
    PV.from = function (t) { return PV.client.from(t); };
    PV.storage = function () { return PV.client.storage; };
  } else {
    // Offline / CDN-blocked: every page falls back to local mode.
    PV.ready = Promise.resolve(null);
    var offlineErr = { message: 'Cloud unavailable — check your connection.' };
    var off = function () { return Promise.resolve({ data: null, error: offlineErr }); };
    PV.signUp = PV.signIn = PV.signOut = off;
    PV.from = function () { throw offlineErr; };
    PV.storage = function () { throw offlineErr; };
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-logout]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        PV.signOut().then(function () { location.reload(); });
      });
    });
    // ?next= deep-link: stash for the login page to use after sign-in.
    try {
      var next = new URLSearchParams(location.search).get('next');
      if (next && next.charAt(0) !== '/' && next.indexOf('://') < 0) sessionStorage.setItem('pv_next', next);
    } catch (e) {}
  });
})();
