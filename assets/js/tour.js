/* ============================================================
   PIPVANT — Onboarding Tour (v2 Week 2)
   Interactive guide for new users. Shows once per browser
   (localStorage flag). Elegant, minimal, skippable.
   Usage: PVTour.start() or auto-starts for new signups.
   ============================================================ */
(function () {
  'use strict';

  var STEPS = [
    {
      title: 'Welcome to PIPVANT',
      body: 'Your professional trading toolkit. Let\'s take a 30-second tour.',
      cta: 'Start tour'
    },
    {
      title: 'Prop Firm Matcher',
      body: 'Compare 10 leading prop firms across 33 programs side by side. Find the challenge that fits your style.',
      link: 'tools/matcher.html',
      cta: 'Next'
    },
    {
      title: 'Trading Journal',
      body: 'Log every trade with institutional-grade analytics. Your edge lives in your data.',
      link: 'tools/journal.html',
      cta: 'Next'
    },
    {
      title: 'Risk Calculator',
      body: 'Size every position with precision. Never risk more than your plan allows.',
      link: 'tools/risk-calculator.html',
      cta: 'Next'
    },
    {
      title: 'Earn Certificates',
      body: 'Hit milestones and earn verifiable certificates. Share your progress.',
      link: 'certificates.html',
      cta: 'Finish'
    }
  ];

  var KEY = 'pv_tour_done_v2';
  var idx = 0;
  var overlay = null;

  function isDone() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return true; }
  }
  function markDone() {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
  }

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render() {
    if (!overlay) return;
    var s = STEPS[idx];
    var dots = STEPS.map(function (_, i) {
      return '<span class="pv-tour-dot' + (i === idx ? ' active' : '') + '"></span>';
    }).join('');

    overlay.querySelector('.pv-tour-card').innerHTML =
      '<div class="pv-tour-dots">' + dots + '</div>' +
      '<h2>' + esc(s.title) + '</h2>' +
      '<p>' + esc(s.body) + '</p>' +
      '<div class="pv-tour-actions">' +
        (s.link ? '<a class="pv-tour-link" href="' + esc(s.link) + '">Try it &rarr;</a>' : '') +
        '<div style="flex:1"></div>' +
        '<button class="pv-tour-skip" type="button">Skip</button>' +
        '<button class="pv-tour-next" type="button">' + esc(s.cta) + '</button>' +
      '</div>';

    overlay.querySelector('.pv-tour-next').addEventListener('click', next);
    overlay.querySelector('.pv-tour-skip').addEventListener('click', close);
  }

  function next() {
    idx++;
    if (idx >= STEPS.length) { close(); return; }
    render();
  }

  function close() {
    markDone();
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    idx = 0;
  }

  function start(force) {
    if (!force && isDone()) return;
    if (overlay) return;
    idx = 0;

    var css = document.createElement('style');
    css.textContent = [
      '.pv-tour-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(5,8,20,.72);backdrop-filter:blur(6px);padding:20px}',
      '.pv-tour-card{max-width:420px;width:100%;background:linear-gradient(160deg,#0d1330,#070b1e);border:1px solid rgba(205,213,228,.16);border-radius:20px;padding:32px;color:#fff;box-shadow:0 24px 80px rgba(0,0,0,.5)}',
      '.pv-tour-card h2{margin:14px 0 10px;font-size:1.4rem}',
      '.pv-tour-card p{color:rgba(205,213,228,.78);line-height:1.6;margin:0 0 20px}',
      '.pv-tour-dots{display:flex;gap:6px}',
      '.pv-tour-dot{width:24px;height:4px;border-radius:2px;background:rgba(205,213,228,.2)}',
      '.pv-tour-dot.active{background:#cdd5e4}',
      '.pv-tour-actions{display:flex;align-items:center;gap:12px}',
      '.pv-tour-link{color:#cdd5e4;font-size:.9rem;text-decoration:none;border-bottom:1px solid rgba(205,213,228,.4)}',
      '.pv-tour-skip{background:none;border:none;color:rgba(205,213,228,.5);cursor:pointer;font-size:.9rem}',
      '.pv-tour-next{background:#e8ecf4;color:#0a0f24;border:none;border-radius:999px;padding:10px 24px;font-weight:700;cursor:pointer}'
    ].join('');
    document.head.appendChild(css);

    overlay = el('div', 'pv-tour-overlay');
    overlay.appendChild(el('div', 'pv-tour-card'));
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
    render();
  }

  // Auto-start for fresh signups (URL flag ?tour=1) or first visit to index
  function autoStart() {
    var params = new URLSearchParams(location.search);
    if (params.get('tour') === '1') { start(true); return; }
    // Only auto-start on homepage for users who never saw it
    if (/(^|\/)index\.html$/.test(location.pathname) || location.pathname === '/') {
      if (!isDone()) {
        setTimeout(function () { start(false); }, 1200);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoStart);
  } else {
    autoStart();
  }

  window.PVTour = { start: start, close: close, reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} } };
})();
