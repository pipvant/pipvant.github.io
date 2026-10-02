/* ============================================================
   PIPVANT — Client-side error tracking (v2 Week 1)
   Logs JS errors to Supabase for proactive fixes.
   Table: public.error_logs (created by migration)
   - Batches errors, sends every 30s or on pagehide
   - Max 10 errors per session to avoid spam
   - No PII: URL path only (no query strings), no user input
   ============================================================ */
(function () {
  'use strict';
  var QUEUE = [];
  var SENT = 0;
  var MAX_PER_SESSION = 10;
  var FLUSH_INTERVAL = 30000;

  function safePath() {
    try { return location.pathname.slice(0, 200); } catch (e) { return '/'; }
  }

  function enqueue(type, message, stack) {
    if (SENT >= MAX_PER_SESSION) return;
    QUEUE.push({
      type: String(type).slice(0, 50),
      message: String(message || '').slice(0, 500),
      stack: String(stack || '').slice(0, 2000),
      page: safePath(),
      user_agent: String(navigator.userAgent || '').slice(0, 300),
      user_id: (window.PV && window.PV.user) ? window.PV.user.id : null
    });
    if (QUEUE.length >= 5) flush();
  }

  function flush() {
    if (!QUEUE.length || SENT >= MAX_PER_SESSION) return;
    if (!window.PV || !window.PV.from) return;
    var batch = QUEUE.splice(0, QUEUE.length);
    SENT += batch.length;
    try {
      window.PV.from('error_logs').insert(batch).then(function () {}, function () {});
    } catch (e) { /* silent */ }
  }

  window.addEventListener('error', function (ev) {
    enqueue('js_error', ev.message, ev.error && ev.error.stack);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var reason = ev.reason;
    enqueue('promise_rejection',
      reason && reason.message ? reason.message : String(reason),
      reason && reason.stack);
  });
  setInterval(flush, FLUSH_INTERVAL);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });

  window.PVErrorTrack = { flush: flush, queue: QUEUE };
})();
