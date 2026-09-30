/* ════════════════════════════════════════════════════════════
   黑白棋 REVERSI（奥赛罗）
   盘面：8×8，开局中央交叉摆两黑两白
   规则：轮流向空位落子，落子必须「夹住」对方至少一子，
         被夹住的整串对方棋子全部翻面；无子可落则弃权；
         双方连续弃权（或盘满）即终局，子多者胜。
   座位：0 黑方先行，1 白方
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub, P = Hub.PAL;

  var N = 8, NC = 64;
  var SEAT_NAME = ['黑方', '白方'];
  var DRC = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  /* 位置价值表：角最贵，邻角格（X 格）最毒 */
  var POSW = [
    120, -20, 20, 5, 5, 20, -20, 120,
    -20, -40, -5, -5, -5, -5, -40, -20,
    20, -5, 15, 3, 3, 15, -5, 20,
    5, -5, 3, 3, 3, 3, -5, 5,
    5, -5, 3, 3, 3, 3, -5, 5,
    20, -5, 15, 3, 3, 15, -5, 20,
    -20, -40, -5, -5, -5, -5, -40, -20,
    120, -20, 20, 5, 5, 20, -20, 120
  ];

  function Reversi(cfg) {
    Hub.Base.call(this, cfg);
    this.reset();
  }
  Reversi.prototype = Object.create(Hub.Base.prototype);
  Reversi.prototype.constructor = Reversi;

  Reversi.prototype.reset = function () {
    this.b = new Int8Array(NC);
    this.b[27] = 2; this.b[36] = 2;          // 白
    this.b[28] = 1; this.b[35] = 1;          // 黑
    this.turn = 0;
    this.passes = 0;
    this.ply = 0;
    this.lastMark = -1;
    this.history = [];
    this.sugg = null;
    this._hover = -1;
    this._over = null;
    this.msg = '黑方先行。';
  };

  Reversi.prototype.seatCount = function () { return 2; };
  Reversi.prototype.colorOf = function (seat) { return seat + 1; };

  /** 落在 i 处可翻的棋子列表；不可落返回 null */
  Reversi.prototype.flipsAt = function (i, seat) {
    if (this.b[i] !== 0) return null;
    var col = seat + 1, opp = 2 - seat, out = [], d, r, c, rr, cc, line;
    r = (i / N) | 0; c = i % N;
    for (d = 0; d < 8; d++) {
      rr = r + DRC[d][0]; cc = c + DRC[d][1];
      line = [];
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && this.b[rr * N + cc] === opp) {
        line.push(rr * N + cc);
        rr += DRC[d][0]; cc += DRC[d][1];
      }
      if (line.length && rr >= 0 && rr < N && cc >= 0 && cc < N && this.b[rr * N + cc] === col) {
        out = out.concat(line);
      }
    }
    return out.length ? out : null;
  };

  Reversi.prototype.genMoves = function (seat) {
    var out = [], i, f;
    for (i = 0; i < NC; i++) {
      f = this.flipsAt(i, seat);
      if (f) out.push({ i: i, flips: f });
    }
    return out;
  };

  Reversi.prototype.count = function (col) {
    var n = 0, i;
    for (i = 0; i < NC; i++) if (this.b[i] === col) n++;
    return n;
  };
  Reversi.prototype.emptyCount = function () {
    var n = 0, i;
    for (i = 0; i < NC; i++) if (this.b[i] === 0) n++;
    return n;
  };

  /* ───────── 执行 / 撤销 ───────── */
  Reversi.prototype.snapshot = function () {
    return {
      b: this.b.slice(), turn: this.turn, passes: this.passes,
      ply: this.ply, lastMark: this.lastMark, msg: this.msg, _over: this._over
    };
  };
  Reversi.prototype.restore = function (s) {
    this.b = s.b.slice(); this.turn = s.turn; this.passes = s.passes;
    this.ply = s.ply; this.lastMark = s.lastMark; this.msg = s.msg;
    this._over = s._over || null;
    this.sugg = null;
  };
  Reversi.prototype.canUndo = function () { return this.history.length > 0 && !this.thinking; };
  Reversi.prototype.undo = function () {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  };

  Reversi.prototype._begin = function () {
    this.history.push(this.snapshot());
    this.history[this.history.length - 1].rec = [];
  };
  Reversi.prototype._rec = function (x) {
    var h = this.history[this.history.length - 1];
    if (!h) return;
    if (!h.rec) h.rec = [];
    h.rec.push(x);
  };

  Reversi.prototype.play = function (m) {
    var seat = this.turn, col = seat + 1, k;
    this._begin();
    this.b[m.i] = col;
    for (k = 0; k < m.flips.length; k++) this.b[m.flips[k]] = col;
    this.ply++;
    this.lastMark = m.i;
    this.sugg = null;
    this._rec({ k: 'move', s: seat, i: m.i, n: m.flips.length });
    this.msg = SEAT_NAME[seat] + ' 落 ' + this.cellName(m.i) + '，翻子 ' + m.flips.length + ' 枚。';
    this.advance();
    return true;
  };

  /** 换手；无子可落者弃权；双方都无子可落则终局 */
  Reversi.prototype.advance = function () {
    var opp = 1 - this.turn;
    if (this.emptyCount() === 0) { this.finish(); return; }
    if (this.genMoves(opp).length) { this.turn = opp; this.passes = 0; return; }
    if (this.genMoves(this.turn).length) {
      this.passes++;
      this._rec({ k: 'pass', s: opp });
      this.msg += ' ' + SEAT_NAME[opp] + ' 无子可落，弃权。';
      return;
    }
    this.finish();
  };

  Reversi.prototype.finish = function () {
    var b = this.count(1), w = this.count(2);
    var winner = b > w ? 0 : (w > b ? 1 : null);
    this._over = {
      winner: winner,
      title: winner == null ? '和局' : (SEAT_NAME[winner] + '胜'),
      text: '终局数子：黑 ' + b + ' 枚，白 ' + w + ' 枚' +
        (winner == null ? '，双方平手。' : ('，' + SEAT_NAME[winner] + ' 以 ' + Math.abs(b - w) + ' 子之差取胜。'))
    };
    this.msg = this._over.title + '　黑 ' + b + ' : 白 ' + w;
  };

  Reversi.prototype.resign = function (seat) {
    var w = 1 - seat;
    this._over = {
      winner: w, title: SEAT_NAME[w] + '胜',
      text: SEAT_NAME[seat] + ' 认输，' + SEAT_NAME[w] + ' 获胜（当时黑 ' + this.count(1) + ' : 白 ' + this.count(2) + '）。'
    };
  };

  /* ───────── 界面契约 ───────── */
  Reversi.prototype.seat = function () { return this._over ? -1 : this.turn; };
  Reversi.prototype.seatName = function (i) { return SEAT_NAME[i] || ('第' + (i + 1) + '方'); };
  Reversi.prototype.seatFilled = function (i) { return i === 0; };
  Reversi.prototype.seatCaptured = function (i) { return this.count(i + 1) + ' 子'; };

  Reversi.prototype.cellName = function (i) {
    return String.fromCharCode(97 + (i % N)) + (N - ((i / N) | 0));
  };
  Reversi.prototype.status = function () {
    if (this._over) return '<b>' + this._over.title + '</b>　' + this.msg;
    var s = '<b>' + SEAT_NAME[this.turn] + '</b> 行棋（第 ' + (this.ply + 1) + ' 手）';
    return s + '　黑 ' + this.count(1) + ' : 白 ' + this.count(2);
  };
  Reversi.prototype.hint = function () {
    if (this._over) return '';
    var n = this.genMoves(this.turn).length;
    if (!n) return SEAT_NAME[this.turn] + ' 无子可落，将自动弃权。';
    return '点任一空心小圈落子：必须夹住对方棋子，夹住的整串都会翻面。当前有 ' + n + ' 个可落点。';
  };
  Reversi.prototype.log = function () {
    var out = [], k, j, rs;
    for (k = 0; k < this.history.length; k++) {
      rs = this.history[k].rec || [];
      for (j = 0; j < rs.length; j++) {
        var r = rs[j];
        out.push({
          n: (out.length + 1) + '.',
          v: r.k === 'pass' ? (SEAT_NAME[r.s] + ' 弃权')
            : (SEAT_NAME[r.s] + ' ' + this.cellName(r.i) + ' 翻 ' + r.n + ' 子'),
          hi: (k === this.history.length - 1 && j === rs.length - 1)
        });
      }
    }
    return out;
  };
  Reversi.prototype.info = function () {
    var b = this.count(1), w = this.count(2);
    var h = '<div class="kv"><span>手数</span><span>' + this.ply + '</span></div>' +
      '<div class="kv"><span>空位</span><span>' + this.emptyCount() + '</span></div>' +
      '<div class="kv"><span>黑方</span><span>' + b + ' 子</span></div>' +
      '<div class="kv"><span>白方</span><span>' + w + ' 子</span></div>';
    h += '<h5>要点</h5><div style="font-size:11.5px;line-height:1.8">角与边是生命线；' +
      '紧贴角斜对角的「X 格」往往送角，慎入。终局前子数落后未必输，先抢稳定子。</div>';
    return h;
  };

  /* ───────── 交互 ───────── */
  Reversi.prototype.layout = function (w, h) {
    var box = Hub.geom.fit(w, h, 1, 0);
    this.cell = box.w / N;
    this.ox = box.x; this.oy = box.y;
    this.W = w; this.H = h;
  };
  Reversi.prototype.px = function (c) { return this.ox + (c + .5) * this.cell; };
  Reversi.prototype.py = function (r) { return this.oy + (r + .5) * this.cell; };
  Reversi.prototype.pick = function (x, y) {
    if (!this.cell) return null;
    var c = Math.floor((x - this.ox) / this.cell);
    var r = Math.floor((y - this.oy) / this.cell);
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    return { r: r, c: c, i: r * N + c };
  };
  Reversi.prototype.pickHint = function (hit) {
    if (!hit || this._over) return false;
    return !!this.flipsAt(hit.i, this.turn);
  };
  Reversi.prototype.hover = function (hit) { this._hover = hit ? hit.i : -1; };
  Reversi.prototype.click = function (hit) {
    if (this._over) return false;
    if (!hit) return false;
    var f = this.flipsAt(hit.i, this.turn);
    if (!f) {
      if (this.b[hit.i] === 0 && Hub.App) Hub.App.toast('这里夹不住对方棋子');
      return false;
    }
    this.play({ i: hit.i, flips: f });
    return true;
  };

  /* ───────── 绘制 ───────── */
  Reversi.prototype.draw = function (v) {
    if (!this.cell) return;
    var cell = this.cell, i, r, c;

    /* 盘底 */
    v.rect(this.ox, this.oy, cell * N, cell * N, { fill: P.paper2, stroke: P.ink, w: 1.5 });
    for (r = 1; r < N; r++) v.line(this.ox, this.oy + r * cell, this.ox + cell * N, this.oy + r * cell, { color: P.ruleSoft, w: .8 });
    for (c = 1; c < N; c++) v.line(this.ox + c * cell, this.oy, this.ox + c * cell, this.oy + cell * N, { color: P.ruleSoft, w: .8 });
    /* 四星 */
    [[2, 2], [2, 6], [6, 2], [6, 6]].forEach(function (p) {
      v.dot(this.px(p[1]), this.py(p[0]), Math.max(1.4, cell * .05), P.ink3, .8);
    }, this);

    /* 可落点提示 */
    if (this.cfg.showMoves !== false && !this._over) {
      var ms = this.genMoves(this.turn);
      for (i = 0; i < ms.length; i++) {
        v.ring(this.px(ms[i].i % N), this.py((ms[i].i / N) | 0), cell * .13, { w: 1.1, a: .55 });
      }
    }

    /* 悬停 */
    if (this._hover >= 0 && this.b[this._hover] === 0 && !this._over) {
      v.rect(this.ox + (this._hover % N) * cell + 1, this.oy + ((this._hover / N) | 0) * cell + 1,
        cell - 2, cell - 2, { fill: P.ink, fillA: .04 });
    }

    /* 棋子 */
    for (i = 0; i < NC; i++) {
      if (!this.b[i]) continue;
      var filled = this.b[i] === 1;
      v.circle(this.px(i % N), this.py((i / N) | 0), cell * .38, {
        fill: filled ? P.ink : P.paper, stroke: P.ink, w: 1.3
      });
      if (filled && cell > 22) {
        v.circle(this.px(i % N), this.py((i / N) | 0), cell * .29, { stroke: 'rgba(255,255,255,.45)', w: .8 });
      }
    }

    /* 上一手记号 */
    if (this.lastMark >= 0 && this.b[this.lastMark]) {
      var lx = this.px(this.lastMark % N), ly = this.py((this.lastMark / N) | 0);
      v.corners(lx - cell * .46, ly - cell * .46, cell * .92, cell * .92, cell * .2, { w: 1.5 });
    }

    /* 建议 */
    if (this.sugg && this.sugg.i >= 0) {
      v.corners(this.ox + (this.sugg.i % N) * cell + 2, this.oy + ((this.sugg.i / N) | 0) * cell + 2,
        cell - 4, cell - 4, cell * .24, { color: P.warn, w: 2.2 });
    }
  };

  /* ───────── 电脑 ───────── */
  Reversi.prototype._ctx = function () {
    var self = this;
    return {
      moves: function () {
        var ms = self.genMoves(self.turn);
        if (ms.length) return ms;
        if (self.emptyCount() === 0 || !self.genMoves(1 - self.turn).length) return [];
        return [{ i: -1, flips: [] }];                 // 弃权着
      },
      make: function (m) {
        m._undo = { b: self.b.slice(), turn: self.turn };
        if (m.i >= 0) {
          var col = self.turn + 1, k;
          self.b[m.i] = col;
          for (k = 0; k < m.flips.length; k++) self.b[m.flips[k]] = col;
        }
        self.turn = 1 - self.turn;
      },
      unmake: function (m) {
        self.b = m._undo.b; self.turn = m._undo.turn;
      },
      terminal: function () {
        if (self.emptyCount() === 0 ||
          (!self.genMoves(self.turn).length && !self.genMoves(1 - self.turn).length)) {
          var b = self.count(1), w = self.count(2);
          var mine = self.turn === 0 ? b : w, theirs = self.turn === 0 ? w : b;
          if (mine === theirs) return 0;
          return (mine - theirs) * 900;
        }
        return null;
      },
      evaluate: function () {
        var col = self.turn + 1, opp = 2 - self.turn, i;
        var pos = 0, mine = 0, theirs = 0, empty = 0;
        for (i = 0; i < NC; i++) {
          if (self.b[i] === col) { pos += POSW[i]; mine++; }
          else if (self.b[i] === opp) { pos -= POSW[i]; theirs++; }
          else empty++;
        }
        var mob = self.genMoves(self.turn).length - self.genMoves(1 - self.turn).length;
        var v = pos + mob * 9;
        if (empty <= 12) v += (mine - theirs) * 6;     // 残局改数子
        else v -= (mine - theirs) * 2;                 // 中盘少子反而灵活
        return v;
      },
      orderScore: function (m) { return m.i >= 0 ? POSW[m.i] : -999; }
    };
  };

  Reversi.prototype.aiMove = function (level) {
    if (this._over) return false;
    level = level || 2;
    var ms = this.genMoves(this.turn);
    if (!ms.length) { this._begin(); this.advance(); return true; }   // 弃权也算一步
    var opts = level <= 1
      ? { maxDepth: 1, timeMs: 200, margin: 60 }
      : (level === 2 ? { maxDepth: 4, timeMs: 600, margin: 18 }
        : { maxDepth: 7, timeMs: 1400 });
    var r = Hub.search.best(this._ctx(), opts);
    if (!r || r.move.i < 0) { this._begin(); this.advance(); return true; }
    return this.play(r.move);
  };

  Reversi.prototype.suggest = function (level) {
    if (this._over) { Hub.App.toast('对局已结束'); return null; }
    var r = Hub.search.best(this._ctx(), { maxDepth: level == null ? 6 : (level + 3), timeMs: 900 });
    if (!r || r.move.i < 0) { Hub.App.toast('无子可落，只能弃权'); return null; }
    this.sugg = { i: r.move.i };
    Hub.App.toast('建议：' + SEAT_NAME[this.turn] + ' 落 ' + this.cellName(r.move.i) +
      '（翻 ' + r.move.flips.length + ' 子，深度 ' + r.depth + '）');
    return this.sugg;
  };
  Reversi.prototype.clearSuggestion = function () { this.sugg = null; };

  /* ───────── 大厅图标 ───────── */
  function icon(v, w, h) {
    var n = 4, cell = Math.min(w, h) / (n + .8);
    var ox = (w - cell * n) / 2, oy = (h - cell * n) / 2, r, c;
    v.rect(ox, oy, cell * n, cell * n, { stroke: P.ink, w: 1.2 });
    for (r = 1; r < n; r++) v.line(ox, oy + r * cell, ox + cell * n, oy + r * cell, { color: P.ruleSoft, w: .7 });
    for (c = 1; c < n; c++) v.line(ox + c * cell, oy, ox + c * cell, oy + cell * n, { color: P.ruleSoft, w: .7 });
    var pat = [[0, 0, 1], [0, 1, 0], [1, 0, 0], [1, 1, 1]];
    for (r = 0; r < 2; r++) {
      for (c = 0; c < 2; c++) {
        v.circle(ox + (c + 1) * cell - cell / 2, oy + (r + 1) * cell - cell / 2, cell * .34,
          { fill: pat[r * 2 + c][2] ? P.ink : P.paper, stroke: P.ink, w: 1.1 });
      }
    }
    v.ring(ox + cell * .5, oy + cell * 2.5, cell * .16, { w: 1.1, a: .7 });
  }

  Hub.register({
    id: 'reversi',
    name: '黑白棋',
    en: 'REVERSI',
    sub: '夹子翻面，终局数子定胜负',
    tag: '翻棋',
    aspect: 1,
    players: 2,
    seatNames: SEAT_NAME,
    ai: true,
    options: [
      {
        key: 'showMoves', label: '可落点', def: true,
        choices: [{ v: true, label: '显示', note: '空心小圈标出可落点' }, { v: false, label: '隐藏' }]
      }
    ],
    rules: {
      intro: '8×8 盘，开局中央交叉摆两黑两白。<b>黑方先行</b>，轮流落子；每次落子必须夹住对方棋子，被夹住的整串立即翻面。<b>终局子多者胜</b>。',
      sections: [
        {
          title: '落子与翻面', items: [
            '只能落在<b>能夹住对方至少一子</b>的空位：己子与落点之间，横、竖、斜八个方向上有一串连续的对方棋子，且串尾是己子。',
            '落子后，所有被夹方向上的对方棋子<b>全部翻成己色</b>。',
            '盘面上的空心小圈即当前可落点（可在开局设置中隐藏）。'
          ]
        },
        {
          title: '弃权与终局', items: [
            '轮到你却<b>无子可落</b>时自动弃权，交给对方继续。',
            '<b>双方连续弃权</b>或<b>盘满</b>即终局，数子多者胜；子数相同为和局。',
            '中途认输立即判负。'
          ]
        },
        {
          title: '要点', items: [
            '<b>角</b>是不可被翻的稳定子，价值最高。',
            '紧贴角斜对角的「X 格」常常把角送给对方，慎入。',
            '中盘不必贪子数：子少往往意味着对方可落点少（行动力优势）。',
            '残局阶段再转为数子思路。'
          ]
        }
      ]
    },
    icon: icon,
    create: function (cfg) { return new Reversi(cfg); }
  });

  Hub.Reversi = Reversi;
  Hub.RV = { N: N, NC: NC, POSW: POSW, SEAT_NAME: SEAT_NAME };

})(window);
