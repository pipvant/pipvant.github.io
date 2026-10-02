/* PIPVANT Prop Firm Matcher — filter, render, compare. */
(function () {
  'use strict';

  var PLANS = window.PIPVANT_PLANS || [];
  var META = window.PIPVANT_META || {};
  var VERIFY = 'Verified ' + (META.lastVerified || '2026-10-02') +
    ' — promos change often, always confirm at checkout.';

  var state = { market: 'any', size: 'any', maxPrice: null, dd: 'any', news: 'any', minSplit: 50 };
  var compareKeys = []; // "firmId|planId"

  /* ---------- cloud: watchlist + saved comparisons ---------- */
  // NOTE: two DB ids differ from the firms.js slugs (seed slug mismatch):
  //   firms.js 'alpha-capital' -> DB 'alpha-capital-group'
  //   firms.js 'the-5ers'      -> DB 'the-5-ers'
  function dbFirmId(fid) { return fid; } // DB ids match firms.js slugs
  var watchlist = {}; // dbFirmId -> true

  function needLogin() {
    location.href = '../login.html?next=' + encodeURIComponent('tools/matcher.html');
  }
  function loadWatchlist() {
    return PV.from('watchlist_firms').select('firm_id').eq('user_id', PV.user.id).then(function (res) {
      if (res.error) throw res.error;
      watchlist = {};
      (res.data || []).forEach(function (r) { watchlist[r.firm_id] = true; });
    }).catch(function () { watchlist = {}; });
  }
  function paintWatchButtons() {
    document.querySelectorAll('.watch-btn').forEach(function (b) {
      var on = !!watchlist[dbFirmId(b.getAttribute('data-firm'))];
      b.innerHTML = on ? '♥ Saved' : '♡ Watchlist';
    });
  }
  function toggleWatch(btn) {
    if (!PV.user || !PV.ok) { needLogin(); return; }
    var fid = dbFirmId(btn.getAttribute('data-firm'));
    // Free plan: 10-firm watchlist cap (removing is always allowed)
    if (!watchlist[fid] && !PV.isPro() && Object.keys(watchlist).length >= 10) {
      PV.upgradeModal("Your watchlist is full at 10 firms on the Free plan. PIPVANT Pro gives you unlimited watchlists — and unlimited saved comparisons.");
      return;
    }
    btn.disabled = true;
    var job = watchlist[fid]
      ? PV.from('watchlist_firms').delete().eq('user_id', PV.user.id).eq('firm_id', fid)
      : PV.from('watchlist_firms').insert({ user_id: PV.user.id, firm_id: fid });
    job.then(function (res) {
      btn.disabled = false;
      if (res.error) { alert(PV.friendly(res.error)); return; }
      if (watchlist[fid]) delete watchlist[fid]; else watchlist[fid] = true;
      paintWatchButtons();
    });
  }

  function loadSaved() {
    var box = document.getElementById('saved-list');
    if (!PV.user || !PV.ok) {
      box.innerHTML = '<p class="micro"><a href="../login.html?next=' + encodeURIComponent('tools/matcher.html') +
        '" style="color:var(--silver-2);font-weight:600">Sign in</a> to save comparisons and sync them across devices.</p>';
      return Promise.resolve();
    }
    return PV.from('saved_comparisons').select('id, name, firm_ids, filters, created_at')
      .eq('user_id', PV.user.id).order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        var rows = res.data || [];
        box.innerHTML = rows.length ? rows.map(function (r) {
          var names = (r.firm_ids || []).map(function (k) { var p = byKey(k); return p ? p.firm : k; }).join(' vs ');
          return '<div class="saved-item"><div><strong>' + esc(r.name) + '</strong><br><span class="micro">' + esc(names) + '</span></div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-load="' + r.id + '">Load</button>' +
            '<button class="btn btn-ghost btn-sm" data-del="' + r.id + '">Delete</button></div></div>';
        }).join('') : '<p class="micro">Nothing saved yet — compare programs above, then save the result.</p>';
        box.querySelectorAll('[data-del]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (!confirm('Delete this saved comparison?')) return;
            PV.from('saved_comparisons').delete().eq('id', b.getAttribute('data-del')).then(function (dr) {
              if (dr.error) alert(PV.friendly(dr.error)); else loadSaved();
            });
          });
        });
        box.querySelectorAll('[data-load]').forEach(function (b) {
          b.addEventListener('click', function () {
            var r = rows.find(function (x) { return x.id === b.getAttribute('data-load'); });
            if (r) applySaved(r);
          });
        });
      }).catch(function (err) {
        box.innerHTML = '<p class="micro">Could not load saved comparisons: ' + esc(PV.friendly(err)) + '</p>';
      });
  }
  function applySaved(r) {
    var keys = (r.firm_ids || []).filter(byKey);
    if (!keys.length) { alert('Those programs are no longer listed.'); return; }
    compareKeys = keys.slice(0, 3);
    if (r.filters) {
      state.market = r.filters.market || 'any';
      state.size = r.filters.size || 'any';
      state.maxPrice = r.filters.maxPrice != null ? r.filters.maxPrice : null;
      state.dd = r.filters.dd || 'any';
      state.news = r.filters.news || 'any';
      state.minSplit = r.filters.minSplit || 50;
      syncFilterUI();
    }
    render(); renderCompareTable();
    document.getElementById('compare-section').scrollIntoView({ behavior: 'smooth' });
  }
  function syncFilterUI() {
    [['f-market', 'market'], ['f-dd', 'dd'], ['f-news', 'news']].forEach(function (pair) {
      document.getElementById(pair[0]).querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-v') === state[pair[1]]);
      });
    });
    document.getElementById('f-size').value = state.size;
    document.getElementById('f-price').value = state.maxPrice == null ? '' : state.maxPrice;
    document.getElementById('f-split').value = state.minSplit;
    document.getElementById('f-split-v').textContent = state.minSplit + '%';
  }

  function key(p) { return p.firmId + '|' + p.planId; }
  function byKey(k) { return PLANS.find(function (p) { return key(p) === k; }); }

  /* ---------- filter ---------- */
  function planMatches(p) {
    if (state.market !== 'any' && p.markets.indexOf(state.market) < 0) return false;
    if (state.dd !== 'any' && p.ddType !== state.dd) return false;
    if (state.news !== 'any' && p.news !== state.news) return false;
    if ((p.profitSplitMin || 0) < state.minSplit) return false;
    var sizes = p.sizes;
    if (state.size !== 'any') {
      sizes = sizes.filter(function (s) { return String(s.sizeUsd) === state.size; });
      if (!sizes.length) return false;
    }
    if (state.maxPrice != null) {
      var ok = sizes.some(function (s) { return s.priceUsd != null && s.priceUsd <= state.maxPrice; });
      if (!ok) return false;
    }
    return true;
  }

  /* ---------- render ---------- */
  function newsLabel(n) {
    return { allowed: 'Allowed', restricted: 'Restricted', prohibited: 'Prohibited', unknown: 'Check terms' }[n] || n;
  }
  function recLabel(r) {
    return { 'one-time': 'one-time', 'monthly': '/month', 'per-30-days': '/30 days' }[r] || '';
  }

  function priceRows(p) {
    return p.sizes.map(function (s) {
      var hl = (state.size !== 'any' && String(s.sizeUsd) === state.size) ? ' class="hl"' : '';
      var price = s.priceUsd != null
        ? '<span class="p">' + esc(s.priceDisplay) + '</span> <span class="micro">' + recLabel(s.recurring) + '</span>'
        : '<span class="micro">See website</span>';
      return '<tr' + hl + '><td>' + esc(s.label) + '</td><td>' + price + '</td></tr>';
    }).join('');
  }

  function fromPrice(p) {
    var best = null;
    (p.sizes || []).forEach(function (s) {
      if (s.priceUsd != null && (!best || s.priceUsd < best.priceUsd)) best = s;
    });
    return best;
  }

  var MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtMD(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return MONTHS_S[d.getUTCMonth()] + ' ' + d.getUTCDate();
    } catch (e) { return ''; }
  }

  /* Live promos from PropFirmMatch (assets/js/promos.js). The generator uses
     slightly different firm keys than our data for 3 firms — alias them here
     so no promo is silently dropped. Fails silently if promos.js is absent. */
  var PROMO_ALIAS = { 'the-5ers': '5ers', 'apex-trader-funding': 'apex', 'take-profit-trader': 'tpt' };
  function livePromos(p) {
    try {
      var P = window.PIPVANT_PROMOS;
      if (!P || !P.promos) return [];
      var arr = P.promos[p.firmId] || P.promos[PROMO_ALIAS[p.firmId]];
      if (!Array.isArray(arr)) return [];
      // Drop expired promos client-side so a weekly sync never shows dead deals.
      var now = Date.now();
      return arr.filter(function (pr) {
        if (!pr.endDate) return true;
        var t = Date.parse(pr.endDate);
        return isNaN(t) || t > now;
      });
    } catch (e) { return []; }
  }

  function promoCodeChip(code) {
    return code
      ? '<span class="fc-code" title="Use this code at checkout">' + esc(code) + '</span>'
      : '';
  }

  function promoStrip(p) {
    var out = '';
    var live = livePromos(p);
    if (live.length) {
      var f = live[0];
      out += '<div class="fc-promo live">' +
        '<span class="fc-promo-ic">🎟</span>' +
        '<div class="fc-promo-main">' +
          '<div class="fc-promo-top"><strong class="fc-promo-label">' + esc(f.label) + '</strong>' +
          promoCodeChip(f.code) +
          (live.length > 1 ? '<span class="fc-promo-more">+' + (live.length - 1) + ' more in details</span>' : '') +
        '</div>' +
        '<div class="fc-promo-sub">via PropFirmMatch — verify at checkout</div>' +
        '</div>' +
      '</div>';
    }
    if (p.priceNote) {
      out += '<div class="fc-promo"><span class="tag">✦</span><span>' + esc(p.priceNote) + '</span></div>';
    }
    return out;
  }

  /* Detail modal: every live promo with description + end date, then priceNote. */
  function promoFull(p) {
    var out = '';
    var live = livePromos(p);
    if (live.length) {
      out += '<div class="fc-promos-full">' +
        live.map(function (pr) {
          var end = pr.endDate ? fmtMD(pr.endDate) : '';
          return '<div class="fc-promo-item">' +
            '<div class="fc-promo-top"><strong class="fc-promo-label">' + esc(pr.label) + '</strong>' +
            promoCodeChip(pr.code) +
            (end ? '<span class="fc-promo-end">ends ' + esc(end) + '</span>' : '') +
          '</div>' +
          (pr.description ? '<div class="fc-promo-desc">' + esc(pr.description) + '</div>' : '') +
          '</div>';
        }).join('') +
        '<div class="fc-promo-sub fc-promo-src">via PropFirmMatch — verify at checkout</div>' +
      '</div>';
    }
    if (p.priceNote) {
      out += '<div class="fc-promo"><span class="tag">✦</span><span>' + esc(p.priceNote) + '</span></div>';
    }
    return out;
  }

  function specTiles(p) {
    function row(k, v) {
      return '<div class="fc-rule"><span>' + k + '</span><b>' + esc(v) + '</b></div>';
    }
    return '<div class="fc-rules"><div class="fc-rules-title">Key rules</div>' +
      row('Profit target', p.profitTarget) +
      row('Daily drawdown', p.dailyDD) +
      row('Max drawdown', p.totalDD) +
      row('Profit split', p.profitSplit) +
    '</div>';
  }

  function sizeChips(p) {
    var sizes = (p.sizes || []).filter(function (s) { return s.priceUsd != null; });
    if (!sizes.length) return '';
    var chips = sizes.map(function (s) {
      var hl = (state.size !== 'any' && String(s.sizeUsd) === state.size) ? ' style="border-color:var(--silver-2);color:#fff"' : '';
      return '<span class="size-chip"' + hl + '>' + esc(s.label) + ' · ' + esc(s.priceDisplay) + '</span>';
    }).join('');
    return '<div class="size-chips"><span class="size-chips-label">Account sizes</span><div class="size-chips-row">' + chips + '</div></div>';
  }

  function card(p, i) {
    var k = key(p);
    var inCmp = compareKeys.indexOf(k) >= 0;
    var badges = p.markets.map(function (m) {
      return '<span class="badge">' + (m === 'cfd' ? 'CFDs' : 'Futures') + '</span>';
    }).join('') + (p.ddType && p.ddType !== 'unknown' ? '<span class="badge dim">' + esc(p.ddType) + ' DD</span>' : '') +
      '<span class="badge dim">News: ' + esc(newsLabel(p.news)) + '</span>';
    var fp = fromPrice(p);
    var mono = esc(((p.firm || '?').trim().charAt(0) || '?').toUpperCase());

    return '' +
      '<article class="firm-card fc-v3" data-key="' + esc(k) + '">' +
        '<div class="fc-head">' +
          '<div class="fc-mono" aria-hidden="true"><span class="fc-mono-ring"></span><span class="fc-mono-l">' + mono + '</span></div>' +
          '<div class="fc-id"><h3 class="fc-firm">' + esc(p.firm) + '</h3>' +
          '<div class="fc-plan">' + esc(p.plan) + '</div></div>' +
          (fp ? '<div class="fc-from"><span class="fc-from-label">From</span>' +
            '<span class="fc-from-price">' + esc(fp.priceDisplay) + '</span></div>' : '') +
        '</div>' +
        '<div class="fc-badges">' + badges + '</div>' +
        promoStrip(p) +
        specTiles(p) +
        sizeChips(p) +
        '<div class="firm-actions">' +
          '<button class="btn btn-ghost btn-sm watch-btn" data-firm="' + esc(p.firmId) + '">♡ Watchlist</button>' +
          '<button class="btn btn-ghost btn-sm detail-btn" data-firm="' + esc(p.firmId) + '">Details</button>' +
          '<button class="btn btn-ghost btn-sm cmp-btn"' + (inCmp || compareKeys.length >= 3 ? ' disabled' : '') + '>' +
            (inCmp ? '✓ In comparison' : '＋ Compare') + '</button>' +
          (p.website ? '<a class="btn btn-silver btn-sm" href="' + esc(p.website) + '" target="_blank" rel="noopener">Visit site ↗</a>' : '') +
        '</div>' +
        '<p class="verify fc-verify">' + esc(VERIFY) + '</p>' +
      '</article>';
  }

  function render() {
    var list = PLANS.filter(planMatches);
    var box = document.getElementById('results');
    document.getElementById('res-count').textContent =
      list.length + ' program' + (list.length === 1 ? '' : 's') + ' match your filters';
    box.innerHTML = list.length
      ? list.map(function (p, i) { return card(p, i); }).join('')
      : '<div class="empty"><h3>No programs match</h3><p>Try widening the price range or clearing a filter.</p></div>';
    box.querySelectorAll('.cmp-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.closest('.firm-card').getAttribute('data-key');
        toggleCompare(k);
      });
    });
    box.querySelectorAll('.watch-btn').forEach(function (b) {
      b.addEventListener('click', function () { toggleWatch(b); });
    });
    box.querySelectorAll('.detail-btn').forEach(function (b) {
      b.addEventListener('click', function () { openFirmModal(b.getAttribute('data-firm')); });
    });
    paintWatchButtons();
    renderTray();
    if (window.PVFX) window.PVFX.armReveals(box);
  }

  /* ---------- firm detail modal (full record, all plans) ---------- */
  function firmModalHTML(fid) {
    var plans = PLANS.filter(function (p) { return p.firmId === fid; });
    if (!plans.length) return '';
    var first = plans[0];
    var badges = first.markets.map(function (m) {
      return '<span class="badge">' + (m === 'cfd' ? 'CFDs' : 'Futures') + '</span>';
    }).join('');
    var body = plans.map(function (p) {
      var rows = p.sizes.map(function (s) {
        return '<tr><td>' + esc(s.label) + '</td><td>' +
          (s.priceUsd != null
            ? '<span class="p">' + esc(s.priceDisplay) + '</span> <span class="micro">' + recLabel(s.recurring) + '</span>'
            : '<span class="micro">See website</span>') + '</td></tr>';
      }).join('');
      var fp = fromPrice(p);
      return '<div class="plan-block">' +
        '<div class="fc-head"><h3 class="fc-planname" style="min-width:0;flex:1">' + esc(p.plan) + '</h3>' +
        (fp ? '<div class="fc-from"><span class="fc-from-label">From</span>' +
          '<span class="fc-from-price sm">' + esc(fp.priceDisplay) + '</span></div>' : '') +
        '</div>' +
        '<div class="ttable-wrap"><table class="price-table"><thead><tr><th>Account size</th><th>Challenge price</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
        promoFull(p) +
        specTiles(p) +
        '<div class="spec" style="grid-template-columns:1fr 1fr">' +
          '<div><div class="k">News trading</div><div class="v">' + esc(newsLabel(p.news)) + '</div></div>' +
          '<div><div class="k">Drawdown type</div><div class="v">' + (p.ddType && p.ddType !== 'unknown' ? esc(p.ddType) : '—') + '</div></div>' +
        '</div>' +
        '<div class="terms"><p><strong style="color:var(--silver-2)">Special terms</strong><br>' +
          esc(p.terms || 'See the firm website for full terms.') + '</p>' +
          (p.sourceUrl ? '<p class="micro">Source: ' + esc(p.sourceUrl) + '</p>' : '') + '</div>' +
      '</div>';
    }).join('');
    var fmono = esc(((first.firm || '?').trim().charAt(0) || '?').toUpperCase());
    return '<button class="modal-x" data-close aria-label="Close">×</button>' +
      '<div class="fc-head" style="margin-bottom:10px">' +
        '<div class="fc-mono" aria-hidden="true"><span class="fc-mono-ring"></span><span class="fc-mono-l">' + fmono + '</span></div>' +
        '<div class="fc-id"><h2 style="margin:0">' + esc(first.firm) + '</h2></div>' +
      '</div>' +
      '<div class="badges">' + badges + '</div>' +
      (first.website ? '<p><a class="btn btn-silver btn-sm" href="' + esc(first.website) + '" target="_blank" rel="noopener">Visit site ↗</a></p>' : '') +
      body +
      '<p class="verify" style="margin-top:18px">' + esc(VERIFY) + '</p>';
  }
  function openFirmModal(fid) {
    var m = document.getElementById('firm-modal');
    document.getElementById('firm-modal-body').innerHTML = firmModalHTML(fid);
    m.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeFirmModal() {
    document.getElementById('firm-modal').classList.remove('show');
    document.body.style.overflow = '';
  }
  function initFirmModal() {
    var m = document.createElement('div');
    m.className = 'modal';
    m.id = 'firm-modal';
    m.innerHTML = '<div class="sheet wide firm-modal"><div id="firm-modal-body"></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      if (e.target === m || e.target.hasAttribute('data-close')) closeFirmModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeFirmModal();
    });
  }

  /* ---------- compare ---------- */
  function toggleCompare(k) {
    var i = compareKeys.indexOf(k);
    if (i >= 0) compareKeys.splice(i, 1);
    else if (compareKeys.length < 3) compareKeys.push(k);
    render();
    renderCompareTable();
  }

  function renderTray() {
    var tray = document.getElementById('tray');
    document.getElementById('tray-n').textContent = compareKeys.length;
    var slots = document.getElementById('tray-slots');
    var html = '';
    for (var i = 0; i < 3; i++) {
      var p = compareKeys[i] ? byKey(compareKeys[i]) : null;
      html += p
        ? '<span class="slot filled">' + esc(p.firm) + ' <button data-i="' + i + '" aria-label="Remove">×</button></span>'
        : '<span class="slot">Empty slot</span>';
    }
    slots.innerHTML = html;
    slots.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { toggleCompare(compareKeys[+b.getAttribute('data-i')]); });
    });
    var go = document.getElementById('tray-go');
    go.disabled = compareKeys.length < 2;
    tray.classList.toggle('show', compareKeys.length > 0);
  }

  function cheapest(p) {
    var best = null;
    p.sizes.forEach(function (s) {
      if (s.priceUsd != null && (!best || s.priceUsd < best.priceUsd)) best = s;
    });
    return best;
  }

  function renderCompareTable() {
    var sec = document.getElementById('compare-section');
    var tbl = document.getElementById('cmp-table');
    if (compareKeys.length < 2) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';
    var ps = compareKeys.map(byKey);
    function row(label, fn) {
      return '<tr><td class="k">' + label + '</td>' +
        ps.map(function (p) { return '<td>' + fn(p) + '</td>'; }).join('') + '</tr>';
    }
    tbl.innerHTML =
      '<tr><td class="k"></td>' + ps.map(function (p) {
        return '<th>' + esc(p.firm) + '<br><span class="micro" style="font-family:var(--font-body)">' + esc(p.plan) + '</span></th>';
      }).join('') + '</tr>' +
      row('Markets', function (p) { return p.markets.map(function (m) { return m === 'cfd' ? 'CFDs' : 'Futures'; }).join(' + '); }) +
      row('Cheapest price', function (p) {
        var c = cheapest(p);
        return c ? '<strong style="color:var(--silver-2)">' + esc(c.priceDisplay) + '</strong> <span class="micro">' + recLabel(c.recurring) + ' (' + esc(c.label) + ')</span><br><span class="verify">' + esc(VERIFY) + '</span>' : '—';
      }) +
      row('Profit target', function (p) { return esc(p.profitTarget); }) +
      row('Daily drawdown', function (p) { return esc(p.dailyDD); }) +
      row('Max drawdown', function (p) { return esc(p.totalDD) + (p.ddType && p.ddType !== 'unknown' ? ' <span class="badge dim">' + esc(p.ddType) + '</span>' : ''); }) +
      row('Profit split', function (p) { return esc(p.profitSplit); }) +
      row('News trading', function (p) { return esc(newsLabel(p.news)); }) +
      row('', function (p) {
        return p.website ? '<a class="btn btn-silver btn-sm" href="' + esc(p.website) + '" target="_blank" rel="noopener">Visit site ↗</a>' : '';
      });
  }

  /* ---------- filter wiring ---------- */
  function seg(id, fn) {
    var el = document.getElementById(id);
    el.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        el.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        fn(b.getAttribute('data-v'));
        render();
      });
    });
  }

  function init() {
    // size options from data
    var sel = document.getElementById('f-size');
    (window.PIPVANT_SIZES || []).forEach(function (s) {
      var o = document.createElement('option');
      o.value = String(s); o.textContent = fmtSize(s);
      sel.appendChild(o);
    });
    var md = document.getElementById('meta-date');
    if (md) md.textContent = 'verified ' + (META.lastVerified || '');
    /* Deals refreshed line — only when promos data actually loaded. */
    (function () {
      var dl = document.getElementById('deals-refreshed');
      if (!dl) return;
      try {
        var P = window.PIPVANT_PROMOS;
        if (P && P.lastChecked) {
          var d = fmtMD(P.lastChecked);
          if (d) { dl.textContent = '🎟 Deals refreshed ' + d; dl.hidden = false; }
        }
      } catch (e) {}
    })();

    seg('f-market', function (v) { state.market = v; });
    seg('f-dd', function (v) { state.dd = v; });
    seg('f-news', function (v) { state.news = v; });
    sel.addEventListener('change', function () { state.size = sel.value; render(); });
    document.getElementById('f-price').addEventListener('input', function (e) {
      var v = parseFloat(e.target.value);
      state.maxPrice = isNaN(v) ? null : v;
      render();
    });
    var split = document.getElementById('f-split');
    split.addEventListener('input', function () {
      state.minSplit = +split.value;
      document.getElementById('f-split-v').textContent = split.value + '%';
      render();
    });
    document.getElementById('f-reset').addEventListener('click', function () {
      state = { market: 'any', size: 'any', maxPrice: null, dd: 'any', news: 'any', minSplit: 50 };
      document.querySelectorAll('.seg button').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-v') === 'any');
      });
      sel.value = 'any';
      document.getElementById('f-price').value = '';
      split.value = 50;
      document.getElementById('f-split-v').textContent = '50%';
      compareKeys = [];
      document.getElementById('compare-section').style.display = 'none';
      render();
    });
    document.getElementById('tray-go').addEventListener('click', function () {
      renderCompareTable();
      document.getElementById('compare-section').scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('save-cmp-btn').addEventListener('click', function () {
      if (!PV.user || !PV.ok) { needLogin(); return; }
      if (compareKeys.length < 2) { alert('Add at least 2 programs to the comparison first.'); return; }
      var nameInput = document.getElementById('cmp-name');
      var name = nameInput.value.trim() ||
        ('Comparison — ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      var btn = this;
      btn.disabled = true;
      PV.from('saved_comparisons').insert({
        user_id: PV.user.id,
        name: name,
        firm_ids: compareKeys.slice(),
        filters: { market: state.market, size: state.size, maxPrice: state.maxPrice, dd: state.dd, news: state.news, minSplit: state.minSplit }
      }).then(function (res) {
        btn.disabled = false;
        if (res.error) { alert(PV.friendly(res.error)); return; }
        nameInput.value = '';
        loadSaved();
      });
    });
    render();
    initFirmModal();
    // cloud state after auth resolves
    PV.ready.then(function (user) {
      if (user && PV.ok) loadWatchlist().then(function () { paintWatchButtons(); return loadSaved(); });
      else loadSaved();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
