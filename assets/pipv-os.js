/* PIPVANT Company OS — privacy-friendly analytics + newsletter.
   No cookies, no fingerprinting. Only page + referrer + an anonymous random
   visitor ID (localStorage, per-browser, no personal data) are logged.
   The anon key below is public by design (same as the main app). */
(function () {
  'use strict';
  var SB_URL = 'https://acpkzavmifjwnskiaret.supabase.co/rest/v1';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjcGt6YXZtaWZqd25za2lhcmV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMDk1ODcsImV4cCI6MjEwNjc4NTU4N30.9-k-DoB6467EXTPKrvWUi-LRDPbSSC30f6BgrZezo2A';

  function post(table, row, onConflict) {
    try {
      var url = SB_URL + '/' + table + (onConflict ? '?on_conflict=' + onConflict : '');
      var headers = {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal' + (onConflict ? ',resolution=merge-duplicates' : '')
      };
      var p = fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(row), keepalive: true });
      return p;
    } catch (e) { return Promise.reject(e); }
  }

  /* ---- page view (once per load) ---- */
  /* Founder exclusion: the founder's own visits must NEVER pollute analytics.
     1) If a Supabase session for one of the founder's emails is stored, skip.
     2) Manual opt-out: opening any page with ?notrack=1 sets a permanent
        localStorage flag on that browser (for logged-out visits). */
  /* AUD-m44: founder accounts are identified only by SHA-256 hashes of
     their (lower-cased) emails — no founder address is in this source.
     The plus-variant is matched by hashing the part up to and including
     the first '+' (the original prefix check, in hash form). */
  var FOUNDER_HASHES = [
    'f068e4f233d1815fd039d1530e6ebfdf3826752b4b0205dc06e3008fa3d2dc1a',
    '5c043d398d080ff8c57d25e488e45bc4736449d3f9665f87b14a131a24d9420f'
  ];
  var FOUNDER_PLUS_HASH = '5744ef4b99aa9a64360678b329bb2f2a1b9f3a35d33fb95f10c0b9d39f40dec5';
  function sha256Hex(str) {
    if (!window.crypto || !crypto.subtle || !crypto.subtle.digest) {
      return Promise.reject(new Error('crypto unavailable'));
    }
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }
  function isFounderSession() {
    try {
      var raw = localStorage.getItem('sb-acpkzavmifjwnskiaret-auth-token');
      if (!raw) return Promise.resolve(false);
      var sess = JSON.parse(raw);
      var email = String((sess && sess.user && sess.user.email) || '').toLowerCase();
      if (!email) return Promise.resolve(false);
      return sha256Hex(email).then(function (h) {
        if (FOUNDER_HASHES.indexOf(h) >= 0) return true;
        var plusIdx = email.indexOf('+');
        if (plusIdx < 0) return false;
        return sha256Hex(email.slice(0, plusIdx + 1)).then(function (ph) {
          return ph === FOUNDER_PLUS_HASH;
        });
      }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  try {
    if (/(?:\?|&)notrack=1(?:&|$)/.test(location.search)) {
      try { localStorage.setItem('pipv_dnt', '1'); } catch (e) {}
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    }
  } catch (e) {}
  function isDnt() {
    try { return localStorage.getItem('pipv_dnt') === '1'; } catch (e) { return false; }
  }
  /* Anonymous visitor ID: one random ID per browser, so the dashboard can
     count UNIQUE visitors (one person = 1) instead of raw page views. */
  function getVisitorId() {
    try {
      var v = localStorage.getItem('pipv_vid');
      if (!v) {
        v = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
        try { localStorage.setItem('pipv_vid', v); } catch (e) {}
      }
      return v;
    } catch (e) { return null; }
  }
  try {
    if (!window.__pipvTracked) {
      window.__pipvTracked = true;
      if (!isDnt()) {
        isFounderSession().then(function (founder) {
          if (founder) return;
          var row = { page: location.pathname, referrer: document.referrer || null };
          var vid = getVisitorId();
          if (vid) row.visitor_id = vid;
          post('page_views', row)
            .catch(function () { /* silent: analytics never breaks the app */ });
        }).catch(function () { /* silent: analytics never breaks the app */ });
      }
    }
  } catch (e) {}

  /* ---- newsletter ---- */
  function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()); }

  window.pipvSubscribe = function (email) {
    email = String(email || '').trim().toLowerCase();
    if (!validEmail(email)) return Promise.reject(new Error('invalid'));
    /* Plain insert (2026-10-23 audit fix): the upsert variant required an
       UPDATE policy for anon and every subscribe failed RLS (42501). A
       duplicate email now returns 409, which pipvSubscribe maps to 'ok'. */
    return post('newsletter_subs', { email: email })
      .then(function (r) {
        if (r && (r.ok || r.status === 409)) return 'ok';
        throw new Error('error');
      });
  };

  /* ---- auto-wire any form with [data-pipv-newsletter] ---- */
  function wire() {
    var forms = document.querySelectorAll('form[data-pipv-newsletter]');
    forms.forEach(function (form) {
      if (form.__pipvWired) return;
      form.__pipvWired = true;
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var input = form.querySelector('input[type=email]');
        var msg = form.querySelector('[data-pipv-msg]');
        var email = input ? input.value : '';
        function say(t, ok) {
          if (msg) { msg.textContent = t; msg.style.color = ok ? '#7EE2A8' : '#E28A7E'; }
        }
        window.pipvSubscribe(email).then(
          function () { say('You are in. Welcome aboard.', true); if (input) input.value = ''; },
          function (e) { say(e && e.message === 'invalid' ? 'Please enter a valid email.' : 'Something went wrong — try again.', false); }
        );
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
