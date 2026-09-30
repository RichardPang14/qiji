/* ════════════════════════════════════════════════════════════
   checkers-ai.js —— 跳棋电脑着法
   评估基础：多源 BFS 预计算「每格到各目标角的最短单步距离」，
             己方十枚棋子的距离和越小越好（跳棋中距离单调、无吃子，
             该启发式与实际进度高度相关）。
   三档：入门 = 近最优加权随机；进阶 = 纯贪心；高手 = 3 层前瞻
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub;
  var Checkers = Hub.Checkers, C = Hub.CK;
  var NC = C.NC, NB = C.NB, REGION_CELLS = C.REGION_CELLS, PIECES = C.PIECES;
  var INF = 1e9, WIN = 1e7;

  /* ───────── 距离场：DIST[区域][格] = 最短单步距离 ───────── */
  var DIST = [];
  (function () {
    for (var rg = 0; rg < 6; rg++) {
      var d = new Int16Array(NC), i, k, q = [], head = 0;
      for (i = 0; i < NC; i++) d[i] = -1;
      var src = REGION_CELLS[rg];
      for (i = 0; i < src.length; i++) { d[src[i]] = 0; q.push(src[i]); }
      while (head < q.length) {
        var cur = q[head++], nb = NB[cur];
        for (k = 0; k < 6; k++) {
          var n = nb[k];
          if (n >= 0 && d[n] < 0) { d[n] = d[cur] + 1; q.push(n); }
        }
      }
      for (i = 0; i < NC; i++) if (d[i] < 0) d[i] = 999;   // 理论上不存在不可达格
      DIST[rg] = d;
    }
  })();

  Checkers.prototype.distTable = function (seat) { return DIST[this.targetOf[seat]]; };

  /** 己方距离和（越小越接近目标） */
  function distSum(g, seat) {
    var d = DIST[g.targetOf[seat]], i, sum = 0;
    for (i = 0; i < NC; i++) if (g.b[i] === seat + 1) sum += d[i];
    return sum;
  }

  /** 静态评估，以 seat 视角，越大越好 */
  function evalSeat(g, seat) {
    var v = -distSum(g, seat) + 9 * g.countHome(seat);
    /* 轻微抑制对手进度：对手距离和越大对我越有利 */
    for (var s = 0; s < g.players; s++) {
      if (s === seat) continue;
      v += 0.10 * distSum(g, s);
    }
    return v;
  }

  /** 生成并按推进量排序的着法；并列时优先搬落后的子 */
  function orderedMoves(g, seat, limit) {
    var d = DIST[g.targetOf[seat]];
    var ms = g.genMoves(seat), k;
    for (k = 0; k < ms.length; k++) {
      var m = ms[k];
      m.v = (d[m.f] - d[m.t]) + (m.jump ? 0.35 : 0) + d[m.f] * 0.02;
    }
    ms.sort(function (a, b) { return b.v - a.v; });
    return limit ? ms.slice(0, limit) : ms;
  }

  /* ───────── 前瞻搜索（多人局非零和，故不用 alpha-beta 剪枝） ───────── */
  function search(g, me, depth, limit) {
    if (depth <= 0) return evalSeat(g, me);
    var cur = g.turn;
    var ms = orderedMoves(g, cur, limit);
    if (!ms.length) return evalSeat(g, me);

    var maximizing = (cur === me);
    var best = maximizing ? -INF : INF;
    for (var k = 0; k < ms.length; k++) {
      var m = ms[k];
      g.doMove(m);
      var v;
      if (g.countHome(cur) >= PIECES) v = (cur === me) ? (WIN - depth) : -(WIN - depth);
      else v = search(g, me, depth - 1, limit);
      g.unMove(m);
      if (maximizing) { if (v > best) best = v; }
      else { if (v < best) best = v; }
    }
    return best;
  }

  /* ───────── 难度参数 ───────── */
  var CAND = { 1: 8, 2: 99, 3: 10 };
  var DEPTH = { 1: 0, 2: 0, 3: 3 };

  Checkers.prototype._think = function (level) {
    if (this._over) return null;
    var lv = CAND[level] ? level : 2;
    var me = this.turn;
    var ms = orderedMoves(this, me, null);
    if (!ms.length) return null;
    if (ms.length === 1) return ms[0];

    /* 入门：在推进量靠前的若干着里加权随机，常漏掉最佳连环跳 */
    if (lv === 1) {
      var top = ms.slice(0, CAND[1]);
      var pool = top.map(function (m) { return { m: m, v: Math.max(0, m.v) + 1 }; });
      var pick = Hub.search.weighted(pool, 1.8);
      return pick ? pick.m : ms[0];
    }

    /* 进阶：纯贪心，取推进量最大者（严格并列时随机，避免每盘雷同） */
    if (lv === 2) {
      var bestV = ms[0].v, tied = [], k;
      for (k = 0; k < ms.length; k++) {
        if (ms[k].v < bestV - 1e-9) break;
        tied.push(ms[k]);
      }
      return tied[(Math.random() * tied.length) | 0];
    }

    /* 高手：候选内做 3 层前瞻 */
    var cands = ms.slice(0, CAND[3]);
    var best = null, bestScore = -INF, j;
    for (j = 0; j < cands.length; j++) {
      var m = cands[j];
      this.doMove(m);
      var v = (this.countHome(me) >= PIECES)
        ? WIN
        : search(this, me, DEPTH[3] - 1, CAND[3]);
      this.unMove(m);
      v += m.v * 1e-4;                      // 并列时的次级排序
      if (v > bestScore) { bestScore = v; best = m; }
    }
    this._lastScore = bestScore;
    return best || ms[0];
  };

  /* ───────── 对外接口 ───────── */
  Checkers.prototype.aiMove = function (level) {
    var m = this._think(level);
    if (!m) return false;
    this.play(m);
    return true;
  };

  Checkers.prototype.suggest = function (level) {
    var m = this._think(level == null ? 3 : level);
    if (!m) { Hub.App.toast('暂无可走之着'); return null; }
    this.sugg = m;
    this.sel = -1; this.selMoves = [];
    Hub.App.toast('建议：' + this.moveText({ f: m.f, t: m.t, seat: this.turn, jump: m.jump }));
    return m;
  };
  Checkers.prototype.clearSuggestion = function () { this.sugg = null; };

})(window);
