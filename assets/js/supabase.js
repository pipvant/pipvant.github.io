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
     PV.plan        — 'free' | 'pro' (loaded from public.profiles after auth)
     PV.isPro()     — true when plan === 'pro'
     PV.requirePro(containerEl, featureName) — renders a locked-state card
     PV.upgradeModal(reason) — friendly "Free limit reached" modal
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
    plan: 'free',
    _cbs: []
  };

  /* ---------- plan plumbing (Pro gates) ---------- */
  function loadPlan() {
    if (!PV.user || !PV.ok) { PV.plan = 'free'; return Promise.resolve('free'); }
    try {
      return PV.from('profiles').select('plan').eq('id', PV.user.id).maybeSingle()
        .then(function (res) {
          PV.plan = (res && res.data && res.data.plan) || 'free';
          return PV.plan;
        })
        .catch(function () { PV.plan = 'free'; return 'free'; });
    } catch (e) { PV.plan = 'free'; return Promise.resolve('free'); }
  }
  PV.isPro = function () { return PV.plan === 'pro'; };

  function proLink() {
    // pricing.html from any depth: root pages vs tools|legal subfolders
    try {
      return location.pathname.split('/').filter(Boolean).length > 1 ? '../pricing.html' : 'pricing.html';
    } catch (e) { return 'pricing.html'; }
  }
  PV.requirePro = function (container, featureName) {
    if (!container) return;
    var name = featureName || 'This feature';
    container.innerHTML =
      '<div class="pro-lock">' +
        '<div class="pro-lock-badge">PRO</div>' +
        '<h3>' + name + ' is a Pro feature</h3>' +
        '<p class="micro">PIPVANT Pro is coming soon — join the waitlist and we will write once, the day it launches.</p>' +
        '<a class="btn btn-silver btn-sm" href="' + proLink() + '">See Pro plans</a>' +
      '</div>';
  };
  PV.upgradeModal = function (reason) {
    var old = document.getElementById('pv-upgrade-modal');
    if (old) old.remove();
    var m = document.createElement('div');
    m.className = 'modal show';
    m.id = 'pv-upgrade-modal';
    m.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true">' +
        '<h2>You have hit a Free limit</h2>' +
        '<p style="margin-top:10px;color:var(--ink-2)">' + reason + '</p>' +
        '<p class="micro" style="margin-top:12px">PIPVANT Pro removes the limits and adds Pro Analytics, PDF reports and more. It is coming soon — join the waitlist to hear first.</p>' +
        '<div style="display:flex;gap:10px;margin-top:22px;justify-content:flex-end;flex-wrap:wrap">' +
          '<button class="btn btn-ghost btn-sm" id="pv-up-close">Not now</button>' +
          '<a class="btn btn-silver btn-sm" href="' + proLink() + '">See Pro plans</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    var c = document.getElementById('pv-up-close');
    if (c) c.addEventListener('click', function () { m.remove(); });
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
      return loadPlan().then(function () { PV.paintNav(); return PV.user; });
    }).catch(function () { PV.user = null; PV.plan = 'free'; PV.paintNav(); return null; });

    PV.client.auth.onAuthStateChange(function (_evt, session) {
      PV.user = session ? session.user : null;
      loadPlan().then(function () {
        PV.paintNav();
        PV._cbs.forEach(function (cb) { try { cb(PV.user, _evt); } catch (e) {} });
      });
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
