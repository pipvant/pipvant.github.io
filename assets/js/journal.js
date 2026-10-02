/* ============================================================
   PIPVANT Trading Journal — stats + SVG equity curve.
   Storage: cloud (Supabase) when signed in, localStorage fallback
   when signed out or offline. Same UI either way.
   ============================================================ */
(function () {
  'use strict';
  var KEY = 'pipvant_journal_v1';

  /* ---------- field mapping: local shape <-> DB row ---------- */
  var SES2DB = { 'New York': 'new_york', 'London': 'london', 'Asian': 'asia' };
  var DB2SES = { 'new_york': 'New York', 'london': 'London', 'asia': 'Asian' };
  var RES2DB = { win: 'win', loss: 'loss', be: 'breakeven' };
  var DB2RES = { win: 'win', loss: 'loss', breakeven: 'be', open: 'be' };

  function rowToLocal(r) {
    return {
      id: r.id, _rid: r.id,
      date: r.trade_date,
      symbol: r.symbol || '',
      side: r.direction === 'short' ? 'Short' : 'Long',
      session: DB2SES[r.session] || 'Other',
      entry: parseFloat(r.entry_price),
      exit: r.exit_price == null ? parseFloat(r.entry_price) : parseFloat(r.exit_price),
      size: parseFloat(r.position_size) || 0,
      riskR: parseFloat(r.risk_percent) || 0,
      result: DB2RES[r.result] || 'be',
      notes: r.notes || '',
      mistake: (r.mistakes && r.mistakes.length) ? r.mistakes[0] : '',
      setup: (r.setup_tags && r.setup_tags.length) ? r.setup_tags[0] : '',
      shots: []
    };
  }
  function localToRow(t, uid) {
    return {
      user_id: uid,
      symbol: t.symbol,
      direction: t.side === 'Short' ? 'short' : 'long',
      trade_date: t.date,
      session: SES2DB[t.session] || null,
      entry_price: t.entry,
      exit_price: t.exit,
      position_size: t.size,
      risk_percent: t.riskR,
      pnl: pnl(t),
      pnl_r: rMult(t),
      result: RES2DB[t.result] || 'breakeven',
      notes: t.notes || null,
      mistakes: t.mistake ? [t.mistake] : [],
      setup_tags: t.setup ? [t.setup] : []
    };
  }

  /* ---------- stores ---------- */
  var LocalStore = {
    name: 'local',
    load: function () {
      try { return Promise.resolve(JSON.parse(localStorage.getItem(KEY)) || []); }
      catch (e) { return Promise.resolve([]); }
    },
    save: function (rec) {
      var all;
      try { all = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { all = []; }
      var i = all.findIndex(function (t) { return t.id === rec.id; });
      if (i >= 0) all[i] = rec; else all.push(rec);
      try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
      return Promise.resolve(rec);
    },
    remove: function (id) {
      var all;
      try { all = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { all = []; }
      all = all.filter(function (t) { return t.id !== id; });
      try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
      return Promise.resolve();
    }
  };

  var CloudStore = {
    name: 'cloud',
    uid: null,
    load: function () {
      var self = this;
      self.uid = PV.user.id;
      return PV.from('journal_entries')
        .select('*').eq('user_id', self.uid)
        .order('trade_date', { ascending: false }).order('created_at', { ascending: false })
        .then(function (res) {
          if (res.error) throw res.error;
          return (res.data || []).map(rowToLocal);
        });
    },
    save: function (rec) {
      var self = this;
      var row = localToRow(rec, self.uid);
      var q = rec._rid
        ? PV.from('journal_entries').update(row).eq('id', rec._rid).select().single()
        : PV.from('journal_entries').insert(row).select().single();
      return q.then(function (res) {
        if (res.error) throw res.error;
        var saved = rowToLocal(res.data);
        saved.shots = rec.shots || [];
        return saved;
      });
    },
    remove: function (rec) {
      var id = rec._rid || rec.id;
      return PV.from('journal_entries').delete().eq('id', id).then(function (res) {
        if (res.error) throw res.error;
      });
    }
  };

  /* ---------- state ---------- */
  var trades = [];
  var store = LocalStore;
  var cloudMode = false;
  var editing = null;

  /* ---------- math (unchanged) ---------- */
  function pnl(t) {
    var d = (t.exit - t.entry) * t.size * (t.side === 'Long' ? 1 : -1);
    return Math.round(d * 100) / 100;
  }
  function rMult(t) {
    if (!t.riskR) return 0;
    if (t.result === 'win') return t.riskR;
    if (t.result === 'loss') return -t.riskR;
    return 0;
  }
  function stats() {
    var n = trades.length;
    if (!n) return null;
    var pnlTot = 0, wins = 0, rTot = 0, grossW = 0, grossL = 0;
    trades.forEach(function (t) {
      var p = pnl(t), r = rMult(t);
      pnlTot += p; rTot += r;
      if (t.result === 'win') { wins++; grossW += p; }
      else if (t.result === 'loss') { grossL += Math.abs(p); }
    });
    return {
      n: n, pnl: pnlTot, wr: wins / n, avgR: rTot / n,
      pf: grossL > 0 ? grossW / grossL : (grossW > 0 ? Infinity : 0),
      exp: pnlTot / n
    };
  }

  /* ---------- attachments (cloud only) ---------- */
  function sanitise(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'shot.png';
  }
  function monthStartISO() {
    var d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  function uploadShots(entryId, files) {
    var uid = CloudStore.uid;
    var list = Array.prototype.slice.call(files).slice(0, 5);
    if (!list.length) return Promise.resolve([]);
    // Free plan: 20 chart screenshots per calendar month
    var gate = PV.isPro() ? Promise.resolve({ count: 0 }) :
      PV.from('journal_attachments').select('id', { count: 'exact', head: true })
        .eq('user_id', uid).gte('created_at', monthStartISO());
    return gate.then(function (res) {
      if (res && res.count >= 20) {
        PV.upgradeModal("You've used your 20 free chart screenshots this month. PIPVANT Pro includes unlimited screenshots for every trade.");
        return [];
      }
      var jobs = list.map(function (f, i) {
        var path = uid + '/' + entryId + '/' + Date.now() + '-' + i + '-' + sanitise(f.name);
        return PV.storage().from('journal-shots').upload(path, f, { upsert: false })
          .then(function (up) {
            if (up.error) throw up.error;
            return PV.from('journal_attachments')
              .insert({ entry_id: entryId, user_id: uid, storage_path: path });
          });
      });
      return Promise.all(jobs);
    });
  }
  function loadShots() {
    if (!cloudMode || !trades.length) return Promise.resolve();
    var ids = trades.map(function (t) { return t._rid || t.id; }).filter(Boolean);
    if (!ids.length) return Promise.resolve();
    return PV.from('journal_attachments')
      .select('entry_id, storage_path').in('entry_id', ids)
      .then(function (res) {
        if (res.error || !res.data) return;
        var byEntry = {};
        res.data.forEach(function (a) {
          (byEntry[a.entry_id] = byEntry[a.entry_id] || []).push(a.storage_path);
        });
        var jobs = [];
        Object.keys(byEntry).forEach(function (eid) {
          byEntry[eid].forEach(function (path) {
            jobs.push(
              PV.storage().from('journal-shots').createSignedUrl(path, 3600).then(function (s) {
                if (s.data && s.data.signedUrl) {
                  var t = trades.find(function (x) { return (x._rid || x.id) === eid; });
                  if (t) t.shots.push(s.data.signedUrl);
                }
              }).catch(function () {})
            );
          });
        });
        return Promise.all(jobs);
      }).catch(function () {});
  }

  /* ---------- rendering ---------- */
  function paintDash() {
    var dash = document.getElementById('dash');
    var s = stats();
    dash.style.display = 'grid';
    if (!s) {
      ['d-trades','d-wr','d-avgr','d-pf','d-exp'].forEach(function (id) { document.getElementById(id).textContent = '—'; });
      document.getElementById('d-pnl').textContent = '$0';
      document.getElementById('equity-wrap').style.display = 'none';
      return;
    }
    document.getElementById('d-trades').textContent = s.n;
    var pe = document.getElementById('d-pnl');
    pe.textContent = (s.pnl >= 0 ? '+' : '−') + fmtUSD(Math.abs(s.pnl));
    pe.classList.toggle('pos', s.pnl >= 0);
    pe.classList.toggle('neg', s.pnl < 0);
    document.getElementById('d-wr').textContent = (s.wr * 100).toFixed(1) + '%';
    var ar = document.getElementById('d-avgr');
    ar.textContent = (s.avgR >= 0 ? '+' : '') + s.avgR.toFixed(2) + 'R';
    ar.classList.toggle('pos', s.avgR >= 0);
    ar.classList.toggle('neg', s.avgR < 0);
    document.getElementById('d-pf').textContent = isFinite(s.pf) ? s.pf.toFixed(2) : '∞';
    document.getElementById('d-exp').textContent = fmtUSD(s.exp) + ' /trade';
    paintEquity();
  }

  function paintEquity() {
    var wrap = document.getElementById('equity-wrap');
    var svg = document.getElementById('equity');
    if (trades.length < 2) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    var sorted = trades.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var cum = 0, pts = sorted.map(function (t) { cum += pnl(t); return cum; });
    var W = 600, H = 220, pad = 16;
    var min = Math.min.apply(null, [0].concat(pts));
    var max = Math.max.apply(null, [0].concat(pts));
    var span = (max - min) || 1;
    function X(i) { return pad + (W - 2 * pad) * (i / (pts.length - 1)); }
    function Y(v) { return pad + (H - 2 * pad) * (1 - (v - min) / span); }
    var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ');
    var up = pts[pts.length - 1] >= 0;
    svg.innerHTML =
      '<line x1="' + pad + '" y1="' + Y(0) + '" x2="' + (W - pad) + '" y2="' + Y(0) +
        '" stroke="#1c2740" stroke-width="1" stroke-dasharray="4 4"/>' +
      '<path d="' + d + '" fill="none" stroke="' + (up ? '#3ddc84' : '#ff6b6b') + '" stroke-width="2.5"/>' +
      '<circle cx="' + X(pts.length - 1) + '" cy="' + Y(pts[pts.length - 1]) + '" r="4" fill="' + (up ? '#3ddc84' : '#ff6b6b') + '"/>';
    if (window.PVFX) window.PVFX.animateEquity(svg);
  }

  /* ---------- Pro Analytics (gated: Pro only) ---------- */
  function paintProAnalytics() {
    var box = document.getElementById('pro-analytics');
    if (!box) return;
    if (!PV.isPro()) { PV.requirePro(box, 'Pro Analytics'); return; }
    if (!trades.length) {
      box.innerHTML = '<div class="empty"><h3>Pro Analytics</h3><p>Log trades to unlock mistake patterns, setup stats and session breakdowns.</p></div>';
      return;
    }
    var mist = {}, setups = {}, sess = {};
    var buckets = [['< −2R', 0], ['−2R to −1R', 0], ['−1R to 0R', 0], ['0R to +1R', 0], ['+1R to +2R', 0], ['> +2R', 0]];
    trades.forEach(function (t) {
      var p = pnl(t), r = rMult(t);
      if (t.mistake) {
        var m = mist[t.mistake] || (mist[t.mistake] = { n: 0, pnl: 0 });
        m.n++; m.pnl += p;
      }
      if (t.setup) {
        var s = setups[t.setup] || (setups[t.setup] = { w: 0, n: 0 });
        s.n++; if (t.result === 'win') s.w++;
      }
      var ses = t.session || 'Other';
      sess[ses] = (sess[ses] || 0) + p;
      buckets[r < -2 ? 0 : r < -1 ? 1 : r < 0 ? 2 : r <= 1 ? 3 : r <= 2 ? 4 : 5][1]++;
    });
    function bar(label, frac, val, cls) {
      return '<div class="abar"><div class="lbl">' + esc(label) + '</div>' +
        '<div class="track"><div class="fill ' + (cls || '') + '" style="width:' + Math.round(Math.min(1, frac) * 100) + '%"></div></div>' +
        '<div class="val">' + val + '</div></div>';
    }
    function money(v) { return (v >= 0 ? '+' : '−') + fmtUSD(Math.abs(v)); }
    var html = '<h2>Pro Analytics <span class="pro-lock-badge" style="margin:0 0 0 8px;vertical-align:4px">PRO</span></h2><div class="pa-grid">';
    // mistakes by frequency + P&L impact
    var mKeys = Object.keys(mist).sort(function (a, b) { return mist[b].n - mist[a].n; }).slice(0, 6);
    var maxM = 1; mKeys.forEach(function (k) { maxM = Math.max(maxM, mist[k].n); });
    html += '<div class="card pa-block"><h4>Top mistakes</h4><p class="micro">By frequency — and what each one cost you.</p>' +
      (mKeys.length ? mKeys.map(function (k) {
        return bar(k, mist[k].n / maxM, mist[k].n + '× · ' + money(mist[k].pnl), mist[k].pnl < 0 ? 'neg' : 'pos');
      }).join('') : '<p class="micro">No mistakes logged. Clean trading.</p>') + '</div>';
    // win rate by setup tag
    var sKeys = Object.keys(setups).sort(function (a, b) { return setups[b].n - setups[a].n; }).slice(0, 6);
    var maxS = 1; sKeys.forEach(function (k) { maxS = Math.max(maxS, setups[k].n); });
    html += '<div class="card pa-block"><h4>Win rate by setup</h4><p class="micro">Which patterns actually pay you.</p>' +
      (sKeys.length ? sKeys.map(function (k) {
        var wr = setups[k].w / setups[k].n;
        return bar(k, setups[k].n / maxS, (wr * 100).toFixed(0) + '% · ' + setups[k].n + ' trades', wr >= 0.5 ? 'pos' : 'neg');
      }).join('') : '<p class="micro">Add a setup tag to your trades to unlock this.</p>') + '</div>';
    // net P&L by session
    var sesKeys = Object.keys(sess);
    var maxP = 1; sesKeys.forEach(function (k) { maxP = Math.max(maxP, Math.abs(sess[k])); });
    html += '<div class="card pa-block"><h4>Net P&L by session</h4><p class="micro">Where your edge lives.</p>' +
      sesKeys.map(function (k) {
        return bar(k, Math.abs(sess[k]) / maxP, money(sess[k]), sess[k] >= 0 ? 'pos' : 'neg');
      }).join('') + '</div>';
    // R-multiple distribution
    var maxB = 1; buckets.forEach(function (b) { maxB = Math.max(maxB, b[1]); });
    html += '<div class="card pa-block"><h4>R-multiple distribution</h4><p class="micro">How your outcomes spread.</p>' +
      buckets.map(function (b) { return bar(b[0], b[1] / maxB, b[1] + ' trade' + (b[1] === 1 ? '' : 's'), ''); }).join('') + '</div>';
    html += '</div>';
    box.innerHTML = html;
  }

  function paintList() {
    var box = document.getElementById('trade-list');
    if (!trades.length) {
      box.innerHTML = '<div class="empty"><h3>No trades yet</h3><p>Add your first trade to start building your statistics.</p></div>';
      return Promise.resolve();
    }
    return loadShots().then(function () {
      var sorted = trades.slice().sort(function (a, b) { return b.date < a.date ? -1 : (b.id > a.id ? 1 : -1); });
      if (calFilter) sorted = sorted.filter(function (t) { return t.date === calFilter; });
      if (!sorted.length) {
        box.innerHTML = calFilter
          ? '<div class="empty"><h3>No trades on ' + esc(calFilter) + '</h3><p><a href="#" id="cal-clear2" style="color:var(--silver-2);font-weight:600">Show all trades</a></p></div>'
          : '<div class="empty"><h3>No trades yet</h3><p>Add your first trade to start building your statistics.</p></div>';
        var c2 = document.getElementById('cal-clear2');
        if (c2) c2.addEventListener('click', function (e) {
          e.preventDefault(); calFilter = null; paintCal(); paintList();
        });
        return;
      }
      box.innerHTML = sorted.map(function (t) {
        var p = pnl(t), cls = p > 0 ? 'pos' : (p < 0 ? 'neg' : '');
        var rc = t.result === 'win' ? 'pos' : (t.result === 'loss' ? 'neg' : '');
        var shots = (t.shots && t.shots.length)
          ? '<div class="thumbs">' + t.shots.map(function (u) {
              return '<a href="' + u + '" target="_blank" rel="noopener"><img src="' + u + '" alt="Chart screenshot" loading="lazy"></a>';
            }).join('') + '</div>' : '';
        return '<div class="trade-row">' +
          '<div><strong>' + esc(t.symbol) + '</strong> <span class="micro">' + esc(t.side) + ' · ' + esc(t.session) + '</span><br>' +
            '<span class="micro">' + esc(t.date) + (t.notes ? ' · ' + esc(t.notes) : '') + (t.mistake ? ' · ⚠ ' + esc(t.mistake) : '') + '</span>' +
            shots + '</div>' +
          '<div class="r ' + rc + '">' + esc(t.result.toUpperCase()) + '<br><span class="' + cls + '">' +
            (p >= 0 ? '+' : '−') + fmtUSD(Math.abs(p)) + ' · ' + (rMult(t) >= 0 ? '+' : '') + rMult(t).toFixed(2) + 'R</span></div>' +
          '<div class="row-actions"><button class="icon-btn edit" data-id="' + t.id + '" aria-label="Edit">✎</button>' +
          '<button class="icon-btn del" data-id="' + t.id + '" aria-label="Delete">×</button></div>' +
        '</div>';
      }).join('');
      box.querySelectorAll('.edit').forEach(function (b) {
        b.addEventListener('click', function () { openModal(trades.find(function (t) { return t.id === b.getAttribute('data-id'); })); });
      });
      box.querySelectorAll('.del').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Delete this trade?')) return;
          var t = trades.find(function (x) { return x.id === b.getAttribute('data-id'); });
          setBusy(true);
          store.remove(cloudMode ? t : t.id).then(function () {
            trades = trades.filter(function (x) { return x.id !== t.id; });
            return refresh();
          }).catch(function (err) {
            alert(PV.friendly(err));
          }).then(function () { setBusy(false); });
        });
      });
    });
  }

  function setBusy(on) {
    var btn = document.getElementById('add-btn');
    if (btn) btn.disabled = !!on;
  }

  function paintSyncNote() {
    var el = document.getElementById('sync-note');
    if (!el) return;
    if (cloudMode) {
      el.innerHTML = '☁ Cloud sync is on — your journal is saved to your PIPVANT account and follows you across devices.';
      el.classList.add('ok');
    } else {
      el.innerHTML = 'Saved on this device only (local storage). <a href="../login.html" style="color:var(--silver-2);font-weight:600">Sign in</a> for cloud sync across devices.';
      el.classList.remove('ok');
    }
    var hint = document.getElementById('shot-hint');
    if (hint) hint.textContent = cloudMode
      ? 'Up to 5 images per trade — stored privately in your cloud.'
      : 'Sign in to attach chart screenshots — they need cloud storage.';
    var fi = document.getElementById('shot-input');
    if (fi) fi.disabled = !cloudMode;
  }

  /* ---------- modal ---------- */
  function openModal(t) {
    editing = t || null;
    document.getElementById('modal-title').textContent = t ? 'Edit trade' : 'Add trade';
    var f = document.getElementById('trade-form');
    f.reset();
    var fi = document.getElementById('shot-input');
    if (fi) fi.value = '';
    if (t) {
      Object.keys(t).forEach(function (k) { if (f.elements[k]) f.elements[k].value = t[k]; });
    } else {
      f.elements.date.value = new Date().toISOString().slice(0, 10);
    }
    document.getElementById('modal').classList.add('show');
  }
  function closeModal() { document.getElementById('modal').classList.remove('show'); }

  /* ---------- calendar heatmap ---------- */
  var calCursor = new Date(); calCursor.setDate(1);
  var calFilter = null; // 'YYYY-MM-DD' or null

  function dayKey(y, m, d) {
    return y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  function heatColor(pnlV, maxAbs) {
    if (!pnlV) return '';
    var a = Math.min(0.85, 0.18 + 0.67 * Math.abs(pnlV) / (maxAbs || 1));
    return pnlV > 0
      ? 'background:rgba(61,220,132,' + a.toFixed(2) + ');color:#eef1f7;'
      : 'background:rgba(255,107,107,' + a.toFixed(2) + ');color:#eef1f7;';
  }
  function paintCal() {
    var grid = document.getElementById('cal-grid');
    var title = document.getElementById('cal-title');
    if (!grid || !title) return;
    var y = calCursor.getFullYear(), m = calCursor.getMonth();
    title.textContent = calCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    var byDay = {};
    trades.forEach(function (t) { byDay[t.date] = (byDay[t.date] || 0) + pnl(t); });
    var maxAbs = 1;
    Object.keys(byDay).forEach(function (k) { maxAbs = Math.max(maxAbs, Math.abs(byDay[k])); });
    var first = new Date(y, m, 1).getDay();
    var days = new Date(y, m + 1, 0).getDate();
    var html = ['Su','Mo','Tu','We','Th','Fr','Sa'].map(function (d) {
      return '<div class="cal-dow">' + d + '</div>';
    }).join('');
    for (var i = 0; i < first; i++) html += '<div class="cal-day blank"></div>';
    for (var d = 1; d <= days; d++) {
      var k = dayKey(y, m, d);
      var v = byDay[k];
      var cls = 'cal-day' + (calFilter === k ? ' sel' : '');
      var style = v ? heatColor(v, maxAbs) : '';
      var tip = v ? ('Net ' + (v >= 0 ? '+' : '−') + fmtUSD(Math.abs(v))) : 'No trades';
      html += '<button class="' + cls + '" data-day="' + k + '" style="' + style + '"' +
        ' aria-label="' + k + ': ' + tip + '"><span class="n">' + d + '</span></button>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll('[data-day]').forEach(function (b) {
      b.addEventListener('click', function () {
        calFilter = (calFilter === b.getAttribute('data-day')) ? null : b.getAttribute('data-day');
        paintCal();
        paintList();
      });
    });
    var note = document.getElementById('cal-note');
    if (note) note.innerHTML = calFilter
      ? 'Showing trades for <strong style="color:var(--silver-2)">' + esc(calFilter) + '</strong> — <a href="#" id="cal-clear" style="color:var(--silver-2);font-weight:600">clear</a>'
      : 'Click a day to filter trades.';
    var clear = document.getElementById('cal-clear');
    if (clear) clear.addEventListener('click', function (e) {
      e.preventDefault(); calFilter = null; paintCal(); paintList();
    });
  }

  function refresh() { paintDash(); paintCal(); paintProAnalytics(); return paintList(); }

  function csv() {
    if (!trades.length) return;
    var rows = [['id','date','symbol','side','session','entry','exit','size','riskR','result','pnl','R','notes','mistake']];
    trades.forEach(function (t) {
      rows.push([t.id, t.date, t.symbol, t.side, t.session, t.entry, t.exit, t.size, t.riskR, t.result, pnl(t), rMult(t), t.notes || '', t.mistake || '']);
    });
    var s = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(s);
    a.download = 'pipvant-journal.csv';
    a.click();
  }

  /* ---------- PDF trade report (Pro; via print stylesheet) ---------- */
  function buildPrintReport() {
    var el = document.getElementById('print-report');
    if (!el) return;
    var s = stats();
    var sorted = trades.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    function money(v) { return (v >= 0 ? '+' : '−') + '$' + Math.abs(v).toFixed(2); }
    var statHtml = s ? [
      ['Trades', String(s.n)],
      ['Net P&L', money(s.pnl)],
      ['Win rate', (s.wr * 100).toFixed(1) + '%'],
      ['Avg R', (s.avgR >= 0 ? '+' : '') + s.avgR.toFixed(2) + 'R'],
      ['Profit factor', isFinite(s.pf) ? s.pf.toFixed(2) : '∞'],
      ['Expectancy', money(s.exp) + ' /trade']
    ].map(function (x) {
      return '<div><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div></div>';
    }).join('') : '<p>No trades logged yet.</p>';
    var rows = sorted.map(function (t) {
      var p = pnl(t);
      return '<tr><td>' + esc(t.date) + '</td><td>' + esc(t.symbol) + '</td><td>' + esc(t.side) + '</td>' +
        '<td>' + esc(t.session) + '</td><td>' + esc(t.setup || '—') + '</td>' +
        '<td>' + esc(t.result.toUpperCase()) + '</td>' +
        '<td class="' + (p > 0 ? 'pos' : p < 0 ? 'neg' : '') + '">' + money(p) + '</td>' +
        '<td>' + (rMult(t) >= 0 ? '+' : '') + rMult(t).toFixed(2) + 'R</td></tr>';
    }).join('');
    el.innerHTML =
      '<h1>PIPVANT — Trade Report</h1>' +
      '<p class="pr-meta">Generated ' + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) +
      (cloudMode ? ' · Cloud journal' : ' · This device') + '</p>' +
      '<h2>Summary</h2><div class="pr-stats">' + statHtml + '</div>' +
      '<h2>Trades (' + sorted.length + ')</h2>' +
      '<table><thead><tr><th>Date</th><th>Symbol</th><th>Side</th><th>Session</th><th>Setup</th><th>Result</th><th>P&amp;L</th><th>R</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="8">No trades logged yet.</td></tr>') + '</tbody></table>' +
      '<p class="disc">PIPVANT provides software tools, not financial advice. Past performance does not predict future results.</p>';
  }

  /* ---------- boot ---------- */
  function boot() {
    return PV.ready.then(function (user) {
      if (user && PV.ok) {
        return CloudStore.load().then(function (rows) {
          store = CloudStore; cloudMode = true; trades = rows;
        }).catch(function (err) {
          // Cloud unreachable or denied: stay local, say so.
          store = LocalStore; cloudMode = false;
          return LocalStore.load().then(function (rows) {
            trades = rows;
            setTimeout(function () { alert('Cloud journal unavailable (' + PV.friendly(err) + ') — working from this device for now.'); }, 300);
          });
        });
      }
      return LocalStore.load().then(function (rows) { trades = rows; });
    }).then(function () {
      paintSyncNote();
      return refresh();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    boot();
    // If the user signs in/out in another tab, reload to switch stores.
    // Only on real SIGNED_IN/SIGNED_OUT transitions — never on INITIAL_SESSION
    // or TOKEN_REFRESHED, otherwise the page reloads itself in a loop.
    // Belt-and-braces: cap auth-triggered reloads per tab so a stale session
    // can never trap the page in an infinite reload cycle.
    PV.onAuth(function (user, evt) {
      if (evt !== 'SIGNED_IN' && evt !== 'SIGNED_OUT') return;
      var n = 0;
      try { n = parseInt(sessionStorage.getItem('pv-auth-reloads') || '0', 10) || 0; } catch (e) {}
      if (n >= 2) return;
      try { sessionStorage.setItem('pv-auth-reloads', String(n + 1)); } catch (e) {}
      location.reload();
    });
    document.getElementById('add-btn').addEventListener('click', function () { openModal(null); });
    document.getElementById('cal-prev').addEventListener('click', function () {
      calCursor.setMonth(calCursor.getMonth() - 1); paintCal();
    });
    document.getElementById('cal-next').addEventListener('click', function () {
      calCursor.setMonth(calCursor.getMonth() + 1); paintCal();
    });
    document.getElementById('cancel-btn').addEventListener('click', closeModal);
    document.getElementById('csv-btn').addEventListener('click', csv);
    document.getElementById('pdf-btn').addEventListener('click', function () {
      if (!PV.isPro()) {
        PV.upgradeModal('PDF trade reports are a Pro feature — a clean, print-ready summary of your stats and every trade, in one click.');
        return;
      }
      buildPrintReport();
      window.print();
    });
    window.addEventListener('afterprint', function () {
      var el = document.getElementById('print-report');
      if (el) el.innerHTML = '';
    });
    document.getElementById('modal').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    document.getElementById('trade-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var rec = editing ? Object.assign({}, editing) : { id: 't' + Date.now(), shots: [] };
      rec.date = f.elements.date.value;
      rec.symbol = f.elements.symbol.value.trim().toUpperCase();
      rec.side = f.elements.side.value;
      rec.session = f.elements.session.value;
      rec.entry = parseFloat(f.elements.entry.value);
      rec.exit = parseFloat(f.elements.exit.value);
      rec.size = parseFloat(f.elements.size.value);
      rec.riskR = parseFloat(f.elements.riskR.value) || 0;
      rec.result = f.elements.result.value;
      rec.notes = f.elements.notes.value.trim();
      rec.mistake = f.elements.mistake.value;
      rec.setup = f.elements.setup ? f.elements.setup.value.trim() : (rec.setup || '');
      // Free plan: 100-trade cap (kind, honest — Pro is unlimited)
      if (!editing && !PV.isPro() && trades.length >= 100) {
        closeModal();
        PV.upgradeModal("You've logged 100 trades on the Free plan — that's real consistency. PIPVANT Pro gives you unlimited trades, so your journal never gets in the way of your review.");
        return;
      }
      setBusy(true);
      var files = document.getElementById('shot-input').files;
      store.save(rec).then(function (saved) {
        var idx = trades.findIndex(function (t) { return t.id === saved.id; });
        if (idx >= 0) trades[idx] = saved; else trades.push(saved);
        if (cloudMode && files && files.length) {
          return uploadShots(saved._rid || saved.id, files).catch(function (err) {
            alert('Trade saved, but screenshots failed to upload: ' + PV.friendly(err));
          });
        }
      }).then(function () {
        closeModal(); return refresh();
      }).catch(function (err) {
        alert(PV.friendly(err));
      }).then(function () { setBusy(false); });
    });
  });
})();
