/* ════════════════════════════════════════════════════════════
   flight-ai.js —— 飞行器电脑决策
   骰点本身是随机的，电脑的棋力体现在「这一手该动哪架飞机」：
     撞击对方 > 抵达终点 > 起飞出动 > 推进 > 进入安全归航段 > 避开被撞
   三档：入门 = 随机选一架；进阶 = 按分值加权随机；高手 = 取分值最高
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub;
  var Flight = Hub.Flight, F = Hub.FL;
  var LOOP = F.LOOP, PLANES = F.PLANES, FINISH = F.FINISH;

  /* 各分值的相对权重（经手工对局调校） */
  var W_CAPTURE = 110;      // 击落对方一架
  var W_FINISH = 95;        // 抵达终点
  var W_LAUNCH = 38;        // 从停机坪起飞
  var W_RUNWAY = 24;        // 进入归航跑道（不可被撞击）
  var W_PROGRESS = 1.1;     // 每推进一格
  var W_RISK = 26;          // 落点可能被对方下一手撞击

  /** 评估「seat 方用 d 点移动第 p 架」的收益 */
  Flight.prototype._scoreMove = function (seat, p, d) {
    var idx = this.pos[seat][p];
    var to = (idx === -1) ? 0 : this.destOf(idx, d);
    var v = 0, s2, q;

    if (idx === -1) v += W_LAUNCH;
    v += to * W_PROGRESS;
    if (to === FINISH) v += W_FINISH;
    else if (to >= LOOP) v += W_RUNWAY;

    var li = this.loopIndex(seat, to);
    if (li < 0) return v;                    // 落在归航段，绝对安全

    /* 撞击收益 */
    for (s2 = 0; s2 < 4; s2++) {
      if (s2 === seat) continue;
      for (q = 0; q < PLANES; q++) {
        if (this.loopIndex(s2, this.pos[s2][q]) === li) v += W_CAPTURE;
      }
    }
    /* 被撞风险：对方任一在途飞机与本落点相距 1–6 格 */
    for (s2 = 0; s2 < 4; s2++) {
      if (s2 === seat) continue;
      for (q = 0; q < PLANES; q++) {
        var ol = this.loopIndex(s2, this.pos[s2][q]);
        if (ol < 0) continue;
        var gap = (li - ol + LOOP) % LOOP;
        if (gap >= 1 && gap <= 6) v -= W_RISK;
      }
    }
    return v;
  };

  /** 从当前可动飞机里挑一架 */
  Flight.prototype._choose = function (level) {
    var seat = this.turn, d = this.dice, list = this.movable;
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];

    /* 入门：完全随机，等于乱走 */
    if (level === 1) return list[(Math.random() * list.length) | 0];

    var scored = [], k;
    for (k = 0; k < list.length; k++) {
      scored.push({ p: list[k], v: this._scoreMove(seat, list[k], d) });
    }

    /* 进阶：按分值加权随机，多数时候走对，偶尔失着 */
    if (level === 2) {
      var mx = -Infinity;
      for (k = 0; k < scored.length; k++) if (scored[k].v > mx) mx = scored[k].v;
      var pool = scored.map(function (e) { return { p: e.p, v: e.v - mx + 60 }; });
      var pick = Hub.search.weighted(pool, 3.0);
      return pick ? pick.p : scored[0].p;
    }

    /* 高手：取最高分，并列时偏向编号小的飞机（稳定可复现） */
    scored.sort(function (a, b) { return (b.v - a.v) || (a.p - b.p); });
    this._lastScore = scored[0].v;
    return scored[0].p;
  };

  /* ───────── 对外接口 ───────── */
  Flight.prototype.aiMove = function (level) {
    if (this._over) return false;

    if (this.phase === 'roll') {
      this.roll();
      if (this._over) return true;
      /* 掷 6 但无可动飞机时 phase 仍为 roll，交回 pump 继续掷 */
      if (this.phase !== 'move') return true;
    }

    var p = this._choose(level);
    if (p == null) return false;
    return this.movePlane(this.turn, p);
  };

  Flight.prototype.suggest = function (level) {
    if (this._over) { Hub.App.toast('对局已结束'); return null; }
    if (this.phase !== 'move') { Hub.App.toast('请先掷骰子'); return null; }
    var p = this._choose(level == null ? 3 : level);
    if (p == null) { Hub.App.toast('无可动飞机'); return null; }
    var idx = this.pos[this.turn][p];
    var to = (idx === -1) ? 0 : this.destOf(idx, this.dice);
    this.sugg = { p: p, to: to };
    Hub.App.toast('建议：' + (this.turn + 1) + ' 号方 ' + (p + 1) + ' 号机' +
      (idx === -1 ? ' 起飞' : '走 ' + this.dice + ' 格') +
      (to === FINISH ? '（抵达终点）' : '') +
      (typeof this._lastScore === 'number' ? '，评分 ' + Math.round(this._lastScore) : ''));
    return this.sugg;
  };
  Flight.prototype.clearSuggestion = function () { this.sugg = null; };

})(window);
