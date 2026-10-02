/* ============================================================
   PIPVANT fx — subtle premium motion. CSS/canvas only, GPU-friendly.
   Everything respects prefers-reduced-motion. No layout thrash.
   ============================================================ */
(function () {
  'use strict';
  var REDUCED = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. hero particle field (canvas) ---------- */
  function initParticles() {
    if (REDUCED || !window.requestAnimationFrame) return;
    var hosts = document.querySelectorAll('.hero, .tool-head');
    hosts.forEach(function (host) {
      if (host.querySelector('canvas.fx-particles')) return;
      var cv = document.createElement('canvas');
      cv.className = 'fx-particles';
      cv.setAttribute('aria-hidden', 'true');
      host.insertBefore(cv, host.firstChild);
      var ctx = cv.getContext('2d');
      var W = 0, H = 0, pts = [], running = false, raf = 0;

      function size() {
        var r = host.getBoundingClientRect();
        W = Math.max(1, Math.floor(r.width));
        H = Math.max(1, Math.floor(r.height));
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = W * dpr; cv.height = H * dpr;
        cv.style.width = W + 'px'; cv.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var n = Math.min(80, Math.floor(W * H / 14000));
        pts = [];
        for (var i = 0; i < n; i++) {
          pts.push({
            x: Math.random() * W, y: Math.random() * H,
            vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22,
            r: 0.8 + Math.random() * 1.5, a: 0.10 + Math.random() * 0.22
          });
        }
      }
      function step() {
        if (!running) return;
        ctx.clearRect(0, 0, W, H);
        var i, j, p, q, dx, dy, d2;
        for (i = 0; i < pts.length; i++) {
          p = pts[i];
          p.x += p.vx; p.y += p.vy;
          if (p.x < -8) p.x = W + 8; if (p.x > W + 8) p.x = -8;
          if (p.y < -8) p.y = H + 8; if (p.y > H + 8) p.y = -8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, 6.2832);
          ctx.fillStyle = 'rgba(205,213,228,' + p.a.toFixed(3) + ')';
          ctx.fill();
        }
        ctx.lineWidth = 1;
        for (i = 0; i < pts.length; i++) {
          for (j = i + 1; j < pts.length; j++) {
            p = pts[i]; q = pts[j];
            dx = p.x - q.x; dy = p.y - q.y; d2 = dx * dx + dy * dy;
            if (d2 < 12100) {
              ctx.strokeStyle = 'rgba(205,213,228,' + (0.055 * (1 - d2 / 12100)).toFixed(3) + ')';
              ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
            }
          }
        }
        raf = requestAnimationFrame(step);
      }
      function start() { if (!running) { running = true; step(); } }
      function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

      var visible = true, onscreen = true;
      function gate() { (visible && onscreen) ? start() : stop(); }
      document.addEventListener('visibilitychange', function () {
        visible = !document.hidden; gate();
      });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) {
          onscreen = es[0].isIntersecting; gate();
        }, { threshold: 0 }).observe(host);
      }
      var rt;
      window.addEventListener('resize', function () {
        clearTimeout(rt); rt = setTimeout(size, 200);
      });
      size(); gate();
    });
  }

  /* ---------- 2. scroll reveals ---------- */
  var revealObs = null;
  function armReveals(root) {
    if (REDUCED || !('IntersectionObserver' in window)) return;
    var scope = root || document;
    scope.querySelectorAll('.revealable:not(.reveal)').forEach(function (el) {
      el.classList.add('reveal');
      revealObs.observe(el);
    });
  }
  function initReveals() {
    if (REDUCED || !('IntersectionObserver' in window)) return;
    revealObs = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('revealed'); revealObs.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.card, .firm-card, .plan, .principle, .stat-card, .metric, .tool-head, .faq details')
      .forEach(function (el) { el.classList.add('revealable'); });
    armReveals(document);
  }

  /* ---------- 3. animated counters ---------- */
  function initCounters() {
    if (REDUCED || !('IntersectionObserver' in window)) return;
    var els = Array.prototype.filter.call(
      document.querySelectorAll('.stat .n'),
      function (el) { return /^\d+$/.test(el.textContent.trim()); }
    );
    if (!els.length) return;
    var obs = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        obs.unobserve(e.target);
        var el = e.target, target = parseInt(el.textContent.trim(), 10), t0 = null;
        function tick(t) {
          if (!t0) t0 = t;
          var k = Math.min(1, (t - t0) / 1300);
          var ease = 1 - Math.pow(1 - k, 3);
          el.textContent = Math.round(target * ease);
          if (k < 1) requestAnimationFrame(tick);
        }
        el.textContent = '0';
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.4 });
    els.forEach(function (el) { obs.observe(el); });
  }

  /* ---------- 5. equity curve draw animation (journal hook) ---------- */
  function animateEquityPath(svg) {
    if (REDUCED || !svg) return;
    var path = svg.querySelector('path');
    if (!path || !path.getTotalLength) return;
    try {
      var len = path.getTotalLength();
      path.style.transition = 'none';
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
      path.getBoundingClientRect();
      path.style.transition = 'stroke-dashoffset 1.4s ease-out';
      requestAnimationFrame(function () { path.style.strokeDashoffset = '0'; });
    } catch (e) {}
  }

  window.PVFX = {
    armReveals: armReveals,
    animateEquity: animateEquityPath,
    reduced: REDUCED
  };

  document.addEventListener('DOMContentLoaded', function () {
    initParticles();
    initReveals();
    initCounters();
  });
})();
