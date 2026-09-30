/* ════════════════════════════════════════════════════════════
   中国象棋 XIANGQI —— 完整走子/吃子规则、将军与照面判定、
                        中文着法记谱、线稿盘面绘制
   坐标系：b[r*9+c]，r=0 为黑方底线（上方），r=9 为红方底线（下方）
   子力编码：正数=红方（座位 0），负数=黑方（座位 1）
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub, P = Hub.PAL, U = Hub.util;

  var KING = 1, ADV = 2, BISH = 3, KNIGHT = 4, ROOK = 5, CANNON = 6, PAWN = 7;
  var RED = 0, BLK = 1;

  var NAME_RED = { 1: '帅', 2: '仕', 3: '相', 4: '马', 5: '车', 6: '炮', 7: '兵' };
  var NAME_BLK = { 1: '将', 2: '士', 3: '象', 4: '马', 5: '车', 6: '炮', 7: '卒' };
  var CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

  var ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var KSTEP = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var DSTEP = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
  var ASTEP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  /* 初始局面 */
  var INIT = [
    -5, -4, -3, -2, -1, -2, -3, -4, -5,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, -6, 0, 0, 0, 0, 0, -6, 0,
    -7, 0, -7, 0, -7, 0, -7, 0, -7,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    7, 0, 7, 0, 7, 0, 7, 0, 7,
    0, 6, 0, 0, 0, 0, 0, 6, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    5, 4, 3, 2, 1, 2, 3, 4, 5
  ];

  /* 兵/炮位的定位星记号 */
  var MARKS = [
    [2, 1], [2, 7], [7, 1], [7, 7],
    [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
    [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]
  ];

  /* ─────────────────────────────────────────────── */
  function Xiangqi(cfg) {
    Hub.Base.call(this, cfg);
    this.reset();
  }
  Xiangqi.prototype = Object.create(Hub.Base.prototype);
  Xiangqi.prototype.constructor = Xiangqi;

  Xiangqi.prototype.reset = function () {
    this.b = new Int8Array(INIT);
    this.turn = RED;
    this.history = [];       // [{f,t,cap,text,chk}]
    this.keys = {};          // 局面重复计数
    this.noCap = 0;
    this._over = null;
    this.sel = -1;           // 选中子
    this.selMoves = [];      // 选中子的合法落点
    this.sugg = null;
    this.lastMark = null;
    this._hover = -1;
    this.pushKey();
  };

  /* ───────── 工具 ───────── */
  Xiangqi.prototype.side = function (p) { return p > 0 ? RED : BLK; };
  Xiangqi.prototype.type = function (p) { return p < 0 ? -p : p; };
  Xiangqi.prototype.at = function (r, c) {
    return (r < 0 || r > 9 || c < 0 || c > 8) ? null : this.b[r * 9 + c];
  };
  Xiangqi.prototype.inPalace = function (r, c, side) {
    if (c < 3 || c > 5) return false;
    return side === RED ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2);
  };
  Xiangqi.prototype.ownHalf = function (r, side) {
    return side === RED ? r >= 5 : r <= 4;
  };

  Xiangqi.prototype.kingIdx = function (side) {
    var want = side === RED ? KING : -KING;
    for (var i = 0; i < 90; i++) if (this.b[i] === want) return i;
    return -1;
  };

  /* (r,c) 是否被 by 方攻击 */
  Xiangqi.prototype.attacked = function (r, c, by) {
    var b = this.b, i, p, t, nr, nc, k;

    /* 兵/卒 */
    if (by === RED) {
      if (r + 1 <= 9 && b[(r + 1) * 9 + c] === PAWN) return true;
      if (r <= 4) {
        if (c - 1 >= 0 && b[r * 9 + c - 1] === PAWN) return true;
        if (c + 1 <= 8 && b[r * 9 + c + 1] === PAWN) return true;
      }
    } else {
      if (r - 1 >= 0 && b[(r - 1) * 9 + c] === -PAWN) return true;
      if (r >= 5) {
        if (c - 1 >= 0 && b[r * 9 + c - 1] === -PAWN) return true;
        if (c + 1 <= 8 && b[r * 9 + c + 1] === -PAWN) return true;
      }
    }

    /* 马（反向找攻击源，注意蹩马腿） */
    var want = by === RED ? KNIGHT : -KNIGHT;
    for (i = 0; i < 8; i++) {
      nr = r + KSTEP[i][0]; nc = c + KSTEP[i][1];
      if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
      if (b[nr * 9 + nc] !== want) continue;
      var lr, lc;
      if (Math.abs(KSTEP[i][0]) === 2) { lr = r + KSTEP[i][0] / 2; lc = nc; }
      else { lr = nr; lc = c + KSTEP[i][1] / 2; }
      if (b[lr * 9 + lc] === 0) return true;
    }

    /* 车 / 炮 / 将帅照面 */
    for (i = 0; i < 4; i++) {
      var dr = ORTH[i][0], dc = ORTH[i][1];
      for (k = 1; k <= 9; k++) {
        nr = r + dr * k; nc = c + dc * k;
        if (nr < 0 || nr > 9 || nc < 0 || nc > 8) break;
        p = b[nr * 9 + nc];
        if (p === 0) continue;
        if (this.side(p) === by) {
          t = this.type(p);
          if (t === ROOK || t === KING) return true;
        }
        /* 该子成为炮架，继续向后找炮 */
        for (var k2 = k + 1; k2 <= 9; k2++) {
          var r2 = r + dr * k2, c2 = c + dc * k2;
          if (r2 < 0 || r2 > 9 || c2 < 0 || c2 > 8) break;
          var p2 = b[r2 * 9 + c2];
          if (p2 === 0) continue;
          if (this.side(p2) === by && this.type(p2) === CANNON) return true;
          break;
        }
        break;
      }
    }
    return false;
  };

  Xiangqi.prototype.inCheck = function (side) {
    var ki = this.kingIdx(side);
    if (ki < 0) return true;
    return this.checkAt(ki, side);
  };

  /* 已知将/帅位置时的将军判定（搜索热路径专用） */
  Xiangqi.prototype.checkAt = function (ki, side) {
    return this.attacked((ki / 9) | 0, ki % 9, 1 - side);
  };

  /* ───────── 着法生成 ───────── */
  /* 伪合法着法，打包为 f*90+t */
  Xiangqi.prototype.genPseudo = function (side, out) {
    out = out || [];
    var b = this.b, i, p, r, c, k, nr, nc, t;
    for (i = 0; i < 90; i++) {
      p = b[i];
      if (p === 0 || this.side(p) !== side) continue;
      r = (i / 9) | 0; c = i % 9;
      t = this.type(p);

      if (t === ROOK || t === CANNON) {
        for (k = 0; k < 4; k++) {
          var dr = ORTH[k][0], dc = ORTH[k][1];
          var screen = false;
          for (var s = 1; s <= 9; s++) {
            nr = r + dr * s; nc = c + dc * s;
            if (nr < 0 || nr > 9 || nc < 0 || nc > 8) break;
            var q = b[nr * 9 + nc];
            if (!screen) {
              /* 未遇到炮架前，车与炮均可自由走到任意空点 */
              if (q === 0) { out.push(i * 90 + nr * 9 + nc); }
              else {
                if (t === CANNON) screen = true;              // 炮：首个阻挡子成为炮架
                else { if (this.side(q) !== side) out.push(i * 90 + nr * 9 + nc); break; }
              }
            } else {
              if (q === 0) continue;
              if (this.side(q) !== side) out.push(i * 90 + nr * 9 + nc);
              break;
            }
          }
        }
      } else if (t === KNIGHT) {
        for (k = 0; k < 8; k++) {
          nr = r + KSTEP[k][0]; nc = c + KSTEP[k][1];
          if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
          var lr, lc;
          if (Math.abs(KSTEP[k][0]) === 2) { lr = r + KSTEP[k][0] / 2; lc = c; }
          else { lr = r; lc = c + KSTEP[k][1] / 2; }
          if (b[lr * 9 + lc] !== 0) continue;                 // 蹩马腿
          var d1 = b[nr * 9 + nc];
          if (d1 === 0 || this.side(d1) !== side) out.push(i * 90 + nr * 9 + nc);
        }
      } else if (t === KING) {
        for (k = 0; k < 4; k++) {
          nr = r + ORTH[k][0]; nc = c + ORTH[k][1];
          if (!this.inPalace(nr, nc, side)) continue;
          var d2 = b[nr * 9 + nc];
          if (d2 === 0 || this.side(d2) !== side) out.push(i * 90 + nr * 9 + nc);
        }
      } else if (t === ADV) {
        for (k = 0; k < 4; k++) {
          nr = r + ASTEP[k][0]; nc = c + ASTEP[k][1];
          if (!this.inPalace(nr, nc, side)) continue;
          var d3 = b[nr * 9 + nc];
          if (d3 === 0 || this.side(d3) !== side) out.push(i * 90 + nr * 9 + nc);
        }
      } else if (t === BISH) {
        for (k = 0; k < 4; k++) {
          nr = r + DSTEP[k][0]; nc = c + DSTEP[k][1];
          if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
          if (!this.ownHalf(nr, side)) continue;              // 不过河
          var er = r + DSTEP[k][0] / 2, ec = c + DSTEP[k][1] / 2;
          if (b[er * 9 + ec] !== 0) continue;                 // 塞象眼
          var d4 = b[nr * 9 + nc];
          if (d4 === 0 || this.side(d4) !== side) out.push(i * 90 + nr * 9 + nc);
        }
      } else if (t === PAWN) {
        var fwd = side === RED ? -1 : 1;
        var crossed = side === RED ? r <= 4 : r >= 5;
        var tries = [[fwd, 0]];
        if (crossed) { tries.push([0, -1]); tries.push([0, 1]); }
        for (k = 0; k < tries.length; k++) {
          nr = r + tries[k][0]; nc = c + tries[k][1];
          if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
          var d5 = b[nr * 9 + nc];
          if (d5 === 0 || this.side(d5) !== side) out.push(i * 90 + nr * 9 + nc);
        }
      }
    }
    return out;
  };

  Xiangqi.prototype.legalMoves = function (side, from) {
    var ps = this.genPseudo(side);
    var out = [], b = this.b, i, f, t, cap;
    var ki = this.kingIdx(side);
    var kingVal = side === RED ? KING : -KING;
    if (ki < 0) return out;
    for (i = 0; i < ps.length; i++) {
      f = (ps[i] / 90) | 0; t = ps[i] % 90;
      if (from != null && f !== from) continue;
      cap = b[t];
      var isKing = b[f] === kingVal;
      b[t] = b[f]; b[f] = 0;
      /* 走的是将帅则王位变为 t，否则王位不变，免去重复扫盘 */
      if (!this.checkAt(isKing ? t : ki, side)) out.push(ps[i]);
      b[f] = b[t]; b[t] = cap;
    }
    return out;
  };

  Xiangqi.prototype.movesFrom = function (idx) {
    if (idx < 0 || this.b[idx] === 0) return [];
    return this.legalMoves(this.side(this.b[idx]), idx);
  };

  /* ───────── 执行 / 撤销（底层，供搜索复用） ───────── */
  Xiangqi.prototype.doMove = function (mv) {
    var f = (mv / 90) | 0, t = mv % 90;
    var cap = this.b[t];
    this.b[t] = this.b[f];
    this.b[f] = 0;
    this.turn = 1 - this.turn;
    return cap;
  };
  Xiangqi.prototype.unMove = function (mv, cap) {
    var f = (mv / 90) | 0, t = mv % 90;
    this.turn = 1 - this.turn;
    this.b[f] = this.b[t];
    this.b[t] = cap;
  };

  /* ───────── 局面指纹（重复局面判定） ───────── */
  Xiangqi.prototype.posKey = function () {
    var s = '', i;
    for (i = 0; i < 90; i++) s += (this.b[i] + 8).toString(36);
    return s + '|' + this.turn;
  };
  Xiangqi.prototype.pushKey = function () {
    var k = this.posKey();
    this.keys[k] = (this.keys[k] || 0) + 1;
    return this.keys[k];
  };
  Xiangqi.prototype.popKey = function () {
    var k = this.posKey();
    if (this.keys[k] != null) this.keys[k]--;
  };

  /* ───────── 对局层面的落子 ───────── */
  Xiangqi.prototype.play = function (mv) {
    var f = (mv / 90) | 0, t = mv % 90;
    var text = this.moveText(f, t);
    var cap = this.doMove(mv);
    if (cap !== 0) this.noCap = 0; else this.noCap++;
    var chk = this.inCheck(this.turn);
    this.history.push({ f: f, t: t, cap: cap, text: text, chk: chk });
    this.lastMark = { f: f, t: t };
    this.sel = -1; this.selMoves = []; this.sugg = null;
    var rep = this.pushKey();
    this.judge(chk, rep);
    return true;
  };

  Xiangqi.prototype.judge = function (chk, rep) {
    var ms = this.legalMoves(this.turn);
    if (!ms.length) {
      var loser = this.turn;
      /* 自行判定是否被将：将死与困毙的文案不同，不能依赖入参 */
      var checked = this.inCheck(loser);
      this._over = {
        winner: 1 - loser,
        title: this.seatName(1 - loser) + '胜',
        text: checked ? '绝杀无解，' + this.seatName(loser) + '被将死。'
          : this.seatName(loser) + '无子可动（困毙）。'
      };
      return;
    }
    var times = (rep == null) ? (this.keys[this.posKey()] || 0) : rep;
    if (times >= 3) {
      this._over = { winner: null, title: '和局', text: '同一局面第三次出现，判和（长将长捉按规应负，此处从简）。' };
      return;
    }
    if (this.noCap >= 120) {
      this._over = { winner: null, title: '和局', text: '连续 60 回合无吃子，判和。' };
      return;
    }
    /* 双方均无进攻子力 */
    if (!this.hasAttacker(RED) && !this.hasAttacker(BLK)) {
      this._over = { winner: null, title: '和局', text: '双方均无车马炮兵可攻，判和。' };
    }
  };

  Xiangqi.prototype.hasAttacker = function (side) {
    for (var i = 0; i < 90; i++) {
      var p = this.b[i];
      if (p === 0 || this.side(p) !== side) continue;
      var t = this.type(p);
      if (t === ROOK || t === CANNON || t === KNIGHT || t === PAWN) return true;
    }
    return false;
  };

  Xiangqi.prototype.undo = function () {
    if (!this.history.length) return false;
    var step = this.history.pop();
    this.popKey();
    this.unMove(step.f * 90 + step.t, step.cap);
    if (step.cap !== 0) { /* noCap 需要重算，简化处理：按剩余历史重新统计 */ }
    this.noCap = 0;
    for (var i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].cap !== 0) break;
      this.noCap++;
    }
    this._over = null;
    this.sel = -1; this.selMoves = []; this.sugg = null;
    this.lastMark = this.history.length
      ? { f: this.history[this.history.length - 1].f, t: this.history[this.history.length - 1].t }
      : null;
    return true;
  };

  Xiangqi.prototype.canUndo = function () { return this.history.length > 0 && !this.thinking; };

  /* 当前是否为初始局面（开局库仅在标准开局生效） */
  Xiangqi.prototype.isInitialPosition = function () {
    for (var i = 0; i < 90; i++) if (this.b[i] !== INIT[i]) return false;
    return true;
  };

  Xiangqi.prototype.resign = function (seat) {
    this._over = { winner: 1 - seat, title: this.seatName(1 - seat) + '胜', text: this.seatName(seat) + ' 认输。' };
  };

  /* ───────── 中文着法记谱 ───────── */
  Xiangqi.prototype.pieceName = function (p) {
    return (p > 0 ? NAME_RED : NAME_BLK)[this.type(p)];
  };

  Xiangqi.prototype.fileNo = function (side, c) { return side === RED ? 9 - c : c + 1; };
  Xiangqi.prototype.fileStr = function (side, c) {
    var n = this.fileNo(side, c);
    return side === RED ? CN[n] : String(n);
  };

  Xiangqi.prototype.moveText = function (f, t) {
    var b = this.b, p = b[f];
    if (!p) return '—';
    var side = this.side(p), ty = this.type(p);
    var fr = (f / 9) | 0, fc = f % 9, tr = (t / 9) | 0, tc = t % 9;

    /* 同线同种的重复子：前/中/后 */
    var same = [], i;
    for (i = 0; i < 90; i++) if (b[i] === p && (i % 9) === fc) same.push(i);
    var head;
    if (same.length >= 2) {
      same.sort(function (x, y) { return x - y; });   // 行号升序
      var pos = same.indexOf(f);
      var front = side === RED ? 0 : same.length - 1;  // 红方行号小者为前
      var tag;
      if (same.length === 2) tag = (pos === front) ? '前' : '后';
      else if (same.length === 3) tag = ['前', '中', '后'][side === RED ? pos : 2 - pos];
      else tag = ['前', '二', '三', '后'][U.clamp(side === RED ? pos : same.length - 1 - pos, 0, 3)];
      head = tag + this.pieceName(p);
    } else {
      head = this.pieceName(p) + this.fileStr(side, fc);
    }

    var fwd = side === RED ? (tr < fr) : (tr > fr);
    var diag = (ty === KNIGHT || ty === BISH || ty === ADV);
    var act, tail;
    if (diag) {
      /* 马相仕斜行，路数必变，但记谱用进/退 + 目标路数 */
      act = fwd ? '进' : '退';
      tail = this.fileStr(side, tc);
    } else if (fc === tc) {
      act = fwd ? '进' : '退';
      var steps = Math.abs(tr - fr);
      tail = side === RED ? CN[steps] : String(steps);
    } else {
      act = '平';
      tail = this.fileStr(side, tc);
    }
    return head + act + tail;
  };

  /* ───────── 界面契约 ───────── */
  Xiangqi.prototype.seat = function () { return this._over ? -1 : this.turn; };
  Xiangqi.prototype.seatName = function (i) { return i === RED ? '红方' : '黑方'; };

  Xiangqi.prototype.seatCaptured = function (i) {
    /* 座位 i 吃掉了对方的子 */
    var list = [], k;
    for (k = 0; k < this.history.length; k++) {
      var cap = this.history[k].cap;
      if (cap === 0) continue;
      var mover = 1 - this.side(cap);
      if (mover === i) list.push(this.pieceName(cap));
    }
    return list.length ? list.join(' ') : '';
  };

  Xiangqi.prototype.status = function () {
    if (this._over) return '<b>' + this._over.title + '</b>';
    var n = this.seatName(this.turn);
    var s = '<b>' + n + '</b> 走棋';
    if (this.inCheck(this.turn)) s += ' · <span style="color:#a02020">将军！</span>';
    return s;
  };

  Xiangqi.prototype.hint = function () {
    if (this._over) return '';
    if (this.sel >= 0) return '已选「' + this.pieceName(this.b[this.sel]) + '」，点击标记处落子；再点该子可取消。';
    return '点选己方棋子，盘上圈出全部合法落点。';
  };

  Xiangqi.prototype.log = function () {
    var h = this.history, out = [], i;
    for (i = 0; i < h.length; i += 2) {
      var n = (i / 2 + 1) + '.';
      var v = h[i].text + (h[i].chk ? ' 将' : '');
      if (h[i + 1]) v += '   ' + h[i + 1].text + (h[i + 1].chk ? ' 将' : '');
      out.push({ n: n, v: v, hi: i + 2 >= h.length });
    }
    return out;
  };

  Xiangqi.prototype.info = function () {
    var cnt = { r: 0, b: 0 }, i, p;
    for (i = 0; i < 90; i++) { p = this.b[i]; if (!p) continue; if (p > 0) cnt.r++; else cnt.b++; }
    var h = '<div class="kv"><span>回合</span><span>' + (Math.floor(this.history.length / 2) + 1) + '</span></div>' +
      '<div class="kv"><span>红方存子</span><span>' + cnt.r + '</span></div>' +
      '<div class="kv"><span>黑方存子</span><span>' + cnt.b + '</span></div>' +
      '<div class="kv"><span>无吃子着数</span><span>' + this.noCap + '</span></div>';
    if (this.inCheck(this.turn) && !this._over) {
      h += '<h5>提示</h5><div style="color:var(--warn)">当前一方被将军，必须应将。</div>';
    }
    return h;
  };

  /* ───────── 交互 ───────── */
  Xiangqi.prototype.layout = function (w, h) {
    var cw = w / (8 + 1.5), ch = h / (9 + 1.3);
    this.cell = Math.min(cw, ch);
    this.ox = (w - this.cell * 8) / 2;
    this.oy = (h - this.cell * 9) / 2;
    this.W = w; this.H = h;
    this.R = this.cell * .435;
  };
  Xiangqi.prototype.px = function (c) { return this.ox + c * this.cell; };
  Xiangqi.prototype.py = function (r) { return this.oy + r * this.cell; };

  Xiangqi.prototype.pick = function (x, y) {
    if (!this.cell) return null;
    var c = Math.round((x - this.ox) / this.cell);
    var r = Math.round((y - this.oy) / this.cell);
    if (r < 0 || r > 9 || c < 0 || c > 8) return null;
    var dx = x - this.px(c), dy = y - this.py(r);
    if (dx * dx + dy * dy > Math.pow(this.cell * .5, 2)) return null;
    return { r: r, c: c, i: r * 9 + c };
  };
  Xiangqi.prototype.pickHint = function (hit) {
    if (!hit || this._over) return false;
    var p = this.b[hit.i];
    if (p && this.side(p) === this.turn) return true;
    return this._hasTarget(hit.i);
  };
  Xiangqi.prototype._hasTarget = function (i) {
    for (var k = 0; k < this.selMoves.length; k++) if (this.selMoves[k] % 90 === i) return true;
    return false;
  };

  Xiangqi.prototype.hover = function (hit) { this._hover = hit ? hit.i : -1; };

  Xiangqi.prototype.click = function (hit) {
    if (this._over) return false;
    if (!hit) { this.sel = -1; this.selMoves = []; return false; }
    var i = hit.i, p = this.b[i];

    if (this.sel >= 0 && this._hasTarget(i)) {
      var mv = -1;
      for (var k = 0; k < this.selMoves.length; k++) if (this.selMoves[k] % 90 === i) mv = this.selMoves[k];
      this.play(mv);
      return true;
    }
    if (p && this.side(p) === this.turn) {
      if (this.sel === i) { this.sel = -1; this.selMoves = []; }
      else { this.sel = i; this.selMoves = this.movesFrom(i); this.sugg = null; }
      return false;
    }
    this.sel = -1; this.selMoves = [];
    return false;
  };

  /* ───────── 绘制 ───────── */
  Xiangqi.prototype.draw = function (v) {
    var cell = this.cell, c, r, i;
    var x0 = this.px(0), x8 = this.px(8), y0 = this.py(0), y9 = this.py(9);

    /* 外框（双线，线稿棋盘的收边） */
    v.rect(x0 - cell * .12, y0 - cell * .12, (x8 - x0) + cell * .24, (y9 - y0) + cell * .24,
      { stroke: P.ink, w: 1.5 });
    v.rect(x0 - cell * .28, y0 - cell * .28, (x8 - x0) + cell * .56, (y9 - y0) + cell * .56,
      { stroke: P.ink, w: .8, a: .5 });

    /* 横线 */
    for (r = 0; r <= 9; r++) v.line(x0, this.py(r), x8, this.py(r), { w: r === 0 || r === 9 ? 1.3 : .9, a: .9 });
    /* 竖线（边线贯通，内线被河界断开） */
    for (c = 0; c <= 8; c++) {
      if (c === 0 || c === 8) v.line(this.px(c), y0, this.px(c), y9, { w: .9, a: .9 });
      else {
        v.line(this.px(c), y0, this.px(c), this.py(4), { w: .9, a: .9 });
        v.line(this.px(c), this.py(5), this.px(c), y9, { w: .9, a: .9 });
      }
    }
    /* 九宫斜线 */
    v.line(this.px(3), this.py(0), this.px(5), this.py(2), { w: .9, a: .9 });
    v.line(this.px(5), this.py(0), this.px(3), this.py(2), { w: .9, a: .9 });
    v.line(this.px(3), this.py(7), this.px(5), this.py(9), { w: .9, a: .9 });
    v.line(this.px(5), this.py(7), this.px(3), this.py(9), { w: .9, a: .9 });

    /* 定位星 */
    for (i = 0; i < MARKS.length; i++) this._mark(v, MARKS[i][0], MARKS[i][1]);

    /* 楚河 汉界 */
    var ry = (this.py(4) + this.py(5)) / 2;
    var fs = Math.max(9, cell * .34);
    v.text('楚  河', this.px(2), ry, { size: fs, color: P.ink3, alpha: .55, family: '"Kaiti SC","STKaiti","KaiTi",serif', tracking: cell * .1 });
    v.text('漢  界', this.px(6), ry, { size: fs, color: P.ink3, alpha: .55, family: '"Kaiti SC","STKaiti","KaiTi",serif', tracking: cell * .1 });

    /* 坐标 */
    if (this.cfg.coords !== false) {
      var cs = Math.max(7, cell * .24);
      for (c = 0; c <= 8; c++) {
        v.text(CN[9 - c], this.px(c), y9 + cell * .5, { size: cs, color: P.ink4, family: '"Kaiti SC","STKaiti","KaiTi",serif' });
        v.text(String(c + 1), this.px(c), y0 - cell * .5, { size: cs, color: P.ink4, family: 'monospace' });
      }
    }

    /* 上一手轨迹 */
    if (this.lastMark) {
      var lf = this.lastMark.f, lt = this.lastMark.t;
      v.line(this.px(lf % 9), this.py((lf / 9) | 0), this.px(lt % 9), this.py((lt / 9) | 0),
        { color: P.ink, w: 1, a: .2, dash: [4, 4] });
      var ms = cell * .55;
      v.rect(this.px(lt % 9) - ms, this.py((lt / 9) | 0) - ms, ms * 2, ms * 2,
        { stroke: P.ink3, w: 1, dash: [3, 3], a: .95 });
    }

    /* 合法落点 */
    if (this.cfg.showMoves !== false) {
      for (i = 0; i < this.selMoves.length; i++) {
        var ti = this.selMoves[i] % 90;
        var tr = (ti / 9) | 0, tc = ti % 9;
        if (this.b[ti] !== 0) {
          this._cornersAt(v, tr, tc, .52, P.warn, 1.4);      // 可吃子
        } else {
          v.dot(this.px(tc), this.py(tr), Math.max(2, cell * .075), P.ink, .45);
        }
      }
    }

    /* 被将军的帅/将 */
    if (!this._over && this.inCheck(this.turn)) {
      var ki = this.kingIdx(this.turn);
      if (ki >= 0) {
        v.circle(this.px(ki % 9), this.py((ki / 9) | 0), this.R * 1.16,
          { stroke: P.warn, w: 1.4, dash: [3, 3], a: .95 });
      }
    }

    /* 棋子 */
    for (i = 0; i < 90; i++) {
      var p = this.b[i];
      if (!p) continue;
      r = (i / 9) | 0; c = i % 9;
      v.disc(this.px(c), this.py(r), this.R, {
        filled: p < 0,
        label: this.pieceName(p),
        size: this.R * 1.04,
        ringK: .84,
        w: 1.25
      });
    }

    /* 选中 / 悬停 */
    if (this.sel >= 0 && this.b[this.sel] !== 0) {
      var sr = (this.sel / 9) | 0, sc = this.sel % 9;
      v.circle(this.px(sc), this.py(sr), this.R * 1.16, { stroke: P.ink, w: 1.7 });
      this._cornersAt(v, sr, sc, .62, P.ink, 1.6);
    } else if (this._hover >= 0 && this.b[this._hover] && this.side(this.b[this._hover]) === this.turn && !this._over) {
      var hr = (this._hover / 9) | 0, hc = this._hover % 9;
      v.circle(this.px(hc), this.py(hr), this.R * 1.14, { stroke: P.ink3, w: 1, a: .7 });
    }

    /* 提示 */
    if (this.sugg) {
      v.circle(this.px(this.sugg.f % 9), this.py((this.sugg.f / 9) | 0), this.R * 1.3,
        { stroke: P.ink, w: 1.2, dash: [3, 3], a: .8 });
      v.arrow(
        this.px(this.sugg.f % 9), this.py((this.sugg.f / 9) | 0),
        this.px(this.sugg.t % 9), this.py((this.sugg.t / 9) | 0),
        { color: P.warn, w: 1.6, head: Math.max(6, cell * .18), a: .85 }
      );
    }
  };

  /* 定位星：四角短折线 */
  Xiangqi.prototype._mark = function (v, r, c) {
    var g = this.cell * .1, l = this.cell * .22, x = this.px(c), y = this.py(r);
    var sides = (c === 0) ? [1] : (c === 8) ? [-1] : [-1, 1];
    for (var s = 0; s < sides.length; s++) {
      var dx = sides[s] * g;
      v.polyline([[x + dx, y + g + l], [x + dx, y + g], [x + dx + sides[s] * l, y + g]], { w: .85, a: .8 });
      v.polyline([[x + dx, y - g - l], [x + dx, y - g], [x + dx + sides[s] * l, y - g]], { w: .85, a: .8 });
    }
  };

  Xiangqi.prototype._cornersAt = function (v, r, c, k, color, w) {
    var s = this.cell * k;
    v.corners(this.px(c) - s, this.py(r) - s, s * 2, s * 2, s * .38, { color: color, w: w });
  };

  Hub.Xiangqi = Xiangqi;
  Hub.XQ = { KING: KING, ADV: ADV, BISH: BISH, KNIGHT: KNIGHT, ROOK: ROOK, CANNON: CANNON, PAWN: PAWN, RED: RED, BLK: BLK };

  /* ───────── 大厅图标 ───────── */
  function icon(v, w, h) {
    var cols = 4, rows = 4;
    var pad = Math.min(w, h) * .16;
    var cell = Math.min((w - pad * 2) / (cols - 1), (h - pad * 2) / (rows - 1));
    var ox = (w - cell * (cols - 1)) / 2, oy = (h - cell * (rows - 1)) / 2;
    var i;
    for (i = 0; i < rows; i++) v.line(ox, oy + i * cell, ox + cell * (cols - 1), oy + i * cell, { color: P.ruleSoft, w: .8 });
    for (i = 0; i < cols; i++) v.line(ox + i * cell, oy, ox + i * cell, oy + cell * (rows - 1), { color: P.ruleSoft, w: .8 });
    v.line(ox + cell, oy, ox + cell * 2, oy + cell, { color: P.ruleSoft, w: .7 });
    v.line(ox + cell * 2, oy, ox + cell, oy + cell, { color: P.ruleSoft, w: .7 });
    var R = cell * .4;
    v.disc(ox + cell * 2, oy, R, { filled: true, label: '将', size: R * 1.05 });
    v.disc(ox, oy + cell * 3, R, { filled: false, label: '車', size: R * 1.05 });
    v.disc(ox + cell * 2, oy + cell * 2, R, { filled: false, label: '馬', size: R * 1.05 });
  }

  /* ───────── 注册 ───────── */
  Hub.register({
    id: 'xiangqi',
    name: '中国象棋',
    en: 'XIANGQI',
    sub: '九路十行，楚河汉界，擒王为胜',
    tag: '象棋',
    aspect: (8 + 1.5) / (9 + 1.3),
    players: 2,
    seatNames: ['红方', '黑方'],
    ai: true,
    options: [
      {
        key: 'coords', label: '坐标', def: true,
        choices: [{ v: true, label: '显示' }, { v: false, label: '隐藏' }],
        note: '下方为红方路数（九至一），上方为黑方路数（1 至 9）。'
      },
      {
        key: 'showMoves', label: '落点提示', def: true,
        choices: [{ v: true, label: '显示' }, { v: false, label: '隐藏' }],
        note: '选子后是否在盘上标出全部合法落点。'
      }
    ],
    rules: {
      intro: '红方先行，双方轮流走一步。目标是把对方的<b>将（帅）</b>将死——即令其被将军且无任何合法着法可解。棋盘九路十行，中间以「楚河汉界」分隔，双方各有九宫与三个陷阱位无关的士象防线。',
      sections: [
        {
          title: '棋子走法', items: [
            '<b>将 / 帅</b>：九宫内直行一格，且两将不得在同一路上无子相隔直接照面。',
            '<b>士 / 仕</b>：九宫内斜行一格。',
            '<b>象 / 相</b>：斜行两格（走「田」），不可过河；田字中心有子即「塞象眼」不能走。',
            '<b>马</b>：走「日」字；日字第一步的直邻点有子即「蹩马腿」不能走。',
            '<b>车</b>：直线任意格，不可越子。',
            '<b>炮</b>：走法同车；但<b>吃子必须隔一个棋</b>（炮架），且只能隔一个。',
            '<b>兵 / 卒</b>：未过河只能直进一格；过河后可直进或横移一格，永远不能后退。'
          ]
        },
        {
          title: '胜负与和局', items: [
            '<b>将死</b>：一方被将军且无合法着法可解，判负。',
            '<b>困毙</b>：未被将军但无任何合法着法，同样判负（象棋规则）。',
            '<b>和局</b>：同一局面第三次出现、连续 60 回合无吃子、或双方均无车马炮兵可攻。',
            '长将长捉按正式规则应由该方变着否则判负，本实现从简统一判和。'
          ]
        },
        {
          title: '盘面记号', items: [
            '<b>墨底白字</b>为黑方，<b>白底墨字</b>为红方；选中的子外加方框与四角记号。',
            '小圆点为可走空位，<b>红色四角框</b>为可吃的敌子。',
            '被将军时，将（帅）外圈以红色虚线示警。',
            '虚线为上一手的移动轨迹；「提示」按钮会画出电脑建议的箭头。'
          ]
        },
        {
          title: '记谱', items: [
            '着法记于右侧「记录」栏，格式为<b>子名 + 路数 + 进/退/平 + 目标</b>，如「炮二平五」「马8进7」。',
            '红方路数用汉字（右起一至九），黑方用阿拉伯数字（右起 1 至 9），各自以本方视角计数。',
            '同一路有两枚同种棋子时以「前」「后」区分，如「前马进六」。',
            '将军在着法后附「将」字。'
          ]
        }
      ]
    },
    icon: icon,
    create: function (cfg) { return new Xiangqi(cfg); }
  });

})(window);
