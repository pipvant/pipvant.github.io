/* Shared site behaviour: brand injection, nav, footer, utils. */
(function () {
  'use strict';
  var C = window.OROVANTA || { company: 'Orovanta', platform: 'PIPVANT', tagline: 'The Platinum Edge' };

  // --- brand injection: <span data-brand="platform|company|tagline|launchline|year"></span>
  function paintBrand() {
    document.querySelectorAll('[data-brand]').forEach(function (el) {
      var k = el.getAttribute('data-brand');
      if (k === 'platform') el.textContent = C.platform;
      else if (k === 'company') el.textContent = C.company;
      else if (k === 'tagline') el.textContent = C.tagline;
      else if (k === 'launchline') el.textContent = C.launchline || (C.platform + ' — launched by ' + C.company);
      else if (k === 'year') el.textContent = new Date().getFullYear();
    });
  }

  // --- mobile nav ---
  function initNav() {
    var btn = document.querySelector('.nav-toggle');
    var nav = document.querySelector('.nav-links');
    if (!btn || !nav) return;
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // active link
    var path = location.pathname.split('/').pop() || 'index.html';
    nav.querySelectorAll('a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.endsWith(path)) a.classList.add('active');
    });
  }

  // --- smooth anchor scroll ---
  function initAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var t = document.querySelector(a.getAttribute('href'));
        if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
      });
    });
  }

  // --- shared formatters ---
  window.fmtUSD = function (n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  };
  window.fmtSize = function (usd) {
    if (usd >= 1000) return (usd / 1000).toString().replace(/\.0$/, '') + 'k';
    return String(usd);
  };
  window.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  document.addEventListener('DOMContentLoaded', function () {
    paintBrand();
    initNav();
    initAnchors();
  });
})();
