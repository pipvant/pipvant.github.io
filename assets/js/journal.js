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
      mistakes: t.mistake ? [t.mistake] : []
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
  function uploadShots(entryId, files) {
    var uid = CloudStore.uid;
    var jobs = Array.prototype.slice.call(files).slice(0, 5).map(function (f, i) {
      var path = uid + '/' + entryId + '/' + Date.now() + '-' + i + '-' + sanitise(f.name);
      return PV.storage().from('journal-shots').upload(path, f, { upsert: false })
        .then(function (up) {
          if (up.error) throw up.error;
          return PV.from('journal_attachments')
            .insert({ entry_id: entryId, user_id: uid, storage_path: path });
        });
    });
    return Promise.all(jobs);
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
  }

  function paintList() {
    var box = document.getElementById('trade-list');
    if (!trades.length) {
      box.innerHTML = '<div class="empty"><h3>No trades yet</h3><p>Add your first trade to start building your statistics.</p></div>';
      return Promise.resolve();
    }
    return loadShots().then(function () {
      var sorted = trades.slice().sort(function (a, b) { return b.date < a.date ? -1 : (b.id > a.id ? 1 : -1); });
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

  function refresh() { paintDash(); return paintList(); }

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
    // If auth state changes (login/logout in another tab), reload to switch stores.
    PV.onAuth(function () { location.reload(); });
    document.getElementById('add-btn').addEventListener('click', function () { openModal(null); });
    document.getElementById('cancel-btn').addEventListener('click', closeModal);
    document.getElementById('csv-btn').addEventListener('click', csv);
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
