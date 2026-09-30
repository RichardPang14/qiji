/* ════════════════════════════════════════════════════════════
   jungle-ai.js —— 斗兽棋电脑着法
   评估 = 子力 + 推进度 + 兽穴迫近 + 陷阱弱化 + 被吃风险 + 机动性
   搜索 = 迭代加深 alpha-beta（复用 core/search.js）
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub;
  var Jungle = Hub.Jungle, JG = Hub.JG;
  var COLS = JG.COLS, ROWS = JG.ROWS;
  var RAT = JG.RAT, ELEPHANT = JG.ELEPHANT, LION = JG.LION, TIGER = JG.TIGER;
  var MATE = Hub.search.MATE;

  /* 子力价值：狮虎最灵，鼠因能吃象且能堵河而身价不菲 */
  var VAL = [0, 620, 250, 300, 360, 460, 800, 850, 560];

  /* 各方「自己的」兽穴位置，索引与座位号对应（与 denSide() 的归属约定一致）：
     座位 0（红，下方）的穴在 (8,3)；座位 1（蓝，上方）的穴在 (0,3)。
     因此 DEN_OF[1 - seat] 才是该座位要攻的敌方兽穴。 */
  var DEN_OF = [(ROWS - 1) * COLS + 3, 3];

  /** 单个座位的静态分（子力 + 位置） */
  function seatScore(g, seat) {
    var b = g.b, s = 0, i, p, t, r, c;
    var enemyDen = DEN_OF[1 - seat];
    var edr = (enemyDen / COLS) | 0, edc = enemyDen % COLS;
    var foeElephant = -1;
    for (i = 0; i < b.length; i++) {
      p = b[i];
      if (!p || g.side(p) === seat) continue;
      if (g.typeOf(p) === ELEPHANT) { foeElephant = i; break; }
    }

    for (i = 0; i < b.length; i++) {
      p = b[i];
      if (!p || g.side(p) !== seat) continue;
      t = g.typeOf(p);
      r = (i / COLS) | 0; c = i % COLS;
      var v = VAL[t];

      /* 推进度：朝对方底线前进 */
      var adv = seat === 0 ? (ROWS - 1 - r) : r;
      v += adv * 9;

      /* 逼近对方兽穴 */
      var d = Math.abs(r - edr) + Math.abs(c - edc);
      if (d === 1) v += 520;
      else if (d === 2) v += 170;
      else if (d === 3) v += 70;
      else v += Math.max(0, 14 - d) * 7;

      /* 踏入对方陷阱：战力归零，重罚 */
      var ts = g.trapSide(i);
      if (ts >= 0 && ts !== seat) v -= 190;

      /* 鼠的特殊任务：找对方的象 */
      if (t === RAT) {
        if (foeElephant >= 0) {
          var er = (foeElephant / COLS) | 0, ec = foeElephant % COLS;
          var ed = Math.abs(r - er) + Math.abs(c - ec);
          v += ed === 1 ? 320 : Math.max(0, 12 - ed) * 12;
        }
        /* 鼠在河中可封锁狮虎跳河，略有加成 */
        if (g.WATER[i]) v += 26;
      }

      /* 狮虎保留跳河能力，鼓励占据河岸 */
      if (t === LION || t === TIGER) {
        if (isRiverside(g, r, c)) v += 34;
      }

      s += v;
    }
    return s;
  }

  function isRiverside(g, r, c) {
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var k = 0; k < 4; k++) {
      var rr = r + dirs[k][0], cc = c + dirs[k][1];
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
      if (g.WATER[rr * COLS + cc]) return true;
    }
    return false;
  }

  /* ───────── 搜索上下文 ───────── */
  function makeCtx(g) {
    var cache = [], capStack = [], winStack = [], curPly = 0;

    function moves(ply) {
      var m = cache[ply];
      if (m === undefined) { m = g.genMoves(g.turn); cache[ply] = m; }
      return m;
    }

    return {
      moves: moves,

      terminal: function (ply) {
        /* 上一手已攻入兽穴 → 走子方胜 */
        if (winStack.length && winStack[winStack.length - 1]) return -(MATE - ply);
        if (!g.hasPieces(g.turn)) return -(MATE - ply);
        if (!moves(ply).length) return -(MATE - ply);      // 困毙
        return null;
      },

      make: function (m) {
        var mover = g.turn;
        curPly++;
        cache[curPly] = undefined;
        capStack.push(g.doMove(m));
        var ds = g.denSide(m.t);
        winStack.push(ds >= 0 && ds !== mover);
      },

      unmake: function (m) {
        winStack.pop();
        g.unMove(m, capStack.pop());
        cache[curPly] = undefined;
        curPly--;
      },

      evaluate: function () {
        var me = g.turn, opp = 1 - me;
        var mine = moves(curPly);
        var theirs = g.genMoves(opp);
        var s = seatScore(g, me) - seatScore(g, opp);

        /* 机动性 */
        s += (mine.length - theirs.length) * 3;

        /* 对方下一手可吃我的哪些子 → 扣分 */
        var b = g.b, k, m;
        var threatened = {};
        for (k = 0; k < theirs.length; k++) {
          m = theirs[k];
          if (b[m.t]) threatened[m.t] = 1;
        }
        for (var i = 0; i < b.length; i++) {
          if (!b[i] || g.side(b[i]) !== me) continue;
          if (threatened[i]) s -= VAL[g.typeOf(b[i])] * .5 + 18;
        }
        /* 我下一手能吃对方的子 → 加分（但别过度贪吃） */
        for (k = 0; k < mine.length; k++) {
          m = mine[k];
          if (b[m.t]) s += VAL[g.typeOf(b[m.t])] * .22;
          /* 直逼兽穴的一手 */
          if (g.denSide(m.t) === opp) s += 9000;
        }
        return s;
      },

      orderScore: function (m) {
        var b = g.b, cap = b[m.t], p = b[m.f];
        var sc = 0;
        if (cap) sc += 100000 + VAL[g.typeOf(cap)] * 6 - VAL[g.typeOf(p)];
        if (g.denSide(m.t) === 1 - g.turn) sc += 500000;
        /* 推进优先 */
        var fr = (m.f / COLS) | 0, tr = (m.t / COLS) | 0;
        sc += (g.turn === 0 ? (fr - tr) : (tr - fr)) * 12;
        return sc;
      }
    };
  }

  /* ───────── 难度 ───────── */
  var CFG = {
    1: { depth: 2, time: 260, margin: 150 },
    2: { depth: 3, time: 750, margin: 0 },
    3: { depth: 4, time: 1500, margin: 0 }
  };

  Jungle.prototype._think = function (level) {
    if (this._over) return null;
    var cf = CFG[level] || CFG[2];
    var ctx = makeCtx(this);
    var res = Hub.search.best(ctx, {
      maxDepth: cf.depth,
      timeMs: cf.time,
      maxNodes: 900000,
      margin: cf.margin
    });
    if (!res || !res.move) {
      /* 搜索失败时兜底：随便走一步合法着 */
      var ms = this.genMoves(this.turn);
      return ms.length ? ms[0] : null;
    }
    this._lastSearch = res;
    return res.move;
  };

  Jungle.prototype.aiMove = function (level) {
    var m = this._think(level);
    if (!m) return false;
    this.play(m);
    return true;
  };

  Jungle.prototype.suggest = function (level) {
    var m = this._think(level == null ? 3 : level);
    if (!m) { Hub.App.toast('暂无可走之着'); return null; }
    this.sugg = m;
    this.sel = -1; this.selMoves = [];
    Hub.App.toast('建议：' + this.moveText(m));
    return m;
  };
  Jungle.prototype.clearSuggestion = function () { this.sugg = null; };

})(window);
