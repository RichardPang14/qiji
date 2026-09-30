/* ════════════════════════════════════════════════════════════
   五子棋 GOMOKU —— 自由规则（长连算胜），黑先
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub, P = Hub.PAL, U = Hub.util;

  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];          // 四个线方向
  var OFF5 = [];                                          // 5×5 邻域偏移（候选点生成）
  for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) OFF5.push([dr, dc]);

  /* 窗口分值表 */
  var W5 = [0, 1, 12, 130, 1400, 1000000];
  var W6 = [0, 0, 7, 70, 950, 20000, 0];

  /* 着法排序用的粗评估表 [连子数][开放端数] */
  var PAT = [
    [0, 0, 0],
    [0, 6, 60],
    [0, 80, 800],
    [0, 1000, 20000],
    [0, 50000, 500000],
    [0, 10000000, 10000000]
  ];

  var COLNAME = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';   // 跳过 I（围棋记谱惯例）

  /* ─────────────────────────────────────────────── */
  function Gomoku(cfg) {
    Hub.Base.call(this, cfg);
    this.N = cfg.size || 15;
    this.reset();
  }
  Gomoku.prototype = Object.create(Hub.Base.prototype);
  Gomoku.prototype.constructor = Gomoku;

  Gomoku.prototype.reset = function () {
    var N = this.N, n = N * N, i;
    this.b = new Int8Array(n);
    this.near = new Int8Array(n);
    this.turn = 1;              // 1 黑 / 2 白
    this.ply = 0;
    this.history = [];          // [{i, s}]
    this.last = -1;
    this.winLine = null;
    this._over = null;
    this.sel = -1;              // 悬停点
    this.sugg = -1;
    this.stones = 0;
    this._buildWindows();
    for (i = 0; i < n; i++) this.near[i] = 0;
  };

  Gomoku.prototype._buildWindows = function () {
    var N = this.N, w5 = [], w6 = [], d, r, c, k;
    for (d = 0; d < 4; d++) {
      var vr = DIRS[d][0], vc = DIRS[d][1];
      for (r = 0; r < N; r++) {
        for (c = 0; c < N; c++) {
          var er = r + vr * 4, ec = c + vc * 4;
          if (er < 0 || er >= N || ec < 0 || ec >= N) continue;
          var a5 = [];
          for (k = 0; k < 5; k++) a5.push((r + vr * k) * N + (c + vc * k));
          w5.push(a5);
          var er6 = r + vr * 5, ec6 = c + vc * 5;
          if (er6 >= 0 && er6 < N && ec6 >= 0 && ec6 < N) {
            var a6 = a5.slice(); a6.push(er6 * N + ec6);
            w6.push(a6);
          }
        }
      }
    }
    this._w5 = w5; this._w6 = w6;
  };

  /* ───────── 基础查询 ───────── */
  Gomoku.prototype.idx = function (r, c) { return r * this.N + c; };
  Gomoku.prototype.inBoard = function (r, c) { return r >= 0 && r < this.N && c >= 0 && c < this.N; };

  Gomoku.prototype.countFive = function (i, s) {
    var N = this.N, r = (i / N) | 0, c = i % N, d, best = 0;
    for (d = 0; d < 4; d++) {
      var vr = DIRS[d][0], vc = DIRS[d][1], cnt = 1, k;
      for (k = 1; k < 6; k++) {
        var rr = r + vr * k, cc = c + vc * k;
        if (!this.inBoard(rr, cc) || this.b[rr * N + cc] !== s) break;
        cnt++;
      }
      for (k = 1; k < 6; k++) {
        var r2 = r - vr * k, c2 = c - vc * k;
        if (!this.inBoard(r2, c2) || this.b[r2 * N + c2] !== s) break;
        cnt++;
      }
      if (cnt > best) best = cnt;
    }
    return best;
  };

  /* 连五的具体点位，用于高亮 */
  Gomoku.prototype.findWinLine = function (i, s) {
    var N = this.N, r = (i / N) | 0, c = i % N, d, k;
    for (d = 0; d < 4; d++) {
      var vr = DIRS[d][0], vc = DIRS[d][1];
      var cells = [[r, c]];
      for (k = 1; k < N; k++) {
        var rr = r + vr * k, cc = c + vc * k;
        if (!this.inBoard(rr, cc) || this.b[rr * N + cc] !== s) break;
        cells.push([rr, cc]);
      }
      for (k = 1; k < N; k++) {
        var r2 = r - vr * k, c2 = c - vc * k;
        if (!this.inBoard(r2, c2) || this.b[r2 * N + c2] !== s) break;
        cells.unshift([r2, c2]);
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  };

  /* ───────── 落子 / 悔棋 ───────── */
  Gomoku.prototype._bump = function (i, delta) {
    var N = this.N, r = (i / N) | 0, c = i % N;
    for (var k = 0; k < OFF5.length; k++) {
      var rr = r + OFF5[k][0], cc = c + OFF5[k][1];
      if (rr >= 0 && rr < N && cc >= 0 && cc < N) this.near[rr * N + cc] += delta;
    }
  };

  Gomoku.prototype.play = function (i) {
    var s = this.turn;
    this.b[i] = s;
    this.stones++;
    this._bump(i, 1);
    this.history.push({ i: i, s: s });
    this.last = i;
    this.ply++;
    this.sugg = -1;

    if (this.countFive(i, s) >= 5) {
      this.winLine = this.findWinLine(i, s);
      this._over = {
        winner: s - 1,
        title: this.seatName(s - 1) + '胜',
        text: '第 ' + this.ply + ' 手连成五子。'
      };
    } else if (this.stones >= this.N * this.N) {
      this._over = { winner: null, title: '和局', text: '棋盘已满，双方均未连五。' };
    } else {
      this.turn = 3 - s;
    }
    return true;
  };

  Gomoku.prototype.undo = function () {
    if (!this.history.length) return false;
    var step = this.history.pop();
    this.b[step.i] = 0;
    this.stones--;
    this.turn = step.s;
    this.ply--;
    this._over = null;
    this.winLine = null;
    this.sugg = -1;
    var prev = this.history.length ? this.history[this.history.length - 1].i : -1;
    this.last = prev;
    if (prev >= 0 && this.countFive(prev, this.b[prev]) >= 5) {
      this.winLine = this.findWinLine(prev, this.b[prev]);
    }
    this._rebuildNear();
    return true;
  };

  Gomoku.prototype._rebuildNear = function () {
    var n = this.N * this.N, i;
    for (i = 0; i < n; i++) this.near[i] = 0;
    for (i = 0; i < n; i++) if (this.b[i]) this._bump(i, 1);
  };

  Gomoku.prototype.canUndo = function () { return this.history.length > 0 && !this.thinking; };

  Gomoku.prototype.resign = function (seat) {
    this._over = {
      winner: 1 - seat,
      title: this.seatName(1 - seat) + '胜',
      text: this.seatName(seat) + ' 认输。'
    };
  };

  /* ───────── 界面契约 ───────── */
  Gomoku.prototype.seat = function () { return this._over ? -1 : this.turn - 1; };
  Gomoku.prototype.seatName = function (i) { return i === 0 ? '黑方' : '白方'; };
  /* 黑子画为实心，与侧栏座位圆点保持一致 */
  Gomoku.prototype.seatFilled = function (i) { return i === 0; };
  Gomoku.prototype.seatCaptured = function (i) {
    var c = 0, s = i + 1;
    for (var k = 0; k < this.b.length; k++) if (this.b[k] === s) c++;
    return '在盘 ' + c;
  };

  Gomoku.prototype.status = function () {
    if (this._over) return '<b>' + this._over.title + '</b>';
    var n = this.seatName(this.turn - 1);
    return '<b>' + n + '</b> 落子' + (this.ply === 0 ? '（黑先）' : '');
  };
  Gomoku.prototype.hint = function () {
    if (this._over) return '';
    return '点击棋盘交叉点落子，先在横、竖、斜任一方向连成五子者胜。';
  };

  Gomoku.prototype.info = function () {
    var n = this.N;
    var h = '<div class="kv"><span>棋盘</span><span>' + n + ' × ' + n + '</span></div>' +
            '<div class="kv"><span>手数</span><span>' + this.ply + '</span></div>' +
            '<div class="kv"><span>黑 / 白</span><span>' + this.seatCaptured(0) + ' / ' + this.seatCaptured(1) + '</span></div>';
    if (this.last >= 0) {
      h += '<div class="kv"><span>上一手</span><span>' + this.coordName(this.last) + '</span></div>';
    }
    return h;
  };

  Gomoku.prototype.coordName = function (i) {
    var N = this.N, r = (i / N) | 0, c = i % N;
    return COLNAME[c] + (N - r);
  };

  Gomoku.prototype.log = function () {
    var out = [];
    for (var k = 0; k < this.history.length; k++) {
      var m = this.history[k];
      out.push({
        n: (k + 1) + '.',
        v: (m.s === 1 ? '● ' : '○ ') + this.coordName(m.i)
      });
    }
    return out;
  };

  /* ───────── 交互 ───────── */
  Gomoku.prototype.layout = function (w, h) {
    var N = this.N;
    var m = Math.max(18, Math.min(w, h) * (this.cfg.coords === false ? .045 : .072));
    this.pad = m;
    this.cell = (Math.min(w, h) - m * 2) / (N - 1);
    this.ox = (w - this.cell * (N - 1)) / 2;
    this.oy = (h - this.cell * (N - 1)) / 2;
    this.W = w; this.H = h;
    this.R = this.cell * .44;
  };
  Gomoku.prototype.px = function (c) { return this.ox + c * this.cell; };
  Gomoku.prototype.py = function (r) { return this.oy + r * this.cell; };

  Gomoku.prototype.pick = function (x, y) {
    if (!this.cell) return null;
    var N = this.N;
    var c = Math.round((x - this.ox) / this.cell);
    var r = Math.round((y - this.oy) / this.cell);
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    var dx = x - this.px(c), dy = y - this.py(r);
    if (dx * dx + dy * dy > Math.pow(this.cell * .52, 2)) return null;
    return { r: r, c: c, i: r * N + c };
  };
  Gomoku.prototype.pickHint = function (hit) { return !!hit && this.b[hit.i] === 0 && !this._over; };

  Gomoku.prototype.hover = function (hit) {
    this.sel = (hit && this.b[hit.i] === 0 && !this._over) ? hit.i : -1;
  };

  Gomoku.prototype.click = function (hit) {
    if (!hit || this._over) return false;
    if (this.b[hit.i] !== 0) return false;
    this.play(hit.i);
    return true;
  };

  /* ───────── 绘制 ───────── */
  Gomoku.prototype.draw = function (v) {
    var N = this.N, r, c, i;
    var x0 = this.px(0), y0 = this.py(0);
    var x1 = this.px(N - 1), y1 = this.py(N - 1);

    /* 外框 */
    v.rect(x0 - this.cell * .5, y0 - this.cell * .5,
      (x1 - x0) + this.cell, (y1 - y0) + this.cell,
      { stroke: P.ruleFaint, w: 1 });

    /* 网格 */
    for (i = 0; i < N; i++) {
      var lw = (i === 0 || i === N - 1) ? 1.3 : .85;
      v.line(x0, this.py(i), x1, this.py(i), { w: lw, color: P.rule, a: (i === 0 || i === N - 1) ? 1 : .82 });
      v.line(this.px(i), y0, this.px(i), y1, { w: lw, color: P.rule, a: (i === 0 || i === N - 1) ? 1 : .82 });
    }

    /* 星位 */
    var stars = this._stars();
    for (i = 0; i < stars.length; i++) {
      v.dot(this.px(stars[i][1]), this.py(stars[i][0]), Math.max(1.6, this.cell * .055), P.ink);
    }

    /* 坐标（仅左列与下行，保持线稿留白） */
    if (this.cfg.coords !== false) {
      var fs = Math.max(7.5, Math.min(11, this.cell * .3));
      for (c = 0; c < N; c++) {
        v.text(COLNAME[c], this.px(c), y1 + this.cell * .52 + fs * .85,
          { size: fs, color: P.ink4, family: 'monospace' });
      }
      for (r = 0; r < N; r++) {
        v.text(String(N - r), x0 - this.cell * .52 - fs * .95, this.py(r),
          { size: fs, color: P.ink4, family: 'monospace' });
      }
    }

    /* 悬停虚影 */
    if (this.sel >= 0 && !this._over && this.b[this.sel] === 0) {
      var sr = (this.sel / N) | 0, sc = this.sel % N;
      v.circle(this.px(sc), this.py(sr), this.R, {
        fill: this.turn === 1 ? P.ink : P.paper,
        stroke: P.ink, w: 1, a: .3, fillA: .28
      });
    }

    /* 棋子 */
    for (r = 0; r < N; r++) {
      for (c = 0; c < N; c++) {
        i = r * N + c;
        var s = this.b[i];
        if (!s) continue;
        v.disc(this.px(c), this.py(r), this.R, {
          filled: s === 1, label: '', ring: false
        });
      }
    }

    /* 最后一手：小十字记号 */
    if (this.last >= 0) {
      var lr = (this.last / N) | 0, lc = this.last % N;
      var col = this.b[this.last] === 1 ? '#fff' : P.ink;
      var t = this.R * .34;
      v.line(this.px(lc) - t, this.py(lr), this.px(lc) + t, this.py(lr), { color: col, w: 1.2 });
      v.line(this.px(lc), this.py(lr) - t, this.px(lc), this.py(lr) + t, { color: col, w: 1.2 });
    }

    /* 建议标记 */
    if (this.sugg >= 0) {
      var gr = (this.sugg / N) | 0, gc = this.sugg % N;
      v.ring(this.px(gc), this.py(gr), this.R * 1.28, { color: P.ink, w: 1.4, a: .9, dash: [3, 3] });
    }

    /* 连五高亮 */
    if (this.winLine && this.winLine.length) {
      var a = this.winLine[0], b2 = this.winLine[this.winLine.length - 1];
      v.line(this.px(a[1]), this.py(a[0]), this.px(b2[1]), this.py(b2[0]),
        { color: P.warn, w: Math.max(1.6, this.cell * .07), a: .55 });
      for (i = 0; i < this.winLine.length; i++) {
        v.circle(this.px(this.winLine[i][1]), this.py(this.winLine[i][0]),
          this.R * 1.22, { stroke: P.warn, w: 1.5, a: .9 });
      }
    }
  };

  Gomoku.prototype._stars = function () {
    var N = this.N;
    if (N === 15) return [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
    if (N === 19) return [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]];
    if (N === 13) return [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]];
    var m = (N / 2) | 0;
    return [[m, m]];
  };

  /* ───────── 评估 ───────── */
  Gomoku.prototype.evalBoth = function () {
    var w5 = this._w5, w6 = this._w6, b = this.b, i, k, v, n1, n2, w;
    var s1 = 0, s2 = 0;
    for (i = 0; i < w5.length; i++) {
      w = w5[i]; n1 = 0; n2 = 0;
      for (k = 0; k < 5; k++) { v = b[w[k]]; if (v === 1) n1++; else if (v === 2) n2++; }
      if (n2 === 0 && n1) s1 += W5[n1];
      if (n1 === 0 && n2) s2 += W5[n2];
    }
    for (i = 0; i < w6.length; i++) {
      w = w6[i]; n1 = 0; n2 = 0;
      for (k = 0; k < 6; k++) { v = b[w[k]]; if (v === 1) n1++; else if (v === 2) n2++; }
      if (n2 === 0 && n1 > 1) s1 += W6[n1];
      if (n1 === 0 && n2 > 1) s2 += W6[n2];
    }
    return [s1, s2];
  };

  /* 单点粗评（仅用于着法排序） */
  Gomoku.prototype.pointScore = function (i, s) {
    var N = this.N, r = (i / N) | 0, c = i % N, b = this.b, tot = 0, d, k;
    for (d = 0; d < 4; d++) {
      var vr = DIRS[d][0], vc = DIRS[d][1];
      var cnt = 1, open = 0, rr, cc;
      for (k = 1; k <= 5; k++) {
        rr = r + vr * k; cc = c + vc * k;
        if (!this.inBoard(rr, cc)) break;
        if (b[rr * N + cc] === s) cnt++;
        else { if (b[rr * N + cc] === 0) open++; break; }
      }
      for (k = 1; k <= 5; k++) {
        rr = r - vr * k; cc = c - vc * k;
        if (!this.inBoard(rr, cc)) break;
        if (b[rr * N + cc] === s) cnt++;
        else { if (b[rr * N + cc] === 0) open++; break; }
      }
      if (cnt > 5) cnt = 5;
      tot += PAT[cnt][open > 2 ? 2 : open];
    }
    return tot;
  };

  Gomoku.prototype.candidates = function (limit, side) {
    var n = this.N * this.N, out = [], i, me = side || this.turn, op = 3 - me;
    for (i = 0; i < n; i++) {
      if (this.b[i] || this.near[i] === 0) continue;
      out.push({ i: i, v: this.pointScore(i, me) + this.pointScore(i, op) * .92 });
    }
    if (!out.length) {
      var c0 = (this.N / 2) | 0;
      out.push({ i: c0 * this.N + c0, v: 0 });
      return out;
    }
    out.sort(function (a, b) { return b.v - a.v; });
    return out.slice(0, limit);
  };

  /* 是否存在一步连五 */
  Gomoku.prototype.findFive = function (s) {
    var n = this.N * this.N;
    for (var i = 0; i < n; i++) {
      if (this.b[i] || this.near[i] === 0) continue;
      this.b[i] = s;
      var ok = this.countFive(i, s) >= 5;
      this.b[i] = 0;
      if (ok) return i;
    }
    return -1;
  };

  /* ───────── 电脑行棋 ───────── */
  Gomoku.prototype.suggest = function (level) {
    var m = this._think(level);
    if (m >= 0) { this.sugg = m; Hub.App.toast('建议落点：' + this.coordName(m)); }
    return m;
  };
  Gomoku.prototype.clearSuggestion = function () { this.sugg = -1; };

  Gomoku.prototype.aiMove = function (level) {
    var m = this._think(level);
    if (m < 0) return false;
    this.play(m);
    return true;
  };

  Gomoku.prototype._think = function (level) {
    if (this._over) return -1;
    var me = this.turn, op = 3 - me;

    /* 空盘：天元附近 */
    if (this.stones === 0) {
      var c0 = (this.N / 2) | 0;
      return c0 * this.N + c0;
    }

    /* 必胜 / 必堵 */
    var win = this.findFive(me);
    if (win >= 0) return win;
    var blk = this.findFive(op);
    if (blk >= 0) return blk;

    var cfgs = {
      1: { depth: 1, cand: 8, time: 180, margin: 2600 },
      2: { depth: 3, cand: 12, time: 550, margin: 0 },
      3: { depth: 5, cand: 16, time: 1300, margin: 0 }
    };
    var cf = cfgs[level] || cfgs[2];

    if (level === 1) {
      /* 入门：粗评 + 加权随机，几乎不搜索 */
      var list = this.candidates(cf.cand).map(function (e) { return { i: e.i, v: e.v }; });
      if (!list.length) return -1;
      var mx = -Infinity, k;
      for (k = 0; k < list.length; k++) if (list[k].v > mx) mx = list[k].v;
      /* 归一到 1..30 的档位后加权 */
      for (k = 0; k < list.length; k++) list[k].v = 1 + Math.round(list[k].v / (mx + 1) * 29);
      var pick = Hub.search.weighted(list, 2.6);
      return pick ? pick.i : list[0].i;
    }

    var self = this;
    var winStack = [];
    var side = me;
    var ctx = {
      moves: function () {
        var arr = self.candidates(cf.cand, side);
        var out = new Array(arr.length);
        for (var i = 0; i < arr.length; i++) out[i] = arr[i].i;
        return out;
      },
      orderScore: function (m) {
        return self.pointScore(m, side) + self.pointScore(m, 3 - side) * .9;
      },
      make: function (m) {
        self.b[m] = side;
        self._bump(m, 1);
        winStack.push(self.countFive(m, side) >= 5);
        side = 3 - side;
      },
      unmake: function (m) {
        side = 3 - side;
        winStack.pop();
        self._bump(m, -1);
        self.b[m] = 0;
      },
      terminal: function (ply) {
        if (winStack.length && winStack[winStack.length - 1]) return -(Hub.search.MATE - ply);
        return null;
      },
      evaluate: function () {
        var e = self.evalBoth();
        return e[side - 1] - e[3 - side] * 1.03;
      }
    };

    var res = Hub.search.best(ctx, {
      maxDepth: cf.depth, timeMs: cf.time, maxNodes: 900000, margin: cf.margin,
      rnd: level <= 1 ? Math.random : null
    });

    /* 校验：搜索必须完整还原局面 */
    if (side !== me) side = me;
    return res ? res.move : this.candidates(1)[0].i;
  };

  /* ───────── 大厅图标 ───────── */
  function icon(v, w, h) {
    var n = 5, pad = Math.min(w, h) * .18;
    var cell = (Math.min(w, h) - pad * 2) / (n - 1);
    var ox = (w - cell * (n - 1)) / 2, oy = (h - cell * (n - 1)) / 2;
    var i;
    for (i = 0; i < n; i++) {
      v.line(ox, oy + i * cell, ox + cell * (n - 1), oy + i * cell, { color: P.ruleSoft, w: .8 });
      v.line(ox + i * cell, oy, ox + i * cell, oy + cell * (n - 1), { color: P.ruleSoft, w: .8 });
    }
    var r = cell * .4;
    [[1, 1, 1], [2, 2, 1], [3, 3, 1], [2, 1, 2], [3, 1, 2]].forEach(function (p) {
      v.disc(ox + p[1] * cell, oy + p[0] * cell, r, { filled: p[2] === 1, ring: false });
    });
    v.line(ox + cell, oy + cell, ox + cell * 3, oy + cell * 3, { color: P.warn, w: 1.6, a: .5 });
  }

  /* ───────── 注册 ───────── */
  Hub.register({
    id: 'gomoku',
    name: '五子棋',
    en: 'GOMOKU',
    sub: '十五路纵横，先连五子者胜',
    tag: '连珠',
    aspect: 1,
    players: 2,
    seatNames: ['黑方', '白方'],
    ai: true,
    options: [
      {
        key: 'size', label: '棋盘', def: 15,
        choices: [{ v: 13, label: '13 路' }, { v: 15, label: '15 路', note: '标准' }, { v: 19, label: '19 路' }]
      },
      {
        key: 'coords', label: '坐标', def: true,
        choices: [{ v: true, label: '显示' }, { v: false, label: '隐藏' }]
      }
    ],
    rules: {
      intro: '五子棋由黑方先行，双方轮流在棋盘交叉点上落子，率先在横、竖或斜方向连成五子（或以上）的一方获胜。本实现采用<b>自由规则</b>：不设禁手，长连（六子以上）同样算胜。',
      sections: [
        {
          title: '基本规则', items: [
            '棋盘默认 <b>15 × 15</b>，可选 13 路或 19 路；棋子落在<b>线的交叉点</b>上，不落格中。',
            '<b>黑方先行</b>，此后双方各下一子，落子后不可移动（可用「悔棋」撤回）。',
            '任一方向出现 <b>5 子或以上相连</b>即判胜；棋盘下满而无人连五则为和局。',
            '本实现不设黑棋禁手（三三、四四、长连均允许），适合休闲对弈。'
          ]
        },
        {
          title: '盘面记号', items: [
            '实心圆为<b>黑子</b>，空心圆为<b>白子</b>。',
            '最后一手以子心<b>小十字</b>标出。',
            '连成五子后以<b>红色连线</b>高亮胜出的一串。',
            '点「提示」后，虚线圈出的即电脑建议的落点。'
          ]
        },
        {
          title: '电脑强度', items: [
            '<b>入门</b>：只做静态形评估并带随机性，会漏算多步威胁。',
            '<b>进阶</b>：alpha-beta 搜索 3 层，能识别活三、冲四并主动做杀。',
            '<b>高手</b>：搜索 5 层并配合威胁排序，需要注意它的连冲手段。'
          ]
        }
      ]
    },
    icon: icon,
    create: function (cfg) { return new Gomoku(cfg); }
  });

})(window);
