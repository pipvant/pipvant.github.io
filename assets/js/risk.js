/* PIPVANT Risk Calculator — CFD lots + futures contracts. */
(function () {
  'use strict';
  var mode = 'cfd';

  function num(id) { return parseFloat(document.getElementById(id).value); }

  function calc() {
    var bal = num('c-balance'), riskPct = num('c-risk');
    if (!(bal > 0) || !(riskPct > 0)) return;
    var riskAmt = bal * riskPct / 100;
    var size, loss, unit, note;

    if (mode === 'cfd') {
      var pips = num('c-pips'), pipVal = num('c-pipval');
      if (!(pips > 0) || !(pipVal > 0)) return;
      size = riskAmt / (pips * pipVal);
      loss = size * pips * pipVal;
      unit = 'lots';
      note = size < 0.01 ? 'Below broker minimum — raise risk or shorten stop.' :
             size > 100 ? 'Very large size — double-check inputs.' : 'Within normal range.';
    } else {
      var instr = document.getElementById('c-instr').value;
      var tickVal = instr === 'custom' ? num('c-tick') : parseFloat(instr);
      var pts = num('c-points');
      if (!(tickVal > 0) || !(pts > 0)) return;
      var raw = riskAmt / (pts * tickVal);
      size = Math.floor(raw);
      if (size < 1) { size = raw; } // show fractional when below 1 contract
      loss = size * pts * tickVal;
      unit = 'contract' + (size === 1 ? '' : 's');
      var instrName = document.getElementById('c-instr').selectedOptions[0].textContent.split(' — ')[0];
      note = size < 1 ? 'Less than 1 ' + instrName + ' contract — widen stop or raise risk.' :
             (Number.isInteger(size) ? 'Whole ' + instrName + ' contracts — loss ≈ risk.' :
             'Fractional — micro contracts may fit better.');
    }

    document.getElementById('r-size').textContent = size >= 10 ? size.toFixed(1) : size.toFixed(2);
    document.getElementById('r-unit').textContent = unit;
    document.getElementById('r-amt').textContent = fmtUSD(riskAmt);
    document.getElementById('r-loss').textContent = fmtUSD(loss);
    document.getElementById('r-pct').textContent = riskPct + '%';
    document.getElementById('r-note').textContent = note;
  }

  /* ---------- cloud / local persistence of balance + risk % ---------- */
  var LS_KEY = 'pipvant_risk_v1';
  var saveTimer = null;

  /* ---------- Pro: multiple risk profiles (public.risk_profiles) ---------- */
  var proMode = false;
  var profiles = [];
  var activeId = null;

  function paintProfileSel() {
    var sel = document.getElementById('profile-sel');
    if (!sel) return;
    sel.innerHTML = profiles.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === activeId ? ' selected' : '') + '>' +
        escOpt(p.name) + '</option>';
    }).join('');
  }
  function escOpt(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function setActive(id) {
    activeId = id;
    var p = profiles.find(function (x) { return x.id === id; });
    if (p) applySettings(p.account_balance, p.risk_per_trade_percent);
    paintProfileSel();
  }
  function enterProMode() {
    proMode = true;
    var bar = document.getElementById('profile-bar');
    if (bar) bar.style.display = 'block';
    var p = profiles.find(function (x) { return x.is_default; }) || profiles[0];
    if (p) setActive(p.id);
    hint(true);
  }
  function loadProProfiles(user) {
    PV.from('risk_profiles').select('*').eq('user_id', user.id).order('created_at', { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        profiles = res.data || [];
        if (!profiles.length) {
          // First Pro run: seed a Default profile from current inputs.
          var d = readInputs();
          return PV.from('risk_profiles').insert({
            user_id: user.id,
            name: 'Default',
            account_balance: (d.balance > 0 ? d.balance : 5000),
            risk_per_trade_percent: (d.riskPct > 0 ? d.riskPct : 1),
            is_default: true
          }).select().single().then(function (r2) {
            if (r2.error) throw r2.error;
            profiles = [r2.data];
          });
        }
      })
      .then(function () { enterProMode(); })
      .catch(function () {
        // Table missing (migration not run yet) or denied: single-profile fallback.
        proMode = false;
        loadSingleCloud();
      });
  }
  function proSave() {
    var p = profiles.find(function (x) { return x.id === activeId; });
    var d = readInputs();
    if (!p || !(d.balance > 0) || !(d.riskPct > 0)) return;
    p.account_balance = d.balance;
    p.risk_per_trade_percent = d.riskPct;
    PV.from('risk_profiles').update({
      account_balance: d.balance,
      risk_per_trade_percent: d.riskPct,
      updated_at: new Date().toISOString()
    }).eq('id', p.id).then(function () { hint(true); }, function () { hint(false); });
  }
  function proAdd() {
    if (!proMode || !PV.user) return;
    var name = prompt('Name this risk profile:', 'Account ' + (profiles.length + 1));
    if (!name || !name.trim()) return;
    var d = readInputs();
    PV.from('risk_profiles').insert({
      user_id: PV.user.id,
      name: name.trim().slice(0, 40),
      account_balance: (d.balance > 0 ? d.balance : 5000),
      risk_per_trade_percent: (d.riskPct > 0 ? d.riskPct : 1)
    }).select().single().then(function (res) {
      if (res.error) { alert(PV.friendly(res.error)); return; }
      profiles.push(res.data);
      setActive(res.data.id);
    });
  }
  function proRename() {
    if (!proMode) return;
    var p = profiles.find(function (x) { return x.id === activeId; });
    if (!p) return;
    var name = prompt('Rename profile:', p.name);
    if (!name || !name.trim() || name.trim() === p.name) return;
    p.name = name.trim().slice(0, 40);
    paintProfileSel();
    PV.from('risk_profiles').update({ name: p.name, updated_at: new Date().toISOString() })
      .eq('id', p.id).then(function () { hint(true); }, function () { hint(false); });
  }
  function proDel() {
    if (!proMode) return;
    if (profiles.length <= 1) { alert('You need at least one risk profile.'); return; }
    var p = profiles.find(function (x) { return x.id === activeId; });
    if (!p || !confirm('Delete profile "' + p.name + '"?')) return;
    PV.from('risk_profiles').delete().eq('id', p.id).then(function (res) {
      if (res.error) { alert(PV.friendly(res.error)); return; }
      profiles = profiles.filter(function (x) { return x.id !== p.id; });
      setActive(profiles[0].id);
    });
  }
  function loadSingleCloud() {
    PV.from('risk_settings').select('account_balance, risk_per_trade_percent')
      .eq('user_id', PV.user.id).maybeSingle().then(function (res) {
        if (res.data) { applySettings(res.data.account_balance, res.data.risk_per_trade_percent); hint(true); }
        else loadLocal();
      }).catch(function () { loadLocal(); });
  }
  /* Free users: single profile, shown locked with a tasteful Pro upsell. */
  function showLockedProfiles() {
    var bar = document.getElementById('profile-bar');
    if (!bar || bar.getAttribute('data-locked')) return;
    bar.setAttribute('data-locked', '1');
    bar.style.display = 'block';
    var sel = document.getElementById('profile-sel');
    if (sel) { sel.innerHTML = '<option>Default</option>'; sel.disabled = true; }
    ['profile-add', 'profile-rename', 'profile-del'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.style.display = 'none';
    });
    var note = document.getElementById('profile-note');
    if (note) note.innerHTML = 'Multiple risk profiles are a <a href="../pricing.html" style="color:var(--silver-2);font-weight:600">Pro</a> feature.';
  }

  function applySettings(bal, riskPct) {
    if (bal > 0) document.getElementById('c-balance').value = bal;
    if (riskPct > 0) document.getElementById('c-risk').value = riskPct;
    calc();
  }
  function readInputs() {
    return {
      balance: parseFloat(document.getElementById('c-balance').value),
      riskPct: parseFloat(document.getElementById('c-risk').value)
    };
  }
  function persistLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(readInputs())); } catch (e) {}
  }
  function loadLocal() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_KEY));
      if (d) applySettings(d.balance, d.riskPct);
    } catch (e) {}
    hint(false);
  }
  function cloudSave() {
    if (!PV.user || !PV.ok) return;
    var d = readInputs();
    if (!(d.balance > 0) || !(d.riskPct > 0)) return;
    PV.from('risk_settings').upsert({
      user_id: PV.user.id,
      account_balance: d.balance,
      risk_per_trade_percent: d.riskPct,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' }).then(function () { hint(true); }, function () { hint(false); });
  }
  function hint(cloud) {
    var el = document.getElementById('risk-sync');
    if (!el) return;
    el.textContent = cloud ? '✓ Synced to your account' : 'Saved on this device';
  }
  function schedulePersist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (proMode) { proSave(); return; }
      if (PV.user && PV.ok) cloudSave(); else { persistLocal(); hint(false); }
    }, 800);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var seg = document.getElementById('mode');
    seg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        mode = b.getAttribute('data-v');
        document.getElementById('cfd-fields').style.display = mode === 'cfd' ? 'block' : 'none';
        document.getElementById('fut-fields').style.display = mode === 'futures' ? 'block' : 'none';
        calc();
      });
    });
    document.getElementById('c-instr').addEventListener('change', function (e) {
      document.getElementById('c-custom-wrap').style.display = e.target.value === 'custom' ? 'block' : 'none';
      calc();
    });
    document.querySelectorAll('input, select').forEach(function (el) {
      if (el.hasAttribute('data-nopersist')) return; // profile switcher manages itself
      el.addEventListener('input', calc);
      el.addEventListener('change', calc);
      el.addEventListener('input', schedulePersist);
      el.addEventListener('change', schedulePersist);
    });
    // Pro profile switcher
    var psel = document.getElementById('profile-sel');
    if (psel) psel.addEventListener('change', function (e) { setActive(e.target.value); });
    var padd = document.getElementById('profile-add');
    if (padd) padd.addEventListener('click', proAdd);
    var pren = document.getElementById('profile-rename');
    if (pren) pren.addEventListener('click', proRename);
    var pdel = document.getElementById('profile-del');
    if (pdel) pdel.addEventListener('click', proDel);
    // boot: Pro profiles when pro, else cloud single profile / device settings
    PV.ready.then(function (user) {
      if (user && PV.ok) {
        if (PV.isPro()) { loadProProfiles(user); return; }
        showLockedProfiles();
        loadSingleCloud();
      } else loadLocal();
    });
    calc();
  });
})();
