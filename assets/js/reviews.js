/* PIPVANT community reviews — real reviews from verified users only */
(function () {
  'use strict';
  var selectedStars = 5;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function stars(n) {
    var out = '';
    for (var i = 1; i <= 5; i++) out += i <= n ? '★' : '☆';
    return out;
  }

  function renderStars() {
    var el = document.getElementById('review-stars');
    if (!el) return;
    el.textContent = '';
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var sp = document.createElement('span');
        sp.textContent = n <= selectedStars ? '★' : '☆';
        sp.style.color = n <= selectedStars ? '#e8c15a' : 'var(--ink-3)';
        sp.onclick = function () { selectedStars = n; renderStars(); };
        el.appendChild(sp);
      })(i);
    }
  }

  function card(r) {
    var d = new Date(r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    var name = esc(r.display_name || 'PIPVANT Trader');
    var initial = name.charAt(0).toUpperCase();
    return '<div class="review-card">' +
      '<div class="stars">' + stars(r.stars) + '</div>' +
      '<p>' + esc(r.body) + '</p>' +
      '<div class="who"><div class="avatar">' + initial + '</div>' +
      '<div><div class="nm">' + name + '<span class="verified">✓ verified</span></div><div class="dt">' + d + '</div></div></div>' +
    '</div>';
  }

  function load() {
    if (!window.PV) return;
    window.PV.from('reviews').select('*').eq('approved', true).order('created_at', { ascending: false }).limit(12)
      .then(function (res) {
        var list = document.getElementById('reviews-list');
        var empty = document.getElementById('reviews-empty');
        if (!list) return;
        var rows = (res && res.data) || [];
        if (!rows.length) {
          list.innerHTML = '';
          if (empty) empty.style.display = '';
        } else {
          if (empty) empty.style.display = 'none';
          list.innerHTML = rows.map(card).join('');
        }
      })
      .catch(function () {
        var empty = document.getElementById('reviews-empty');
        if (empty) empty.style.display = '';
      });
  }

  window.submitReview = function () {
    var text = document.getElementById('review-text');
    var body = text ? text.value.trim() : '';
    if (!body) { alert('Please write your review first.'); return; }
    if (!window.PV || !window.PV.user) { location.href = 'login.html'; return; }
    var uid = window.PV.user.id;
    window.PV.from('profiles').select('display_name').eq('id', uid).maybeSingle()
      .then(function (pr) {
        var nm = (pr.data && pr.data.display_name) || 'PIPVANT Trader';
        return window.PV.from('reviews').insert({
          user_id: uid, display_name: nm, stars: selectedStars, body: body, approved: false
        });
      })
      .then(function () {
        alert('Thank you! Your review was submitted and will appear after moderation.');
        if (text) text.value = '';
        selectedStars = 5; renderStars();
      })
      .catch(function () { alert('Could not submit your review. Please try again.'); });
  };

  document.addEventListener('DOMContentLoaded', function () {
    renderStars();
    /* wait for PV auth init */
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (window.PV && window.PV.ready !== false) { clearInterval(iv); afterAuth(); }
      else if (tries > 40) { clearInterval(iv); afterAuth(); }
    }, 250);
    function afterAuth() {
      load();
      var logged = !!(window.PV && window.PV.user);
      var fw = document.getElementById('review-form-wrap');
      var cta = document.getElementById('review-login-cta');
      if (fw) fw.style.display = logged ? '' : 'none';
      if (cta) cta.style.display = logged ? 'none' : '';
    }
  });
})();
