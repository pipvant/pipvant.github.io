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
    body.innerHTML = items.map(function (n) {
      var lb = TYPE_LABEL[n.type] || 'Notice';
      var tag = TYPE_ICON[n.type] || 'INFO';
      var inner =
        '<div style="display:flex;gap:12px;padding:12px;border-radius:12px">' +
        '<span style="font-size:.68rem;font-weight:800;letter-spacing:.08em;flex-shrink:0;color:var(--silver-2);border:1px solid var(--line);border-radius:8px;padding:4px 8px;height:fit-content">' + tag + '</span>' +
        '<div style="min-width:0">' +
        '<div style="font-weight:700;color:var(--silver-2);font-size:.9rem">' + esc(n.title) + '</div>' +
        '<div style="font-size:.82rem;color:var(--ink-2);margin-top:4px;line-height:1.5">' + esc(n.body) + '</div>' +
        '<div style="font-size:.7rem;color:var(--ink-3);margin-top:6px">' + lb + ' - ' + timeAgo(n.created_at) + '</div>' +
        '</div></div>';
      var wrap = n.link
        ? '<a data-notif="' + n.id + '" href="' + esc(n.link) + '" style="display:block;border-radius:12px">' + inner + '</a>'
        : '<div data-notif="' + n.id + '">' + inner + '</div>';
      return wrap + '<div style="height:1px;background:var(--line-soft);margin:0 12px"></div>';
    }).join('');
    var st = document.createElement('style');
    st.textContent = '.notif-panel [data-notif]:hover { background: rgba(205,213,228,.06); }';
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
