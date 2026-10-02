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

  // --- mobile bottom nav (<=900px): built from config, not duplicated markup ---
  var TABS = [
    { id: 'home', label: 'Home', href: 'index.html', match: ['index.html', ''],
      icon: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-5h4v5"/>' },
    { id: 'matcher', label: 'Matcher', href: 'tools/matcher.html', match: ['matcher.html'],
      icon: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2.2"/><circle cx="15" cy="12" r="2.2"/><circle cx="8" cy="17" r="2.2"/>' },
    { id: 'journal', label: 'Journal', href: 'tools/journal.html', match: ['journal.html'],
      icon: '<path d="M6 3.5h9l4 4V20.5H6z"/><path d="M15 3.5V8h4"/><path d="M9 13h6M9 16.5h6"/>' },
    { id: 'risk', label: 'Risk', href: 'tools/risk-calculator.html', match: ['risk-calculator.html'],
      icon: '<rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M9.5 7.5h5"/><path d="M9.5 12h.8M12 12h.8M14.5 12h.8M9.5 15h.8M12 15h.8M14.5 15h.8M9.5 18h5"/>' },
    { id: 'account', label: 'Account', href: 'account.html', match: ['account.html'],
      icon: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5.5 20c1-3.6 3.4-5.4 6.5-5.4s5.5 1.8 6.5 5.4"/>' }
  ];
  function initBottomNav() {
    if (document.querySelector('.bottomnav')) return;
    // depth: /tools/x.html and /legal/x.html need '../', root pages need ''
    var up = location.pathname.split('/').filter(Boolean).length > 1 ? '../' : '';
    var page = location.pathname.split('/').pop() || 'index.html';
    var nav = document.createElement('nav');
    nav.className = 'bottomnav';
    nav.setAttribute('aria-label', 'Primary');
    TABS.forEach(function (t) {
      var a = document.createElement('a');
      a.href = up + t.href;
      if (t.match.indexOf(page) >= 0) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
      a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + t.icon + '</svg>' +
        '<span>' + t.label + '</span>';
      nav.appendChild(a);
    });
    document.body.appendChild(nav);
  }

  // --- service worker (conservative): same-origin shell cache only ---
  function initSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    var up = location.pathname.split('/').filter(Boolean).length > 1 ? '../' : '';
    try {
      navigator.serviceWorker.register(up + 'sw.js').catch(function () {});
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', function () {
    paintBrand();
    initNav();
    initAnchors();
    initBottomNav();
    initSW();
  });
})();
