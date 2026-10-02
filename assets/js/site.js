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


  // --- smooth anchor scroll ---
  function initAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var t = document.querySelector(a.getAttribute('href'));
        if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
      });
    });
  }

  // --- mobile nav: slide-out drawer + notifications bell ---
  var ICONS = {
    matcher: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2.2"/><circle cx="15" cy="12" r="2.2"/><circle cx="8" cy="17" r="2.2"/></svg>',
    journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h9l4 4V20.5H6z"/><path d="M15 3.5V8h4"/><path d="M9 13h6M9 16.5h6"/></svg>',
    risk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M9.5 7.5h5"/><path d="M9.5 12h5M9.5 15h5M9.5 18h5"/></svg>',
    pricing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3v18M5 7l7-4 7 4M5 7v10l7 4 7-4V7"/></svg>',
    about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.1"/></svg>',
    account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.5"/><path d="M5.5 20c1-3.6 3.4-5.4 6.5-5.4s5.5 1.8 6.5 5.4"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2"/><path d="M10 12h11M18 8l3 4-3 4"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 5H4a1 1 0 0 0-1 1c0 2.5 2 4 4 4"/><path d="M17 5h3a1 1 0 0 1 1 1c0 2.5-2 4-4 4"/><path d="M12 13v4"/><path d="M8 20h8"/></svg>', mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>', 
  };
  function drawerLinks(up) {
    return [
      { href: up + 'tools/matcher.html', label: 'Prop Firm Matcher', icon: 'matcher', match: ['matcher.html'] },
      { href: up + 'tools/journal.html', label: 'Journal', icon: 'journal', match: ['journal.html'] },
      { href: up + 'leaderboard.html', label: 'Leaderboard', icon: 'trophy', match: ['leaderboard.html'] },
      { href: up + 'certificates.html', label: 'Certificates', icon: 'trophy', match: ['certificates.html'] },
      { href: up + 'tools/risk-calculator.html', label: 'Risk Calculator', icon: 'risk', match: ['risk-calculator.html'] },
      { href: up + 'pricing.html', label: 'Pricing', icon: 'pricing', match: ['pricing.html'] },
      { href: up + 'contact.html', label: 'Contact', icon: 'mail', match: ['contact.html'] },
      { href: up + 'about.html', label: 'About', icon: 'about', match: ['about.html'] },
      { href: up + 'account.html', label: 'Account', icon: 'account', match: ['account.html'], auth: 'in' }
    ];
  }
  function initNav() {
    var btn = document.querySelector('.nav-toggle');
    var nav = document.querySelector('.nav-links');
    if (!btn) return;
    var up = location.pathname.split('/').filter(Boolean).length > 1 ? '../' : '';
    var page = location.pathname.split('/').pop() || 'index.html';
    var actions = document.createElement('div');
    actions.className = 'nav-actions';
    var bell = document.createElement('button');
    bell.className = 'nav-bell'; bell.setAttribute('aria-label', 'Notifications');
    bell.innerHTML = ICONS.bell + '<span class="dot"></span>';
    actions.appendChild(bell);
    btn.parentNode.insertBefore(actions, btn);
    actions.appendChild(btn);
    var overlay = document.createElement('div');
    overlay.className = 'drawer-overlay';
    var drawer = document.createElement('aside');
    drawer.className = 'drawer'; drawer.setAttribute('aria-label', 'Menu');
    drawer.innerHTML =
      '<div class="drawer-head">' +
        '<a class="brand" href="' + up + 'index.html"><img src="' + up + 'assets/img/logo.png" alt="PIPVANT logo"></a>' +
        '<button class="drawer-close" aria-label="Close menu">X</button>' +
      '</div>' +
      '<div class="drawer-user" id="drawer-user"></div>' +
      '<div class="drawer-cta"><a class="btn btn-silver btn-sm" style="width:100%" href="' + up + 'tools/matcher.html">Compare Prop Firms</a></div>' +
      '<nav class="drawer-nav" id="drawer-nav"></nav>' +
      '<div class="drawer-foot" id="drawer-foot"></div>';
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    function paintDrawerUser() {
      var box = document.getElementById('drawer-user');
      var foot = document.getElementById('drawer-foot');
      var PV = window.PV || {};
      if (PV.user) {
        var email = PV.user.email || '';
        var plan = (PV.plan || 'free').toUpperCase();
        // Load display_name + avatar from profiles (synced with account page)
        var renderUser = function (prof) {
          prof = prof || {};
          var name = (prof.display_name || '').trim() || email.split('@')[0];
          var avatar = prof.avatar_url && prof.avatar_url.indexOf('data:image') === 0
            ? '<img src="' + esc(prof.avatar_url) + '" alt="">'
            : esc((name.charAt(0) || '?').toUpperCase());
          box.innerHTML =
            '<div class="du-row"><div class="du-avatar">' + avatar + '</div>' +
            '<div><div class="du-name">' + esc(name) + '</div>' +
            '<div class="du-mail">' + esc(email) + '</div></div></div>' +
            '<div class="du-plan"><span class="plan-badge">' + esc(plan) + '</span></div>';
          foot.innerHTML = '<a href="#" data-logout style="color:var(--ink-3);font-size:.92rem">Log out</a>';
          var lo = foot.querySelector('[data-logout]');
          if (lo && PV.signOut) lo.addEventListener('click', function (e) { e.preventDefault(); PV.signOut(); });
        };
        // Render immediately with email fallback, then refresh from profiles
        renderUser(null);
        if (PV.from) {
          PV.from('profiles').select('display_name,avatar_url').eq('id', PV.user.id).maybeSingle().then(function (r) {
            if (r && r.data) renderUser(r.data);
          }).catch(function () {});
        }
      } else {
        box.innerHTML =
          '<div style="display:flex;gap:10px"><a class="btn btn-silver btn-sm" style="flex:1" href="' + up + 'signup.html">Sign up free</a>' +
          '<a class="btn btn-ghost btn-sm" style="flex:1" href="' + up + 'login.html">Log in</a></div>';
        foot.innerHTML = '';
      }
    }
    function paintDrawerNav() {
      var box = document.getElementById('drawer-nav');
      var PV = window.PV || {};
      var authed = !!PV.user;
      var html = '';
      drawerLinks(up).forEach(function (l) {
        if (l.auth === 'in' && !authed) return;
        var active = l.match.indexOf(page) >= 0 ? ' active' : '';
        html += '<a class="du-link' + active + '" href="' + l.href + '">' + ICONS[l.icon] + '<span>' + l.label + '</span></a>';
      });
      box.innerHTML = html;
    }
    function openDrawer() {
      paintDrawerUser(); paintDrawerNav();
      drawer.classList.add('show'); overlay.classList.add('show');
      document.body.style.overflow = 'hidden';
      btn.setAttribute('aria-expanded', 'true');
    }
    function closeDrawer() {
      drawer.classList.remove('show'); overlay.classList.remove('show');
      document.body.style.overflow = '';
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', openDrawer);
    drawer.querySelector('.drawer-close').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeDrawer(); closeNotif(); } });
    var panel = document.createElement('div');
    panel.className = 'notif-panel'; panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Notifications');
    panel.innerHTML = '<div class="np-head"><span>Notifications</span></div>' +
      '<div class="np-body"><span class="np-ic">Notification</span>No notifications yet.<br>Stay tuned.</div>';
    document.body.appendChild(panel);
    function closeNotif() { panel.classList.remove('show'); }
    bell.addEventListener('click', function (e) {
      e.stopPropagation();
      closeDrawer();
      panel.classList.toggle('show');
    });
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== bell && !bell.contains(e.target)) closeNotif();
    });
    if (window.PV && window.PV.onAuth) window.PV.onAuth(function () { paintDrawerUser(); paintDrawerNav(); });
    if (nav) nav.querySelectorAll('a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.endsWith(page)) a.classList.add('active');
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
    { id: 'board', label: 'Board', href: 'leaderboard.html', match: ['leaderboard.html'],
      icon: '<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 5H4a1 1 0 0 0-1 1c0 2.5 2 4 4 4"/><path d="M17 5h3a1 1 0 0 1 1 1c0 2.5-2 4-4 4"/><path d="M12 13v4"/><path d="M8 20h8"/>' },
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
