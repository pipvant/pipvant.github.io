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
        { level: 1, name: 'Rising Trader', need: 10, desc: 'Logged 10 trades' },
        { level: 2, name: 'Active Trader', need: 50, desc: 'Logged 50 trades' },
        { level: 3, name: 'Century Trader', need: 100, desc: 'Logged 100 trades' },
        { level: 4, name: 'Elite Trader', need: 500, desc: 'Logged 500 trades' }
      ],
      check: function (stats) { return stats.totalTrades; }
    },
    streak: {
      title: 'Consistency',
      levels: [
        { level: 1, name: 'Consistent Week', need: 7, desc: '7-day journaling streak' },
        { level: 2, name: 'Dedicated Month', need: 30, desc: '30-day journaling streak' },
        { level: 3, name: 'Unstoppable', need: 100, desc: '100-day journaling streak' }
      ],
      check: function (stats) { return stats.bestStreak; }
    },
    winrate: {
      title: 'Precision',
      levels: [
        { level: 1, name: 'Sharp Shooter', need: 55, minTrades: 20, desc: '55%+ win rate over 20 trades' },
        { level: 2, name: 'Precision Trader', need: 60, minTrades: 50, desc: '60%+ win rate over 50 trades' }
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
        { level: 1, name: 'Profitable', need: 1.5, minTrades: 30, desc: 'Profit factor 1.5+ over 30 trades' },
        { level: 2, name: 'Elite Edge', need: 2.0, minTrades: 50, desc: 'Profit factor 2.0+ over 50 trades' }
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

  function checkAchievements(stats, onNew) {
    var PV = window.PV;
    if (!PV || !PV.user || !PV.from) return;
    var uid = PV.user.id;

    PV.from('certificates').select('type,level').eq('user_id', uid)
      .then(function (res) {
        var earned = {};
        (res.data || []).forEach(function (c) { earned[c.type + '-' + c.level] = 1; });
        var queue = [];
        Object.keys(ACHIEVEMENTS).forEach(function (type) {
          var def = ACHIEVEMENTS[type];
          def.levels.forEach(function (lvl) {
            if (earned[type + '-' + lvl.level]) return;
            var val = def.check(stats, lvl);
            if (val >= lvl.need) {
              queue.push({
                user_id: uid,
                type: type,
                level: lvl.level,
                title: lvl.name,
                description: lvl.desc,
                verify_code: genCode()
              });
            }
          });
        });
        if (!queue.length) return;
        (function next(i) {
          if (i >= queue.length) { if (onNew) onNew(queue); return; }
          PV.from('certificates').insert(queue[i]).then(function () { next(i + 1); })
            .catch(function () { next(i + 1); });
        })(0);
      })
      .catch(function () {});
  }

  window.PVCerts = {
    check: checkAchievements,
    definitions: ACHIEVEMENTS
  };
})();
