/* ════════════════════════════════════════════════════════════
   chess-ai.js —— 国际象棋电脑决策
   子力 + 位置价值表（PST）+ alpha-beta 迭代加深；MVV-LVA 排序。
   三档：入门 = 浅搜 + 大随机边带；进阶 = 3 层；高手 = 4~5 层限时
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub;
  var Chess = Hub.Chess, CH = Hub.CH;
  var N = 8, NC = CH.NC, VAL = CH.VAL;

  /* 位置价值表（白方视角，index 0 = a8）；黑方竖向镜像取用 */
  var PST = {
    1: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0],
    2: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50],
    3: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20],
    4: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0],
    5: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20],
    6: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20]
  };
  function mirror(i) { return (7 - ((i / N) | 0)) * N + (i % N); }

  Chess.prototype._material = function () {
    var v = 0, i, t;
    for (i = 0; i < NC; i++) {
      t = this.b[i];
      if (!t) continue;
      if (t > 0) v += VAL[t] + PST[t][i];
      else v -= VAL[-t] + PST[-t][mirror(i)];
    }
    return v;                       // 正数利于白
  };

  /** 是否存在任一合法着（早退，比生成全部便宜） */
  Chess.prototype.hasLegal = function (seat) {
    var ps = this.pseudoMoves(seat), i;
    for (i = 0; i < ps.length; i++) {
      this.doMove(ps[i]);
      var bad = this.inCheck(seat);
      this.unMove(ps[i]);
      if (!bad) return true;
    }
    return false;
  };

  Chess.prototype._ctx = function () {
    var self = this;
    var cache = { ply: -1, list: null };
    return {
      moves: function (ply) {
        if (cache.ply === ply) return cache.list;
        cache.ply = ply;
        cache.list = self.legalMoves(self.turn);
        return cache.list;
      },
      make: function (m) { self.doMove(m); },
      unmake: function (m) { self.unMove(m); },
      terminal: function (ply) {
        if (!self.hasLegal(self.turn)) {
          return self.inCheck(self.turn) ? -(Hub.search.MATE - ply) : 0;
        }
        if (self.half >= 100) return 0;
        return null;
      },
      evaluate: function () {
        var v = self._material();
        return self.turn === 0 ? v : -v;
      },
      orderScore: function (m) {
        var victim = m.ep ? 1 : Math.abs(self.b[m.t]);
        var attacker = Math.abs(self.b[m.f]);
        var s = victim ? (VAL[victim] * 10 - attacker) : 0;
        if (m.promo) s += VAL[5];
        return s;
      }
    };
  };

  Chess.prototype.aiMove = function (level) {
    if (this._over) return false;
    level = level || 2;
    var opts = level <= 1
      ? { maxDepth: 2, timeMs: 350, margin: 150, rnd: Math.random, rndTop: 5 }
      : (level === 2
        ? { maxDepth: 3, timeMs: 800, margin: 25 }
        : { maxDepth: 5, timeMs: 1600 });
    var r = Hub.search.best(this._ctx(), opts);
    if (!r) return false;
    return this.play(r.move);
  };

  Chess.prototype.suggest = function (level) {
    if (this._over) { Hub.App.toast('对局已结束'); return null; }
    var r = Hub.search.best(this._ctx(), {
      maxDepth: level == null ? 4 : (level + 2), timeMs: 1200
    });
    if (!r) { Hub.App.toast('无合法着法'); return null; }
    this.sugg = { f: r.move.f, t: r.move.t };
    Hub.App.toast('建议：' + this.moveText(r.move, this.turn) + '（深度 ' + r.depth + '）');
    return this.sugg;
  };

  Chess.prototype.clearSuggestion = function () { this.sugg = null; };

})(window);
