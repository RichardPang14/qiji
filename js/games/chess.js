/* ════════════════════════════════════════════════════════════
   国际象棋 CHESS
   盘面：8×8，白方在下（第 7 行），黑方在上（第 0 行）
   兵种：1 兵 2 马 3 象 4 车 5 后 6 王（白正黑负）
   规则：完整 FIDE 简化规则 —— 王车易位、吃过路兵、兵升变（自动升后）、
         将死 / 逼和、五十回合和、三次重复局面和。
   座位：0 白方先行，1 黑方
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub, P = Hub.PAL;

  var N = 8, NC = 64;
  var SIDE = ['白方', '黑方'];
  var PN = ['', '兵', '马', '象', '车', '后', '王'];
  var VAL = [0, 100, 320, 330, 500, 900, 20000];

  var KNIGHT_D = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KING_D = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var BISHOP_D = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  var ROOK_D = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  /* 易位权：1 白王翼 2 白后翼 4 黑王翼 8 黑后翼 */
  var INIT_RIGHTS = 15;

  function initBoard() {
    var b = new Int8Array(NC);
    var back = [4, 2, 3, 5, 6, 3, 2, 4], c;
    for (c = 0; c < 8; c++) {
      b[c] = -back[c];
      b[8 + c] = -1;
      b[48 + c] = 1;
      b[56 + c] = back[c];
    }
    return b;
  }

  function Chess(cfg) {
    Hub.Base.call(this, cfg);
    this.reset();
  }
  Chess.prototype = Object.create(Hub.Base.prototype);
  Chess.prototype.constructor = Chess;

  Chess.prototype.reset = function () {
    this.b = initBoard();
    this.turn = 0;
    this.rights = INIT_RIGHTS;
    this.ep = -1;
    this.half = 0;
    this.full = 1;
    this.caps = [[], []];
    this.lastMark = null;
    this.sel = -1;
    this.selMoves = [];
    this.sugg = null;
    this._hover = -1;
    this.history = [];
    this.histKeys = [this.key()];
    this._over = null;
    this.msg = '白方先行。';
  };

  Chess.prototype.seatCount = function () { return 2; };
  Chess.prototype.side = function (v) { return v > 0 ? 0 : 1; };
  Chess.prototype.key = function () {
    return this.b.join('') + '|' + this.turn + '|' + this.rights + '|' + this.ep;
  };
  Chess.prototype.repCount = function () {
    var k = this.key(), n = 0, i;
    for (i = 0; i < this.histKeys.length; i++) if (this.histKeys[i] === k) n++;
    return n;
  };

  /* ───────── 攻击判定 ───────── */
  Chess.prototype.attacked = function (sq, by) {
    var b = this.b, r = (sq / N) | 0, c = sq % N, k, rr, cc, v, d;
    /* 兵 */
    var pr = by === 0 ? r + 1 : r - 1;
    for (k = -1; k <= 1; k += 2) {
      cc = c + k;
      if (pr >= 0 && pr < N && cc >= 0 && cc < N) {
        v = b[pr * N + cc];
        if (v && this.side(v) === by && Math.abs(v) === 1) return true;
      }
    }
    /* 马 */
    for (k = 0; k < 8; k++) {
      rr = r + KNIGHT_D[k][0]; cc = c + KNIGHT_D[k][1];
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
      v = b[rr * N + cc];
      if (v && this.side(v) === by && Math.abs(v) === 2) return true;
    }
    /* 王 */
    for (k = 0; k < 8; k++) {
      rr = r + KING_D[k][0]; cc = c + KING_D[k][1];
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
      v = b[rr * N + cc];
      if (v && this.side(v) === by && Math.abs(v) === 6) return true;
    }
    /* 车/后 */
    for (d = 0; d < 4; d++) {
      rr = r + ROOK_D[d][0]; cc = c + ROOK_D[d][1];
      while (rr >= 0 && rr < N && cc >= 0 && cc < N) {
        v = b[rr * N + cc];
        if (v) {
          if (this.side(v) === by && (Math.abs(v) === 4 || Math.abs(v) === 5)) return true;
          break;
        }
        rr += ROOK_D[d][0]; cc += ROOK_D[d][1];
      }
    }
    /* 象/后 */
    for (d = 0; d < 4; d++) {
      rr = r + BISHOP_D[d][0]; cc = c + BISHOP_D[d][1];
      while (rr >= 0 && rr < N && cc >= 0 && cc < N) {
        v = b[rr * N + cc];
        if (v) {
          if (this.side(v) === by && (Math.abs(v) === 3 || Math.abs(v) === 5)) return true;
          break;
        }
        rr += BISHOP_D[d][0]; cc += BISHOP_D[d][1];
      }
    }
    return false;
  };

  Chess.prototype.kingSq = function (seat) {
    var kv = seat === 0 ? 6 : -6, i;
    for (i = 0; i < NC; i++) if (this.b[i] === kv) return i;
    return -1;
  };
  Chess.prototype.inCheck = function (seat) {
    var k = this.kingSq(seat);
    return k >= 0 && this.attacked(k, 1 - seat);
  };

  /* ───────── 着法生成 ───────── */
  Chess.prototype.pseudoMoves = function (seat) {
    var b = this.b, out = [], i, r, c, k, rr, cc, v, d;
    for (i = 0; i < NC; i++) {
      v = b[i];
      if (!v || this.side(v) !== seat) continue;
      r = (i / N) | 0; c = i % N;
      var t = Math.abs(v);
      if (t === 1) {
        var dir = seat === 0 ? -1 : 1;
        var start = seat === 0 ? 6 : 1;
        var last = seat === 0 ? 0 : 7;
        rr = r + dir;
        if (rr >= 0 && rr < N && b[rr * N + c] === 0) {
          out.push({ f: i, t: rr * N + c, promo: rr === last ? 5 : 0 });
          if (r === start && b[(r + 2 * dir) * N + c] === 0) {
            out.push({ f: i, t: (r + 2 * dir) * N + c, dbl: true });
          }
        }
        for (k = -1; k <= 1; k += 2) {
          cc = c + k;
          if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
          var tv = b[rr * N + cc];
          if (tv && this.side(tv) !== seat) out.push({ f: i, t: rr * N + cc, promo: rr === last ? 5 : 0 });
          else if (!tv && rr * N + cc === this.ep) out.push({ f: i, t: rr * N + cc, ep: true });
        }
      } else if (t === 2 || t === 6) {
        var D = t === 2 ? KNIGHT_D : KING_D;
        for (k = 0; k < 8; k++) {
          rr = r + D[k][0]; cc = c + D[k][1];
          if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
          var w = b[rr * N + cc];
          if (!w || this.side(w) !== seat) out.push({ f: i, t: rr * N + cc });
        }
        if (t === 6) this._castleMoves(seat, i, out);
      } else {
        var DS = t === 3 ? BISHOP_D : (t === 4 ? ROOK_D : BISHOP_D.concat(ROOK_D));
        for (d = 0; d < DS.length; d++) {
          rr = r + DS[d][0]; cc = c + DS[d][1];
          while (rr >= 0 && rr < N && cc >= 0 && cc < N) {
            var u = b[rr * N + cc];
            if (!u) out.push({ f: i, t: rr * N + cc });
            else {
              if (this.side(u) !== seat) out.push({ f: i, t: rr * N + cc });
              break;
            }
            rr += DS[d][0]; cc += DS[d][1];
          }
        }
      }
    }
    return out;
  };

  Chess.prototype._castleMoves = function (seat, ki, out) {
    var b = this.b, opp = 1 - seat;
    if (this.attacked(ki, opp)) return;
    if (seat === 0) {
      if ((this.rights & 1) && b[61] === 0 && b[62] === 0 && b[63] === 4 &&
        !this.attacked(61, opp) && !this.attacked(62, opp)) out.push({ f: ki, t: 62, castle: 'K' });
      if ((this.rights & 2) && b[59] === 0 && b[58] === 0 && b[57] === 0 && b[56] === 4 &&
        !this.attacked(59, opp) && !this.attacked(58, opp)) out.push({ f: ki, t: 58, castle: 'Q' });
    } else {
      if ((this.rights & 4) && b[5] === 0 && b[6] === 0 && b[7] === -4 &&
        !this.attacked(5, opp) && !this.attacked(6, opp)) out.push({ f: ki, t: 6, castle: 'K' });
      if ((this.rights & 8) && b[3] === 0 && b[2] === 0 && b[1] === 0 && b[0] === -4 &&
        !this.attacked(3, opp) && !this.attacked(2, opp)) out.push({ f: ki, t: 2, castle: 'Q' });
    }
  };

  /* ───────── 执行 / 撤销（增量） ───────── */
  Chess.prototype.doMove = function (m) {
    var b = this.b, seat = this.turn, f = m.f, t = m.t;
    var moved = b[f], capV = 0, capSq = -1;
    m._u = {
      rights: this.rights, ep: this.ep, half: this.half, full: this.full,
      movedType: Math.abs(moved)
    };
    if (m.ep) {
      capSq = t + (seat === 0 ? N : -N);
      capV = b[capSq];
      b[capSq] = 0;
    } else if (b[t]) {
      capV = b[t]; capSq = t;
    }
    m._u.capV = capV; m._u.capSq = capSq;

    b[t] = m.promo ? (seat === 0 ? m.promo : -m.promo) : moved;
    b[f] = 0;
    if (m.castle) {
      if (seat === 0) {
        if (m.castle === 'K') { b[61] = b[63]; b[63] = 0; }
        else { b[59] = b[56]; b[56] = 0; }
      } else {
        if (m.castle === 'K') { b[5] = b[7]; b[7] = 0; }
        else { b[3] = b[0]; b[0] = 0; }
      }
    }
    /* 易位权 */
    if (Math.abs(moved) === 6) this.rights &= seat === 0 ? ~3 : ~12;
    if (f === 63 || t === 63) this.rights &= ~1;
    if (f === 56 || t === 56) this.rights &= ~2;
    if (f === 7 || t === 7) this.rights &= ~4;
    if (f === 0 || t === 0) this.rights &= ~8;
    /* 过路兵目标 */
    this.ep = m.dbl ? (f + t) / 2 : -1;
    /* 半步钟 */
    this.half = (Math.abs(moved) === 1 || capV) ? 0 : this.half + 1;
    if (seat === 1) this.full++;
    if (capV) this.caps[seat].push(Math.abs(capV));
    this.turn = 1 - seat;
  };

  Chess.prototype.unMove = function (m) {
    var b = this.b, seat = 1 - this.turn, f = m.f, t = m.t;
    this.turn = seat;
    b[f] = m.promo ? (seat === 0 ? 1 : -1) : b[t];
    b[t] = 0;
    if (m._u.capSq >= 0) b[m._u.capSq] = m._u.capV;
    if (m.castle) {
      if (seat === 0) {
        if (m.castle === 'K') { b[63] = b[61]; b[61] = 0; }
        else { b[56] = b[59]; b[59] = 0; }
      } else {
        if (m.castle === 'K') { b[7] = b[5]; b[5] = 0; }
        else { b[0] = b[3]; b[3] = 0; }
      }
    }
    if (m._u.capV) this.caps[seat].pop();
    if (seat === 1) this.full--;
    this.rights = m._u.rights;
    this.ep = m._u.ep;
    this.half = m._u.half;
    this.full = m._u.full;
  };

  Chess.prototype.legalMoves = function (seat) {
    var ps = this.pseudoMoves(seat), out = [], i;
    for (i = 0; i < ps.length; i++) {
      this.doMove(ps[i]);
      var bad = this.inCheck(seat);
      this.unMove(ps[i]);
      if (!bad) out.push(ps[i]);
    }
    return out;
  };

  /* ───────── 快照 / 悔棋 ───────── */
  Chess.prototype.snapshot = function () {
    return {
      b: this.b.slice(), turn: this.turn, rights: this.rights, ep: this.ep,
      half: this.half, full: this.full, caps: [this.caps[0].slice(), this.caps[1].slice()],
      lastMark: this.lastMark, msg: this.msg, _over: this._over,
      histKeys: this.histKeys.slice()
    };
  };
  Chess.prototype.restore = function (s) {
    this.b = s.b.slice(); this.turn = s.turn; this.rights = s.rights; this.ep = s.ep;
    this.half = s.half; this.full = s.full;
    this.caps = [s.caps[0].slice(), s.caps[1].slice()];
    this.lastMark = s.lastMark; this.msg = s.msg; this._over = s._over || null;
    this.histKeys = s.histKeys.slice();
    this.sel = -1; this.selMoves = []; this.sugg = null;
  };
  Chess.prototype.canUndo = function () { return this.history.length > 0 && !this.thinking; };
  Chess.prototype.undo = function () {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  };

  Chess.prototype.play = function (m) {
    var seat = this.turn;
    this.history.push(this.snapshot());
    this.doMove(m);
    this.histKeys.push(this.key());
    this.lastMark = { f: m.f, t: m.t };
    this.sel = -1; this.selMoves = []; this.sugg = null;
    var chk = this.inCheck(this.turn);
    var note = this.moveText(m, seat) + (chk ? (this.legalMoves(this.turn).length ? '+' : '#') : '');
    this.history[this.history.length - 1].note = note;
    this.msg = SIDE[seat] + '　' + note;
    this.judge();
    if (this._over) this.msg = this._over.title + '　' + note;
    return true;
  };

  Chess.prototype.judge = function () {
    var ms = this.legalMoves(this.turn);
    if (!ms.length) {
      if (this.inCheck(this.turn)) {
        var w = 1 - this.turn;
        this._over = {
          winner: w, title: SIDE[w] + '胜',
          text: SIDE[this.turn] + ' 被将死，对局结束于第 ' + this.full + ' 回合。'
        };
      } else {
        this._over = { winner: null, title: '和局', text: '逼和：轮走方未被将军却无合法着法。' };
      }
      return;
    }
    if (this.half >= 100) {
      this._over = { winner: null, title: '和局', text: '五十回合规则：连续 50 回合无吃子、无兵动。' };
      return;
    }
    if (this.repCount() >= 3) {
      this._over = { winner: null, title: '和局', text: '同一局面第三次出现，判和。' };
    }
  };

  Chess.prototype.resign = function (seat) {
    var w = 1 - seat;
    this._over = {
      winner: w, title: SIDE[w] + '胜',
      text: SIDE[seat] + ' 认输。'
    };
  };

  /* ───────── 记谱 ───────── */
  Chess.prototype.sqName = function (i) {
    return String.fromCharCode(97 + (i % N)) + (N - ((i / N) | 0));
  };
  Chess.prototype.moveText = function (m, seat) {
    if (m.castle) return m.castle === 'K' ? '王翼易位' : '后翼易位';
    var t = (m._u && m._u.movedType) || 1;
    var cap = m._u && m._u.capV ? '×' : '→';
    var txt = PN[t] + ' ' + this.sqName(m.f) + cap + this.sqName(m.t);
    if (m.promo) txt += '＝后';
    if (m.ep) txt += '（过路兵）';
    return txt;
  };

  /* ───────── 界面契约 ───────── */
  Chess.prototype.seat = function () { return this._over ? -1 : this.turn; };
  Chess.prototype.seatName = function (i) { return SIDE[i] || ('第' + (i + 1) + '方'); };
  Chess.prototype.seatFilled = function (i) { return i === 1; };
  Chess.prototype.seatCaptured = function (i) {
    var sum = 0, k;
    for (k = 0; k < this.caps[i].length; k++) sum += VAL[this.caps[i][k]] / 100;
    return '得子 ' + (sum ? ('+' + sum) : '0');
  };
  Chess.prototype.status = function () {
    if (this._over) return '<b>' + this._over.title + '</b>';
    var s = '<b>' + SIDE[this.turn] + '</b> 行棋（第 ' + this.full + ' 回合）';
    if (this.inCheck(this.turn)) s += '　<b style="color:var(--warn)">将军！</b>';
    return s;
  };
  Chess.prototype.hint = function () {
    if (this._over) return '';
    if (this.sel >= 0) {
      if (!this.selMoves.length) return '这枚棋子当前没有合法着法。';
      return '小圆点为可走位，圆圈为可吃子；点目标位落子。';
    }
    return '点选己方棋子再看可走位。王车易位：点王后点车方向的两格目标位。兵到底线自动升后。';
  };
  Chess.prototype.log = function () {
    var out = [], k;
    for (k = 0; k < this.history.length; k++) {
      var h = this.history[k];
      out.push({
        n: (Math.floor(k / 2) + 1) + (k % 2 ? '…' : '.'),
        v: h.note || '',
        hi: k === this.history.length - 1
      });
    }
    return out;
  };
  Chess.prototype.info = function () {
    var h = '<div class="kv"><span>回合</span><span>' + this.full + '</span></div>' +
      '<div class="kv"><span>半步钟</span><span>' + this.half + ' / 100</span></div>' +
      '<div class="kv"><span>重复局面</span><span>' + this.repCount() + ' 次</span></div>';
    h += '<h5>得子</h5>';
    for (var s = 0; s < 2; s++) {
      h += '<div class="kv"><span>' + SIDE[s] + '</span><span>' + this.seatCaptured(s) + '</span></div>';
    }
    h += '<h5>易位权</h5><div style="font-size:11.5px;line-height:1.8">' +
      (this.rights & 1 ? '白王翼 ' : '') + (this.rights & 2 ? '白后翼 ' : '') +
      (this.rights & 4 ? '黑王翼 ' : '') + (this.rights & 8 ? '黑后翼' : '') +
      (this.rights ? '' : '已全部丧失') + '</div>';
    return h;
  };

  /* ───────── 交互 ───────── */
  Chess.prototype.layout = function (w, h) {
    var box = Hub.geom.fit(w, h, 1, 0);
    /* 显示坐标时留出左边与下边的标注位 */
    var margin = this.cfg.coords === false ? .1 : .8;
    this.cell = box.w / (N + margin);
    this.ox = box.x + (margin - .1) * this.cell;
    this.oy = box.y + (box.h - this.cell * N - .3 * this.cell) / 2;
    this.W = w; this.H = h;
  };
  Chess.prototype.px = function (c) { return this.ox + (c + .5) * this.cell; };
  Chess.prototype.py = function (r) { return this.oy + (r + .5) * this.cell; };
  Chess.prototype.pick = function (x, y) {
    if (!this.cell) return null;
    var c = Math.floor((x - this.ox) / this.cell);
    var r = Math.floor((y - this.oy) / this.cell);
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    return { r: r, c: c, i: r * N + c };
  };
  Chess.prototype.pickHint = function (hit) {
    if (!hit || this._over) return false;
    if (this.b[hit.i] && this.side(this.b[hit.i]) === this.turn) return true;
    return this._hasTarget(hit.i);
  };
  Chess.prototype._hasTarget = function (i) {
    for (var k = 0; k < this.selMoves.length; k++) if (this.selMoves[k].t === i) return true;
    return false;
  };
  Chess.prototype.hover = function (hit) { this._hover = hit ? hit.i : -1; };
  Chess.prototype.click = function (hit) {
    if (this._over) return false;
    if (!hit) { this.sel = -1; this.selMoves = []; return false; }
    var i = hit.i, k;
    for (k = 0; k < this.selMoves.length; k++) {
      if (this.selMoves[k].t === i) { this.play(this.selMoves[k]); return true; }
    }
    if (this.b[i] && this.side(this.b[i]) === this.turn) {
      if (this.sel === i) { this.sel = -1; this.selMoves = []; }
      else {
        this.sel = i;
        this.selMoves = this.legalMoves(this.turn).filter(function (m) { return m.f === i; });
        this.sugg = null;
      }
      return false;
    }
    this.sel = -1; this.selMoves = [];
    return false;
  };

  /* ───────── 绘制 ───────── */
  Chess.prototype.draw = function (v) {
    if (!this.cell) return;
    var cell = this.cell, r, c, i;

    for (r = 0; r < N; r++) {
      for (c = 0; c < N; c++) {
        var dark = (r + c) % 2 === 1;
        v.rect(this.ox + c * cell, this.oy + r * cell, cell, cell,
          { fill: dark ? P.wash2 : P.paper });
      }
    }
    v.rect(this.ox, this.oy, cell * N, cell * N, { stroke: P.ink, w: 1.6 });

    /* 坐标 */
    if (this.cfg.coords !== false) {
      for (c = 0; c < N; c++) {
        v.text(String.fromCharCode(97 + c), this.px(c), this.oy + cell * N + cell * .22,
          { size: Math.max(6, cell * .2), color: P.ink4, family: 'monospace' });
      }
      for (r = 0; r < N; r++) {
        v.text(String(N - r), this.ox - cell * .22, this.py(r),
          { size: Math.max(6, cell * .2), color: P.ink4, family: 'monospace' });
      }
    }

    /* 上一手 / 选中 / 悬停 */
    if (this.lastMark) {
      v.rect(this.ox + (this.lastMark.f % N) * cell, this.oy + ((this.lastMark.f / N) | 0) * cell, cell, cell, { fill: P.ink, fillA: .07 });
      v.rect(this.ox + (this.lastMark.t % N) * cell, this.oy + ((this.lastMark.t / N) | 0) * cell, cell, cell, { fill: P.ink, fillA: .10 });
    }
    if (this._hover >= 0 && this.b[this._hover] && this.side(this.b[this._hover]) === this.turn && !this._over) {
      v.rect(this.ox + (this._hover % N) * cell + 1, this.oy + ((this._hover / N) | 0) * cell + 1, cell - 2, cell - 2, { fill: P.ink, fillA: .04 });
    }
    if (this.sel >= 0) {
      v.corners(this.ox + (this.sel % N) * cell + 2, this.oy + ((this.sel / N) | 0) * cell + 2, cell - 4, cell - 4, cell * .22, { w: 1.8 });
    }

    /* 将军标记 */
    if (!this._over && this.inCheck(this.turn)) {
      var kk = this.kingSq(this.turn);
      if (kk >= 0) {
        v.circle(this.px(kk % N), this.py((kk / N) | 0), cell * .44, { stroke: P.warn, w: 2, dash: [4, 3] });
      }
    }

    /* 棋子 */
    for (i = 0; i < NC; i++) {
      if (!this.b[i]) continue;
      this._piece(v, this.px(i % N), this.py((i / N) | 0), cell * .36, Math.abs(this.b[i]), this.b[i] > 0);
    }

    /* 合法着法 */
    if (this.cfg.showMoves !== false && this.sel >= 0) {
      for (i = 0; i < this.selMoves.length; i++) {
        var t = this.selMoves[i].t;
        if (this.b[t]) v.circle(this.px(t % N), this.py((t / N) | 0), cell * .40, { stroke: P.ink, w: 1.6, a: .8 });
        else v.dot(this.px(t % N), this.py((t / N) | 0), Math.max(2, cell * .10), P.ink, .45);
      }
    }

    /* 建议 */
    if (this.sugg && this.sugg.f >= 0) {
      v.arrow(this.px(this.sugg.f % N), this.py((this.sugg.f / N) | 0),
        this.px(this.sugg.t % N), this.py((this.sugg.t / N) | 0),
        { color: P.warn, w: 2, head: Math.max(7, cell * .24) });
    }
  };

  /** 线稿棋子：white=true 为白方（空心），否则黑方（实墨） */
  Chess.prototype._piece = function (v, x, y, r, type, white) {
    var fill = white ? P.paper : P.ink;
    var stroke = P.ink;
    function shape(pts, close) {
      v.polygon(pts, { fill: fill, stroke: stroke, w: 1.2 });
    }
    /* 底座 */
    v.rect(x - r * .62, y + r * .58, r * 1.24, r * .30, { fill: fill, stroke: stroke, w: 1.2, r: r * .1 });
    if (type === 1) {                                   /* 兵 */
      v.circle(x, y - r * .30, r * .34, { fill: fill, stroke: stroke, w: 1.2 });
      shape([[x - r * .40, y + r * .58], [x - r * .18, y + r * .02], [x + r * .18, y + r * .02], [x + r * .40, y + r * .58]]);
    } else if (type === 4) {                            /* 车 */
      shape([[x - r * .44, y + r * .58], [x - r * .36, y - r * .18], [x + r * .36, y - r * .18], [x + r * .44, y + r * .58]]);
      shape([[x - r * .46, y - r * .18], [x - r * .46, y - r * .56], [x - r * .24, y - r * .56], [x - r * .24, y - r * .38],
        [x - r * .10, y - r * .38], [x - r * .10, y - r * .56], [x + r * .10, y - r * .56], [x + r * .10, y - r * .38],
        [x + r * .24, y - r * .38], [x + r * .24, y - r * .56], [x + r * .46, y - r * .56], [x + r * .46, y - r * .18]]);
    } else if (type === 2) {                            /* 马 */
      shape([[x - r * .40, y + r * .58], [x - r * .34, y + r * .10], [x - r * .10, y - r * .30],
        [x + r * .06, y - r * .62], [x + r * .20, y - r * .34], [x + r * .44, y - r * .06],
        [x + r * .40, y + r * .20], [x + r * .16, y + r * .16], [x + r * .34, y + r * .58]]);
      v.circle(x + r * .10, y - r * .34, r * .07, { fill: white ? P.ink : P.paper });
    } else if (type === 3) {                            /* 象 */
      v.circle(x, y - r * .16, r * .38, { fill: fill, stroke: stroke, w: 1.2 });
      v.polygon([[x, y - r * .78], [x - r * .12, y - r * .48], [x + r * .12, y - r * .48]], { fill: fill, stroke: stroke, w: 1 });
      shape([[x - r * .40, y + r * .58], [x - r * .20, y + r * .12], [x + r * .20, y + r * .12], [x + r * .40, y + r * .58]]);
      v.line(x - r * .16, y - r * .30, x + r * .16, y - r * .02, { color: white ? P.ink : P.paper, w: 1.1 });
    } else if (type === 5) {                            /* 后 */
      shape([[x - r * .46, y + r * .58], [x - r * .30, y - r * .18], [x + r * .30, y - r * .18], [x + r * .46, y + r * .58]]);
      var k;
      for (k = -2; k <= 2; k++) {
        var sx = x + k * r * .30, sy = y - r * .18 - (Math.abs(k) === 2 ? r * .30 : (Math.abs(k) === 1 ? r * .44 : r * .52));
        v.line(x + k * r * .22, y - r * .18, sx, sy, { color: stroke, w: 1.2 });
        v.circle(sx, sy, r * .09, { fill: fill, stroke: stroke, w: 1 });
      }
    } else {                                            /* 王 */
      shape([[x - r * .46, y + r * .58], [x - r * .28, y - r * .14], [x + r * .28, y - r * .14], [x + r * .46, y + r * .58]]);
      v.circle(x, y - r * .26, r * .30, { fill: fill, stroke: stroke, w: 1.2 });
      v.line(x, y - r * .78, x, y - r * .40, { color: stroke, w: 1.6 });
      v.line(x - r * .18, y - r * .60, x + r * .18, y - r * .60, { color: stroke, w: 1.6 });
    }
  };

  /* ───────── 大厅图标 ───────── */
  function icon(v, w, h) {
    var n = 4, cell = Math.min(w, h) / (n + .8);
    var ox = (w - cell * n) / 2, oy = (h - cell * n) / 2, r, c;
    for (r = 0; r < n; r++) {
      for (c = 0; c < n; c++) {
        if ((r + c) % 2 === 1) v.rect(ox + c * cell, oy + r * cell, cell, cell, { fill: P.wash2 });
      }
    }
    v.rect(ox, oy, cell * n, cell * n, { stroke: P.ink, w: 1.2 });
    /* 直接画两枚示意棋子 */
    function mini(x, y, rr, type, white) {
      var fill = white ? P.paper : P.ink;
      v.rect(x - rr * .6, y + rr * .55, rr * 1.2, rr * .3, { fill: fill, stroke: P.ink, w: 1, r: rr * .1 });
      if (type === 6) {
        v.circle(x, y - rr * .2, rr * .34, { fill: fill, stroke: P.ink, w: 1.1 });
        v.line(x, y - rr * .82, x, y - rr * .42, { color: P.ink, w: 1.4 });
        v.line(x - rr * .2, y - rr * .62, x + rr * .2, y - rr * .62, { color: P.ink, w: 1.4 });
      } else {
        v.circle(x, y - rr * .32, rr * .34, { fill: fill, stroke: P.ink, w: 1.1 });
        v.polygon([[x - rr * .4, y + rr * .55], [x - rr * .18, y], [x + rr * .18, y], [x + rr * .4, y + rr * .55]],
          { fill: fill, stroke: P.ink, w: 1 });
      }
    }
    mini(ox + cell * 1.0, oy + cell * 2.6, cell * .42, 6, true);
    mini(ox + cell * 2.6, oy + cell * 1.2, cell * .42, 6, false);
  }

  Hub.register({
    id: 'chess',
    name: '国际象棋',
    en: 'CHESS',
    sub: '六兵种协同，将死对方国王',
    tag: '象棋',
    aspect: 1,
    players: 2,
    seatNames: SIDE,
    ai: true,
    options: [
      {
        key: 'coords', label: '坐标', def: true,
        choices: [{ v: true, label: '显示' }, { v: false, label: '隐藏' }]
      },
      {
        key: 'showMoves', label: '可走位', def: true,
        choices: [{ v: true, label: '显示', note: '选子后标点' }, { v: false, label: '隐藏' }]
      }
    ],
    rules: {
      intro: '8×8 盘，白方先行。六兵种各有走法，目标是<b>将死对方国王</b>：令其被将军且无合法着法可解。',
      sections: [
        {
          title: '兵种走法', items: [
            '<b>兵</b>：直进一格（首步可两格），斜吃一格；到底线自动升后。',
            '<b>马</b>：走日字，唯一可越子的兵种。',
            '<b>象</b>：斜线任意格；<b>车</b>：直线任意格；<b>后</b>：直斜皆可。',
            '<b>王</b>：八向一格；不可送入被攻击格。'
          ]
        },
        {
          title: '特殊着法', items: [
            '<b>王车易位</b>：王向车方向走两格（点王再点该目标位），车越过王。需王车未动、之间无子、王不被将军且不经过被攻击格。',
            '<b>吃过路兵</b>：对方兵首步冲两格落在己方兵旁时，可斜进一格吃掉它（仅限紧接着的一手）。',
            '<b>升变</b>：兵到底线自动升为后。'
          ]
        },
        {
          title: '和局', items: [
            '<b>逼和</b>：轮走方未被将军却无合法着法。',
            '<b>五十回合</b>：连续 50 回合无吃子、无兵动。',
            '<b>三次重复</b>：同一局面第三次出现。'
          ]
        },
        {
          title: '盘面记号', items: [
            '深浅相间的棋格；选中棋子套四角框，小圆点为可走位、圆圈为可吃子。',
            '上一手以淡墨底标出起止两格；被将军时国王外套红色虚线圈。',
            '白棋空心、黑棋实墨，造型为线稿兵种图标。'
          ]
        }
      ]
    },
    icon: icon,
    create: function (cfg) { return new Chess(cfg); }
  });

  Hub.Chess = Chess;
  Hub.CH = { N: N, NC: NC, SIDE: SIDE, PN: PN, VAL: VAL, initBoard: initBoard };

})(window);
