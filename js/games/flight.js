/* ════════════════════════════════════════════════════════════
   飞行棋 FLIGHT CHESS
   盘面：15×15 十字，共 81 格
     · 环形跑道 56 格（顺时针，四个起点相隔 14 格）
     · 各方归航跑道 6 格，自臂端口部向内直插中心终点
     · 四个 6×6 角落为停机坪，各停 4 架
   规则：掷出 6 才能起飞，且掷 6 追加一次；落到对方棋子所在格
         将其击回停机坪；须正好抵达终点，超出则反弹回退；
         连续掷出 4 次 6 点，己方已出动的飞机全部返回停机坪。
   座位：0 红（上）1 黄（右）2 蓝（下）3 绿（左），顺时针行进
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub, P = Hub.PAL;

  var GW = 15;                 // 盘面边长（格）
  var LOOP = 56;               // 环形跑道格数
  var RUNWAY = 6;              // 归航跑道格数（口部向内，不含中心终点）
  var FINISH = LOOP + RUNWAY;  // = 62，中心终点
  var PATHLEN = FINISH + 1;    // = 63，每方路径长度
  var PLANES = 4;
  var COLOR_STEP = 4;          // 同色格周期：沿本方路径每 4 格一色
  /* 起飞点：紧邻本机库、顺时针入环的那一格；
     绕环一周后正好回到本臂跑道口部外侧的肩格 */
  var START_IDX = [44, 2, 16, 30];
  /* 跨中心航线（环道索引对，两端关于中心 (7,7) 对称） */
  var LANES = [[0, 28], [14, 42], [28, 0], [42, 14]];
  /* 航线两端换算成本方路径序号 [起点, 终点]（四家均为 12 → 40） */
  var FLY_PATH = [[12, 40], [12, 40], [12, 40], [12, 40]];

  var SEAT_NAME = ['红方', '黄方', '蓝方', '绿方'];

  /* ───────── 几何构建 ───────── */
  function sgn(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

  var TRACK = (function () {
    var t = [];
    function push(r, c) { t.push([r, c]); }
    function run(r0, c0, r1, c1) {
      var dr = sgn(r1 - r0), dc = sgn(c1 - c0), r = r0, c = c0;
      for (;;) { push(r, c); if (r === r1 && c === c1) break; r += dr; c += dc; }
    }
    run(0, 6, 0, 8);          // 上臂顶边
    run(1, 8, 5, 8);          // 上臂右列
    push(6, 8);               // 肩
    run(6, 9, 6, 14);         // 右臂上行
    push(7, 14); push(8, 14); // 右臂端
    run(8, 13, 8, 9);         // 右臂下行
    push(8, 8);               // 肩
    run(9, 8, 14, 8);         // 下臂右列
    push(14, 7); push(14, 6); // 下臂端
    run(13, 6, 9, 6);         // 下臂左列
    push(8, 6);               // 肩
    run(8, 5, 8, 0);          // 左臂下行
    push(7, 0); push(6, 0);   // 左臂端
    run(6, 1, 6, 5);          // 左臂上行
    push(6, 6);               // 肩
    run(5, 6, 1, 6);          // 上臂左列
    return t;
  })();

  /* 各方归航跑道：自跑道口部（臂端中格）向内直插中心 */
  var RUNWAYS = [
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]]
  ];
  var HUB = [7, 7];                                  // 正中心：四方共用终点

  /* 停机坪：四个 6×6 角落，各取靠内的 2×2 四个泊位 */
  var HANGARS = (function () {
    var org = [[0, 0], [0, 9], [9, 9], [9, 0]], out = [], s, k;
    for (s = 0; s < 4; s++) {
      var a = [];
      for (k = 0; k < 4; k++) {
        a.push([org[s][0] + 2 + ((k / 2) | 0), org[s][1] + 2 + (k % 2)]);
      }
      out.push(a);
    }
    return out;
  })();

  /* 十字区域内的全部格子（用于绘制底色与命中判定） */
  var CROSS = [];
  (function () {
    for (var r = 0; r < GW; r++) {
      for (var c = 0; c < GW; c++) {
        var inArm = (c >= 6 && c <= 8);
        var inBand = (r >= 6 && r <= 8);
        if (inArm || inBand) CROSS.push([r, c]);
      }
    }
  })();

  /* 格 → 类型索引，便于 O(1) 查询 */
  var CELLKIND = {};                                 // "r,c" -> {kind, seat, idx}
  (function () {
    var i;
    for (i = 0; i < TRACK.length; i++) CELLKIND[TRACK[i][0] + ',' + TRACK[i][1]] = { k: 'track', i: i };
    for (var s = 0; s < 4; s++) {
      for (i = 0; i < RUNWAYS[s].length; i++) {
        CELLKIND[RUNWAYS[s][i][0] + ',' + RUNWAYS[s][i][1]] = { k: 'run', s: s, i: i };
      }
    }
    CELLKIND[HUB[0] + ',' + HUB[1]] = { k: 'hub' };
    for (s = 0; s < 4; s++) {
      for (i = 0; i < 4; i++) {
        CELLKIND[HANGARS[s][i][0] + ',' + HANGARS[s][i][1]] = { k: 'yard', s: s, i: i };
      }
    }
  })();

  /* ─────────────────────────────────────────────── */
  function Flight(cfg) {
    Hub.Base.call(this, cfg);
    this.reset();
  }
  Flight.prototype = Object.create(Hub.Base.prototype);
  Flight.prototype.constructor = Flight;

  Flight.prototype.reset = function () {
    var s, p;
    this.pos = [];
    for (s = 0; s < 4; s++) {
      this.pos[s] = [];
      for (p = 0; p < PLANES; p++) this.pos[s][p] = -1;      // -1 = 停机坪
    }
    this.turn = 0;
    this.dice = 0;
    this.phase = 'roll';            // roll | move
    this.sixes = 0;
    this.movable = [];
    this.sel = -1;
    this.lastMove = null;
    this.history = [];
    this._over = null;
    this.msg = '掷骰子开始。';
  };

  Flight.prototype.seatCount = function () { return 4; };

  /* 路径索引 → 盘面格坐标 */
  Flight.prototype.pathCell = function (seat, idx) {
    if (idx < 0) return null;
    if (idx < LOOP) return TRACK[(START_IDX[seat] + idx) % LOOP];
    if (idx < FINISH) return RUNWAYS[seat][idx - LOOP];
    return HUB;
  };
  /* 路径索引 → 环形跑道绝对索引（归航段返回 -1，不受撞击） */
  Flight.prototype.loopIndex = function (seat, idx) {
    return (idx >= 0 && idx < LOOP) ? (START_IDX[seat] + idx) % LOOP : -1;
  };
  /* 飞机当前所在格（停机坪用泊位坐标） */
  Flight.prototype.planeCell = function (seat, p) {
    var idx = this.pos[seat][p];
    if (idx === -1) return HANGARS[seat][p];
    return this.pathCell(seat, idx);
  };

  /** 掷出 d 后，seat 的哪些飞机可动 */
  Flight.prototype.legalPlanes = function (seat, d) {
    var out = [], p, idx;
    for (p = 0; p < PLANES; p++) {
      idx = this.pos[seat][p];
      if (idx === FINISH) continue;                       // 已抵达
      if (idx === -1) { if (d === 6) out.push(p); continue; }   // 仅 6 点可起飞
      out.push(p);                                        // 在途：超出终点会反弹，恒可动
    }
    return out;
  };

  /** 落点：正好到终点则停，超出则反弹回退 */
  Flight.prototype.destOf = function (idx, d) {
    var n = idx + d;
    if (n <= FINISH) return n;
    return FINISH - (n - FINISH);
  };

  /** 跳子与飞子：
      落在本方同色格（路径序号为 4 的倍数）→ 向前跳 4 格；
      跳后若落在航线起点（12）→ 跨中心直飞至 40；飞后不再跳。
      跳/飞只结算最终落点的撞击，中途格不受影响。 */
  Flight.prototype.chainOf = function (seat, to) {
    var steps = [], p = to, fp = FLY_PATH[seat];
    if (p >= 0 && p < LOOP && p % COLOR_STEP === 0 && p + COLOR_STEP < LOOP) {
      p += COLOR_STEP;
      steps.push({ k: 'jump', to: p });
    }
    if (p === fp[0]) {
      p = fp[1];
      steps.push({ k: 'fly', to: p });
      /* 村规「同色连续跳」：飞后若仍同色，可再跳一次 */
      if (this.cfg.chainJump && p % COLOR_STEP === 0 && p + COLOR_STEP < LOOP) {
        p += COLOR_STEP;
        steps.push({ k: 'jump', to: p });
      }
    }
    return { to: p, steps: steps };
  };

  /* ───────── 快照 / 悔棋 ───────── */
  Flight.prototype.snapshot = function () {
    return {
      pos: [this.pos[0].slice(), this.pos[1].slice(), this.pos[2].slice(), this.pos[3].slice()],
      turn: this.turn, dice: this.dice, phase: this.phase,
      sixes: this.sixes, msg: this.msg,
      lastMove: this.lastMove ? { s: this.lastMove.s, p: this.lastMove.p, from: this.lastMove.from, to: this.lastMove.to, cap: this.lastMove.cap, chain: this.lastMove.chain } : null
    };
  };
  Flight.prototype.restore = function (s) {
    this.pos = [s.pos[0].slice(), s.pos[1].slice(), s.pos[2].slice(), s.pos[3].slice()];
    this.turn = s.turn; this.dice = s.dice; this.phase = s.phase;
    this.sixes = s.sixes; this.msg = s.msg; this.lastMove = s.lastMove;
    this.movable = this.phase === 'move' ? this.legalPlanes(this.turn, this.dice) : [];
    this._over = null;
    this.sel = -1;
  };

  Flight.prototype.canUndo = function () { return this.history.length > 0 && !this.thinking; };
  Flight.prototype.undo = function () {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  };

  /* ───────── 掷骰与走子 ───────── */
  Flight.prototype.roll = function () {
    if (this._over || this.phase !== 'roll') return 0;
    this.history.push(this.snapshot());

    var d = 1 + ((Math.random() * 6) | 0);
    this.dice = d;                      // 保留到下次掷骰，中央骰面持续可见
    this.lastRoll = d;
    if (d === 6) this.sixes++; else this.sixes = 0;

    /* 连续四次 6 点：己方已出动的飞机全部返回停机坪（可关） */
    if (this.cfg.sixRule !== false && this.sixes >= 4) {
      var p, n = 0;
      for (p = 0; p < PLANES; p++) {
        if (this.pos[this.turn][p] >= 0 && this.pos[this.turn][p] !== FINISH) { this.pos[this.turn][p] = -1; n++; }
      }
      this.sixes = 0;
      this.msg = this.seatName(this.turn) + ' 连掷四次 6 点，' + n + ' 架飞机返回停机坪。';
    } else {
      this.msg = this.seatName(this.turn) + ' 掷出 ' + d + ' 点。';
    }

    this.movable = this.legalPlanes(this.turn, d);
    if (!this.movable.length) {
      this.phase = 'roll';
      if (d === 6) {
        this.msg += ' 无可动飞机，但掷 6 点可再掷一次。';
        this.history.pop();                 // 未走子，并入下一次掷骰
        return d;
      }
      this.msg += ' 无可动飞机，轮到下一家。';
      this.history[this.history.length - 1].rec = { pass: true, s: this.turn, d: d };
      this.turn = (this.turn + 1) % 4;
      this.lastMove = null;
      return d;
    }
    this.phase = 'move';
    if (this.movable.length === 1) this.sel = this.movable[0];
    return d;
  };

  /** 移动 seat 的第 p 架飞机（使用当前 dice）
      自行压入快照，使「悔棋」先退回重选飞机，再按一次才退回掷骰前 */
  Flight.prototype.movePlane = function (seat, p) {
    if (seat !== this.turn || this.phase !== 'move') return false;   // 不是你的回合
    if (this.movable.indexOf(p) < 0) return false;                  // 该架不可动
    this.history.push(this.snapshot());
    var d = this.dice, idx = this.pos[seat][p], from = idx, to, cap = 0, s2, q;
    if (idx === -1) to = 0;                                  // 起飞
    else to = this.destOf(idx, d);
    /* 跳子 / 飞子连锁（起飞落起点格视作已结算，不跳） */
    var ch = (from === -1) ? { to: to, steps: [] } : this.chainOf(seat, to);
    var chain = ch.steps;
    to = ch.to;
    this.pos[seat][p] = to;

    /* 撞击：同一跑道格上的其他方飞机被击回停机坪 */
    var li = this.loopIndex(seat, to);
    if (li >= 0) {
      for (s2 = 0; s2 < 4; s2++) {
        if (s2 === seat) continue;
        for (q = 0; q < PLANES; q++) {
          if (this.loopIndex(s2, this.pos[s2][q]) === li) { this.pos[s2][q] = -1; cap++; }
        }
      }
    }

    this.lastMove = { s: seat, p: p, from: from, to: to, cap: cap, chain: chain };
    this.history[this.history.length - 1].rec =
      { s: seat, p: p, from: from, to: to, cap: cap, d: d, chain: chain };
    var chainTxt = '';
    for (var ci = 0; ci < chain.length; ci++) chainTxt += chain[ci].k === 'jump' ? '跳' : '飞';
    this.msg = this.seatName(seat) + ' ' + (from === -1 ? '起飞' : '前进 ' + d + ' 格') +
      (chainTxt ? '，同色' + chainTxt + '！' : '') +
      (to === FINISH ? '，抵达终点！' : '') + (cap ? ' 击落 ' + cap + ' 架。' : '。');

    this.judge();
    if (this._over) { this.phase = 'roll'; this.movable = []; return true; }

    /* 掷 6 点追加一次；村规「撞击追加一掷」；否则换下一家。骰面保留至下次掷骰 */
    if (cap > 0 && this.cfg.capAgain) {
      this.phase = 'roll'; this.movable = []; this.sel = -1;
    } else if (d === 6) {
      this.phase = 'roll'; this.movable = []; this.sel = -1;
    } else {
      this.turn = (this.turn + 1) % 4;
      this.phase = 'roll'; this.movable = []; this.sel = -1;
      this.sixes = 0;
    }
    return true;
  };

  Flight.prototype.judge = function () {
    var s, n;
    for (s = 0; s < 4; s++) {
      n = 0;
      for (var p = 0; p < PLANES; p++) if (this.pos[s][p] === FINISH) n++;
      if (n >= PLANES) {
        this._over = {
          winner: s, title: this.seatName(s) + '胜',
          text: this.seatName(s) + ' 的四架飞机全部抵达终点。'
        };
        return;
      }
    }
    if (this.history.length >= 2000) {
      this._over = { winner: null, title: '和局', text: '已达回合上限，判和。' };
    }
  };

  Flight.prototype.resign = function (seat) {
    /* 多人局：认输者出局，其余按已抵达终点的飞机数比较 */
    var s, best = -1, bestN = -1, n, p;
    for (p = 0; p < PLANES; p++) this.pos[seat][p] = -2;      // -2 = 已退场
    for (s = 0; s < 4; s++) {
      if (s === seat) continue;
      n = 0;
      for (p = 0; p < PLANES; p++) if (this.pos[s][p] === FINISH) n++;
      if (n > bestN) { bestN = n; best = s; }
    }
    this._over = {
      winner: best, title: this.seatName(best) + '胜',
      text: this.seatName(seat) + ' 认输；其余各方比较已抵达终点的飞机数，' +
            this.seatName(best) + '（' + bestN + ' / ' + PLANES + '）领先。'
    };
  };

  /* ───────── 界面契约 ───────── */
  Flight.prototype.seat = function () { return this._over ? -1 : this.turn; };
  Flight.prototype.seatName = function (i) { return SEAT_NAME[i] || ('第' + (i + 1) + '方'); };
  Flight.prototype.seatFilled = function (i) { return i === 0 || i === 2; };

  Flight.prototype.seatCaptured = function (i) {
    var done = 0, flying = 0, yard = 0, p;
    for (p = 0; p < PLANES; p++) {
      var v = this.pos[i][p];
      if (v === FINISH) done++;
      else if (v < 0) yard++;
      else flying++;
    }
    return '终 ' + done + ' · 途 ' + flying + ' · 坪 ' + yard;
  };

  Flight.prototype.status = function () {
    if (this._over) return '<b>' + this._over.title + '</b>';
    var s = '<b>' + this.seatName(this.turn) + '</b> ';
    s += this.phase === 'roll' ? '掷骰子' : ('走子（' + this.dice + ' 点）');
    if (this.sixes > 0) s += ' · 连续 6 点 ' + this.sixes + ' 次';
    return s;
  };

  Flight.prototype.hint = function () {
    if (this._over) return '';
    if (this.phase === 'roll') return '点右侧「掷骰子」。掷出 6 点方可让停机坪上的飞机起飞，且掷 6 点可追加一次。';
    if (this.movable.length === 1) return '只有 ' + (this.sel + 1) + ' 号机可动，点击它即可（高亮处）。落在与起飞点同档深浅的同色格可向前跳 4 格，跳到航线起点还能跨中心直飞；虚线环已预告落点。';
    return '点击任一高亮的飞机移动 ' + this.dice + ' 格。落到对方飞机所在格会将其击回停机坪；落同色格可跳，跳入航线起点可飞。';
  };

  Flight.prototype.log = function () {
    var out = [], k;
    for (k = 0; k < this.history.length; k++) {
      var m = this.history[k].rec;
      if (!m) continue;
      out.push({
        n: out.length + 1 + '.',
        v: m.pass
          ? (SEAT_NAME[m.s] + ' 掷 ' + m.d + ' 点，无子可动')
          : (SEAT_NAME[m.s] + ' ' + m.d + '点 ' + (m.p + 1) + '号机' +
            (m.from === -1 ? ' 起飞' : ' ' + m.from + '→' + m.to) +
            ((m.chain && m.chain.length) ? ' ' + m.chain.map(function (c) { return c.k === 'jump' ? '跳' : '飞'; }).join('') : '') +
            (m.to === FINISH ? ' 抵终点' : '') + (m.cap ? ' 击落' + m.cap : '')),
        hi: k === this.history.length - 1
      });
    }
    return out;
  };

  Flight.prototype.info = function () {
    var h = '<div class="kv"><span>当前点数</span><span>' + (this.dice || '—') + '</span></div>' +
      '<div class="kv"><span>连续 6 点</span><span>' + this.sixes + ' / 4</span></div>' +
      '<div class="kv"><span>回合</span><span>' + this.history.length + '</span></div>';
    h += '<h5>各方飞机（终点 / 在途 / 停机坪）</h5>';
    for (var s = 0; s < 4; s++) {
      var d = 0, f = 0, y = 0, p;
      for (p = 0; p < PLANES; p++) {
        var v = this.pos[s][p];
        if (v === FINISH) d++; else if (v < 0) y++; else f++;
      }
      h += '<div class="kv"><span>' + (s + 1) + ' ' + this.seatName(s) + '</span><span>' + d + ' / ' + f + ' / ' + y + '</span></div>';
    }
    h += '<h5>棋子样式（黑白线稿）</h5>' +
      '<div style="font-size:11.5px;line-height:1.8">1 实心 · 2 空心 · 3 灰底 · 4 空心带点<br>每架飞机内标有座号，据此区分。</div>';
    return h;
  };

  Flight.prototype.actions = function () {
    if (this._over) return [];
    if (this.phase !== 'roll') return [];
    return [{ id: 'roll', label: '掷骰子', title: '掷一枚六面骰', primary: true }];
  };
  Flight.prototype.onAction = function (id) {
    if (id === 'roll') this.roll();
  };

  /* ───────── 交互 ───────── */
  Flight.prototype.layout = function (w, h) {
    var m = Math.min(w, h) * .03;
    this.cell = (Math.min(w, h) - m * 2) / GW;
    this.ox = (w - this.cell * GW) / 2;
    this.oy = (h - this.cell * GW) / 2;
    this.W = w; this.H = h;
  };
  Flight.prototype.cx = function (c) { return this.ox + (c + .5) * this.cell; };
  Flight.prototype.cy = function (r) { return this.oy + (r + .5) * this.cell; };

  Flight.prototype.pick = function (x, y) {
    if (!this.cell) return null;
    var c = Math.floor((x - this.ox) / this.cell);
    var r = Math.floor((y - this.oy) / this.cell);
    if (r < 0 || r >= GW || c < 0 || c >= GW) return null;
    return { r: r, c: c, i: r * GW + c };
  };
  Flight.prototype.pickHint = function (hit) {
    if (!hit || this._over || this.phase !== 'move') return false;
    return this._planeAt(hit.r, hit.c) >= 0;
  };
  /** 该格上是否有「当前可动」的己方飞机；返回飞机号或 -1 */
  Flight.prototype._planeAt = function (r, c) {
    for (var k = 0; k < this.movable.length; k++) {
      var p = this.movable[k];
      var cell = this.planeCell(this.turn, p);
      if (cell && cell[0] === r && cell[1] === c) return p;
    }
    return -1;
  };

  Flight.prototype.hover = function (hit) { this._hover = hit ? hit.i : -1; };

  Flight.prototype.click = function (hit) {
    if (this._over) return false;
    if (!hit) { this.sel = -1; return false; }
    if (this.phase !== 'move') {
      Hub.App.toast('请先掷骰子');
      return false;
    }
    var p = this._planeAt(hit.r, hit.c);
    if (p < 0) return false;
    this.sel = -1;
    this.movePlane(this.turn, p);
    return true;
  };

  /* ───────── 绘制（对齐标准飞行棋盘的语言：色块说话，少用记号） ───────── */
  var RW_FILL = [.12, .05, .20, .085];   // 四条归航跑道的灰阶（代色）
  /* 跑道同色格带：每 4 格一档，与起飞点同档者即本方同色格（代四色） */
  var TRACK_TINT = [P.wash2, P.paper2, P.wash3, P.paper2];

  Flight.prototype.draw = function (v) {
    var cell = this.cell, i, s, k, self = this;

    /* 停机坪：细实线圆角框 + 四个泊位环 */
    for (s = 0; s < 4; s++) {
      var hr = HANGARS[s][0][0], hc = HANGARS[s][0][1];
      var x = this.ox + (hc - 2 + .10) * cell, y = this.oy + (hr - 2 + .10) * cell;
      v.rect(x, y, cell * 3.80, cell * 3.80, { stroke: P.ruleSoft, w: 1.1, r: cell * .34 });
      v.text(this.seatName(s), x + cell * 1.90, y + cell * .40, {
        size: Math.max(7, cell * .28), color: P.ink4,
        family: '"Kaiti SC","STKaiti","KaiTi",serif'
      });
      for (k = 0; k < 4; k++) {
        var bh = HANGARS[s][k];
        v.circle(this.cx(bh[1]), this.cy(bh[0]), cell * .36, { stroke: P.ruleFaint, w: 1 });
      }
    }

    /* 十字盘底色 */
    for (i = 0; i < CROSS.length; i++) {
      var rr = CROSS[i][0], cc = CROSS[i][1];
      v.rect(this.ox + cc * cell, this.oy + rr * cell, cell, cell,
        { fill: P.paper2, stroke: P.ruleFaint, w: .7 });
    }

    /* 归航跑道：四档灰底 + 一条向内导向箭头 */
    for (s = 0; s < 4; s++) {
      for (k = 0; k < RUNWAYS[s].length; k++) {
        var rc = RUNWAYS[s][k];
        v.rect(this.ox + rc[1] * cell, this.oy + rc[0] * cell, cell, cell,
          { fill: P.ink, fillA: RW_FILL[s] });
      }
      var m0 = RUNWAYS[s][0], m1 = RUNWAYS[s][RUNWAYS[s].length - 1];
      v.arrow(this.cx(m0[1]), this.cy(m0[0]), this.cx(m1[1]), this.cy(m1[0]),
        { color: P.ink3, w: 1, a: .55, head: Math.max(4, cell * .16) });
    }

    /* 环形跑道：连续带 + 同色格带（深浅每 4 格一档） */
    for (i = 0; i < TRACK.length; i++) {
      var t = TRACK[i];
      v.rect(this.ox + t[1] * cell, this.oy + t[0] * cell, cell, cell,
        { fill: TRACK_TINT[i % 4], stroke: P.ruleFaint, w: .7 });
    }
    /* 行进方向：四个转向箭头（淡） */
    [7, 21, 35, 49].forEach(function (i2) {
      var a = TRACK[i2], b = TRACK[(i2 + 1) % LOOP];
      v.arrow(self.cx(a[1]), self.cy(a[0]), self.cx(b[1]), self.cy(b[0]),
        { color: P.ink4, w: 1, a: .9, head: Math.max(4, cell * .16) });
    });
    /* 起飞点：粗框 + 座徽 */
    for (s = 0; s < 4; s++) {
      var stc = TRACK[START_IDX[s]];
      v.rect(this.ox + stc[1] * cell + cell * .05, this.oy + stc[0] * cell + cell * .05,
        cell * .90, cell * .90, { stroke: P.ink, w: 1.7 });
      this._seatMark(v, this.cx(stc[1]), this.cy(stc[0]), cell * .20, s);
    }

    /* 航线：两条跨中心淡虚线，四个端点画小飞机图标（标准盘记号） */
    [[0, 28], [14, 42]].forEach(function (ln) {
      var a = TRACK[ln[0]], b = TRACK[ln[1]];
      v.line(self.cx(a[1]), self.cy(a[0]), self.cx(b[1]), self.cy(b[0]),
        { color: P.ink4, w: .9, a: .9, dash: [5, 4] });
    });
    for (s = 0; s < 4; s++) {
      var fo = TRACK[LANES[s][0]];
      this._drawPlane(v, this.cx(fo[1]), this.cy(fo[0]), s, -1, false, cell * .17);
    }

    /* 中心终点：四象限三角（尖朝中心）+ 座徽，骰子牌覆于正中 */
    var hx0 = this.cx(HUB[1]), hy0 = this.cy(HUB[0]);
    var QD = [[-1, 0], [0, -1], [1, 0], [0, 1]];      // 西/北/东/南 → 座 0/1/2/3
    for (s = 0; s < 4; s++) {
      var qdx = QD[s][0], qdy = QD[s][1], qpx = -qdy, qpy = qdx;
      v.polygon([
        [hx0, hy0],
        [hx0 + qdx * cell * .98 + qpx * cell * .62, hy0 + qdy * cell * .98 + qpy * cell * .62],
        [hx0 + qdx * cell * .98 - qpx * cell * .62, hy0 + qdy * cell * .98 - qpy * cell * .62]
      ], { fill: 'rgba(20,22,26,' + (RW_FILL[s] + .05).toFixed(3) + ')', stroke: P.ink, w: 1 });
      this._seatMark(v, hx0 + qdx * cell * .68, hy0 + qdy * cell * .68, cell * .115, s);
    }
    this._drawDie(v, hx0, hy0, cell * 1.02, this.dice);

    /* 落点预览：走子阶段预告每架可动飞机连锁后的最终落点 */
    if (this.phase === 'move' && !this._over) {
      for (k = 0; k < this.movable.length; k++) {
        var midx = this.pos[this.turn][this.movable[k]];
        var raw = (midx === -1) ? 0 : this.destOf(midx, this.dice);
        var ch = this.chainOf(this.turn, raw);
        var lc = this.pathCell(this.turn, ch.to);
        if (lc) {
          v.circle(this.cx(lc[1]), this.cy(lc[0]), cell * .30,
            { stroke: P.ink2, w: 1.1, a: .8, dash: [3, 3] });
        }
        if (ch.steps.length && lc) {
          var rc0 = this.pathCell(this.turn, raw);
          if (rc0) {
            v.line(this.cx(rc0[1]), this.cy(rc0[0]), this.cx(lc[1]), this.cy(lc[0]),
              { color: P.warn, w: 1, a: .45, dash: [3, 3] });
          }
        }
      }
    }

    /* 上一手轨迹：一条淡虚线箭头 */
    if (this.lastMove && this.lastMove.from >= 0) {
      var la = this.pathCell(this.lastMove.s, this.lastMove.from);
      var lb = this.pathCell(this.lastMove.s, this.lastMove.to);
      if (la && lb) {
        v.arrow(this.cx(la[1]), this.cy(la[0]), this.cx(lb[1]), this.cy(lb[0]),
          { color: P.ink3, w: 1.1, a: .5, dash: [4, 4], head: Math.max(5, cell * .18) });
      }
    }

    /* 飞机：同格多机时缩小平铺 2×2，避免糊成一团 */
    var cnt = {}, s2, k2;
    for (s2 = 0; s2 < 4; s2++) {
      for (k2 = 0; k2 < PLANES; k2++) {
        if (this.pos[s2][k2] === -2) continue;
        var cl2 = this.planeCell(s2, k2);
        if (!cl2) continue;
        var ky = cl2[0] + ',' + cl2[1];
        cnt[ky] = (cnt[ky] || 0) + 1;
      }
    }
    for (s = 0; s < 4; s++) {
      var at = {};
      for (k = 0; k < PLANES; k++) {
        if (this.pos[s][k] === -2) continue;          // 已退场
        var cl = this.planeCell(s, k);
        if (!cl) continue;
        var key = cl[0] + ',' + cl[1];
        var n = at[key] = (at[key] || 0);
        at[key]++;
        var c = cnt[key] || 1;
        var pr = c > 1 ? cell * .25 : cell * .36;
        var sp = c > 1 ? cell * .40 : 0;
        var ox = ((n % 2) - .5) * sp;
        var oy = ((((n / 2) | 0) - .5) * sp);
        var movable = (s === this.turn && !this._over && this.phase === 'move' &&
          this.movable.indexOf(k) >= 0);
        this._drawPlane(v, this.cx(cl[1]) + ox, this.cy(cl[0]) + oy, s, k, movable, pr);
      }
    }

    /* 提示箭头 */
    if (this.sugg != null) {
      var sc = this.planeCell(this.turn, this.sugg.p);
      var tc = this.pathCell(this.turn, this.sugg.to);
      if (sc && tc) {
        v.arrow(this.cx(sc[1]), this.cy(sc[0]), this.cx(tc[1]), this.cy(tc[0]),
          { color: P.warn, w: 2, head: Math.max(7, cell * .26) });
      }
    }
  };

  /* 四种纯黑白可辨识的座徽；alpha 用于淡化 */
  Flight.prototype._seatMark = function (v, x, y, r, seat, alpha) {
    var style = seat % 4, a = alpha == null ? 1 : alpha;
    if (style === 0) v.circle(x, y, r, { fill: P.ink, stroke: P.ink, w: 1, a: a, fillA: a });
    else if (style === 1) v.circle(x, y, r, { fill: P.paper, stroke: P.ink, w: 1.4, a: a });
    else if (style === 2) v.circle(x, y, r, { fill: P.ink3, stroke: P.ink, w: 1, a: a, fillA: a });
    else {
      v.circle(x, y, r, { fill: P.paper, stroke: P.ink, w: 1.4, a: a });
      v.circle(x, y, r * .45, { fill: P.ink, fillA: a });
    }
  };

  /** 线稿小飞机（顶视）：后掠主翼 + 尾翼 + 机身 + 座号牌，r 为机身半径 */
  Flight.prototype._drawPlane = function (v, x, y, seat, p, hot, r) {
    var style = seat % 4;
    var fill = style === 2 ? P.ink3 : (style === 0 ? P.ink : P.paper);
    var dark = (style === 0 || style === 2);
    if (hot) v.circle(x, y, r * 1.40, { stroke: P.warn, w: 1.6, a: .9, dash: [3, 3] });
    var wing = { fill: fill, stroke: P.ink, w: 1 };
    /* 主翼：左右两片后掠翼 */
    v.polygon([
      [x - r * .20, y - r * .16], [x - r * 1.00, y + r * .30],
      [x - r * 1.00, y + r * .46], [x - r * .20, y + r * .18]
    ], wing);
    v.polygon([
      [x + r * .20, y - r * .16], [x + r * 1.00, y + r * .30],
      [x + r * 1.00, y + r * .46], [x + r * .20, y + r * .18]
    ], wing);
    /* 尾翼 */
    v.polygon([
      [x - r * .12, y + r * .60], [x - r * .54, y + r * .92],
      [x - r * .54, y + r * 1.02], [x - r * .12, y + r * .82]
    ], wing);
    v.polygon([
      [x + r * .12, y + r * .60], [x + r * .54, y + r * .92],
      [x + r * .54, y + r * 1.02], [x + r * .12, y + r * .82]
    ], wing);
    /* 机身 */
    v.polygon([
      [x, y - r * 1.05], [x + r * .20, y - r * .45], [x + r * .20, y + r * .55],
      [x, y + r * .90], [x - r * .20, y + r * .55], [x - r * .20, y - r * .45]
    ], { fill: fill, stroke: P.ink, w: 1.2 });
    if (style === 3) v.circle(x, y - r * .10, r * .56, { stroke: P.ink, w: .9 });
    /* 座号牌 */
    v.circle(x, y - r * .10, r * .40, { fill: dark ? P.paper : P.ink, stroke: P.ink, w: .9 });
    v.text(String(seat + 1), x, y - r * .08, {
      size: r * .62, family: 'monospace', weight: 700, color: dark ? P.ink : '#fff'
    });
  };

  /** 骰子：一点到六点的标准点阵 */
  Flight.prototype._drawDie = function (v, cx, cy, size, n) {
    var h = size / 2;
    v.rect(cx - h, cy - h, size, size, { fill: P.paper, stroke: P.ink, w: 1.4, r: size * .16 });
    if (!n) {
      v.text('骰', cx, cy, { size: size * .34, color: P.ink4, family: '"Kaiti SC","STKaiti","KaiTi",serif' });
      return;
    }
    var d = size * .11, ox = size * .26, oy = size * .26;
    var pts = {
      1: [[0, 0]],
      2: [[-1, -1], [1, 1]],
      3: [[-1, -1], [0, 0], [1, 1]],
      4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
      5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
      6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]
    }[n] || [];
    for (var i = 0; i < pts.length; i++) {
      v.circle(cx + pts[i][0] * ox, cy + pts[i][1] * oy, d, { fill: P.ink });
    }
  };

  /* ───────── 大厅图标 ───────── */
  function icon(v, w, h) {
    var cell = Math.min(w, h) / 7.4;
    var ox = (w - cell * 7) / 2, oy = (h - cell * 7) / 2;
    function X(c) { return ox + (c + .5) * cell; }
    function Y(r) { return oy + (r + .5) * cell; }
    var cross = [[2, 0], [2, 1], [2, 2], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2],
      [2, 3], [2, 4], [2, 5], [2, 6], [5, 2], [6, 2]];
    var seen = {}, i;
    for (i = 0; i < cross.length; i++) {
      var k = cross[i][0] + ',' + cross[i][1];
      if (seen[k]) continue;
      seen[k] = 1;
      v.rect(ox + cross[i][1] * cell + cell * .08, oy + cross[i][0] * cell + cell * .08,
        cell * .84, cell * .84, { stroke: P.ruleSoft, w: .8 });
    }
    v.rect(ox + cell * 2.9, oy + cell * 2.9, cell * 1.2, cell * 1.2, { stroke: P.ink, w: 1.2, r: cell * .2 });
    v.circle(X(3), Y(3), cell * .13, { fill: P.ink });
    v.circle(X(3) - cell * .5, Y(3) - cell * .5, cell * .13, { fill: P.ink });
    v.circle(X(3), Y(1), cell * .3, { fill: P.ink, stroke: P.ink, w: 1 });
    v.circle(X(5), Y(3), cell * .3, { fill: P.paper, stroke: P.ink, w: 1.2 });
  }

  /* ───────── 注册 ───────── */
  Hub.register({
    id: 'flight',
    name: '飞行棋',
    en: 'FLIGHT CHESS',
    sub: '掷骰绕行，同色跳飞，撞落对手回坪',
    tag: '骰子',
    aspect: 1,
    players: 4,
    minP: 2,
    maxP: 4,
    seatNames: SEAT_NAME,
    ai: true,
    setupNote: '本作为黑白线稿风格，四方以「实心 / 空心 / 灰底 / 空心带点」四种样式区分，每架飞机内标有座号 1–4。',
    options: [
      {
        key: 'sixRule', label: '连四六归坪', def: true,
        choices: [{ v: true, label: '启用', note: '传统规则' }, { v: false, label: '关闭' }],
        note: '连续掷出四次 6 点时，己方已出动的飞机全部返回停机坪。'
      },
      {
        key: 'chainJump', label: '同色连续跳', def: false,
        choices: [{ v: false, label: '关闭', note: '跳→飞后停止' }, { v: true, label: '启用', note: '飞后同色可再跳' }],
        note: '村规：飞越航线后若仍落在同色格，可再向前跳 4 格。'
      },
      {
        key: 'capAgain', label: '撞击追加掷', def: false,
        choices: [{ v: false, label: '关闭' }, { v: true, label: '启用', note: '击落敌机后再掷一次' }],
        note: '村规：本手击落了敌机，可追加掷骰一次。'
      }
    ],
    rules: {
      intro: '四人各持四架飞机，停在四个角落的停机坪上。<b>红方先行</b>，顺时针轮流掷骰。起飞点就在本机库旁，绕外环一周后从本臂端口转入归航跑道，<b>最先让四架飞机全部抵达中心终点</b>者胜。',
      sections: [
        {
          title: '掷骰与起飞', items: [
            '轮到你时点「掷骰子」，得到 1–6 点。',
            '<b>只有掷出 6 点</b>才能让停机坪上的一架飞机起飞，落到本方起点格。',
            '<b>掷出 6 点可追加一次</b>：走完这一手后仍由你继续掷骰。',
            '若掷出的点数无飞机可动，本手作废，轮到下一家（掷 6 点时仍可再掷）。'
          ]
        },
        {
          title: '行进与撞击', items: [
            '起飞点紧邻本机库（虚线箭头所指）。飞机沿环形跑道顺时针前进。',
            '跑满一周后回到本臂端口外侧，转入<b>本方归航跑道</b>，自端口向内直插中心。',
            '落到<b>对方飞机所在的跑道格</b>，即把该格上所有对方飞机<b>击回停机坪</b>，须重新掷 6 点起飞。',
            '归航跑道与中心终点不受撞击。',
            '己方多架飞机可以停在同一格，不互相阻挡。'
          ]
        },
        {
          title: '跳子与飞子', items: [
            '跑道上<b>深浅每 4 格一档</b>的格带即同色格：与本机库起飞点同档深浅者为本方同色格，落到其上即向前<b>跳 4 格</b>；走子阶段的虚线环也会直接预告跳/飞后的落点。',
            '<b>跳</b>：走子后落在本方同色格，立即向前<b>跳 4 格</b>到下一个同色格（起飞落起点格不跳）。',
            '<b>飞</b>：跳后若落在<b>航线起点</b>（跨中心虚线的端点），则<b>跨中心直飞</b>到对面同色格；飞后不再跳。',
            '跳与飞<b>只结算最终落点</b>：中途掠过的格子上的敌机不受影响，最终落点上的敌机照常被击落。',
            '已进入归航跑道或抵达终点后不再跳飞；跳会冲进归航段时也不跳。'
          ]
        },
        {
          title: '终点与反弹', items: [
            '抵达终点<b>必须点数正好</b>。',
            '若点数超出，飞机走到终点后<b>按多余步数原路反弹回退</b>，下次再找机会。',
            '四架飞机全部抵达终点即获胜。'
          ]
        },
        {
          title: '连四六归坪', items: [
            '同一方<b>连续掷出四次 6 点</b>，其已出动（尚未抵达终点）的飞机全部返回停机坪——防止连掷 6 点一路白跑。',
            '该规则可在开局设置中关闭。',
            '掷出非 6 点即重置连续计数。'
          ]
        },
        {
          title: '村规（开局可选）', items: [
            '<b>同色连续跳</b>：飞越航线后若仍落在同色格，可再向前跳 4 格（默认关闭）。',
            '<b>撞击追加掷</b>：本手击落了敌机，可追加掷骰一次（默认关闭）。',
            '<b>连四六归坪</b>：连续四次 6 点已出动飞机全部回坪（默认启用，可关）。'
          ]
        },
        {
          title: '盘面记号', items: [
            '<b>粗框格</b>为四方起飞点，紧贴各自机库，框内为本方座徽；起飞点所在的那一档深浅即本方同色格。',
            '中心为<b>四象限终点区</b>（尖朝中心，各带座徽）；<b>跨中心淡虚线</b>即航线，端点印有本方小飞机图标。',
            '四个细线圆角框为停机坪，内含四个泊位环，飞机起飞后留下空环。',
            '正中央画出<b>当前骰子点数</b>，未掷时显示「骰」字。',
            '走子阶段可动飞机外套<b>红色虚线圈</b>，其<b>跳/飞后的最终落点</b>以虚线环预告；淡虚线箭头为上一手轨迹。',
            '同格多架飞机会缩小平铺摆放，便于数清。'
          ]
        }
      ]
    },
    icon: icon,
    create: function (cfg) { return new Flight(cfg); }
  });

  Hub.Flight = Flight;
  Hub.FL = {
    GW: GW, LOOP: LOOP, RUNWAY_LEN: RUNWAY, FINISH: FINISH, PATHLEN: PATHLEN,
    PLANES: PLANES, TRACK: TRACK, RUNWAYS: RUNWAYS, START_IDX: START_IDX,
    HANGARS: HANGARS, HUB: HUB, CROSS: CROSS, SEAT_NAME: SEAT_NAME,
    COLOR_STEP: COLOR_STEP, LANES: LANES, FLY_PATH: FLY_PATH
  };

})(window);
