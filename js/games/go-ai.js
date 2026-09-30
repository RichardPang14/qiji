/* ════════════════════════════════════════════════════════════
   go-ai.js —— 围棋电脑着法
   两段式：① 启发式选点（提子/逃劫/禁自填眼/边线偏好）
           ② 对候选点做随机终局模拟（flat Monte Carlo）比胜率
   不做深度死活计算，9 路棋力明显优于 19 路。
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub;
  var Go = Hub.Go;
  var now = Hub.util.now;

  /* ─────────────────────────────────────────────
     ① 启发式选点
     ───────────────────────────────────────────── */
  Go.prototype._heuristic = function (i, color) {
    var b = this.b, N = this.N, opp = 3 - color, k, q;
    var r = (i / N) | 0, c = i % N;
    var tac = 0, pos = 0;                 // 战术分与位置分分开，位置分降权

    /* 试下，取得提子数与自身气数 */
    var cap = this.tryPlay(i, color, false);
    if (cap === null) return null;
    var ownLibs = this.groupInfo(i).libs.length;
    this.revertPlay(i, color, cap);

    /* 提子：极高价值 */
    if (cap.length) tac += 26 * cap.length + 8;

    /* 救出处于被打吃状态的己方块 / 反向打吃对方 */
    var nb = this.nb[i];
    for (k = 0; k < nb.length; k++) {
      q = nb[k];
      if (!b[q]) continue;
      if (b[q] === color) {
        var g = this.groupInfo(q);
        if (g.libs.length === 1) tac += 20 + g.stones.length * 6;      // 救自己的孤块
        tac += 3;                                                      // 连接
      } else {
        var g2 = this.groupInfo(q);
        if (g2.libs.length === 2) tac += 10 + g2.stones.length * 3;    // 打吃对方
        else if (g2.libs.length === 3) tac += 4;
        tac += 4;                                                      // 贴身接触
      }
    }

    /* 自填成打吃且没提到子：大恶手 */
    if (ownLibs === 1 && !cap.length) tac -= 78;
    else if (ownLibs === 2 && !cap.length) tac -= 8;

    /* 斜向连接（小飞/大飞的呼应） */
    var dg = this.dg[i].list;
    for (k = 0; k < dg.length; k++) {
      if (b[dg[k]] === color) tac += 2;
      else if (b[dg[k]] === opp) tac += 1;
    }

    /* 边线偏好：开局抢占三、四线，避免一二线 */
    var dist = Math.min(r, c, N - 1 - r, N - 1 - c);
    var early = this.moveNo < N * 2;
    if (early) {
      pos += dist === 0 ? -16 : dist === 1 ? 1 : dist === 2 ? 10 : dist === 3 ? 9 : 3;
      /* 开局偏向角部与边星一带 */
      var dc = Math.min(c, N - 1 - c), dr = Math.min(r, N - 1 - r);
      if (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4) pos += 6;
    } else {
      pos += dist === 0 ? -8 : dist === 1 ? -1 : 2;
    }

    /* 中央一点微弱加成，避免全程贴边 */
    var ctr = Math.abs(r - (N - 1) / 2) + Math.abs(c - (N - 1) / 2);
    pos += Math.max(0, (N - ctr)) * .12;

    return tac + pos * .7;
  };

  /** 生成候选点：合法、非自填眼，按启发分排序 */
  Go.prototype._candidates = function (color, limit) {
    var b = this.b, n = b.length, out = [], i, h;
    for (i = 0; i < n; i++) {
      if (b[i]) continue;
      if (this.isEye(i, color)) continue;           // 不自填真眼
      h = this._heuristic(i, color);
      if (h === null) continue;                     // 非法（自杀/劫）
      out.push({ i: i, v: h });
    }
    if (!out.length) return out;
    out.sort(function (a, c2) { return c2.v - a.v; });
    return limit ? out.slice(0, limit) : out;
  };

  /* ─────────────────────────────────────────────
     ② 随机终局模拟
     独立的轻量引擎，直接在 Int8Array 上跑，不复用类方法以求速度
     ───────────────────────────────────────────── */
  function Playout(N) {
    this.N = N;
    this.n = N * N;
    this.nb = new Array(this.n);
    for (var i = 0; i < this.n; i++) {
      var r = (i / N) | 0, c = i % N, a = [];
      if (r > 0) a.push(i - N);
      if (r < N - 1) a.push(i + N);
      if (c > 0) a.push(i - 1);
      if (c < N - 1) a.push(i + 1);
      this.nb[i] = a;
    }
    this.dg = new Array(this.n);
    for (i = 0; i < this.n; i++) {
      var r2 = (i / N) | 0, c2 = i % N, d = [], edge = 0, o;
      var offs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      for (o = 0; o < 4; o++) {
        var rr = r2 + offs[o][0], cc = c2 + offs[o][1];
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) edge++;
        else d.push(rr * N + cc);
      }
      this.dg[i] = { list: d, edge: edge };
    }
    this.empIdx = new Int16Array(this.n);
    this.seen = new Int32Array(this.n);
    this.gen = 0;
    this.region = [];
  }

  Playout.prototype.isEye = function (b, i, color) {
    if (b[i] !== 0) return false;
    var nb = this.nb[i], k;
    for (k = 0; k < nb.length; k++) if (b[nb[k]] !== color) return false;
    var d = this.dg[i], bad = 0;
    for (k = 0; k < d.list.length; k++) {
      var v = b[d.list[k]];
      if (v !== color && v !== 0) bad++;
    }
    return d.edge > 0 ? bad === 0 : bad <= 1;
  };

  /** 落子并提子；返回被提子数，非法返回 -1 */
  Playout.prototype.play = function (b, empties, i, color) {
    if (b[i] !== 0) return -1;
    var opp = 3 - color, nb = this.nb[i], k, q, capN = 0, g = ++this.gen;
    b[i] = color;

    for (k = 0; k < nb.length; k++) {
      q = nb[k];
      if (b[q] !== opp || this.seen[q] === g) continue;
      /* 收集该块与其气 */
      var stones = [], libs = 0, stack = [q], seen2 = this.seen;
      seen2[q] = g;
      while (stack.length) {
        var p = stack.pop();
        stones.push(p);
        var nn = this.nb[p], j;
        for (j = 0; j < nn.length; j++) {
          var z = nn[j];
          if (b[z] === opp) { if (seen2[z] !== g) { seen2[z] = g; stack.push(z); } }
          else if (b[z] === 0) libs++;
        }
      }
      if (libs === 0) {
        for (j = 0; j < stones.length; j++) {
          b[stones[j]] = 0;
          this._addEmpty(empties, stones[j]);
          capN++;
        }
      }
    }

    if (capN === 0) {
      /* 自杀检查 */
      var own = [], olibs = 0, st2 = [i], g2 = ++this.gen, s2 = this.seen;
      s2[i] = g2;
      while (st2.length) {
        var p2 = st2.pop();
        own.push(p2);
        var nb2 = this.nb[p2], j2;
        for (j2 = 0; j2 < nb2.length; j2++) {
          var y = nb2[j2];
          if (b[y] === color) { if (s2[y] !== g2) { s2[y] = g2; st2.push(y); } }
          else if (b[y] === 0) olibs++;
        }
      }
      if (olibs === 0) { b[i] = 0; return -1; }
    }

    this._delEmpty(empties, i);
    return capN;
  };

  Playout.prototype._addEmpty = function (empties, i) {
    if (this.empIdx[i] >= 0 && empties[this.empIdx[i]] === i) return;
    this.empIdx[i] = empties.length;
    empties.push(i);
  };
  Playout.prototype._delEmpty = function (empties, i) {
    var p = this.empIdx[i];
    if (p < 0 || empties[p] !== i) return;
    var last = empties.pop();
    if (p < empties.length) { empties[p] = last; this.empIdx[last] = p; }
    this.empIdx[i] = -1;
  };

  /** 数子式判定：返回胜方 1 或 2（0 = 和，极少见） */
  Playout.prototype.score = function (b, komi) {
    var n = this.n, visited = this.seen, g = ++this.gen, k;
    var black = 0, white = 0;
    for (k = 0; k < n; k++) { if (b[k] === 1) black++; else if (b[k] === 2) white++; }

    var region = this.region;
    for (k = 0; k < n; k++) {
      if (b[k] !== 0 || visited[k] === g) continue;
      region.length = 0;
      var stack = [k], nbB = false, nbW = false;
      visited[k] = g;
      while (stack.length) {
        var p = stack.pop();
        region.push(p);
        var nb = this.nb[p], j;
        for (j = 0; j < nb.length; j++) {
          var q = nb[j];
          if (b[q] === 1) nbB = true;
          else if (b[q] === 2) nbW = true;
          else if (visited[q] !== g) { visited[q] = g; stack.push(q); }
        }
      }
      if (nbB && !nbW) black += region.length;
      else if (nbW && !nbB) white += region.length;
    }
    var w = white + komi;
    return black > w ? 1 : (black < w ? 2 : 0);
  };

  /** 完整跑一局随机对局，返回胜方 */
  Playout.prototype.run = function (b, startColor, komi, rng, maxMoves) {
    var empties = [], i, n = this.n;
    for (i = 0; i < n; i++) this.empIdx[i] = -1;
    for (i = 0; i < n; i++) if (b[i] === 0) { this.empIdx[i] = empties.length; empties.push(i); }

    var turn = startColor, passes = 0, mv = 0;
    while (passes < 2 && mv < maxMoves && empties.length) {
      var m = this._pick(b, empties, turn, rng);
      if (m < 0) { passes++; mv++; turn = 3 - turn; continue; }
      var res = this.play(b, empties, m, turn);
      if (res < 0) { passes++; mv++; turn = 3 - turn; continue; }
      passes = 0; mv++; turn = 3 - turn;
    }
    return this.score(b, komi);
  };

  /** 模拟中的一手：优先提子，其次随机非眼位合法点 */
  Playout.prototype._pick = function (b, empties, color, rng) {
    var L = empties.length, k, idx, i, nb, q, opp = 3 - color;
    if (!L) return -1;

    /* 先随机探查若干点，看有没有能提子的 */
    var tries = L < 8 ? L : 8;
    for (k = 0; k < tries; k++) {
      idx = (rng() * L) | 0;
      i = empties[idx];
      if (this.isEye(b, i, color)) continue;
      nb = this.nb[i];
      for (q = 0; q < nb.length; q++) {
        if (b[nb[q]] === opp) {
          /* 该邻块是否只剩这一口气 */
          var libs = this._countLib(b, nb[q]);
          if (libs === 1) return i;
        }
      }
    }
    /* 常规：随机取一个非眼位点（合法性交给 play 判定） */
    for (k = 0; k < 12; k++) {
      idx = (rng() * L) | 0;
      i = empties[idx];
      if (!this.isEye(b, i, color)) return i;
    }
    return -1;
  };

  Playout.prototype._countLib = function (b, i) {
    var color = b[i];
    if (!color) return 0;
    var g = ++this.gen, seen = this.seen, stack = [i], libs = 0;
    seen[i] = g;
    while (stack.length) {
      var p = stack.pop(), nb = this.nb[p], j;
      for (j = 0; j < nb.length; j++) {
        var q = nb[j];
        if (b[q] === color) { if (seen[q] !== g) { seen[q] = g; stack.push(q); } }
        else if (b[q] === 0) libs++;
      }
    }
    return libs;
  };

  /* ─────────────────────────────────────────────
     ③ 组装：候选点 + 模拟比胜率
     ───────────────────────────────────────────── */
  var CFG = {
    1: { cand: 8, time: 0, rounds: 0 },
    2: { cand: 10, time: 700, rounds: 40 },
    3: { cand: 14, time: 1600, rounds: 90 }
  };

  Go.prototype._engine = function () {
    if (!this._pl || this._pl.N !== this.N) this._pl = new Playout(this.N);
    return this._pl;
  };

  Go.prototype._think = function (level) {
    if (this._over || this.phase !== 'play') return -2;      // -2 = 不该走
    var color = this.turn;
    var cands = this._candidates(color, 60);
    if (!cands.length) return -1;                           // -1 = 虚手

    /* 明显领先的一手直接落子：不必把模拟预算浪费在已定的战术上 */
    if (cands.length === 1) return cands[0].i;
    if (cands[0].v - cands[1].v >= 15) return cands[0].i;

    var cf = CFG[level] || CFG[2];
    if (!cf.time) {
      /* 入门：只按启发分加权随机 */
      var pool = cands.slice(0, cf.cand).map(function (e) { return { i: e.i, v: Math.max(0, e.v) + 1 }; });
      var pick = Hub.search.weighted(pool, 2.2);
      return pick ? pick.i : cands[0].i;
    }

    var K = Math.min(cf.cand, cands.length);
    var top = cands.slice(0, K);
    var pl = this._engine();
    var rng = Math.random;
    var n = this.N * this.N;
    var base = this.b;
    var wins = new Float64Array(K), vis = new Int32Array(K);
    var maxMoves = n * 3;
    var t0 = now(), round = 0, k;

    while (round < cf.rounds) {
      for (k = 0; k < K; k++) {
        var pi = top[k].i;
        var work = new Int8Array(base);
        work[pi] = color;

        /* 在副本上手工提子（模拟中不启用超级劫） */
        var removed = 0, nb = pl.nb[pi], opp = 3 - color, q;
        for (q = 0; q < nb.length; q++) {
          if (work[nb[q]] !== opp) continue;
          if (pl._countLib(work, nb[q]) === 0) removed += this._removeGroup(work, nb[q]);
        }
        /* 提不到子又要自杀：不属合法候选，跳过 */
        if (removed === 0 && this._countLibsRaw(work, pi, pl) === 0) { work[pi] = 0; continue; }

        var w = pl.run(work, opp, this.komi, rng, maxMoves);
        vis[k]++;
        if (w === color) wins[k]++;
        else if (w === 0) wins[k] += .5;
      }
      round++;
      if (round >= 3 && now() - t0 > cf.time) break;
    }

    /* 选胜率最高者；胜率接近时用启发分打散 */
    var best = -1, bestRate = -1;
    for (k = 0; k < K; k++) {
      if (!vis[k]) continue;
      var rate = wins[k] / vis[k] + top[k].v * 1e-5;
      if (rate > bestRate) { bestRate = rate; best = k; }
    }
    if (best < 0) return top[0].i;
    this._lastThink = { rounds: round, vis: vis[best], rate: bestRate };
    return top[best].i;
  };

  /* 在裸数组上收一块棋，返回提子数 */
  Go.prototype._removeGroup = function (b, i) {
    var color = b[i];
    if (!color) return 0;
    var pl = this._engine(), stack = [i], cnt = 0;
    var g = ++pl.gen, seen = pl.seen;
    seen[i] = g;
    while (stack.length) {
      var p = stack.pop();
      b[p] = 0; cnt++;
      var nb = pl.nb[p], j;
      for (j = 0; j < nb.length; j++) {
        var q = nb[j];
        if (b[q] === color && seen[q] !== g) { seen[q] = g; stack.push(q); }
      }
    }
    return cnt;
  };

  Go.prototype._countLibsRaw = function (b, i, pl) {
    var color = b[i];
    if (!color) return 0;
    var g = ++pl.gen, seen = pl.seen, stack = [i], libs = 0;
    seen[i] = g;
    while (stack.length) {
      var p = stack.pop(), nb = pl.nb[p], j;
      for (j = 0; j < nb.length; j++) {
        var q = nb[j];
        if (b[q] === color) { if (seen[q] !== g) { seen[q] = g; stack.push(q); } }
        else if (b[q] === 0) libs++;
      }
    }
    return libs;
  };

  /* ───────── 对外接口 ───────── */
  Go.prototype.aiMove = function (level) {
    var mv = this._think(level);
    if (mv === -2) return false;          // 数子阶段，电脑不行动
    if (mv === -1) { this.pass(); return true; }
    if (mv < 0) return false;
    return this.play(mv);
  };

  Go.prototype.suggest = function (level) {
    var mv = this._think(level == null ? 3 : level);
    if (mv === -2) { Hub.App.toast('数子阶段无法提示'); return -2; }
    if (mv === -1) { Hub.App.toast('建议：虚手'); this.sugg = -1; return -1; }
    this.sugg = mv;
    Hub.App.toast('建议落点：' + this.coordName(mv));
    return mv;
  };
  Go.prototype.clearSuggestion = function () { this.sugg = -1; };

})(window);
