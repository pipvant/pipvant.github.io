/* ============================================================
   PIPVANT notifications — platform updates, features, important.
   Fetches from Supabase 'notifications' table, tracks reads.
   ============================================================ */
(function () {
  'use strict';
  var TYPE_ICON = { update: 'UPDATE', feature: 'NEW', important: 'ALERT' };
  var TYPE_LABEL = { update: 'Update', feature: 'New feature', important: 'Important' };
  function timeAgo(iso) {
    var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function init() {
    var PV = window.PV;
    if (!PV || !PV.from) return;
    var bell = document.querySelector('.nav-bell');
    var panel = document.querySelector('.notif-panel');
    if (!bell || !panel) return;
    PV.from('notifications')
      .select('id,title,body,type,link,created_at')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(function (res) {
        var items = (res.data || []);
        if (!items.length) return;
        renderList(panel, items);
        if (PV.user) checkUnread(PV, bell, items);
        else bell.classList.add('has-new');
      })
      .catch(function () {});
    var obs = new MutationObserver(function () {
      if (!panel.classList.contains('show')) return;
      bell.classList.remove('has-new');
      var PV2 = window.PV;
      if (!PV2 || !PV2.user) return;
      panel.querySelectorAll('[data-notif]').forEach(function (el) {
        var nid = el.getAttribute('data-notif');
        PV2.from('notification_reads')
          .upsert({ user_id: PV2.user.id, notification_id: nid }, { onConflict: 'user_id,notification_id' })
          .then(function () {});
      });
    });
    obs.observe(panel, { attributes: true, attributeFilter: ['class'] });
  }
  function checkUnread(PV, bell, items) {
    PV.from('notification_reads')
      .select('notification_id')
      .eq('user_id', PV.user.id)
      .then(function (res) {
        var read = {};
        (res.data || []).forEach(function (r) { read[r.notification_id] = 1; });
        var unread = items.some(function (n) { return !read[n.id]; });
        bell.classList.toggle('has-new', unread);
      })
      .catch(function () {});
  }
  function renderList(panel, items) {
    var body = panel.querySelector('.np-body');
    if (!body) return;
    body.style.textAlign = 'left';
    body.style.padding = '8px';
    var TYPE_COLORS = {
      update: 'color:#8fb8ff;border-color:rgba(143,184,255,.35);background:rgba(143,184,255,.08)',
      feature: 'color:#a8e6b8;border-color:rgba(168,230,184,.35);background:rgba(168,230,184,.08)',
      important: 'color:#ffb8b8;border-color:rgba(255,184,184,.35);background:rgba(255,184,184,.08)'
    };
    var TYPE_EMOJI = { update: '🔄', feature: '✨', important: '⚠️' };
    body.innerHTML = items.map(function (n) {
      var lb = TYPE_LABEL[n.type] || 'Notice';
      var tag = TYPE_ICON[n.type] || 'INFO';
      var tc = TYPE_COLORS[n.type] || 'color:var(--silver-2);border-color:var(--line);background:rgba(205,213,228,.06)';
      var em = TYPE_EMOJI[n.type] || '📌';
      var inner =
        '<div style="display:flex;gap:14px;padding:16px 14px;border-radius:16px;margin:6px;position:relative;overflow:hidden;background:linear-gradient(135deg,rgba(205,213,228,.04),transparent);border:1px solid transparent;transition:border-color .2s">' +
        '<span style="font-size:1.3rem;flex-shrink:0;filter:drop-shadow(0 2px 8px rgba(0,0,0,.4))">' + em + '</span>' +
        '<div style="min-width:0;flex:1">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<span style="font-size:.62rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;border:1px solid;border-radius:999px;padding:3px 10px;' + tc + '">' + tag + '</span>' +
        '<span style="font-size:.68rem;color:var(--ink-3)">' + timeAgo(n.created_at) + '</span>' +
        '</div>' +
        '<div style="font-weight:700;color:#fff;font-size:.95rem;margin-top:8px;line-height:1.4">' + esc(n.title) + '</div>' +
        '<div style="font-size:.84rem;color:var(--ink-2);margin-top:6px;line-height:1.6">' + esc(n.body) + '</div>' +
        '</div></div>';
      var wrap = n.link
        ? '<a data-notif="' + n.id + '" href="' + esc(n.link) + '" style="display:block;border-radius:12px">' + inner + '</a>'
        : '<div data-notif="' + n.id + '">' + inner + '</div>';
      return wrap + '<div style="height:1px;background:var(--line-soft);margin:0 12px"></div>';
    }).join('');
    var st = document.createElement('style');
    st.textContent = '.notif-panel [data-notif]:hover > div { border-color: #3d4f75 !important; background: linear-gradient(135deg, rgba(205,213,228,.08), transparent) !important; }';
    document.head.appendChild(st);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
