/* PIPVANT Company OS — privacy-friendly analytics + newsletter.
   No cookies, no fingerprinting. Only page + referrer are logged.
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
  try {
    if (!window.__pipvTracked) {
      window.__pipvTracked = true;
      post('page_views', { page: location.pathname, referrer: document.referrer || null })
        .catch(function () { /* silent: analytics never breaks the app */ });
    }
  } catch (e) {}

  /* ---- newsletter ---- */
  function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()); }

  window.pipvSubscribe = function (email) {
    email = String(email || '').trim().toLowerCase();
    if (!validEmail(email)) return Promise.reject(new Error('invalid'));
    return post('newsletter_subs', { email: email }, 'email')
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
