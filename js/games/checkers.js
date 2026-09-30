/* ════════════════════════════════════════════════════════════
   跳棋 CHINESE CHECKERS（六角星跳棋）
   棋盘：17 行共 121 个交叉位 = 中央六边形 61 + 六个角三角各 10
   行宽：1 2 3 4 | 13 12 11 10 9 10 11 12 13 | 4 3 2 1
   走法：单步走到相邻空位，或跳过任一相邻棋子落到其正后方空位，
         可连续跳跃（一次行动内链式跳多子）
   胜负：最先把自己 10 枚棋子全部送入正对面的角三角者胜
   座位：0..5 依次为 北 / 东北 / 东南 / 南 / 西南 / 西北
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub, P = Hub.PAL;

  /* ───────── 棋盘几何（常量） ───────── */
  var RW = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1];
  var SIDE = [0, 0, 0, 0, 4, 3, 2, 1, 0, 1, 2, 3, 4, 0, 0, 0, 0];
  var NROW = RW.length;                 // 17
  var NC = 0, OFF = [], r0;
  for (r0 = 0; r0 < NROW; r0++) { OFF[r0] = NC; NC += RW[r0]; }

  /* 区域编号：0 北 1 东北 2 东南 3 南 4 西南 5 西北 6 中央 */
  var CENTER = 6;
  var REGION_NAME = ['北', '东北', '东南', '南', '西南', '西北', '中央'];

  /* 六个方向的邻接：0 右 1 左 2 左上 3 右上 4 左下 5 右下 */
  var OPP = [1, 0, 5, 4, 3, 2];

  var REGION = new Int8Array(NC);       // 每格所属区域
  var RC = [];                          // 每格的 [行, 列]
  var NB = [];                          // 每格的 6 个邻居（-1 表示出界）
  var PX = [], PY = [];                 // 归一化坐标（间距为单位 1）

  (function buildBoard() {
    var r, j, i;
    for (r = 0; r < NROW; r++) {
      for (j = 0; j < RW[r]; j++) {
        i = OFF[r] + j;
        RC[i] = [r, j];
        /* 归一化坐标：行内间距 1，行间距 sqrt(3)/2，整体水平居中 */
        PX[i] = j - (RW[r] - 1) / 2;
        PY[i] = r * 0.8660254;
      }
    }
    /* 区域归属 */
    for (i = 0; i < NC; i++) {
      r = RC[i][0]; j = RC[i][1];
      if (r <= 3) REGION[i] = 0;                       // 北角
      else if (r >= 13) REGION[i] = 3;                 // 南角
      else {
        var s = SIDE[r];
        if (j < s) REGION[i] = (r <= 8) ? 5 : 4;       // 西北 / 西南
        else if (j >= RW[r] - s) REGION[i] = (r <= 8) ? 1 : 2;   // 东北 / 东南
        else REGION[i] = CENTER;
      }
    }
    /* 邻接：同一行左右各一；上下行按半格错位取两邻 */
    function at(rr, jj) {
      if (rr < 0 || rr >= NROW || jj < 0 || jj >= RW[rr]) return -1;
      return OFF[rr] + jj;
    }
    for (i = 0; i < NC; i++) {
      r = RC[i][0]; j = RC[i][1];
      var up = (r > 0) ? (RW[r - 1] - RW[r]) : 0;       // 上移行宽差（奇数）
      var dn = (r < NROW - 1) ? (RW[r + 1] - RW[r]) : 0;
      NB[i] = [
        at(r, j + 1),                                   // 0 右
        at(r, j - 1),                                   // 1 左
        at(r - 1, j + (up - 1) / 2),                    // 2 左上
        at(r - 1, j + (up + 1) / 2),                    // 3 右上
        at(r + 1, j + (dn - 1) / 2),                    // 4 左下
        at(r + 1, j + (dn + 1) / 2)                     // 5 右下
      ];
    }
  })();

  /* 各人数配置使用的区域（互为对面的两两配对） */
  var SEAT_REGIONS = {
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    6: [0, 1, 2, 3, 4, 5]
  };
  var PIECES = 10;

  /* 每个区域一格子的清单 */
  var REGION_CELLS = [[], [], [], [], [], [], []];
  (function () {
    for (var i = 0; i < NC; i++) REGION_CELLS[REGION[i]].push(i);
  })();

  /* ─────────────────────────────────────────────── */
  function Checkers(cfg) {
    Hub.Base.call(this, cfg);
    this.players = SEAT_REGIONS[cfg.players] ? cfg.players : 2;
    this.regions = SEAT_REGIONS[this.players].slice();
    this.targetOf = [];
    for (var s = 0; s < this.players; s++) this.targetOf[s] = (this.regions[s] + 3) % 6;
    this.reset();
  }
  Checkers.prototype = Object.create(Hub.Base.prototype);
  Checkers.prototype.constructor = Checkers;

  Checkers.prototype.reset = function () {
    var s, k, cells;
    this.b = new Int8Array(NC);            // 0 空，否则 seat+1
    for (s = 0; s < this.players; s++) {
      cells = REGION_CELLS[this.regions[s]];
      for (k = 0; k < cells.length; k++) this.b[cells[k]] = s + 1;
    }
    this.turn = 0;
    this.ply = 0;
    this.history = [];
    this._over = null;
    this.sel = -1;
    this.selMoves = [];
    this.sugg = null;
    this.lastMark = null;
    this._hover = -1;
    /* 链式跳跃搜索复用的标记数组（用代号区分轮次，避免反复分配）
       必须用 Int32Array：若用 Uint8Array，代号超过 255 后会被截断，
       导致 seen[m] === st 永不成立、去重失效而陷入无限循环 */
    this._seen = new Int32Array(NC);
    this._stamp = 0;
    this._queue = [];
    this.rank = [];                        // 各方已入目标区的子数
    for (s = 0; s < this.players; s++) this.rank[s] = this.countHome(s);
  };

  Checkers.prototype.seatCount = function () { return this.players; };
  Checkers.prototype.owner = function (i) { return this.b[i] ? this.b[i] - 1 : -1; };

  /** 该座位已送入目标区的子数 */
  Checkers.prototype.countHome = function (s) {
    var t = this.targetOf[s], n = 0, cells = REGION_CELLS[t], k;
    for (k = 0; k < cells.length; k++) if (this.b[cells[k]] === s + 1) n++;
    return n;
  };

  /* ───────── 着法生成 ───────── */
  /** 从 i 出发，一次行动内所有可跳到的格子（链式跳） */
  Checkers.prototype.jumpTargets = function (i) {
    var b = this.b, out = [], d, n, m;
    /* 代号即将溢出时清零重置，保证与初始值 0 不相撞 */
    if (this._stamp > 2000000000) { this._seen.fill(0); this._stamp = 0; }
    var st = ++this._stamp, seen = this._seen, queue = this._queue;
    queue.length = 0;
    queue.push(i);
    seen[i] = st;
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      var nb = NB[cur];
      for (d = 0; d < 6; d++) {
        n = nb[d];
        if (n < 0 || b[n] === 0) continue;            // 必须有子可跳
        m = NB[n][d];                                 // 同方向再走一格
        if (m < 0 || seen[m] === st || b[m] !== 0) continue;
        seen[m] = st;
        out.push(m);
        queue.push(m);
      }
    }
    return out;
  };

  /** 该格的全部着法：{f, t, jump}
      必须带上起点 f：click() 会直接把这些对象交给 play()，
      缺 f 会导致 doMove 读到 undefined、把棋子凭空抹除 */
  Checkers.prototype.movesFrom = function (i) {
    var b = this.b, out = [], d, n, jt, k;
    if (!b[i]) return out;
    var nb = NB[i];
    for (d = 0; d < 6; d++) {
      n = nb[d];
      if (n >= 0 && b[n] === 0) out.push({ f: i, t: n, jump: false });
    }
    jt = this.jumpTargets(i);
    for (k = 0; k < jt.length; k++) out.push({ f: i, t: jt[k], jump: true });
    return out;
  };

  Checkers.prototype.genMoves = function (seat) {
    var out = [], i, ms, k;
    for (i = 0; i < NC; i++) {
      if (this.b[i] !== seat + 1) continue;
      ms = this.movesFrom(i);
      for (k = 0; k < ms.length; k++) out.push(ms[k]);
    }
    return out;
  };

  /* ───────── 执行 / 撤销 ───────── */
  Checkers.prototype.doMove = function (m) {
    this.b[m.t] = this.b[m.f];
    this.b[m.f] = 0;
    this.turn = (this.turn + 1) % this.players;
  };
  Checkers.prototype.unMove = function (m) {
    this.turn = (this.turn - 1 + this.players) % this.players;
    this.b[m.f] = this.b[m.t];
    this.b[m.t] = 0;
  };

  Checkers.prototype.play = function (m) {
    var seat = this.turn;
    this.doMove(m);
    this.ply++;
    this.history.push({ f: m.f, t: m.t, seat: seat, jump: !!m.jump });
    this.lastMark = { f: m.f, t: m.t };
    this.sel = -1; this.selMoves = []; this.sugg = null;
    this.rank[seat] = this.countHome(seat);
    this.judge();
    return true;
  };

  Checkers.prototype.judge = function () {
    var s;
    for (s = 0; s < this.players; s++) {
      if (this.countHome(s) >= PIECES) {
        this._over = {
          winner: s,
          title: this.seatName(s) + '胜',
          text: this.seatName(s) + '的 ' + PIECES + ' 枚棋子已全部抵达' +
                REGION_NAME[this.targetOf[s]] + '角，第 ' + this.ply + ' 手结束。'
        };
        return;
      }
    }
    if (this.ply >= 600) {
      this._over = { winner: null, title: '和局', text: '已达 600 手上限，判和。' };
      return;
    }
    /* 当前行棋方无着可走则跳过（极罕见）；记入历史以便悔棋时一并退回 */
    if (!this.genMoves(this.turn).length) {
      this.history.push({ f: -1, t: -1, seat: this.turn, jump: false, skip: true });
      this.turn = (this.turn + 1) % this.players;
    }
  };

  Checkers.prototype.undo = function () {
    if (!this.history.length) return false;
    var h = this.history.pop();
    if (h.skip) {
      this.turn = (this.turn - 1 + this.players) % this.players;
    } else {
      this.unMove({ f: h.f, t: h.t });
      this.ply--;
    }
    this._over = null;
    this.sel = -1; this.selMoves = []; this.sugg = null;
    /* 回退到最近一个真实着法作为轨迹标记 */
    this.lastMark = null;
    for (var k = this.history.length - 1; k >= 0; k--) {
      if (!this.history[k].skip) {
        this.lastMark = { f: this.history[k].f, t: this.history[k].t };
        break;
      }
    }
    for (var s = 0; s < this.players; s++) this.rank[s] = this.countHome(s);
    return true;
  };

  Checkers.prototype.canUndo = function () { return this.history.length > 0 && !this.thinking; };

  Checkers.prototype.resign = function (seat) {
    /* 多人局：认输者棋子离场，其余按已入目标区子数比较 */
    var i, s, best = -1, bestN = -1;
    for (i = 0; i < NC; i++) if (this.b[i] === seat + 1) this.b[i] = 0;
    for (s = 0; s < this.players; s++) {
      if (s === seat) continue;
      var n = this.countHome(s);
      if (n > bestN) { bestN = n; best = s; }
    }
    this._over = {
      winner: best,
      title: this.seatName(best) + '胜',
      text: this.seatName(seat) + ' 认输；其余各方比较已抵达目标区的子数，' +
            this.seatName(best) + '（' + bestN + ' / ' + PIECES + '）领先。'
    };
  };

  /* ───────── 记谱 ───────── */
  Checkers.prototype.cellName = function (i) {
    var rc = RC[i];
    if (!rc) return '?';
    return String.fromCharCode(97 + rc[1]) + (NROW - rc[0]);
  };
  Checkers.prototype.moveText = function (h) {
    if (h.skip) return REGION_NAME[this.regions[h.seat]] + ' 无着可走，跳过';
    return REGION_NAME[this.regions[h.seat]] + ' ' +
      this.cellName(h.f) + (h.jump ? '⇢' : '→') + this.cellName(h.t);
  };

  /* ───────── 界面契约 ───────── */
  Checkers.prototype.seat = function () { return this._over ? -1 : this.turn; };
  Checkers.prototype.seatName = function (i) {
    return REGION_NAME[this.regions[i]] + '方';
  };
  Checkers.prototype.seatFilled = function (i) { return i % 2 === 0; };
  Checkers.prototype.seatCaptured = function (i) {
    return this.countHome(i) + ' / ' + PIECES + ' 抵达';
  };

  Checkers.prototype.status = function () {
    if (this._over) return '<b>' + this._over.title + '</b>';
    return '<b>' + this.seatName(this.turn) + '</b> 行棋（第 ' + (this.ply + 1) + ' 手）';
  };
  Checkers.prototype.hint = function () {
    if (this._over) return '';
    if (this.sel >= 0) {
      if (!this.selMoves.length) {
        return '这枚棋子当前无路可走（四周均被占且无法跳跃），请另选一枚。';
      }
      return '小圆点为单步可走位，圆圈为可跳跃落点；跳跃可连环，一次走完。';
    }
    return '点选己方棋子。可走到相邻空位，或跳过任意相邻棋子落到其正后方空位，并可连续跳跃。目标是把 10 枚子全部送进正对面的角。';
  };

  Checkers.prototype.log = function () {
    var out = [], k;
    for (k = 0; k < this.history.length; k++) {
      out.push({
        n: (k + 1) + '.',
        v: this.moveText(this.history[k]),
        hi: k === this.history.length - 1
      });
    }
    return out;
  };

  Checkers.prototype.info = function () {
    var h = '<div class="kv"><span>人数</span><span>' + this.players + ' 人</span></div>' +
      '<div class="kv"><span>每方棋子</span><span>' + PIECES + '</span></div>' +
      '<div class="kv"><span>手数</span><span>' + this.ply + '</span></div>';
    h += '<h5>各方进度（已入目标角）</h5>';
    for (var s = 0; s < this.players; s++) {
      var n = this.countHome(s);
      h += '<div class="kv"><span>' + this.seatName(s) + ' → ' + REGION_NAME[this.targetOf[s]] + '</span>' +
        '<span>' + n + ' / ' + PIECES + '</span></div>';
    }
    return h;
  };

  /* ───────── 交互 ───────── */
  Checkers.prototype.layout = function (w, h) {
    /* 归一化包围盒：x ∈ [-6,6]（宽 12），y ∈ [0,13.856] */
    var spanX = 12, spanY = (NROW - 1) * 0.8660254;
    var pad = 0.95;
    this.s = Math.min(w / (spanX + pad * 2), h / (spanY + pad * 2));
    this.ox = w / 2;
    this.oy = (h - spanY * this.s) / 2;
    this.W = w; this.H = h;
    this.R = this.s * .40;
  };
  Checkers.prototype.px = function (i) { return this.ox + PX[i] * this.s; };
  Checkers.prototype.py = function (i) { return this.oy + PY[i] * this.s; };

  Checkers.prototype.pick = function (x, y) {
    if (!this.s) return null;
    /* bd 全程以「平方距离」比较，初值为允许半径的平方 */
    var lim = this.s * .52;
    var best = -1, bd = lim * lim, i, dx, dy, d;
    for (i = 0; i < NC; i++) {
      dx = x - this.px(i); dy = y - this.py(i);
      d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    return { r: RC[best][0], c: RC[best][1], i: best };
  };

  Checkers.prototype.pickHint = function (hit) {
    if (!hit || this._over) return false;
    if (this.b[hit.i] === this.turn + 1) return true;
    return this._hasTarget(hit.i);
  };
  Checkers.prototype._hasTarget = function (i) {
    for (var k = 0; k < this.selMoves.length; k++) if (this.selMoves[k].t === i) return true;
    return false;
  };
  Checkers.prototype._moveTo = function (i) {
    for (var k = 0; k < this.selMoves.length; k++) if (this.selMoves[k].t === i) return this.selMoves[k];
    return null;
  };

  Checkers.prototype.hover = function (hit) { this._hover = hit ? hit.i : -1; };

  Checkers.prototype.click = function (hit) {
    if (this._over) return false;
    if (!hit) { this.sel = -1; this.selMoves = []; return false; }
    var i = hit.i;

    var mv = this.sel >= 0 ? this._moveTo(i) : null;
    if (mv) { this.play(mv); return true; }

    if (this.b[i] === this.turn + 1) {
      if (this.sel === i) { this.sel = -1; this.selMoves = []; }
      else { this.sel = i; this.selMoves = this.movesFrom(i); this.sugg = null; }
      return false;
    }
    this.sel = -1; this.selMoves = [];
    return false;
  };

  /* ───────── 绘制 ───────── */
  Checkers.prototype.draw = function (v) {
    var i, s, k;

    /* 目标角：淡底 + 虚线圈 + 座号 */
    for (s = 0; s < this.players; s++) {
      var cells = REGION_CELLS[this.targetOf[s]];
      var cx = 0, cy = 0, rad = 0;
      for (k = 0; k < cells.length; k++) { cx += this.px(cells[k]); cy += this.py(cells[k]); }
      cx /= cells.length; cy /= cells.length;
      for (k = 0; k < cells.length; k++) {
        var dx = this.px(cells[k]) - cx, dy = this.py(cells[k]) - cy;
        if (dx * dx + dy * dy > rad) rad = dx * dx + dy * dy;
      }
      rad = Math.sqrt(rad) + this.s * .62;
      v.circle(cx, cy, rad, { fill: P.ink, fillA: .035 });
      v.circle(cx, cy, rad, { stroke: P.ink3, w: 1, dash: [4, 4], a: .75 });
      /* 座号标签：夹进画布内，避免北/南角被裁掉 */
      var ly = cy - rad - this.s * .30;
      ly = Hub.util.clamp(ly, this.s * .34, this.H - this.s * .34);
      v.text(String(s + 1), cx, ly, {
        size: Math.max(8, this.s * .30), color: P.ink3, family: 'monospace'
      });
      /* 进度弧：已入子数占满圈的比例，不遮挡任何棋子 */
      var done = this.countHome(s);
      if (done > 0) {
        v.arc(cx, cy, rad + this.s * .12, -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * done / PIECES, { color: P.ink, w: 2.2, a: .85 });
      }
      if (done >= PIECES) {
        v.text('✓', cx, cy, { size: Math.max(10, this.s * .6), color: P.ink, weight: 700 });
      }
    }

    /* 空位小点 */
    for (i = 0; i < NC; i++) {
      if (this.b[i]) continue;
      v.dot(this.px(i), this.py(i), Math.max(1.1, this.s * .085), P.ink4, .95);
    }

    /* 上一手轨迹 */
    if (this.lastMark && this.lastMark.f >= 0) {
      v.arrow(this.px(this.lastMark.f), this.py(this.lastMark.f),
        this.px(this.lastMark.t), this.py(this.lastMark.t),
        { color: P.ink, w: 1.1, a: .28, dash: [4, 4], head: Math.max(5, this.s * .17) });
    }

    /* 合法落点 */
    if (this.cfg.showMoves !== false) {
      for (k = 0; k < this.selMoves.length; k++) {
        var m = this.selMoves[k];
        if (m.jump) {
          v.circle(this.px(m.t), this.py(m.t), this.s * .30, { stroke: P.ink, w: 1.3, a: .7 });
        } else {
          v.dot(this.px(m.t), this.py(m.t), Math.max(2, this.s * .13), P.ink, .5);
        }
      }
    }

    /* 棋子 */
    for (i = 0; i < NC; i++) {
      var o = this.owner(i);
      if (o < 0) continue;
      this._drawPiece(v, this.px(i), this.py(i), o);
    }

    /* 选中 / 悬停 */
    if (this.sel >= 0) {
      v.circle(this.px(this.sel), this.py(this.sel), this.R * 1.22, { stroke: P.ink, w: 1.8 });
    } else if (this._hover >= 0 && this.b[this._hover] === this.turn + 1 && !this._over) {
      v.circle(this.px(this._hover), this.py(this._hover), this.R * 1.2, { stroke: P.ink3, w: 1, a: .7 });
    }

    /* 提示 */
    if (this.sugg) {
      v.arrow(this.px(this.sugg.f), this.py(this.sugg.f), this.px(this.sugg.t), this.py(this.sugg.t),
        { color: P.warn, w: 2, head: Math.max(7, this.s * .22) });
    }
  };

  /** 六种纯黑白可辨识的棋子样式；三人以上加座号 */
  Checkers.prototype._drawPiece = function (v, x, y, seat) {
    var R = this.R, style = seat % 6, num = this.players >= 3;
    var filled = (style === 0 || style === 4);
    v.circle(x, y, R, {
      fill: style === 2 ? P.ink3 : (filled ? P.ink : P.paper),
      stroke: P.ink, w: 1.25
    });
    if (style === 3) v.dot(x, y, R * .32, P.ink);
    if (style === 4) v.dot(x, y, R * .32, '#fff');
    if (style === 5) v.circle(x, y, R * .58, { stroke: P.ink, w: 1.1 });
    if (num) {
      v.text(String(seat + 1), x, y, {
        size: R * .92, family: 'monospace', weight: 600,
        color: filled ? '#fff' : P.ink
      });
    }
  };

  /* ───────── 大厅图标 ───────── */
  function icon(v, w, h) {
    /* 缩小版六角星：只画外轮廓与几枚棋子 */
    var s = Math.min(w, h) / 16.4;
    var ox = w / 2, oy = (h - 16 * 0.8660254 * s) / 2;
    function X(i) { return ox + PX[i] * s; }
    function Y(i) { return oy + PY[i] * s; }
    var i;
    /* 六个角三角的轮廓提示 */
    [0, 1, 2, 3, 4, 5].forEach(function (rg) {
      var cs = REGION_CELLS[rg], cx = 0, cy = 0, k;
      for (k = 0; k < cs.length; k++) { cx += X(cs[k]); cy += Y(cs[k]); }
      cx /= cs.length; cy /= cs.length;
      v.circle(cx, cy, s * 1.5, { stroke: P.ruleFaint, w: .8, dash: [2, 2] });
    });
    for (i = 0; i < NC; i++) {
      if (REGION[i] === CENTER) v.dot(X(i), Y(i), Math.max(.8, s * .07), P.ink4, .9);
    }
    var home = REGION_CELLS[3], tgt = REGION_CELLS[0], k2;
    for (k2 = 0; k2 < home.length; k2++) {
      v.circle(X(home[k2]), Y(home[k2]), s * .38, { fill: P.ink, stroke: P.ink, w: 1 });
    }
    for (k2 = 0; k2 < 3; k2++) {
      v.circle(X(tgt[tgt.length - 1 - k2]), Y(tgt[tgt.length - 1 - k2]), s * .38, { fill: P.paper, stroke: P.ink, w: 1.1 });
    }
    v.circle(X(tgt[0]), Y(tgt[0]), s * .38, { fill: P.paper, stroke: P.ink, w: 1.1 });
  }

  /* ───────── 注册 ───────── */
  Hub.register({
    id: 'checkers',
    name: '跳棋',
    en: 'CHINESE CHECKERS',
    sub: '六角星盘，连环跳跃，抢占对角',
    tag: '跳棋',
    aspect: (12 + 1.9) / ((NROW - 1) * 0.8660254 + 1.9),
    players: 6,
    minP: 2,
    maxP: 6,
    seatNames: ['北方', '东北方', '东南方', '南方', '西南方', '西北方'],
    /* 座位名与人数相关（2 人局是北 vs 南，而非北 vs 东北），
       开局设置弹层需按实际人数取名 */
    seatNamesFor: function (n) {
      var regs = SEAT_REGIONS[n] || SEAT_REGIONS[2];
      return regs.map(function (rg) { return REGION_NAME[rg] + '方'; });
    },
    ai: true,
    options: [
      {
        key: 'players', label: '人数', def: 2,
        choices: [
          { v: 2, label: '2 人', note: '南北对阵' },
          { v: 3, label: '3 人', note: '三角对垒' },
          { v: 4, label: '4 人', note: '两组对面' },
          { v: 6, label: '6 人', note: '满盘' }
        ],
        note: '各方 10 枚棋子，目标是正对面的角。空出的角不参与本局。'
      },
      {
        key: 'showMoves', label: '落点提示', def: true,
        choices: [{ v: true, label: '显示' }, { v: false, label: '隐藏' }]
      }
    ],
    rules: {
      intro: '每人 10 枚棋子，开局各据一个角三角。轮流行动，每次移动一枚棋子。目标是<b>最先把全部 10 枚棋子送进正对面的角三角</b>。棋盘为六角星形，共 121 个交叉位。',
      sections: [
        {
          title: '走法', items: [
            '<b>单步</b>：走到相邻的六个方向上的任一<b>空位</b>。',
            '<b>跳跃</b>：若相邻位置有任意一方的棋子（不限敌我），且其<b>正后方同方向</b>的位置为空，即可跳过它落到那里。',
            '<b>连环跳</b>：落地后若还能继续跳，可在<b>同一次行动内</b>一直跳下去，中途不得插入单步。',
            '棋子只前进不后退的规则并不存在——<b>可以往回走</b>，有时为了让路或搭桥是必要的。'
          ]
        },
        {
          title: '胜负', items: [
            '<b>胜</b>：己方 10 枚棋子全部进入正对面的角三角。',
            '多人局中第一个完成者即获胜，其余各方以已抵达的子数比较进度。',
            '达到 600 手上限判和（正常对局远不会触及）。',
            '某方无子可动时自动跳过其回合（实战中几乎不会发生）。'
          ]
        },
        {
          title: '盘面记号', items: [
            '六个角的<b>虚线圈</b>标出各方的<b>目标角</b>，圈上方数字为对应座位号。',
            '小黑点为可落子的空位；选中棋子后，<b>实心小点</b>为单步落点，<b>圆圈</b>为跳跃落点。',
            '虚线箭头为上一手的移动轨迹。',
            '棋子样式按座位区分：实心、空心、灰底、带中心点、带白心点、带内环；<b>三人以上会在棋子内标注座位号</b>。'
          ]
        },
        {
          title: '人数与座位', items: [
            '<b>2 人</b>：北 vs 南。<b>3 人</b>：北、东南、西南（三方互不正对，均需绕行）。',
            '<b>4 人</b>：北+南、东北+西南两组对面，空出东南与西北两角。',
            '<b>6 人</b>：六角全满。',
            '空出的角上的格子仍可自由通行与借跳，只是无人以其为目标。'
          ]
        },
        {
          title: '小建议', items: [
            '把棋子排成<b>彼此可互跳的链</b>，一次行动能跨越半个棋盘，远快于逐格挪动。',
            '不要只顾自己搭桥——对手的链子也会借你的子起跳。',
            '残局阶段注意<b>不要堵住自己目标角的入口</b>，先让深处的位置空着。'
          ]
        }
      ]
    },
    icon: icon,
    create: function (cfg) { return new Checkers(cfg); }
  });

  Hub.Checkers = Checkers;
  Hub.CK = {
    NC: NC, NROW: NROW, RW: RW, SIDE: SIDE, OFF: OFF,
    REGION: REGION, REGION_CELLS: REGION_CELLS, REGION_NAME: REGION_NAME,
    CENTER: CENTER, NB: NB, OPP: OPP, PX: PX, PY: PY, RC: RC,
    PIECES: PIECES, SEAT_REGIONS: SEAT_REGIONS
  };

})(window);
