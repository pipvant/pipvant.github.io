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
      el.addEventListener('input', calc);
      el.addEventListener('change', calc);
      el.addEventListener('input', schedulePersist);
      el.addEventListener('change', schedulePersist);
    });
    // boot: cloud settings when signed in, device settings otherwise
    PV.ready.then(function (user) {
      if (user && PV.ok) {
        PV.from('risk_settings').select('account_balance, risk_per_trade_percent')
          .eq('user_id', user.id).maybeSingle().then(function (res) {
            if (res.data) { applySettings(res.data.account_balance, res.data.risk_per_trade_percent); hint(true); }
            else loadLocal();
          }).catch(function () { loadLocal(); });
      } else loadLocal();
    });
    calc();
  });
})();
