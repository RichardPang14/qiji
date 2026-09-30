/* ════════════════════════════════════════════════════════════
   四子棋 CONNECT FOUR
   盘面：7 列 × 6 行竖盘，棋子自顶落入每列最底空位
   规则：轮流落子，先在横、竖、斜任一方向连成四子者胜；
         盘满无人连线为和局。
   座位：0 红方（实心）先行，1 黄方（空心）
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub, P = Hub.PAL;

  var COLS = 7, ROWS = 6, NC = COLS * ROWS;
  var SEAT_NAME = ['红方', '黄方'];
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function Connect4(cfg) {
    Hub.Base.call(this, cfg);
    this.reset();
  }
  Connect4.prototype = Object.create(Hub.Base.prototype);
  Connect4.prototype.constructor = Connect4;

  Connect4.prototype.reset = function () {
    this.b = new Int8Array(NC);
    this.heights = [0, 0, 0, 0, 0, 0, 0];
    this.turn = 0;
    this.ply = 0;
    this.lastMark = -1;
    this.winLine = null;
    this._winFlag = false;
    this.history = [];
    this.sugg = null;
    this._hoverCol = -1;
    this._over = null;
    this.msg = '红方先行，点任一列落子。';
  };

  Connect4.prototype.seatCount = function () { return 2; };
  Connect4.prototype.landing = function (c) {
    if (c < 0 || c >= COLS || this.heights[c] >= ROWS) return -1;
    return this.heights[c] * COLS + c;
  };

  Connect4.prototype.genMoves = function () {
    var out = [], c;
    for (c = 0; c < COLS; c++) if (this.heights[c] < ROWS) out.push({ c: c, r: this.heights[c] });
    return out;
  };

  /** 以 (r,c) 为末子的四连检测，返回四格索引或 null */
  Connect4.prototype.winAt = function (r, c) {
    var col = this.b[r * COLS + c], d, k, rr, cc, line;
    if (!col) return null;
    for (d = 0; d < 4; d++) {
      line = [r * COLS + c];
      for (k = 1; k < 4; k++) {
        rr = r + DIRS[d][0] * k; cc = c + DIRS[d][1] * k;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || this.b[rr * COLS + cc] !== col) break;
        line.push(rr * COLS + cc);
      }
      for (k = 1; k < 4; k++) {
        rr = r - DIRS[d][0] * k; cc = c - DIRS[d][1] * k;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || this.b[rr * COLS + cc] !== col) break;
        line.unshift(rr * COLS + cc);
      }
      if (line.length >= 4) return line.slice(0, 4);
    }
    return null;
  };

  /* ───────── 执行 / 撤销 ───────── */
  Connect4.prototype.snapshot = function () {
    return {
      b: this.b.slice(), heights: this.heights.slice(), turn: this.turn,
      ply: this.ply, lastMark: this.lastMark, winLine: this.winLine,
      msg: this.msg, _over: this._over
    };
  };
  Connect4.prototype.restore = function (s) {
    this.b = s.b.slice(); this.heights = s.heights.slice(); this.turn = s.turn;
    this.ply = s.ply; this.lastMark = s.lastMark; this.winLine = s.winLine;
    this.msg = s.msg; this._over = s._over || null;
    this.sugg = null;
  };
  Connect4.prototype.canUndo = function () { return this.history.length > 0 && !this.thinking; };
  Connect4.prototype.undo = function () {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  };

  Connect4.prototype.play = function (m) {
    var seat = this.turn, i = m.r * COLS + m.c;
    this.history.push(this.snapshot());
    this.b[i] = seat + 1;
    this.heights[m.c]++;
    this.ply++;
    this.lastMark = i;
    this.sugg = null;
    var line = this.winAt(m.r, m.c);
    this._winFlag = !!line;
    if (line) {
      this.winLine = line;
      this._over = {
        winner: seat, title: SEAT_NAME[seat] + '胜',
        text: SEAT_NAME[seat] + ' 在第 ' + this.ply + ' 手连成四子（' +
          this.cellName(line[0]) + ' – ' + this.cellName(line[3]) + '）。'
      };
      this.msg = SEAT_NAME[seat] + ' 四连获胜！';
    } else if (this.ply >= NC) {
      this._over = { winner: null, title: '和局', text: '42 格落满，无人四连，判和。' };
      this.msg = '盘满和局。';
    } else {
      this.turn = 1 - seat;
      this.msg = SEAT_NAME[seat] + ' 落 ' + String.fromCharCode(97 + m.c) + ' 列。';
    }
    this.history[this.history.length - 1].rec = { s: seat, c: m.c, r: m.r };
    return true;
  };

  Connect4.prototype.resign = function (seat) {
    var w = 1 - seat;
    this._over = {
      winner: w, title: SEAT_NAME[w] + '胜',
      text: SEAT_NAME[seat] + ' 认输，' + SEAT_NAME[w] + ' 获胜。'
    };
  };

  /* ───────── 界面契约 ───────── */
  Connect4.prototype.seat = function () { return this._over ? -1 : this.turn; };
  Connect4.prototype.seatName = function (i) { return SEAT_NAME[i] || ('第' + (i + 1) + '方'); };
  Connect4.prototype.seatFilled = function (i) { return i === 0; };
  Connect4.prototype.seatCaptured = function (i) {
    var n = 0, k;
    for (k = 0; k < NC; k++) if (this.b[k] === i + 1) n++;
    return n + ' 子';
  };
  Connect4.prototype.cellName = function (i) {
    return String.fromCharCode(97 + (i % COLS)) + (((i / COLS) | 0) + 1);
  };
  Connect4.prototype.status = function () {
    if (this._over) return '<b>' + this._over.title + '</b>';
    return '<b>' + SEAT_NAME[this.turn] + '</b> 行棋（第 ' + (this.ply + 1) + ' 手）';
  };
  Connect4.prototype.hint = function () {
    if (this._over) return '';
    return '点任一列，棋子落到该列最底空位。横、竖、斜任一方向先连四子者胜；留神对方上一手的三连缺口。';
  };
  Connect4.prototype.log = function () {
    var out = [], k;
    for (k = 0; k < this.history.length; k++) {
      var r = this.history[k].rec;
      if (!r) continue;
      out.push({
        n: (k + 1) + '.',
        v: SEAT_NAME[r.s] + ' ' + String.fromCharCode(97 + r.c) + ' 列 → 第 ' + (r.r + 1) + ' 行',
        hi: k === this.history.length - 1
      });
    }
    return out;
  };
  Connect4.prototype.info = function () {
    var h = '<div class="kv"><span>手数</span><span>' + this.ply + ' / ' + NC + '</span></div>';
    h += '<h5>各列已落</h5>';
    var c;
    for (c = 0; c < COLS; c++) {
      h += '<div class="kv"><span>' + String.fromCharCode(97 + c) + ' 列</span><span>' +
        this.heights[c] + ' / ' + ROWS + '</span></div>';
    }
    h += '<h5>要点</h5><div style="font-size:11.5px;line-height:1.8">中列 d 参与的连线最多；' +
      '制造「一子双杀」的两个三连缺口，对手只能堵一边。</div>';
    return h;
  };

  /* ───────── 交互 ───────── */
  Connect4.prototype.layout = function (w, h) {
    var box = Hub.geom.fit(w, h, COLS / ROWS, 0);
    this.cell = box.w / COLS;
    this.ox = box.x; this.oy = box.y;
    this.W = w; this.H = h;
  };
  Connect4.prototype.px = function (c) { return this.ox + (c + .5) * this.cell; };
  Connect4.prototype.py = function (r) { return this.oy + (r + .5) * this.cell; };
  Connect4.prototype.pick = function (x, y) {
    if (!this.cell) return null;
    var c = Math.floor((x - this.ox) / this.cell);
    if (c < 0 || c >= COLS) return null;
    var r = Math.floor((y - this.oy) / this.cell);
    if (r < 0 || r >= ROWS) return null;
    var lr = this.heights[c] < ROWS ? this.heights[c] : ROWS - 1;
    return { r: lr, c: c, i: lr * COLS + c, col: c };
  };
  Connect4.prototype.pickHint = function (hit) {
    return !!(hit && !this._over && this.heights[hit.c] < ROWS);
  };
  Connect4.prototype.hover = function (hit) { this._hoverCol = hit ? hit.c : -1; };
  Connect4.prototype.click = function (hit) {
    if (this._over) return false;
    if (!hit) return false;
    if (this.heights[hit.c] >= ROWS) {
      if (Hub.App) Hub.App.toast(String.fromCharCode(97 + hit.c) + ' 列已满');
      return false;
    }
    return this.play({ c: hit.c, r: this.heights[hit.c] });
  };

  /* ───────── 绘制 ───────── */
  Connect4.prototype.draw = function (v) {
    if (!this.cell) return;
    var cell = this.cell, r, c, i;

    /* 竖盘面板 */
    v.rect(this.ox, this.oy, cell * COLS, cell * ROWS, { fill: P.paper2, stroke: P.ink, w: 1.6, r: cell * .18 });
    for (c = 1; c < COLS; c++) {
      v.line(this.ox + c * cell, this.oy + cell * .12, this.ox + c * cell, this.oy + cell * ROWS - cell * .12,
        { color: P.ruleFaint, w: .8 });
    }

    /* 悬停列高亮 + 落点预告 */
    if (this.cfg.ghost !== false && this._hoverCol >= 0 && !this._over && this.heights[this._hoverCol] < ROWS) {
      v.rect(this.ox + this._hoverCol * cell + 1, this.oy + 1, cell - 2, cell * ROWS - 2,
        { fill: P.ink, fillA: .035 });
      var gi = this.landing(this._hoverCol);
      v.circle(this.px(gi % COLS), this.py((gi / COLS) | 0), cell * .36,
        { stroke: P.ink3, w: 1.1, dash: [4, 3], a: .8 });
    }

    /* 棋孔与棋子 */
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        i = r * COLS + c;
        var x = this.px(c), y = this.py(r);
        if (!this.b[i]) {
          v.circle(x, y, cell * .36, { fill: P.paper, stroke: P.ruleSoft, w: 1 });
        } else {
          var filled = this.b[i] === 1;
          v.circle(x, y, cell * .38, { fill: filled ? P.ink : P.paper, stroke: P.ink, w: 1.4 });
          if (!filled) v.circle(x, y, cell * .26, { stroke: P.ink, w: .9, a: .55 });
          if (filled && cell > 22) v.circle(x, y, cell * .27, { stroke: 'rgba(255,255,255,.4)', w: .8 });
        }
      }
    }

    /* 上一手记号 */
    if (this.lastMark >= 0) {
      var lx = this.px(this.lastMark % COLS), ly = this.py((this.lastMark / COLS) | 0);
      v.corners(lx - cell * .46, ly - cell * .46, cell * .92, cell * .92, cell * .18, { w: 1.4 });
    }

    /* 连线高亮 */
    if (this.winLine) {
      var a = this.winLine[0], z = this.winLine[3];
      /* 取两端：winLine 未必按端点排序，用距离最远的一对 */
      var p0 = this.winLine[0], p1 = this.winLine[0];
      for (i = 1; i < 4; i++) {
        if (this.winLine[i] < p0) p0 = this.winLine[i];
        if (this.winLine[i] > p1) p1 = this.winLine[i];
      }
      a = p0; z = p1;
      v.line(this.px(a % COLS), this.py((a / COLS) | 0), this.px(z % COLS), this.py((z / COLS) | 0),
        { color: P.warn, w: 3, a: .8 });
      for (i = 0; i < 4; i++) {
        var wi = this.winLine[i];
        v.circle(this.px(wi % COLS), this.py((wi / COLS) | 0), cell * .44, { stroke: P.warn, w: 1.6, a: .9 });
      }
    }

    /* 建议 */
    if (this.sugg && this.sugg.c >= 0) {
      v.corners(this.ox + this.sugg.c * cell + 2, this.oy + 2, cell - 4, cell * ROWS - 4,
        cell * .22, { color: P.warn, w: 2 });
    }
  };

  /* ───────── 电脑 ───────── */
  /** 数「三子+一空」的威胁窗口：站在 seat 视角 */
  Connect4.prototype._threats = function (seat) {
    var col = seat + 1, opp = 2 - seat, score = 0;
    var r, c, d, k, rr, cc, mine, theirs, empty, cells;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        for (d = 0; d < 4; d++) {
          mine = 0; theirs = 0; empty = 0; cells = [];
          for (k = 0; k < 4; k++) {
            rr = r + DIRS[d][0] * k; cc = c + DIRS[d][1] * k;
            if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) { mine = -1; break; }
            var bv = this.b[rr * COLS + cc];
            if (bv === col) mine++;
            else if (bv === opp) theirs++;
            else { empty++; cells.push(rr * COLS + cc); }
          }
          if (mine < 0 || theirs) continue;
          if (mine === 3 && empty === 1) {
            /* 缺口是否真的能落子（下方有支撑） */
            var gi = cells[0], gc = gi % COLS, gr = (gi / COLS) | 0;
            var playable = (gr === this.heights[gc]);
            score += playable ? 100 : 30;
          } else if (mine === 2 && empty === 2) score += 6;
          else if (mine === 1 && empty === 3) score += 1;
        }
      }
    }
    return score;
  };

  Connect4.prototype._ctx = function () {
    var self = this;
    return {
      moves: function () { return self.genMoves(); },
      make: function (m) {
        m._u = { h: self.heights[m.c], turn: self.turn, ply: self.ply, wf: self._winFlag };
        self.b[m.r * COLS + m.c] = self.turn + 1;
        self.heights[m.c]++;
        self.ply++;
        self._winFlag = !!self.winAt(m.r, m.c);
        self.turn = 1 - self.turn;
      },
      unmake: function (m) {
        self.b[m.r * COLS + m.c] = 0;
        self.heights[m.c] = m._u.h;
        self.turn = m._u.turn; self.ply = m._u.ply; self._winFlag = m._u.wf;
      },
      terminal: function (ply) {
        if (self._winFlag) return -(Hub.search.MATE - ply);   // 上一手已连线，当前方输
        if (self.ply >= NC) return 0;
        return null;
      },
      evaluate: function () {
        var ctr = 0, i, bv;
        for (i = 0; i < ROWS; i++) {
          bv = self.b[i * COLS + 3];
          if (bv === self.turn + 1) ctr += 3;
          else if (bv) ctr -= 3;
        }
        return self._threats(self.turn) - self._threats(1 - self.turn) * 1.15 + ctr;
      },
      orderScore: function (m) { return 6 - Math.abs(3 - m.c); }
    };
  };

  Connect4.prototype.aiMove = function (level) {
    if (this._over) return false;
    level = level || 2;
    var ms = this.genMoves();
    if (!ms.length) return false;
    var seat = this.turn, c, i;

    /* 一手取胜 / 必堵 */
    for (i = 0; i < 2; i++) {
      var who = i === 0 ? seat : 1 - seat;
      for (c = 0; c < COLS; c++) {
        if (this.heights[c] >= ROWS) continue;
        var r0 = this.heights[c];
        this.b[r0 * COLS + c] = who + 1;
        var win = this.winAt(r0, c);
        this.b[r0 * COLS + c] = 0;
        if (win) {
          if (i === 0) return this.play({ c: c, r: r0 });
          if (level >= 2) return this.play({ c: c, r: r0 });
        }
      }
    }
    if (level <= 1) {
      var pool = ms.map(function (m) { return { m: m, v: 6 - Math.abs(3 - m.c) + Math.random() * 3 }; });
      pool.sort(function (a, b) { return b.v - a.v; });
      return this.play(pool[0].m);
    }
    var depth = level === 2 ? 5 : 8;
    var res = Hub.search.best(this._ctx(), { maxDepth: depth, timeMs: level === 2 ? 700 : 1500 });
    if (!res) return this.play(ms[(ms.length / 2) | 0]);
    return this.play(res.move);
  };

  Connect4.prototype.suggest = function (level) {
    if (this._over) { Hub.App.toast('对局已结束'); return null; }
    var res = Hub.search.best(this._ctx(), { maxDepth: level == null ? 8 : (level + 4), timeMs: 1200 });
    if (!res) { Hub.App.toast('无可落之列'); return null; }
    this.sugg = { c: res.move.c };
    Hub.App.toast('建议：落 ' + String.fromCharCode(97 + res.move.c) + ' 列（深度 ' + res.depth + '）');
    return this.sugg;
  };
  Connect4.prototype.clearSuggestion = function () { this.sugg = null; };

  /* ───────── 大厅图标 ───────── */
  function icon(v, w, h) {
    var cols = 5, rows = 4, cell = Math.min(w / cols, h / rows) * .92;
    var ox = (w - cell * cols) / 2, oy = (h - cell * rows) / 2, r, c;
    v.rect(ox, oy, cell * cols, cell * rows, { stroke: P.ink, w: 1.2, r: cell * .2 });
    var pat = [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [1, 0, 0, 2, 0],
      [1, 1, 2, 2, 1]
    ];
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var x = ox + (c + .5) * cell, y = oy + (r + .5) * cell;
        if (!pat[r][c]) v.circle(x, y, cell * .32, { fill: P.paper, stroke: P.ruleSoft, w: .8 });
        else v.circle(x, y, cell * .34, { fill: pat[r][c] === 1 ? P.ink : P.paper, stroke: P.ink, w: 1.1 });
      }
    }
  }

  Hub.register({
    id: 'connect4',
    name: '四子棋',
    en: 'CONNECT FOUR',
    sub: '竖盘落子，四连即胜',
    tag: '连珠',
    aspect: COLS / ROWS,
    players: 2,
    seatNames: SEAT_NAME,
    ai: true,
    options: [
      {
        key: 'ghost', label: '落点预告', def: true,
        choices: [{ v: true, label: '显示', note: '悬停列时预告落点' }, { v: false, label: '隐藏' }]
      }
    ],
    rules: {
      intro: '7 列 6 行竖盘。<b>红方先行</b>，轮流把棋子投入任一列，棋子落到该列最底空位。先在<b>横、竖、斜任一方向连成四子</b>者胜。',
      sections: [
        {
          title: '落子', items: [
            '点任一列即落子；该列已满则不可再落。',
            '悬停某列时会以虚线圆预告棋子的落点。',
            '棋子受重力影响，只能堆叠，不能悬空。'
          ]
        },
        {
          title: '胜负', items: [
            '横、竖、斜任一方向<b>先连成四子</b>者胜，连线以红线标出。',
            '42 格落满仍无人四连为和局。',
            '认输立即判负。'
          ]
        },
        {
          title: '要点', items: [
            '中列 d 参与的四连窗口最多，开局宜占中。',
            '制造<b>一子双杀</b>：同时留下两个三连缺口，对手一回合只能堵一边。',
            '警惕「帮对方垫子」：你落的那格正好是对方三连缺口的下方支撑。'
          ]
        }
      ]
    },
    icon: icon,
    create: function (cfg) { return new Connect4(cfg); }
  });

  Hub.Connect4 = Connect4;
  Hub.C4 = { COLS: COLS, ROWS: ROWS, NC: NC, SEAT_NAME: SEAT_NAME };

})(window);
