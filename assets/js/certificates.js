/* ============================================================
   PIPVANT Certificates — achievement detection and issuance.
   Milestones with levels, QR verification, founder signature.
   ============================================================ */
(function () {
  'use strict';

  var ACHIEVEMENTS = {
    trades: {
      title: 'Trader',
      levels: [
        { level: 1, name: 'Rising Trader', need: 25, desc: 'Logged 25 trades with discipline' },
        { level: 2, name: 'Active Trader', need: 100, desc: 'Logged 100 trades with discipline' },
        { level: 3, name: 'Century Trader', need: 250, desc: 'Logged 250 trades with discipline' },
        { level: 4, name: 'Elite Trader', need: 1000, desc: 'Logged 1000 trades with discipline' }
      ],
      check: function (stats) { return stats.totalTrades; }
    },
    streak: {
      title: 'Consistency',
      levels: [
        { level: 1, name: 'Consistent Fortnight', need: 14, desc: '14-day journaling streak' },
        { level: 2, name: 'Dedicated Quarter', need: 90, desc: '90-day journaling streak' },
        { level: 3, name: 'Unstoppable', need: 365, desc: '365-day journaling streak — a full year' }
      ],
      check: function (stats) { return stats.bestStreak; }
    },
    winrate: {
      title: 'Precision',
      levels: [
        { level: 1, name: 'Sharp Shooter', need: 58, minTrades: 50, desc: '58%+ win rate over 50 trades' },
        { level: 2, name: 'Precision Trader', need: 65, minTrades: 100, desc: '65%+ win rate over 100 trades' }
      ],
      check: function (stats, lvl) {
        if (stats.totalTrades < lvl.minTrades) return 0;
        return stats.winRate;
      }
    },
    discipline: {
      title: 'Discipline',
      levels: [
        { level: 1, name: 'Disciplined', need: 20, desc: '20 trades with risk at or below 2%' },
        { level: 2, name: 'Risk Master', need: 50, desc: '50 trades with risk at or below 1.5%' }
      ],
      check: function (stats, lvl) {
        var maxRisk = lvl.level === 1 ? 2 : 1.5;
        return stats.disciplinedTrades(maxRisk);
      }
    },
    profitfactor: {
      title: 'Edge',
      levels: [
        { level: 1, name: 'Profitable', need: 1.8, minTrades: 50, desc: 'Profit factor 1.8+ over 50 trades' },
        { level: 2, name: 'Elite Edge', need: 2.5, minTrades: 100, desc: 'Profit factor 2.5+ over 100 trades' }
      ],
      check: function (stats, lvl) {
        if (stats.totalTrades < lvl.minTrades) return 0;
        return stats.profitFactor;
      }
    }
  };

  function genCode() {
    var c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var s = 'PV-';
    for (var i = 0; i < 8; i++) s += c.charAt(Math.floor(Math.random() * c.length));
    return s;
  }

  /* Server-side trusted issuance: the database computes stats from
     journal_entries and awards only genuinely earned certificates. */
  function checkAchievements(stats, onNew) {
    var PV = window.PV;
    if (!PV || !PV.user || !PV.client) return;
    PV.client.rpc('award_certificates').then(function (res) {
      if (res.error) return;
      var fresh = (res.data || []).filter(function (c) { return c.is_new; });
      if (!fresh.length) return;
      /* send site notifications for new certificates */
      fresh.forEach(function (cert) {
        PV.from('notifications').insert({
          user_id: PV.user.id,
          title: 'Achievement unlocked: ' + cert.ctitle,
          body: 'You earned the ' + cert.ctitle + ' certificate (Level ' + cert.clevel + '). View it on your certificates page.',
          type: 'feature',
          link: 'certificates.html'
        }).catch(function () {});
      });
      if (onNew) onNew(fresh.map(function (c) {
        return { type: c.ctype, level: c.clevel, title: c.ctitle };
      }));
    }).catch(function () {});
  }

  window.PVCerts = {
    check: checkAchievements,
    definitions: ACHIEVEMENTS
  };
})();
