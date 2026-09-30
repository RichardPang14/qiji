/* ════════════════════════════════════════════════════════════
   xiangqi-ai.js —— 中国象棋电脑着法
   评估 = 子力 + 位置价值表（PST）+ 车路通敞 + 机动性 + 被将惩罚
   搜索 = 迭代加深 alpha-beta，MVV-LVA / PST 增量 / killer 着法排序
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub;
  var X = Hub.XQ, Xiangqi = Hub.Xiangqi;
  var KING = X.KING, ADV = X.ADV, BISH = X.BISH, KNIGHT = X.KNIGHT;
  var ROOK = X.ROOK, CANNON = X.CANNON, PAWN = X.PAWN, RED = X.RED;
  var MATE = Hub.search.MATE;

  /* ── 子力基准分 ── */
  var BASE = [];
  BASE[KING] = 10000; BASE[ROOK] = 900; BASE[CANNON] = 452;
  BASE[KNIGHT] = 430; BASE[ADV] = 206; BASE[BISH] = 202; BASE[PAWN] = 100;

  /* 位置表：一律以「己方底线为第 0 行」书写，9 列 × 10 行 */
  function T(rows) {
    var a = new Int16Array(90);
    for (var r = 0; r < 10; r++) for (var c = 0; c < 9; c++) a[r * 9 + c] = rows[r][c];
    return a;
  }

  var PST = [];

  /* 兵：过河后价值陡增，逼近九宫最强 */
  PST[PAWN] = T([
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [2, 0, 4, 0, 6, 0, 4, 0, 2],
    [6, 0, 10, 0, 14, 0, 10, 0, 6],
    [14, 20, 30, 40, 46, 40, 30, 20, 14],
    [20, 30, 44, 56, 62, 56, 44, 30, 20],
    [26, 34, 48, 62, 70, 62, 48, 34, 26],
    [30, 38, 50, 66, 76, 66, 50, 38, 30],
    [14, 18, 24, 34, 42, 34, 24, 18, 14]
  ]);

  /* 马：居中向前为佳，底线与边角迟钝 */
  PST[KNIGHT] = T([
    [0, -4, 0, 0, 0, 0, 0, -4, 0],
    [0, 2, 4, 4, -2, 4, 4, 2, 0],
    [4, 2, 8, 8, 4, 8, 8, 2, 4],
    [2, 6, 8, 6, 10, 6, 8, 6, 2],
    [4, 12, 16, 14, 12, 14, 16, 12, 4],
    [6, 16, 14, 18, 16, 18, 14, 16, 6],
    [8, 24, 18, 24, 20, 24, 18, 24, 8],
    [12, 14, 16, 20, 18, 20, 16, 14, 12],
    [4, 10, 28, 16, 8, 16, 28, 10, 4],
    [4, 8, 16, 12, 4, 12, 16, 8, 4]
  ]);

  /* 车：深入敌阵、占据要道为佳 */
  PST[ROOK] = T([
    [-2, 10, 6, 14, 12, 14, 6, 10, -2],
    [8, 4, 8, 16, 8, 16, 8, 4, 8],
    [4, 8, 6, 14, 12, 14, 6, 8, 4],
    [6, 10, 8, 14, 14, 14, 8, 10, 6],
    [12, 16, 14, 20, 20, 20, 14, 16, 12],
    [12, 14, 12, 18, 18, 18, 12, 14, 12],
    [12, 18, 16, 22, 22, 22, 16, 18, 12],
    [12, 12, 12, 18, 18, 18, 12, 12, 12],
    [16, 20, 18, 24, 26, 24, 18, 20, 16],
    [14, 14, 12, 18, 16, 18, 12, 14, 14]
  ]);

  /* 炮：需炮架，宜守中线，孤军深入反受制 */
  PST[CANNON] = T([
    [6, 4, 0, -10, -12, -10, 0, 4, 6],
    [2, 2, 0, -4, -14, -4, 0, 2, 2],
    [2, 2, 0, -10, -8, -10, 0, 2, 2],
    [0, 4, -2, 0, 10, 0, -2, 4, 0],
    [0, 0, 2, 0, 6, 0, 2, 0, 0],
    [-2, 0, 4, 0, 6, 0, 4, 0, -2],
    [0, 0, 2, 4, 6, 4, 2, 0, 0],
    [2, 2, 4, 6, 6, 6, 4, 2, 2],
    [0, 2, 4, 6, 8, 6, 4, 2, 0],
    [0, 0, 2, 6, 10, 6, 2, 0, 0]
  ]);

  /* 将：稳坐底线，露头即危 */
  PST[KING] = T([
    [0, 0, 0, 8, 12, 8, 0, 0, 0],
    [0, 0, 0, -4, -8, -4, 0, 0, 0],
    [0, 0, 0, -10, -16, -10, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0]
  ]);

  /* 士：联防为宜，撑起中士反挡将路 */
  PST[ADV] = T([
    [0, 0, 0, 2, 0, 2, 0, 0, 0],
    [0, 0, 0, 0, 6, 0, 0, 0, 0],
    [0, 0, 0, 1, 0, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0]
  ]);

  /* 象：守家，边象稍逊 */
  PST[BISH] = T([
    [0, 0, 2, 0, 0, 0, 2, 0, 0],
    [0, 0, 0, 0, 3, 0, 0, 0, 0],
    [1, 0, 2, 0, 2, 0, 2, 0, 1],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 2, 0, 0, 0, 2, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0]
  ]);

  /* 己方视角行号：红方底线在第 9 行，黑方底线在第 0 行 */
  function orow(side, r) { return side === RED ? 9 - r : r; }

  /* ───────── 静态评估（返回值以红方为正） ───────── */
  function evalRed(g) {
    var b = g.b, s = 0, i, p, t, r, c, side;
    for (i = 0; i < 90; i++) {
      p = b[i];
      if (!p) continue;
      if (p > 0) { t = p; side = RED; } else { t = -p; side = 1; }
      r = (i / 9) | 0; c = i % 9;
      var v = BASE[t] + PST[t][orow(side, r) * 9 + c];
      s += side === RED ? v : -v;
    }
    return s + rookFileBonus(g, RED) - rookFileBonus(g, 1);
  }

  /* 车占通路：本路无己方兵则通敞 */
  function rookFileBonus(g, side) {
    var b = g.b, bonus = 0, i, c, r, p, q;
    for (i = 0; i < 90; i++) {
      p = b[i];
      if (!p) continue;
      if ((p > 0 ? RED : 1) !== side) continue;
      if ((p > 0 ? p : -p) !== ROOK) continue;
      c = i % 9;
      var ownPawn = 0, foePawn = 0;
      for (r = 0; r < 10; r++) {
        q = b[r * 9 + c];
        if (!q) continue;
        if ((q > 0 ? q : -q) !== PAWN) continue;
        if ((q > 0 ? RED : 1) === side) ownPawn++; else foePawn++;
      }
      if (!ownPawn) bonus += 14;
      if (!foePawn) bonus += 8;
    }
    return bonus;
  }

  /* ───────── 搜索上下文 ───────── */
  function makeCtx(g) {
    var cache = [];        // cache[ply] = 该节点的合法着法（terminal 与 moves 共用，避免重复生成）
    var capStack = [];     // 每层被吃子，用于 unmake
    var killers = [];      // 每层的杀手着法
    var curPly = 0;

    function moves(ply) {
      var m = cache[ply];
      if (m === undefined) {
        m = g.legalMoves(g.turn);
        cache[ply] = m;
      }
      return m;
    }

    return {
      moves: moves,

      terminal: function (ply) {
        if (!moves(ply).length) return -(MATE - ply);   // 将死或困毙，均判负
        return null;
      },

      make: function (mv) {
        curPly++;
        cache[curPly] = undefined;      // 新局面，子节点缓存作废
        capStack.push(g.doMove(mv));
      },

      unmake: function (mv) {
        g.unMove(mv, capStack.pop());
        cache[curPly] = undefined;
        curPly--;
      },

      evaluate: function () {
        var red = evalRed(g);
        var v = g.turn === RED ? red : -red;
        var m = cache[curPly];
        if (m) v += m.length * 2;                     // 机动性
        if (g.inCheck(g.turn)) v -= 26;               // 被将军的额外惩罚
        return v;
      },

      orderScore: function (mv) {
        var f = (mv / 90) | 0, t = mv % 90;
        var p = g.b[f], cap = g.b[t];
        var side = p > 0 ? RED : 1;
        var ty = p > 0 ? p : -p;
        var sc = PST[ty][orow(side, (t / 9) | 0) * 9 + (t % 9)] -
                 PST[ty][orow(side, (f / 9) | 0) * 9 + (f % 9)];
        if (cap) sc += 100000 + BASE[cap > 0 ? cap : -cap] * 8 - BASE[ty];
        var k = killers[curPly];
        if (k && (k[0] === mv || k[1] === mv)) sc += 60000;
        return sc;
      }
    };
  }

  /* ───────── 难度参数 ───────── */
  var CFG = {
    1: { depth: 2, time: 380, margin: 120 },   // 入门：浅搜 + 在近似最优中随机
    2: { depth: 3, time: 1000, margin: 0 },    // 进阶
    3: { depth: 4, time: 2200, margin: 0 }     // 高手
  };

  Xiangqi.prototype._think = function (level) {
    if (this._over) return -1;
    var cf = CFG[level] || CFG[2];
    var snap = this.b.slice();
    var res = Hub.search.best(makeCtx(this), {
      maxDepth: cf.depth,
      timeMs: cf.time,
      maxNodes: 2600000,
      margin: cf.margin
    });
    /* 搜索必须完整还原局面，否则后续判定全错 */
    for (var i = 0; i < 90; i++) {
      if (this.b[i] !== snap[i]) {
        if (global.console) console.error('[xiangqi] 搜索未还原局面，已回滚');
        this.b = snap;
        break;
      }
    }
    if (!res) return -1;
    this._lastSearch = res;
    return res.move;
  };

  Xiangqi.prototype.aiMove = function (level) {
    var mv = this._think(level);
    if (mv < 0) return false;
    this.play(mv);
    return true;
  };

  Xiangqi.prototype.suggest = function (level) {
    var mv = this._think(level == null ? 3 : level);
    if (mv < 0) { Hub.App.toast('暂无可走之着'); return -1; }
    this.sugg = { f: (mv / 90) | 0, t: mv % 90 };
    this.sel = -1; this.selMoves = [];
    var d = this._lastSearch;
    Hub.App.toast('建议：' + this.moveText(this.sugg.f, this.sugg.t) +
      (d ? '（搜至 ' + d.depth + ' 层，' + Math.round(d.ms) + ' ms）' : ''));
    return mv;
  };
  Xiangqi.prototype.clearSuggestion = function () { this.sugg = null; };

})(window);
