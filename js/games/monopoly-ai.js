/* ════════════════════════════════════════════════════════════
   monopoly-ai.js —— 大富翁电脑决策
   骰点是随机的，电脑的棋力体现在三处判断：
     ① 落到无主产业「买还是不买」
     ② 行动阶段「盖不盖房、盖在哪」
     ③ 狱中「等对子还是付保释金」
   三档：入门 = 只看手头宽裕，三成概率犯懒
         进阶 = 按产业价值加权判断，留 $220 周转
         高手 = 抢占满组、阻击对手，回报率不够就不动工
   aiMove(level) 每次只推进一步（掷骰 / 决定买 / 盖一间 / 结束回合），
   由 App.pump() 循环驱动，界面因此能逐步演示电脑的操作。
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub;
  var M = Hub.Monopoly, MP = Hub.MP;
  var CELLS = MP.CELLS, GROUP_CELLS = MP.GROUP_CELLS, HOUSE_COST = MP.HOUSE_COST, NC = MP.NC;

  /* 各档买下后至少要留下的周转现金 */
  var RESERVE = { 1: 60, 2: 220, 3: 150 };

  /** 同组持有情况：own 己方已有、free 仍无主、total 组内总数 */
  function groupProgress(g, seat, gr) {
    var cells = GROUP_CELLS[gr], own = 0, free = 0, k, o;
    for (k = 0; k < cells.length; k++) {
      o = g.owner(cells[k]);
      if (o === seat) own++;
      else if (o < 0) free++;
    }
    return { own: own, free: free, total: cells.length };
  }

  /** 买下第 i 格对 seat 的价值分（越高越该买） */
  M.prototype._buyScore = function (seat, i) {
    var c = CELLS[i], v = 0, p, s2, q;
    if (c.k === 'prop') {
      p = groupProgress(this, seat, c.g);
      v = 40 + p.own * 46;
      if (p.own === p.total - 1) v += 95;        // 买下即集齐同组，可立刻盖房
      else if (p.free + p.own < p.total) v -= 78; // 组内已被他人插足，永远独占不了
      v += c.rent[5] * 0.013;                    // 酒店租金潜力
      /* 阻击：某对手已握有同组其余全部，抢下此格即断其盖房 */
      for (s2 = 0; s2 < this.players; s2++) {
        if (s2 === seat || this.out[s2] || c.g == null) continue;
        q = groupProgress(this, s2, c.g);
        if (q.own === q.total - 1 && q.free === 1) v += 72;
      }
    } else if (c.k === 'rail') {
      v = 34 + this.countKind(seat, 'rail') * 42;
    } else if (c.k === 'util') {
      v = 30 + this.countKind(seat, 'util') * 48;
    } else {
      return -999;
    }
    v -= c.price * 0.10;                         // 越贵越要掂量
    return v;
  };

  /** 该不该买下当前待购格 */
  M.prototype._wantBuy = function (seat, i, level) {
    level = level || 2;
    if (i == null || i < 0) return false;
    var price = CELLS[i].price;
    if (!(price > 0) || this.money[seat] < price) return false;
    var left = this.money[seat] - price;

    /* 入门：只看手头宽不宽裕，且三成概率犯懒 */
    if (level <= 1) return left >= RESERVE[1] && this.rnd() > 0.3;

    var v = this._buyScore(seat, i);
    if (level === 2) return left >= RESERVE[2] && v > 26;
    return left >= RESERVE[3] && v > 4;
  };

  /** 该不该在第 i 格盖一间房（只管现金安全线，盖哪一处由 _aiBuildTarget 定） */
  M.prototype._wantBuild = function (seat, i, level) {
    level = level || 2;
    if (i == null || i < 0 || !this.canBuild(seat, i)) return false;
    var cost = HOUSE_COST[CELLS[i].g];
    /* 入门：钱多得没处花才动手，且一半概率放过 */
    if (level <= 1) return this.money[seat] >= cost + 300 && this.rnd() > 0.5;
    return (this.money[seat] - cost) >= RESERVE[level];
  };

  /** 电脑挑盖房目标：高手档按「租金增量 / 房价」排序，其余用通用均衡规则 */
  M.prototype._aiBuildTarget = function (seat, level) {
    var base = this.buildTarget(seat);
    if (base < 0 || !level || level < 3) return base;
    var self = this, cand = [], i;
    for (i = 0; i < NC; i++) if (this.canBuild(seat, i)) cand.push(i);
    if (cand.length < 2) return base;
    function roi(k) {
      var c = CELLS[k], h = self.house[k], cost = HOUSE_COST[c.g];
      return (c.rent[h + 1] - c.rent[h]) / cost;
    }
    cand.sort(function (x, y) { return (roi(y) - roi(x)) || (y - x); });
    return cand[0];
  };

  /* ───────── 对外接口 ───────── */
  M.prototype.aiMove = function (level) {
    if (this._over) return false;
    level = level || 2;
    var seat = this.turn, i;

    if (this.out[seat]) { this._begin(); this._nextTurn(); return true; }

    if (this.phase === 'roll') {
      /* 高手档：狱中已耗两回合就先付保释金，免得白关一回合 */
      if (level >= 3 && this.jail[seat] >= 2 && this.money[seat] >= 400) this.payBail();
      return this.roll();
    }

    if (this.phase === 'buy') {
      return this._wantBuy(seat, this.offer, level) ? this.buy() : this.skipBuy();
    }

    if (this.phase === 'act') {
      i = this._aiBuildTarget(seat, level);
      if (i >= 0 && this._wantBuild(seat, i, level)) return this.actBuild(i);
      return this.endTurn();
    }
    return false;
  };

  M.prototype.suggest = function (level) {
    if (this._over) { Hub.App.toast('对局已结束'); return null; }
    level = level == null ? 3 : level;
    var seat = this.turn, i, h;

    if (this.phase === 'buy') {
      i = this.offer;
      var yes = this._wantBuy(seat, i, level);
      this.sugg = { k: yes ? 'buy' : 'skip', i: i, buy: yes };
      Hub.App.toast(yes
        ? ('建议：买下' + CELLS[i].name + '（$' + CELLS[i].price + '，评分 ' +
          Math.round(this._buyScore(seat, i)) + '）')
        : ('建议：放弃' + CELLS[i].name + '，留 $' + this.money[seat] + ' 周转'));
      return this.sugg;
    }

    if (this.phase === 'act') {
      i = this._aiBuildTarget(seat, level);
      if (i >= 0 && this._wantBuild(seat, i, level)) {
        h = this.house[i];
        this.sugg = { k: 'build', i: i };
        Hub.App.toast('建议：在' + CELLS[i].name + '盖房（$' + HOUSE_COST[CELLS[i].g] +
          '，租金 $' + CELLS[i].rent[h] + ' → $' + (h < 5 ? CELLS[i].rent[h + 1] : 0) + '）');
        return this.sugg;
      }
      this.sugg = { k: 'end', i: -1 };
      Hub.App.toast('建议：结束回合' + (this.pendingDouble ? '（掷出对子，可再掷一次）' : ''));
      return this.sugg;
    }

    this.sugg = null;
    Hub.App.toast(this.jail[seat] > 0
      ? ('建议：掷骰求对子出狱（狱中第 ' + this.jail[seat] + ' 回合）')
      : '建议：掷骰子');
    return null;
  };

  M.prototype.clearSuggestion = function () { this.sugg = null; };

})(window);
