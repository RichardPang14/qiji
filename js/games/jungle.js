/* ════════════════════════════════════════════════════════════
   斗兽棋 JUNGLE / DOU SHOU QI
   棋盘 7 列 × 9 行；两条 2×3 小河；双方各一兽穴三陷阱
   等级：象8 > 狮7 > 虎6 > 豹5 > 狼4 > 狗3 > 猫2 > 鼠1，唯鼠可吃象
   座位：0 = 红方（下方，先行）  1 = 蓝方（上方）
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub, P = Hub.PAL, U = Hub.util;

  var ROWS = 9, COLS = 7, N = ROWS * COLS;

  /* 动物类型 */
  var RAT = 1, CAT = 2, DOG = 3, WOLF = 4, LEOPARD = 5, TIGER = 6, LION = 7, ELEPHANT = 8;
  var ANIMAL = { 1: '鼠', 2: '猫', 3: '狗', 4: '狼', 5: '豹', 6: '虎', 7: '狮', 8: '象' };

  /* 初始布局：以蓝方（上）为例，红方为其 180° 旋转 (r,c) → (8-r, 6-c)
     象与鼠守左右桥头，狮虎踞底线两角 */
  var INIT_BLUE = [
    [0, 0, LION], [0, 6, TIGER],
    [1, 1, DOG], [1, 5, CAT],
    [2, 0, RAT], [2, 2, LEOPARD], [2, 4, WOLF], [2, 6, ELEPHANT]
  ];

  var ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var FILE = 'abcdefg';

  /* 地形常量表（全局不变，各局共用）
     DEN / TRAP 存的是该格归属的座位号，非特殊格为 -1 */
  var NC = N;
  var WATER = new Uint8Array(NC);
  var DEN = new Int8Array(NC);
  var TRAP = new Int8Array(NC);
  (function () {
    var i, r, c;
    for (i = 0; i < NC; i++) { DEN[i] = -1; TRAP[i] = -1; }
    /* 两条小河：列 1-2 与列 4-5，行 3-5 */
    for (r = 3; r <= 5; r++) {
      for (c = 1; c <= 2; c++) WATER[r * COLS + c] = 1;
      for (c = 4; c <= 5; c++) WATER[r * COLS + c] = 1;
    }
    /* 兽穴：底线中点 */
    DEN[0 * COLS + 3] = 1;                 // 蓝方（上）
    DEN[8 * COLS + 3] = 0;                 // 红方（下）
    /* 陷阱：兽穴两侧 + 正前方 */
    TRAP[0 * COLS + 2] = 1; TRAP[0 * COLS + 4] = 1; TRAP[1 * COLS + 3] = 1;
    TRAP[8 * COLS + 2] = 0; TRAP[8 * COLS + 4] = 0; TRAP[7 * COLS + 3] = 0;
  })();

  /* ─────────────────────────────────────────────── */
  function Jungle(cfg) {
    Hub.Base.call(this, cfg);
    /* 狼狗序：standard = 狼>狗（中式常见）；swap = 狗>狼（部分版本） */
    this.rank = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    if (cfg.order === 'swap') { this.rank[DOG] = 4; this.rank[WOLF] = 3; }
    this._buildTerrain();
    this.reset();
  }
  Jungle.prototype = Object.create(Hub.Base.prototype);
  Jungle.prototype.constructor = Jungle;

  Jungle.prototype._buildTerrain = function () {
    this.WATER = WATER;
    var r, c;
    /* 邻接表 */
    this.nb = new Array(N);
    for (var i = 0; i < N; i++) {
      r = (i / COLS) | 0; c = i % COLS;
      var a = [];
      for (var k = 0; k < 4; k++) {
        var rr = r + ORTH[k][0], cc = c + ORTH[k][1];
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        a.push(rr * COLS + cc);
      }
      this.nb[i] = a;
    }
  };

  Jungle.prototype.reset = function () {
    this.b = new Int8Array(N);
    var i;
    for (i = 0; i < INIT_BLUE.length; i++) {
      var e = INIT_BLUE[i];
      this.b[e[0] * COLS + e[1]] = -e[2];                              // 蓝方为负
      this.b[(8 - e[0]) * COLS + (6 - e[1])] = e[2];                    // 红方 180° 旋转
    }
    this.turn = 0;                 // 红方先行
    this.history = [];
    this.keys = {};
    this.noCap = 0;
    this._over = null;
    this.sel = -1;
    this.selMoves = [];
    this.sugg = null;
    this.lastMark = null;
    this._hover = -1;
    this.pushKey();
  };

  /* ───────── 基础 ───────── */
  Jungle.prototype.side = function (p) { return p > 0 ? 0 : 1; };
  Jungle.prototype.typeOf = function (p) { return p < 0 ? -p : p; };
  Jungle.prototype.rc = function (i) { return [(i / COLS) | 0, i % COLS]; };

  /* 站在对方陷阱里的子战力归零 */
  Jungle.prototype.effRank = function (i) {
    var p = this.b[i];
    if (!p) return 0;
    var ts = this.trapSide(i);
    if (ts >= 0 && ts !== this.side(p)) return 0;
    return this.rank[this.typeOf(p)];
  };

  /* 陷阱归属：上方三个属蓝方（座位 1），下方三个属红方（座位 0），非陷阱返回 -1 */
  Jungle.prototype.trapSide = function (i) { return TRAP[i]; };
  Jungle.prototype.denSide = function (i) { return DEN[i]; };
  Jungle.prototype.isWater = function (i) { return WATER[i] === 1; };

  /* ───────── 吃子判定 ───────── */
  Jungle.prototype.canCapture = function (fi, ti) {
    var a = this.b[fi], d = this.b[ti];
    if (!a || !d) return false;
    if (this.side(a) === this.side(d)) return false;
    /* 水陆不能互吃；两鼠在水中可互吃 */
    if (this.WATER[fi] !== this.WATER[ti]) return false;

    var at = this.typeOf(a), dt = this.typeOf(d);
    /* 敌子落入我方陷阱：任意子皆可吃 */
    var ts = this.trapSide(ti);
    if (ts >= 0 && ts === this.side(a)) return true;
    /* 鼠吃象 / 象不能吃鼠 */
    if (at === RAT && dt === ELEPHANT) return true;
    if (at === ELEPHANT && dt === RAT) return false;
    /* 其余按有效等级比大小（处于对方陷阱者战力为 0） */
    return this.effRank(fi) >= this.effRank(ti);
  };

  /* ───────── 着法生成 ───────── */
  Jungle.prototype.genMoves = function (side, from) {
    var out = [], b = this.b, i, k, t, nr, nc, r, c;
    for (i = 0; i < N; i++) {
      var p = b[i];
      if (!p || this.side(p) !== side) continue;
      if (from != null && i !== from) continue;
      var ty = this.typeOf(p);
      r = (i / COLS) | 0; c = i % COLS;

      /* 普通一步 */
      for (k = 0; k < 4; k++) {
        nr = r + ORTH[k][0]; nc = c + ORTH[k][1];
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
        t = nr * COLS + nc;
        if (this.denSide(t) === side) continue;             // 不能进自己兽穴
        if (this.WATER[t] && ty !== RAT) continue;           // 只有鼠能下水
        if (b[t]) { if (this.canCapture(i, t)) out.push({ f: i, t: t }); }
        else out.push({ f: i, t: t });
      }

      /* 狮虎跳河：紧邻水域时直线跃过，河中有鼠则受阻 */
      if (ty === LION || ty === TIGER) {
        for (k = 0; k < 4; k++) {
          nr = r + ORTH[k][0]; nc = c + ORTH[k][1];
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          if (!this.WATER[nr * COLS + nc]) continue;
          var blocked = false;
          while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && this.WATER[nr * COLS + nc]) {
            if (b[nr * COLS + nc] !== 0) { blocked = true; break; }
            nr += ORTH[k][0]; nc += ORTH[k][1];
          }
          if (blocked || nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          t = nr * COLS + nc;
          if (this.denSide(t) === side) continue;
          if (b[t]) { if (this.canCapture(i, t)) out.push({ f: i, t: t }); }
          else out.push({ f: i, t: t });
        }
      }
    }
    return out;
  };

  /* ───────── 执行 / 撤销 ───────── */
  Jungle.prototype.doMove = function (m) {
    var cap = this.b[m.t];
    this.b[m.t] = this.b[m.f];
    this.b[m.f] = 0;
    this.turn = 1 - this.turn;
    return cap;
  };
  Jungle.prototype.unMove = function (m, cap) {
    this.turn = 1 - this.turn;
    this.b[m.f] = this.b[m.t];
    this.b[m.t] = cap;
  };

  Jungle.prototype.posKey = function () {
    var s = '', i;
    for (i = 0; i < N; i++) s += (this.b[i] + 9).toString(36);
    return s + '|' + this.turn;
  };
  Jungle.prototype.pushKey = function () {
    var k = this.posKey();
    this.keys[k] = (this.keys[k] || 0) + 1;
    return this.keys[k];
  };
  Jungle.prototype.popKey = function () {
    var k = this.posKey();
    if (this.keys[k] != null) this.keys[k]--;
  };

  Jungle.prototype.play = function (m) {
    var text = this.moveText(m);
    var cap = this.doMove(m);
    if (cap) this.noCap = 0; else this.noCap++;
    this.history.push({ f: m.f, t: m.t, cap: cap, text: text });
    this.lastMark = { f: m.f, t: m.t };
    this.sel = -1; this.selMoves = []; this.sugg = null;
    var rep = this.pushKey();
    this.judge(m, rep);
    return true;
  };

  Jungle.prototype.judge = function (m, rep) {
    var mover = 1 - this.turn;

    /* 攻入对方兽穴即胜 */
    if (this.denSide(m.t) >= 0 && this.denSide(m.t) !== mover) {
      this._over = {
        winner: mover, title: this.seatName(mover) + '胜',
        text: this.seatName(mover) + '的' + ANIMAL[this.typeOf(this.b[m.t])] + '攻入对方兽穴。'
      };
      return;
    }
    /* 对方无子 */
    if (!this.hasPieces(this.turn)) {
      this._over = { winner: mover, title: this.seatName(mover) + '胜', text: this.seatName(this.turn) + '的兽已被吃光。' };
      return;
    }
    /* 对方无着可走 */
    if (!this.genMoves(this.turn).length) {
      this._over = { winner: mover, title: this.seatName(mover) + '胜', text: this.seatName(this.turn) + '无兽可动，被困毙。' };
      return;
    }
    if (rep >= 3) {
      this._over = { winner: null, title: '和局', text: '同一局面第三次出现，判和。' };
      return;
    }
    if (this.noCap >= 200) {
      this._over = { winner: null, title: '和局', text: '连续 100 回合无吃子，判和。' };
    }
  };

  Jungle.prototype.hasPieces = function (side) {
    for (var i = 0; i < N; i++) if (this.b[i] && this.side(this.b[i]) === side) return true;
    return false;
  };

  Jungle.prototype.undo = function () {
    if (!this.history.length) return false;
    var s = this.history.pop();
    this.popKey();
    this.unMove({ f: s.f, t: s.t }, s.cap);
    this.noCap = 0;
    for (var i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].cap) break;
      this.noCap++;
    }
    this._over = null;
    this.sel = -1; this.selMoves = []; this.sugg = null;
    this.lastMark = this.history.length
      ? { f: this.history[this.history.length - 1].f, t: this.history[this.history.length - 1].t } : null;
    return true;
  };

  Jungle.prototype.canUndo = function () { return this.history.length > 0 && !this.thinking; };

  Jungle.prototype.resign = function (seat) {
    this._over = { winner: 1 - seat, title: this.seatName(1 - seat) + '胜', text: this.seatName(seat) + ' 认输。' };
  };

  /* ───────── 记谱 ───────── */
  Jungle.prototype.coord = function (i) {
    var r = (i / COLS) | 0, c = i % COLS;
    return FILE[c] + (ROWS - r);
  };
  Jungle.prototype.moveText = function (m) {
    var p = this.b[m.f];
    if (!p) return '—';
    return ANIMAL[this.typeOf(p)] + ' ' + this.coord(m.f) + (this.b[m.t] ? '×' : '-') + this.coord(m.t);
  };

  /* ───────── 界面契约 ───────── */
  Jungle.prototype.seat = function () { return this._over ? -1 : this.turn; };
  Jungle.prototype.seatName = function (i) { return i === 0 ? '红方' : '蓝方'; };

  Jungle.prototype.seatCaptured = function (i) {
    var list = [], k;
    for (k = 0; k < this.history.length; k++) {
      var cap = this.history[k].cap;
      if (cap && this.side(cap) !== i) list.push(ANIMAL[this.typeOf(cap)]);
    }
    return list.length ? '吃 ' + list.join('') : '';
  };

  Jungle.prototype.status = function () {
    if (this._over) return '<b>' + this._over.title + '</b>';
    return '<b>' + this.seatName(this.turn) + '</b> 走棋';
  };
  Jungle.prototype.hint = function () {
    if (this._over) return '';
    if (this.sel >= 0) return '已选「' + ANIMAL[this.typeOf(this.b[this.sel])] + '」，点击标记处移动；红框为可吃的敌兽。';
    return '点选己方动物。象＞狮＞虎＞豹＞狼＞狗＞猫＞鼠，唯鼠能吃象；狮虎可跳河，鼠可下水。';
  };

  Jungle.prototype.log = function () {
    var out = [], k;
    for (k = 0; k < this.history.length; k++) {
      out.push({
        n: (k + 1) + '.',
        v: (k % 2 === 0 ? '红 ' : '蓝 ') + this.history[k].text,
        hi: k === this.history.length - 1
      });
    }
    return out;
  };

  Jungle.prototype.info = function () {
    var cnt = [0, 0], i, p;
    for (i = 0; i < N; i++) { p = this.b[i]; if (p) cnt[this.side(p)]++; }
    var h = '<div class="kv"><span>回合</span><span>' + (Math.floor(this.history.length / 2) + 1) + '</span></div>' +
      '<div class="kv"><span>红 / 蓝 存兽</span><span>' + cnt[0] + ' / ' + cnt[1] + '</span></div>' +
      '<div class="kv"><span>无吃子着数</span><span>' + this.noCap + '</span></div>' +
      '<h5>等级（大者吃小者）</h5><div style="letter-spacing:.1em">' + this._rankLine() + '</div>';
    return h;
  };
  Jungle.prototype._rankLine = function () {
    var self = this, arr = [];
    for (var t = 1; t <= 8; t++) arr.push({ t: t, r: this.rank[t] });
    arr.sort(function (a, b) { return b.r - a.r; });
    return arr.map(function (e) { return ANIMAL[e.t]; }).join('＞') + '（鼠可吃象）';
  };

  /* ───────── 交互 ───────── */
  Jungle.prototype.layout = function (w, h) {
    var cw = w / (COLS + .8), ch = h / (ROWS + .8);
    this.cell = Math.min(cw, ch);
    this.ox = (w - this.cell * COLS) / 2;
    this.oy = (h - this.cell * ROWS) / 2;
    this.W = w; this.H = h;
  };
  Jungle.prototype.px = function (c) { return this.ox + c * this.cell; };
  Jungle.prototype.py = function (r) { return this.oy + r * this.cell; };

  Jungle.prototype.pick = function (x, y) {
    if (!this.cell) return null;
    var c = Math.floor((x - this.ox) / this.cell);
    var r = Math.floor((y - this.oy) / this.cell);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return { r: r, c: c, i: r * COLS + c };
  };
  Jungle.prototype.pickHint = function (hit) {
    if (!hit || this._over) return false;
    var p = this.b[hit.i];
    if (p && this.side(p) === this.turn) return true;
    return this._hasTarget(hit.i);
  };
  Jungle.prototype._hasTarget = function (i) {
    for (var k = 0; k < this.selMoves.length; k++) if (this.selMoves[k].t === i) return true;
    return false;
  };
  Jungle.prototype._moveTo = function (i) {
    for (var k = 0; k < this.selMoves.length; k++) if (this.selMoves[k].t === i) return this.selMoves[k];
    return null;
  };

  Jungle.prototype.hover = function (hit) { this._hover = hit ? hit.i : -1; };

  Jungle.prototype.click = function (hit) {
    if (this._over) return false;
    if (!hit) { this.sel = -1; this.selMoves = []; return false; }
    var i = hit.i, p = this.b[i];

    var mv = this.sel >= 0 ? this._moveTo(i) : null;
    if (mv) { this.play(mv); return true; }

    if (p && this.side(p) === this.turn) {
      if (this.sel === i) { this.sel = -1; this.selMoves = []; }
      else { this.sel = i; this.selMoves = this.genMoves(this.turn, i); this.sugg = null; }
      return false;
    }
    this.sel = -1; this.selMoves = [];
    return false;
  };

  /* ───────── 绘制 ───────── */
  Jungle.prototype.draw = function (v) {
    var cell = this.cell, r, c, i;
    var X0 = this.px(0), Y0 = this.py(0);
    var X1 = this.px(COLS), Y1 = this.py(ROWS);

    /* 河流水域（先铺底，再压格线） */
    v.hatch(this.px(1), this.py(3), cell * 2, cell * 3, cell * .16, { color: P.ruleSoft, w: .7, a: .34 });
    v.hatch(this.px(4), this.py(3), cell * 2, cell * 3, cell * .16, { color: P.ruleSoft, w: .7, a: .34 });
    v.rect(this.px(1), this.py(3), cell * 2, cell * 3, { stroke: P.ruleSoft, w: 1 });
    v.rect(this.px(4), this.py(3), cell * 2, cell * 3, { stroke: P.ruleSoft, w: 1 });
    for (i = 0; i < 3; i++) {
      v.wave(this.px(1) + cell * .3, this.py(3) + cell * (.7 + i), cell * 1.4, cell * .09, 3, { a: .3 });
      v.wave(this.px(4) + cell * .3, this.py(3) + cell * (.7 + i), cell * 1.4, cell * .09, 3, { a: .3 });
    }
    var wfs = Math.max(8, cell * .26);
    v.text('小河', this.px(2), this.py(4.5), { size: wfs, color: P.ink3, alpha: .5, family: '"Kaiti SC","STKaiti","KaiTi",serif', tracking: cell * .06 });
    v.text('小河', this.px(5), this.py(4.5), { size: wfs, color: P.ink3, alpha: .5, family: '"Kaiti SC","STKaiti","KaiTi",serif', tracking: cell * .06 });

    /* 格线 */
    for (r = 0; r <= ROWS; r++) v.line(X0, this.py(r), X1, this.py(r), { w: r === 0 || r === ROWS ? 1.4 : .85, a: .85 });
    for (c = 0; c <= COLS; c++) v.line(this.px(c), Y0, this.px(c), Y1, { w: c === 0 || c === COLS ? 1.4 : .85, a: .85 });

    /* 兽穴：双环；陷阱：菱形（压在格线之上） */
    this._den(v, 0, 3, 1);
    this._den(v, 8, 3, 0);
    this._trap(v, 0, 2); this._trap(v, 0, 4); this._trap(v, 1, 3);
    this._trap(v, 8, 2); this._trap(v, 8, 4); this._trap(v, 7, 3);

    /* 坐标 */
    if (this.cfg.coords !== false) {
      var fs = Math.max(7, cell * .2);
      for (c = 0; c < COLS; c++) v.text(FILE[c], this.px(c + .5), Y1 + fs * 1.5, { size: fs, color: P.ink4, family: 'monospace' });
      for (r = 0; r < ROWS; r++) v.text(String(ROWS - r), X0 - fs * 1.4, this.py(r + .5), { size: fs, color: P.ink4, family: 'monospace' });
    }

    /* 上一手轨迹 */
    if (this.lastMark) {
      var lf = this.lastMark.f, lt = this.lastMark.t;
      var fr = (lf / COLS) | 0, fc = lf % COLS, tr2 = (lt / COLS) | 0, tc2 = lt % COLS;
      var jump = Math.abs(fr - tr2) + Math.abs(fc - tc2) > 1;
      v.arrow(this.px(fc + .5), this.py(fr + .5), this.px(tc2 + .5), this.py(tr2 + .5), {
        color: P.ink, w: 1.2, a: jump ? .5 : .3, dash: jump ? null : [4, 4], head: Math.max(6, cell * .16)
      });
    }

    /* 合法落点 */
    if (this.cfg.showMoves !== false) {
      for (i = 0; i < this.selMoves.length; i++) {
        var m = this.selMoves[i], mr = (m.t / COLS) | 0, mc = m.t % COLS;
        var cx = this.px(mc + .5), cy = this.py(mr + .5), s = cell * .46;
        if (this.b[m.t]) {
          v.corners(cx - s, cy - s, s * 2, s * 2, s * .4, { color: P.warn, w: 1.6 });
        } else {
          v.circle(cx, cy, cell * .1, { stroke: P.ink, w: 1.2, a: .55 });
        }
      }
    }

    /* 兽 */
    for (i = 0; i < N; i++) {
      var p = this.b[i];
      if (!p) continue;
      r = (i / COLS) | 0; c = i % COLS;
      var ty = this.typeOf(p);
      v.tile(this.px(c + .5), this.py(r + .5), cell * .78, cell * .78, {
        filled: p < 0, r: cell * .12, lw: 1.3,
        label: ANIMAL[ty], size: cell * .4,
        family: '"Kaiti SC","STKaiti","KaiTi","楷体",serif', weight: 600
      });
      /* 角标等级，便于对照大小 */
      v.text(String(this.rank[ty]), this.px(c + .5) + cell * .3, this.py(r + .5) - cell * .3, {
        size: Math.max(7, cell * .17), color: p < 0 ? '#fff' : P.ink3, family: 'monospace'
      });
    }

    /* 选中 / 悬停 */
    if (this.sel >= 0 && this.b[this.sel]) {
      var sr = (this.sel / COLS) | 0, sc = this.sel % COLS, ss = cell * .46;
      v.corners(this.px(sc + .5) - ss, this.py(sr + .5) - ss, ss * 2, ss * 2, ss * .4, { color: P.ink, w: 2 });
    } else if (this._hover >= 0 && this.b[this._hover] && this.side(this.b[this._hover]) === this.turn && !this._over) {
      var hr = (this._hover / COLS) | 0, hc = this._hover % COLS;
      v.rect(this.px(hc) + cell * .07, this.py(hr) + cell * .07, cell * .86, cell * .86, { stroke: P.ink3, w: 1, a: .7 });
    }

    /* 提示 */
    if (this.sugg) {
      v.arrow(this.px(this.sugg.f % COLS + .5), this.py(((this.sugg.f / COLS) | 0) + .5),
        this.px(this.sugg.t % COLS + .5), this.py(((this.sugg.t / COLS) | 0) + .5),
        { color: P.warn, w: 2, head: Math.max(7, cell * .2) });
    }
  };

  Jungle.prototype._den = function (v, r, c, side) {
    var cx = this.px(c + .5), cy = this.py(r + .5), s = this.cell;
    v.circle(cx, cy, s * .4, { stroke: P.ink, w: 1.2, a: .55 });
    v.circle(cx, cy, s * .3, { stroke: P.ink, w: .8, a: .35 });
    v.text('穴', cx, cy, {
      size: s * .26, color: P.ink3, alpha: .55,
      family: '"Kaiti SC","STKaiti","KaiTi",serif'
    });
  };

  Jungle.prototype._trap = function (v, r, c) {
    var cx = this.px(c + .5), cy = this.py(r + .5), s = this.cell * .34;
    v.polygon([[cx, cy - s], [cx + s, cy], [cx, cy + s], [cx - s, cy]],
      { stroke: P.ink, w: 1, a: .4 });
    v.dot(cx, cy, Math.max(1, this.cell * .035), P.ink3, .5);
  };

  /* ───────── 大厅图标 ───────── */
  function icon(v, w, h) {
    var cols = 5, rows = 6;
    var pad = Math.min(w, h) * .12;
    var cell = Math.min((w - pad * 2) / cols, (h - pad * 2) / rows);
    var ox = (w - cell * cols) / 2, oy = (h - cell * rows) / 2, r, c;
    /* 水域 */
    v.hatch(ox + cell, oy + cell * 2, cell * 1, cell * 2, cell * .18, { a: .3 });
    v.hatch(ox + cell * 3, oy + cell * 2, cell * 1, cell * 2, cell * .18, { a: .3 });
    for (r = 0; r <= rows; r++) v.line(ox, oy + r * cell, ox + cell * cols, oy + r * cell, { color: P.ruleSoft, w: .7 });
    for (c = 0; c <= cols; c++) v.line(ox + c * cell, oy, ox + c * cell, oy + cell * rows, { color: P.ruleSoft, w: .7 });
    v.circle(ox + cell * 2.5, oy + cell * .5, cell * .3, { stroke: P.ink, w: 1, a: .5 });
    v.circle(ox + cell * 2.5, oy + cell * 5.5, cell * .3, { stroke: P.ink, w: 1, a: .5 });
    v.tile(ox + cell * .5, oy + cell * 5.5, cell * .78, cell * .78, { filled: false, r: cell * .1, label: '象', size: cell * .42 });
    v.tile(ox + cell * 4.5, oy + cell * .5, cell * .78, cell * .78, { filled: true, r: cell * .1, label: '狮', size: cell * .42 });
    v.tile(ox + cell * 2.5, oy + cell * 2.5, cell * .78, cell * .78, { filled: false, r: cell * .1, label: '虎', size: cell * .42 });
  }

  /* ───────── 注册 ───────── */
  Hub.register({
    id: 'jungle',
    name: '斗兽棋',
    en: 'JUNGLE',
    sub: '八兽争锋，攻入兽穴者胜',
    tag: '动物棋',
    aspect: (COLS + .8) / (ROWS + .8),
    players: 2,
    seatNames: ['红方', '蓝方'],
    ai: true,
    options: [
      {
        key: 'order', label: '狼狗序', def: 'standard',
        choices: [
          { v: 'standard', label: '狼＞狗', note: '中式常见' },
          { v: 'swap', label: '狗＞狼', note: '部分版本' }
        ]
      },
      {
        key: 'showMoves', label: '落点提示', def: true,
        choices: [{ v: true, label: '显示' }, { v: false, label: '隐藏' }]
      },
      {
        key: 'coords', label: '坐标', def: true,
        choices: [{ v: true, label: '显示' }, { v: false, label: '隐藏' }]
      }
    ],
    rules: {
      intro: '双方各八只动物，红方先行。目标是让任意一只兽<b>走入对方的兽穴</b>，或把对方的兽<b>吃光</b>、逼到<b>无兽可动</b>。棋盘七列九行，中部有两条小河，双方底线各有一个兽穴与三个陷阱。',
      sections: [
        {
          title: '等级与吃法', items: [
            '大小次序：<b>象＞狮＞虎＞豹＞狼＞狗＞猫＞鼠</b>，大者可吃小者与同级者。',
            '<b>唯鼠能吃象</b>，象不能吃鼠（鼠可钻进象耳）。',
            '兽走入<b>对方的陷阱</b>即失去战力，对方任何一只兽都能吃它；走入自己的陷阱则不受影响。',
            '狼与狗的次序在不同版本中相反，可在开局设置中切换。'
          ]
        },
        {
          title: '走法', items: [
            '每兽每次走一格，前后左右均可，<b>不可斜走</b>。',
            '<b>不能走入自己的兽穴</b>；走入对方兽穴立即获胜。任何兽都可自由进出陷阱格。',
            '<b>鼠是唯一能下水的兽</b>，在水中同样每次走一格。',
            '<b>狮、虎可跳河</b>：从河边直线跃过整条河落到对岸第一个陆格，途中若河里有鼠（不论敌我）则不能跳；落点上若有可吃的敌兽，可一并吃掉。'
          ]
        },
        {
          title: '水陆之间', items: [
            '水中的兽与陆地上的兽<b>不能互相吃</b>。',
            '水里的鼠只有水里的鼠能吃；岸上的兽吃不到它，它也吃不到岸上的象。',
            '两只鼠同在水中时可以互吃。'
          ]
        },
        {
          title: '胜负与和局', items: [
            '<b>胜</b>：任一兽走入对方兽穴；或吃光对方全部兽；或对方无兽可动（困毙）。',
            '<b>和</b>：同一局面第三次出现；或连续 100 回合无吃子。'
          ]
        },
        {
          title: '盘面记号', items: [
            '斜线阴影加波纹的区域为<b>小河</b>；双环为<b>兽穴</b>；菱形为<b>陷阱</b>。',
            '<b>白底墨字</b>为红方，<b>墨底白字</b>为蓝方；每只兽右上角标有其等级数字，便于对照大小。',
            '小圆圈为可走的空格，<b>红色四角框</b>为可吃的敌兽，箭头为上一手（实线为跳河）。',
            '「提示」会画出电脑建议的一步。'
          ]
        }
      ]
    },
    icon: icon,
    create: function (cfg) { return new Jungle(cfg); }
  });

  Hub.Jungle = Jungle;
  Hub.JG = {
    ROWS: ROWS, COLS: COLS, NC: NC,
    WATER: WATER, DEN: DEN, TRAP: TRAP,
    ANIMAL: ANIMAL,
    RAT: RAT, CAT: CAT, DOG: DOG, WOLF: WOLF,
    LEOPARD: LEOPARD, TIGER: TIGER, LION: LION, ELEPHANT: ELEPHANT
  };

})(window);
