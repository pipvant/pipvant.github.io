/* ============================================================
   PIPVANT Leaderboard — fair scoring from real journal data.
   Opt-in only. Composite score rewards consistency, not gambling.
   ============================================================ */
(function () {
  'use strict';

  var MIN_TRADES = 20;

  /* Compute a 0-100 composite score from journal stats.
     Weights: profit factor 40%, win rate 25%, avg R 20%, volume 15%.
     Caps prevent one lucky streak from dominating. */
  function computeScore(s) {
    if (!s || s.n < MIN_TRADES) return 0;

    /* profit factor: 1.0 -> 0, 2.0 -> 100 (capped) */
    var pf = Math.max(0, Math.min(100, (s.pf - 1) * 100));

    /* win rate: 50% -> 50, scaled 0-100 */
    var wr = Math.max(0, Math.min(100, s.wr * 100));

    /* avg R: 0 -> 0, 1.0R -> 100 (capped) */
    var ar = Math.max(0, Math.min(100, s.avgR * 100));

    /* volume: 20 trades -> ~30, 100+ trades -> 100 (log scale) */
    var vol = Math.max(0, Math.min(100, Math.log(s.n / MIN_TRADES + 1) / Math.log(6) * 100));

    return Math.round(pf * 0.40 + wr * 0.25 + ar * 0.20 + vol * 0.15);
  }

  /* Server-side trusted scoring: the database computes the score from
     journal_entries. Users cannot fake their rank via console. */
  function syncEntry(stats, profile) {
    var PV = window.PV;
    if (!PV || !PV.user || !PV.client) return Promise.resolve();
    return PV.client.rpc('sync_leaderboard').then(function () {}).catch(function () {});
  }

  /* Load the public leaderboard, sorted by score */
  function loadBoard(limit) {
    var PV = window.PV;
    if (!PV || !PV.from) return Promise.reject(new Error('no db'));
    return PV.from('leaderboard')
      .select('display_name,avatar_url,score,total_trades,win_rate,profit_factor,avg_r,updated_at')
      .order('score', { ascending: false })
      .limit(limit || 50)
      .then(function (res) { return res.data || []; });
  }

  window.PVBoard = {
    computeScore: computeScore,
    sync: syncEntry,
    load: loadBoard,
    minTrades: MIN_TRADES
  };
})();
