/* ============================================================
   PIPVANT Certificates UI — display earned certificates with QR.
   ============================================================ */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function load() {
    var PV = window.PV;
    var grid = document.getElementById('certs-grid');
    var empty = document.getElementById('certs-empty');
    if (!PV || !PV.user || !grid) return;
    grid.innerHTML = '<p class="micro">Loading…</p>';

    PV.from('certificates')
      .select('title,description,level,verify_code,earned_at')
      .eq('user_id', PV.user.id)
      .order('earned_at', { ascending: false })
      .then(function (res) {
        var certs = res.data || [];
        if (!certs.length) {
          grid.innerHTML = '';
          if (empty) empty.style.display = '';
          return;
        }
        if (empty) empty.style.display = 'none';
        grid.innerHTML = certs.map(function (c, i) {
          var d = new Date(c.earned_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
          return '' +
          '<div class="cert-card" style="background:linear-gradient(160deg,#0e1729,#080d18);border:1px solid #2a3a5c;border-radius:18px;padding:28px 24px;text-align:center;position:relative;overflow:hidden">' +
            '<div style="position:absolute;top:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,rgba(238,241,248,.5),transparent)"></div>' +
            '<p style="font-size:.62rem;letter-spacing:.28em;text-transform:uppercase;color:var(--steel);margin-bottom:10px">PIPVANT · Achievement</p>' +
            '<h4 style="font-family:var(--font-display);font-size:1.45rem;color:var(--silver-2);margin:0 0 4px">' + esc(c.title) + '</h4>' +
            '<div style="display:inline-block;margin:10px 0;padding:5px 16px;border:1px solid rgba(205,213,228,.3);border-radius:999px;font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;color:var(--silver-2)">Level ' + c.level + '</div>' +
            '<p style="font-size:.84rem;color:var(--ink-2);margin:6px 0 14px">' + esc(c.description || '') + '</p>' +
            '<div id="qr-' + i + '" style="display:inline-block;background:#fff;padding:10px;border-radius:12px;margin-bottom:12px"></div>' +
            '<p style="font-family:ui-monospace,monospace;font-size:.7rem;letter-spacing:.12em;color:var(--ink-3)">' + esc(c.verify_code) + '</p>' +
            '<p class="micro" style="margin-top:4px">' + d + '</p>' +
            '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line-soft)">' +
              '<div style="font-family:Georgia,serif;font-style:italic;font-size:1.15rem;color:var(--silver-2)">Saifeddine Ben Iaich</div>' +
              '<div style="font-size:.64rem;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-3)">Founder, PIPVANT</div>' +
            '</div>' +
          '</div>';
        }).join('');

        certs.forEach(function (c, i) {
          var el = document.getElementById('qr-' + i);
          if (!el) return;
          var url = location.origin + '/verify.html?c=' + encodeURIComponent(c.verify_code);
          if (window.QRCode) {
            new window.QRCode(el, { text: url, width: 110, height: 110, correctLevel: QRCode.CorrectLevel.M });
          } else {
            el.innerHTML = '<a href="' + esc(url) + '" style="font-size:.7rem">Verify</a>';
          }
        });
      })
      .catch(function () {
        grid.innerHTML = '<p class="micro">Could not load certificates.</p>';
      });
  }

  window.PVCertsUI = { load: load };
})();
