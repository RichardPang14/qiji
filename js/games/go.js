/* ════════════════════════════════════════════════════════════
   围棋 GO —— 气/提子/劫争（情景超级劫）/禁自杀 + 中国规则数子终局
   盘面：b[i] 0=空 1=黑 2=白；黑先；贴目可配
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub, P = Hub.PAL, U = Hub.util;

  var COLNAME = 'ABCDEFGHJKLMNOPQRST';   // 跳过 I

  /* 各盘面的星位 */
  var HOSHI = {
    19: [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]],
    13: [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]],
    9: [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]]
  };

  /* ─────────────────────────────────────────────── */
  function Go(cfg) {
    Hub.Base.call(this, cfg);
    this.N = cfg.size || 19;
    this.komi = cfg.komi == null ? 7.5 : cfg.komi;
    this.reset();
  }
  Go.prototype = Object.create(Hub.Base.prototype);
  Go.prototype.constructor = Go;

  Go.prototype.reset = function () {
    var N = this.N, n = N * N, i;
    this.b = new Int8Array(n);
    this.turn = 1;                     // 1 黑 / 2 白
    this.caps = [0, 0];                // caps[座位]：0=黑方提子数，1=白方提子数
    this.last = -1;
    this.passes = 0;
    this.moveNo = 0;
    this.ko = -1;                      // 简单劫的禁着点，-1 表示无
    this.n = n;                        // 交叉点总数
    this.phase = 'play';               // play | score
    this.dead = new Uint8Array(n);
    this.history = [];                 // 快照栈（悔棋用）
    this.hist = [];                    // 着手记录（谱面用）
    this.seen = {};
    this.territory = null;
    this.result = null;
    this._over = null;
    this.sel = -1;
    this.sugg = -1;
    this.scoreMark = null;

    /* 邻接表：每点至多 4 个正交邻居 */
    this.nb = new Array(n);
    for (i = 0; i < n; i++) {
      var r = (i / N) | 0, c = i % N, a = [];
      if (r > 0) a.push(i - N);
      if (r < N - 1) a.push(i + N);
      if (c > 0) a.push(i - 1);
      if (c < N - 1) a.push(i + 1);
      this.nb[i] = a;
    }
    /* 斜向邻居（眼形判定用） */
    this.dg = new Array(n);
    for (i = 0; i < n; i++) {
      var r2 = (i / N) | 0, c2 = i % N, d = [], edge = 0;
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (o) {
        var rr = r2 + o[0], cc = c2 + o[1];
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) edge++;
        else d.push(rr * N + cc);
      });
      this.dg[i] = { list: d, edge: edge };
    }
    this._mark = new Int32Array(n);
    this._lib = new Int32Array(n);
    this._capMark = new Int32Array(n);
    this._gen = 0; this._lgen = 0; this._cgen = 0;
    this._stack = [];
    this._seenKey = this.keyOf(this.b, this.turn);
    this.seen[this._seenKey] = 1;
  };

  /* ───────── 基础 ───────── */
  Go.prototype.idx = function (r, c) { return r * this.N + c; };

  Go.prototype.keyOf = function (b, turn) {
    var s = '', i;
    for (i = 0; i < b.length; i++) s += b[i];
    return s + '|' + turn;
  };

  /** 求 i 所在整块的气与子（复用标记数组，避免重复分配） */
  Go.prototype.groupInfo = function (i) {
    var b = this.b, N = this.N, color = b[i];
    var stones = [], libs = [];
    if (!color) return { stones: stones, libs: libs };
    var g = ++this._gen, lg = ++this._lgen;
    var mark = this._mark, libm = this._lib, stack = this._stack;
    stack.length = 0;
    stack.push(i); mark[i] = g;
    while (stack.length) {
      var p = stack.pop();
      stones.push(p);
      var nb = this.nb[p], k, q;
      for (k = 0; k < nb.length; k++) {
        q = nb[k];
        if (b[q] === color) { if (mark[q] !== g) { mark[q] = g; stack.push(q); } }
        else if (b[q] === 0) { if (libm[q] !== lg) { libm[q] = lg; libs.push(q); } }
      }
    }
    return { stones: stones, libs: libs };
  };

  Go.prototype.liberties = function (i) {
    if (!this.b[i]) return 0;
    return this.groupInfo(i).libs.length;
  };

  /**
   * 试下一子：合法则改盘并返回被提子数组；非法返回 null 且盘面不变。
   * superko=true 时启用情景超级劫（正式对局用），false 时只做禁自杀（模拟用）。
   */
  Go.prototype.tryPlay = function (i, color, superko) {
    if (i < 0 || this.b[i] !== 0) return null;
    if (this.ko >= 0 && i === this.ko) return null;      // 劫争禁着点
    var b = this.b, opp = 3 - color, k, q;
    b[i] = color;

    /* 先收对方无气的块（同一块可能与落子点多个相邻，需去重） */
    var cap = [], nb = this.nb[i], cg = ++this._cgen, cm = this._capMark;
    for (k = 0; k < nb.length; k++) {
      q = nb[k];
      if (b[q] !== opp) continue;
      var gi = this.groupInfo(q);
      if (gi.libs.length !== 0) continue;
      for (var j = 0; j < gi.stones.length; j++) {
        var si = gi.stones[j];
        if (cm[si] === cg) continue;
        cm[si] = cg;
        cap.push(si);
      }
    }

    /* 未提子则要检查自杀 */
    if (!cap.length && this.groupInfo(i).libs.length === 0) { b[i] = 0; return null; }

    /* 劫争：不得重现此前出现过的局面 */
    if (superko) {
      for (k = 0; k < cap.length; k++) b[cap[k]] = 0;
      var key = this.keyOf(b, opp);
      if (this.seen[key]) {
        for (k = 0; k < cap.length; k++) b[cap[k]] = opp;
        b[i] = 0;
        return null;
      }
      return cap;
    }

    for (k = 0; k < cap.length; k++) b[cap[k]] = 0;
    return cap;
  };

  Go.prototype.revertPlay = function (i, color, cap) {
    this.b[i] = 0;
    for (var k = 0; k < cap.length; k++) this.b[cap[k]] = 3 - color;
  };

  Go.prototype.legalPoints = function (color, superko) {
    var out = [], n = this.b.length, i;
    for (i = 0; i < n; i++) {
      if (this.b[i]) continue;
      var cap = this.tryPlay(i, color, superko);
      if (cap === null) continue;
      this.revertPlay(i, color, cap);
      out.push(i);
    }
    return out;
  };

  /* ───────── 落子 / 虚手 / 悔棋 ───────── */
  Go.prototype.snapshot = function () {
    return {
      b: new Int8Array(this.b),
      turn: this.turn,
      caps: this.caps.slice(),
      last: this.last,
      passes: this.passes,
      moveNo: this.moveNo,
      ko: this.ko,
      key: this._seenKey
    };
  };

  Go.prototype.play = function (i) {
    var color = this.turn;
    this.history.push(this.snapshot());
    var cap = this.tryPlay(i, color, true);
    if (cap === null) { this.history.pop(); return false; }
    this.caps[color - 1] += cap.length;
    this.last = i;
    this.passes = 0;
    this.moveNo++;
    this.sugg = -1;
    /* 简单劫：恰提一子且落子后自身为单子单气 */
    this.ko = -1;
    if (cap.length === 1) {
      var g = this.groupInfo(i);
      if (g.stones.length === 1 && g.libs.length === 1) this.ko = cap[0];
    }
    this._seenKey = this.keyOf(this.b, 3 - color);
    this.seen[this._seenKey] = (this.seen[this._seenKey] || 0) + 1;
    this.turn = 3 - color;
    this.history[this.history.length - 1].mv = { i: i, color: color, pass: false };
    this.hist.push({ kind: 'play', i: i, c: color });
    this._settlePhase();
    return true;
  };

  Go.prototype.pass = function () {
    var color = this.turn;
    this.history.push(this.snapshot());
    this.passes++;
    this.last = -1;
    this.moveNo++;
    this.sugg = -1;
    this.ko = -1;
    this.turn = 3 - color;
    this.history[this.history.length - 1].mv = { i: -1, color: color, pass: true };
    this.hist.push({ kind: 'pass', i: -1, c: color });
    this._settlePhase();
    return true;
  };

  Go.prototype._settlePhase = function () {
    if (this.phase !== 'play') return;
    if (this.passes >= 2) {
      this.phase = 'score';
      this.dead = new Uint8Array(this.b.length);
      this.territory = this.computeTerritory();
    }
  };

  Go.prototype.undo = function () {
    if (!this.history.length) return false;
    var s = this.history.pop();
    if (this._seenKey && this.seen[this._seenKey]) this.seen[this._seenKey]--;
    this.b = s.b;
    this.turn = s.turn;
    this.caps = s.caps;
    this.last = s.last;
    this.passes = s.passes;
    this.moveNo = s.moveNo;
    this.ko = s.ko;
    this._seenKey = s.key;
    this.hist.pop();
    this.phase = 'play';
    this._over = null;
    this.territory = null;
    this.result = null;
    this.sugg = -1;
    return true;
  };

  Go.prototype.canUndo = function () { return this.history.length > 0 && !this.thinking; };

  Go.prototype.resign = function (seat) {
    this._over = {
      winner: 1 - seat,
      title: this.seatName(1 - seat) + '胜',
      text: this.seatName(seat) + ' 中盘认输。'
    };
  };

  /* ───────── 眼形 ───────── */
  /** i 是否为 color 的真眼（含边角修正） */
  Go.prototype.isEye = function (i, color) {
    if (this.b[i] !== 0) return false;
    var nb = this.nb[i], k;
    for (k = 0; k < nb.length; k++) if (this.b[nb[k]] !== color) return false;
    var d = this.dg[i], bad = 0;
    for (k = 0; k < d.list.length; k++) {
      var v = this.b[d.list[k]];
      if (v !== color && v !== 0) bad++;
    }
    /* 边角上的眼要求所有斜邻均为己方 */
    return d.edge > 0 ? bad === 0 : bad <= 1;
  };

  /* ───────── 数子 ───────── */
  Go.prototype.effectiveBoard = function () {
    var n = this.b.length, eff = new Int8Array(n), i;
    for (i = 0; i < n; i++) eff[i] = this.dead[i] ? 0 : this.b[i];
    return eff;
  };

  /** 返回每点归属：1 黑地 / 2 白地 / 0 中立（含死子已剔除后的空区） */
  Go.prototype.computeTerritory = function () {
    var N = this.N, n = N * N, eff = this.effectiveBoard();
    var terr = new Int8Array(n), visited = new Uint8Array(n), i, k;
    for (i = 0; i < n; i++) {
      if (eff[i] !== 0 || visited[i]) continue;
      var region = [], stack = [i], nbB = false, nbW = false;
      visited[i] = 1;
      while (stack.length) {
        var p = stack.pop();
        region.push(p);
        var nb = this.nb[p];
        for (k = 0; k < nb.length; k++) {
          var q = nb[k];
          if (eff[q] === 1) nbB = true;
          else if (eff[q] === 2) nbW = true;
          else if (!visited[q]) { visited[q] = 1; stack.push(q); }
        }
      }
      var owner = (nbB && !nbW) ? 1 : (nbW && !nbB) ? 2 : 0;
      for (k = 0; k < region.length; k++) terr[region[k]] = owner;
    }
    this.territory = { terr: terr, eff: eff };
    return { terr: terr, eff: eff };
  };

  /** 该点当前是否可下（含禁自杀与劫争） */
  Go.prototype.isLegal = function (i, color) {
    if (i < 0 || i >= this.n || this.b[i] !== 0) return false;
    var cap = this.tryPlay(i, color, true);
    if (cap === null) return false;
    this.revertPlay(i, color, cap);
    return true;
  };

  /** 标记 / 取消标记一整块为死子；返回标记后的状态 */
  Go.prototype.toggleDead = function (i) {
    if (i < 0 || !this.b[i]) return false;
    var gi = this.groupInfo(i), st = !this.dead[i], k;
    for (k = 0; k < gi.stones.length; k++) this.dead[gi.stones[k]] = st ? 1 : 0;
    this.computeTerritory();
    return st;
  };

  Go.prototype.computeScore = function () {
    var t = this.computeTerritory(), eff = t.eff, terr = t.terr, n = eff.length, i;
    var sb = 0, sw = 0, tb = 0, tw = 0, dame = 0, deadB = 0, deadW = 0;
    for (i = 0; i < n; i++) {
      if (this.dead[i]) { if (this.b[i] === 1) deadB++; else if (this.b[i] === 2) deadW++; }
      if (eff[i] === 1) sb++;
      else if (eff[i] === 2) sw++;
      else if (terr[i] === 1) tb++;
      else if (terr[i] === 2) tw++;
      else dame++;
    }
    var black = sb + tb;
    var white = sw + tw + this.komi;
    var diff = black - white;
    return {
      stonesB: sb, stonesW: sw, terrB: tb, terrW: tw, dame: dame,
      deadB: deadB, deadW: deadW,
      black: black, white: white, diff: diff,
      terr: terr, eff: eff
    };
  };

  /** 数子结果（两种命名都给，便于外部调用） */
  Go.prototype.tally = function () {
    var s = this.computeScore();
    return {
      blackStone: s.stonesB, blackTerr: s.terrB,
      whiteStone: s.stonesW, whiteTerr: s.terrW,
      dame: s.dame, deadB: s.deadB, deadW: s.deadW,
      black: s.black, white: s.white, diff: s.diff
    };
  };

  /** 确认终局：按当前死子标记计算并写入终局结果 */
  Go.prototype.confirmResult = function () {
    var s = this.computeScore();
    this.result = s;
    var w = s.diff > 0 ? 0 : (s.diff < 0 ? 1 : null);
    var margin = Math.abs(s.diff).toFixed(1);
    this._over = {
      winner: w,
      title: w == null ? '和局' : (w === 0 ? '黑胜 ' : '白胜 ') + margin + ' 点',
      text: '黑 ' + s.black.toFixed(1) + '（子 ' + s.stonesB + ' + 地 ' + s.terrB + '）　' +
            '白 ' + s.white.toFixed(1) + '（子 ' + s.stonesW + ' + 地 ' + s.terrW + ' + 贴目 ' + this.komi + '）　' +
            (w == null ? '双方持平' : (w === 0 ? '黑胜 ' : '白胜 ') + margin + ' 点') +
            (s.deadB || s.deadW ? '　已标死子：黑 ' + s.deadB + ' 白 ' + s.deadW : '')
    };
    return this._over;
  };

  /* 旧名兼容 */
  Go.prototype.finish = function () { return this.confirmResult(); };

  /* ───────── 界面契约 ───────── */
  Go.prototype.seat = function () {
    /* 数子阶段已无行棋方 */
    return (this._over || this.phase === 'score') ? -1 : this.turn - 1;
  };
  Go.prototype.seatName = function (i) { return i === 0 ? '黑方' : '白方'; };
  /* 黑子画为实心，与侧栏座位圆点保持一致 */
  Go.prototype.seatFilled = function (i) { return i === 0; };
  Go.prototype.seatCaptured = function (i) { return '提 ' + this.caps[i]; };

  Go.prototype.status = function () {
    if (this._over) return '<b>' + this._over.title + '</b>';
    if (this.phase === 'score') return '<b>数子阶段</b> · 点击棋盘标记死子';
    var n = this.seatName(this.turn - 1);
    return '<b>' + n + '</b> 落子' + (this.passes === 1 ? '（对方已虚手）' : '');
  };

  Go.prototype.hint = function () {
    if (this._over) return '';
    if (this.phase === 'score') {
      return '点击整块棋子可标记/取消其「死子」身份，死子将从盘上清除并计入对方地盘。确认后点「终局数子」。';
    }
    return '点击交叉点落子；无子可下或不愿下时点「虚手」。双方连续虚手即进入数子。';
  };

  Go.prototype.coordName = function (i) {
    var N = this.N, r = (i / N) | 0, c = i % N;
    return (COLNAME[c] || '?') + (N - r);
  };

  Go.prototype.log = function () {
    var out = [], k, m, mv;
    for (k = 0; k < this.history.length; k++) {
      mv = this.history[k].mv;
      if (!mv) continue;
      out.push({
        n: (k + 1) + '.',
        v: (mv.color === 1 ? '● ' : '○ ') + (mv.pass ? '虚手' : this.coordName(mv.i)),
        hi: k === this.history.length - 1
      });
    }
    return out;
  };

  Go.prototype.info = function () {
    var h = '<div class="kv"><span>棋盘</span><span>' + this.N + ' 路</span></div>' +
      '<div class="kv"><span>手数</span><span>' + this.moveNo + '</span></div>' +
      '<div class="kv"><span>黑提 / 白提</span><span>' + this.caps[0] + ' / ' + this.caps[1] + '</span></div>' +
      '<div class="kv"><span>贴目</span><span>' + this.komi + '</span></div>';
    if (this.phase === 'score' && this.territory) {
      var s = this.computeScore();
      h += '<h5>当前估算</h5>' +
        '<div class="kv"><span>黑（子+地）</span><span>' + s.black.toFixed(1) + '</span></div>' +
        '<div class="kv"><span>白（子+地+贴目）</span><span>' + s.white.toFixed(1) + '</span></div>' +
        '<div class="kv"><span>差额</span><span>' + (s.diff > 0 ? '黑+' : s.diff < 0 ? '白+' : '') + Math.abs(s.diff).toFixed(1) + '</span></div>';
    }
    return h;
  };

  Go.prototype.actions = function () {
    if (this._over) return [];
    if (this.phase === 'score') {
      return [
        { id: 'clearDead', label: '清除标记', title: '取消全部死子标记' },
        { id: 'resume', label: '继续对局', title: '退出数子，回到行棋阶段' },
        { id: 'finish', label: '终局数子', title: '按当前标记计算最终结果', primary: true }
      ];
    }
    return [{ id: 'pass', label: '虚手', title: '本轮不下子（Pass）' }];
  };

  Go.prototype.onAction = function (id) {
    if (id === 'pass') { if (!this._over && this.phase === 'play') this.pass(); }
    else if (id === 'clearDead') { this.dead = new Uint8Array(this.b.length); this.territory = this.computeTerritory(); }
    else if (id === 'resume') {
      this.phase = 'play'; this.passes = 0; this.territory = null;
      this.dead = new Uint8Array(this.b.length);
      Hub.App.toast('已回到行棋阶段');
    } else if (id === 'finish') { this.confirmResult(); }
  };

  /* ───────── 交互 ───────── */
  Go.prototype.layout = function (w, h) {
    var N = this.N;
    var m = Math.min(w, h) * (this.cfg.coords === false ? .045 : .068);
    this.cell = (Math.min(w, h) - m * 2) / (N - 1);
    this.ox = (w - this.cell * (N - 1)) / 2;
    this.oy = (h - this.cell * (N - 1)) / 2;
    this.W = w; this.H = h;
    this.R = this.cell * .47;
  };
  Go.prototype.px = function (c) { return this.ox + c * this.cell; };
  Go.prototype.py = function (r) { return this.oy + r * this.cell; };

  Go.prototype.pick = function (x, y) {
    if (!this.cell) return null;
    var N = this.N;
    var c = Math.round((x - this.ox) / this.cell);
    var r = Math.round((y - this.oy) / this.cell);
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    var dx = x - this.px(c), dy = y - this.py(r);
    if (dx * dx + dy * dy > Math.pow(this.cell * .55, 2)) return null;
    return { r: r, c: c, i: r * N + c };
  };

  Go.prototype.pickHint = function (hit) {
    if (!hit) return false;
    return this.phase === 'score' ? this.b[hit.i] !== 0 : this.b[hit.i] === 0;
  };

  Go.prototype.hover = function (hit) { this.sel = hit ? hit.i : -1; };

  Go.prototype.click = function (hit) {
    if (this._over) return false;
    if (!hit) { this.sel = -1; return false; }
    var i = hit.i;

    if (this.phase === 'score') {
      if (this.b[i] === 0) return false;
      this.toggleDead(i);
      return false;                       // 未改变行棋状态
    }

    if (this.b[i] !== 0) { Hub.App.toast('该点已有子'); return false; }
    var probe = this.tryPlay(i, this.turn, true);
    if (probe === null) {
      Hub.App.toast('禁着点：自杀或劫争重复');
      return false;
    }
    this.revertPlay(i, this.turn, probe);
    return this.play(i);
  };

  /* ───────── 绘制 ───────── */
  Go.prototype.draw = function (v) {
    var N = this.N, i, r, c;
    var x0 = this.px(0), y0 = this.py(0);
    var x1 = this.px(N - 1), y1 = this.py(N - 1);

    /* 网格 */
    for (i = 0; i < N; i++) {
      var edge = (i === 0 || i === N - 1);
      v.line(x0, this.py(i), x1, this.py(i), { w: edge ? 1.4 : .85, a: edge ? 1 : .8 });
      v.line(this.px(i), y0, this.px(i), y1, { w: edge ? 1.4 : .85, a: edge ? 1 : .8 });
    }

    /* 星位 */
    var hs = HOSHI[N] || HOSHI[19];
    for (i = 0; i < hs.length; i++) {
      v.dot(this.px(hs[i][1]), this.py(hs[i][0]), Math.max(1.6, this.cell * .062), P.ink);
    }

    /* 坐标 */
    if (this.cfg.coords !== false) {
      var fs = Math.max(7, Math.min(11, this.cell * .34));
      for (c = 0; c < N; c++) {
        v.text(COLNAME[c], this.px(c), y1 + this.cell * .55 + fs * .8, { size: fs, color: P.ink4, family: 'monospace' });
      }
      for (r = 0; r < N; r++) {
        v.text(String(N - r), x0 - this.cell * .55 - fs * .95, this.py(r), { size: fs, color: P.ink4, family: 'monospace' });
      }
    }

    /* 数子阶段的地域底色 */
    if (this.phase === 'score' && this.territory) {
      var t = this.territory.terr, e = this.territory.eff, s = this.cell * .5;
      for (i = 0; i < t.length; i++) {
        if (e[i] !== 0 || t[i] === 0) continue;
        r = (i / N) | 0; c = i % N;
        v.rect(this.px(c) - s, this.py(r) - s, s * 2, s * 2, {
          fill: t[i] === 1 ? P.ink : P.ink3,
          fillA: t[i] === 1 ? .08 : .13,
          stroke: P.ink4, w: .5, a: .45
        });
      }
    }

    /* 悬停虚影 */
    if (this.phase === 'play' && this.sel >= 0 && this.b[this.sel] === 0 && !this._over) {
      r = (this.sel / N) | 0; c = this.sel % N;
      v.circle(this.px(c), this.py(r), this.R, {
        fill: this.turn === 1 ? P.ink : P.paper, stroke: P.ink, w: 1, a: .3, fillA: .3
      });
    }

    /* 棋子 */
    for (i = 0; i < this.b.length; i++) {
      if (!this.b[i]) continue;
      r = (i / N) | 0; c = i % N;
      var dead = this.dead[i];
      v.disc(this.px(c), this.py(r), this.R, {
        filled: this.b[i] === 1, ring: false, a: dead ? .42 : 1
      });
      if (dead) {
        var d = this.R * .55;
        v.line(this.px(c) - d, this.py(r) - d, this.px(c) + d, this.py(r) + d, { color: P.warn, w: 1.6 });
        v.line(this.px(c) - d, this.py(r) + d, this.px(c) + d, this.py(r) - d, { color: P.warn, w: 1.6 });
      }
    }

    /* 最后一手 */
    if (this.last >= 0) {
      r = (this.last / N) | 0; c = this.last % N;
      v.circle(this.px(c), this.py(r), this.R * .42, {
        stroke: this.b[this.last] === 1 ? '#fff' : P.ink, w: 1.3
      });
    }

    /* 建议落点 */
    if (this.sugg >= 0) {
      r = (this.sugg / N) | 0; c = this.sugg % N;
      v.ring(this.px(c), this.py(r), this.R * 1.25, { color: P.ink, w: 1.4, a: .9, dash: [3, 3] });
      v.cross(this.px(c), this.py(r), this.R * .5, { color: P.warn, w: 1.3 });
    }
  };

  /* ───────── 大厅图标 ───────── */
  function icon(v, w, h) {
    var n = 5, pad = Math.min(w, h) * .17;
    var cell = (Math.min(w, h) - pad * 2) / (n - 1);
    var ox = (w - cell * (n - 1)) / 2, oy = (h - cell * (n - 1)) / 2, i;
    for (i = 0; i < n; i++) {
      v.line(ox, oy + i * cell, ox + cell * (n - 1), oy + i * cell, { color: P.ruleSoft, w: .8 });
      v.line(ox + i * cell, oy, ox + i * cell, oy + cell * (n - 1), { color: P.ruleSoft, w: .8 });
    }
    v.dot(ox + cell * 2, oy + cell * 2, cell * .07, P.ink);
    var R = cell * .42;
    v.disc(ox + cell * 2, oy + cell, R, { filled: true, ring: false });
    v.disc(ox + cell * 3, oy + cell * 2, R, { filled: false, ring: false });
    v.disc(ox + cell * 2, oy + cell * 3, R, { filled: true, ring: false });
    v.disc(ox + cell, oy + cell * 2, R, { filled: false, ring: false });
  }

  /* ───────── 注册 ───────── */
  Hub.register({
    id: 'go',
    name: '围棋',
    en: 'WEIQI',
    sub: '黑白对弈，围地多者胜',
    tag: '围棋',
    aspect: 1,
    players: 2,
    seatNames: ['黑方', '白方'],
    ai: true,
    options: [
      {
        key: 'size', label: '棋盘', def: 19,
        choices: [
          { v: 9, label: '9 路', note: '快棋，电脑最强' },
          { v: 13, label: '13 路', note: '折中' },
          { v: 19, label: '19 路', note: '标准' }
        ],
        note: '与电脑对弈建议选 9 路：全盘模拟量小，棋力明显更高。'
      },
      {
        key: 'komi', label: '贴目', def: 7.5,
        choices: [{ v: 5.5, label: '5.5 目' }, { v: 6.5, label: '6.5 目' }, { v: 7.5, label: '7.5 目', note: '中国规则' }]
      },
      {
        key: 'coords', label: '坐标', def: true,
        choices: [{ v: true, label: '显示' }, { v: false, label: '隐藏' }]
      }
    ],
    rules: {
      intro: '黑先白后，轮流把棋子下在<b>交叉点</b>上，落定不得移动。棋子以「气」（相邻空点）维生，气尽则被提走。终局以<b>中国规则数子</b>定胜负：己方活子加上所围空点，多者胜，白方另有贴目补偿。',
      sections: [
        {
          title: '基本规则', items: [
            '<b>气</b>：与棋子直线相邻的空点。同色直线相连的棋子共用气，称为一「块」。',
            '<b>提子</b>：落子后使对方某块气数为零，该块立即从盘上移除，计入己方提子数。',
            '<b>禁自杀</b>：若落子后己方一块气数为零且未能提掉对方，则该点为禁着点。',
            '<b>劫争</b>：不得使盘面重现本局此前出现过的同一局面（情景超级劫），因此打劫时必须先找劫材。',
            '<b>虚手</b>：可选择不落子。双方连续虚手即告终局，进入数子。'
          ]
        },
        {
          title: '数子与胜负', items: [
            '终局后进入<b>数子阶段</b>：点击盘上整块棋子可标记为「死子」，再点一次取消。',
            '死子会从盘上清除，其所在区域归对方所有。确认无误后点「终局数子」。',
            '计算方式：<b>黑 = 黑子 + 黑地</b>，<b>白 = 白子 + 白地 + 贴目</b>，多者胜。',
            '双方边界之间的单官（中立空点）不计入任何一方。',
            '若对标记有分歧，点「继续对局」回到行棋阶段，用实战解决。'
          ]
        },
        {
          title: '盘面记号', items: [
            '实心圆为<b>黑子</b>，空心圆为<b>白子</b>；子内小圈标出最后一手。',
            '数子阶段：淡墨方格为黑地，浅灰方格为白地，无底色为中立。',
            '死子以红色叉号标记，并整体淡化显示。',
            '「提示」会给出电脑建议的落点（虚线圈 + 红叉）。'
          ]
        },
        {
          title: '电脑强度', items: [
            '电脑采用<b>启发式选点 + 随机终局模拟（蒙特卡洛）</b>，不做深度死活计算。',
            '<b>入门</b>仅用启发式；<b>进阶 / 高手</b>增加模拟次数与时间预算。',
            '9 路上棋力尚可，19 路上仍以布局占大场为主，<b>不会做复杂攻杀与死活</b>，请酌情让子。'
          ]
        }
      ]
    },
    icon: icon,
    create: function (cfg) { return new Go(cfg); }
  });

  Hub.Go = Go;
  Hub.GO = { EMPTY: 0, BLACK: 1, WHITE: 2 };

})(window);
