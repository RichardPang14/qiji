/* ════════════════════════════════════════════════════════════
   search.js —— 通用博弈搜索（negamax + alpha-beta + 迭代加深）
   ════════════════════════════════════════════════════════════
   各棋种只需提供一个 ctx 对象：
   {
     moves(ply)      -> [move, ...]      当前行棋方的合法着法
     make(move)                            执行
     unmake(move)                          撤销（必须严格还原）
     evaluate()      -> number             静态评估，站在「当前行棋方」视角
     terminal(ply)   -> number|null        终局分值（当前行棋方视角），未终局返回 null
     orderScore(move, ply) -> number       着法排序权重，可选
   }
   best(ctx, opts) -> {move, score, depth, nodes, ms}
   opts: {maxDepth, timeMs, maxNodes, margin, rnd}
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub;
  var now = Hub.util.now;

  var INF = 1e9;
  var MATE = 1e6;

  Hub.search = {
    INF: INF,
    MATE: MATE,

    /**
     * 迭代加深搜索，返回最佳着法。
     * 超时后回退到上一层已完成的结果，保证一定有解。
     */
    best: function (ctx, opts) {
      opts = opts || {};
      var maxDepth = Math.max(1, opts.maxDepth || 3);
      var timeMs = opts.timeMs || 800;
      var maxNodes = opts.maxNodes || 4000000;
      var t0 = now();

      var st = { t0: t0, timeMs: timeMs, maxNodes: maxNodes, nodes: 0, stop: false, depth: 0 };

      var root = ctx.moves(0);
      if (!root || !root.length) return null;
      if (root.length === 1 && !opts.forceFull) {
        return { move: root[0], score: 0, depth: 1, nodes: 1, ms: now() - t0, sole: true };
      }

      /* 根节点排序：先用启发分，再随迭代逐层用回传分 */
      var scored = root.map(function (m) {
        return { m: m, s: ctx.orderScore ? ctx.orderScore(m, 0) : 0, prev: null };
      });
      scored.sort(function (a, b) { return b.s - a.s; });

      var bestEntry = scored[0];
      var bestScore = -INF;
      var completed = 0;

      for (var d = 1; d <= maxDepth; d++) {
        st.depth = d;
        var alpha = -INF, beta = INF;
        var iterBest = null, iterScore = -INF;
        var aborted = false;

        for (var i = 0; i < scored.length; i++) {
          var e = scored[i];
          ctx.make(e.m);
          var v;
          try {
            v = -negamax(ctx, d - 1, -beta, -alpha, 1, st);
          } catch (err) {
            ctx.unmake(e.m);
            if (err && err.__abort) { aborted = true; break; }
            throw err;
          }
          ctx.unmake(e.m);
          if (st.stop) { aborted = true; break; }

          e.prev = v;
          if (v > iterScore) { iterScore = v; iterBest = e; }
          if (v > alpha) alpha = v;
        }

        if (aborted || !iterBest) break;

        /* 本层完成：按本层得分重排，便于下次迭代优先展开 */
        bestEntry = iterBest; bestScore = iterScore; completed = d;
        scored.sort(function (a, b) { return (b.prev == null ? -INF : b.prev) - (a.prev == null ? -INF : a.prev); });

        /* 已找到杀棋，无需再深搜 */
        if (bestScore >= MATE - 1000) break;
        if (now() - t0 > timeMs * .55) break;
      }

      var pool = scored.filter(function (e) { return e.prev != null; });
      if (!pool.length) pool = scored;

      /* margin：允许在最优分附近随机挑选，降低低难度的机械感 */
      var chosen = bestEntry;
      if (opts.margin > 0 && completed > 0) {
        var cand = pool.filter(function (e) { return e.prev >= bestScore - opts.margin; });
        if (cand.length > 1) {
          var rnd = opts.rnd || Math.random;
          chosen = cand[(rnd() * cand.length) | 0];
        }
      } else if (opts.rnd && completed <= 1 && scored.length > 1) {
        /* 最浅层：直接从启发分前列里随机 */
        var k = Math.min(scored.length, opts.rndTop || 4);
        chosen = scored[(opts.rnd() * k) | 0];
      }

      return {
        move: chosen.m,
        score: chosen.prev == null ? bestScore : chosen.prev,
        depth: completed || 1,
        nodes: st.nodes,
        ms: now() - t0
      };
    },

    /**
     * 在候选集合里按权重随机挑选（弱 AI / 平局打散用）
     * items: [{v: 权重}], power 越大越偏向高分
     */
    weighted: function (items, power, rnd) {
      rnd = rnd || Math.random;
      if (!items.length) return null;
      if (items.length === 1) return items[0];
      power = power == null ? 1 : power;
      var mx = -Infinity, i;
      for (i = 0; i < items.length; i++) if (items[i].v > mx) mx = items[i].v;
      var tot = 0;
      for (i = 0; i < items.length; i++) {
        items[i]._w = 1 / Math.pow(mx - items[i].v + 1, power);
        tot += items[i]._w;
      }
      var t = rnd() * tot;
      for (i = 0; i < items.length; i++) { t -= items[i]._w; if (t <= 0) return items[i]; }
      return items[items.length - 1];
    }
  };

  /* ─────────── 内部：negamax ─────────── */
  function abortErr() { var e = new Error('abort'); e.__abort = true; return e; }

  function negamax(ctx, depth, alpha, beta, ply, st) {
    if ((++st.nodes & 511) === 0) {
      if (now() - st.t0 > st.timeMs || st.nodes > st.maxNodes) st.stop = true;
    }
    if (st.stop) throw abortErr();

    var t = ctx.terminal ? ctx.terminal(ply) : null;
    if (t != null) return t;

    if (depth <= 0) return ctx.evaluate();

    var moves = ctx.moves(ply);
    if (!moves.length) {
      /* 无着法：由 terminal 未判定，视为被困，给一个接近被将死的分值 */
      return -(MATE - ply);
    }

    if (ctx.orderScore) {
      moves.sort(function (a, b) { return ctx.orderScore(b, ply) - ctx.orderScore(a, ply); });
    }

    var best = -INF;
    for (var i = 0; i < moves.length; i++) {
      ctx.make(moves[i]);
      var v = -negamax(ctx, depth - 1, -beta, -alpha, ply + 1, st);
      ctx.unmake(moves[i]);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

})(window);
