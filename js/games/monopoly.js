/* ════════════════════════════════════════════════════════════
   大富翁 MONOPOLY
   盘面：11×11 方环，外圈 40 格，自「起点」逆时针行进
     · 22 处地产分八组（甲乙丙丁戊己庚辛），集齐同组方可盖房
     · 4 座车站、2 处公用事业、2 项税收
     · 3 张机会、3 张命运、4 个角格（起点 / 监狱 / 免费停车 / 入狱）
   规则：起始 $1500，掷两枚骰子行进；落到无主产业可购入；
         落到他人产业须付租金；集齐同组可盖房（须均衡），
         五间即成酒店；掷出对子可再掷一次，连三次对子直接入狱；
         过起点领 $200；付不出租金先自动卖房，仍不足则破产出局。
   胜负：其余各家尽数破产者胜；达回合上限则按净资产判定。
   本作不收录抵押、拍卖与玩家间交易。
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub, P = Hub.PAL;
  var U = Hub.util;

  var GW = 11, NC = 40;
  var SEAT_NAME = ['红方', '黄方', '蓝方', '绿方'];
  var RAIL_RENT = [25, 50, 100, 200];

  /* ───────── 盘面几何：格序号 → 行列 ───────── */
  var RC = [], IDX = {};
  (function () {
    function put(i, r, c) { RC[i] = [r, c]; IDX[r + ',' + c] = i; }
    var i;
    put(0, 10, 10);                                  // 起点（右下角）
    for (i = 1; i <= 9; i++) put(i, 10, 10 - i);     // 下边，自右向左
    put(10, 10, 0);                                  // 监狱（左下角）
    for (i = 11; i <= 19; i++) put(i, 20 - i, 0);    // 左边，自下向上
    put(20, 0, 0);                                   // 免费停车（左上角）
    for (i = 21; i <= 29; i++) put(i, 0, i - 20);    // 上边，自左向右
    put(30, 0, 10);                                  // 入狱（右上角）
    for (i = 31; i <= 39; i++) put(i, i - 30, 10);   // 右边，自上向下
  })();

  function cellRC(i) { return RC[i]; }
  function cellIndex(r, c) { var v = IDX[r + ',' + c]; return v == null ? -1 : v; }

  /* 由格心指向盘心的方向 [dc, dr]（角格为对角） */
  function inward(i) {
    if (i === 0) return [-1, -1];
    if (i === 10) return [1, -1];
    if (i === 20) return [1, 1];
    if (i === 30) return [-1, 1];
    if (i >= 1 && i <= 9) return [0, -1];
    if (i >= 11 && i <= 19) return [1, 0];
    if (i >= 21 && i <= 29) return [0, 1];
    return [-1, 0];
  }
  function isCorner(i) { return i % 10 === 0; }

  /* ───────── 四十格定义 ───────── */
  var GROUP_NAME = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
  var HOUSE_COST = [50, 50, 100, 100, 150, 150, 200, 200];
  /* 组带在黑白线稿下的区分：底色深浅 + 是否加斜纹 */
  var GSTYLE = [
    { a: .06, h: false }, { a: .12, h: false }, { a: .18, h: true }, { a: .26, h: false },
    { a: .34, h: true }, { a: .46, h: false }, { a: .62, h: true }, { a: .88, h: false }
  ];

  function pr(name, g, price, rent) { return { k: 'prop', name: name, g: g, price: price, rent: rent }; }

  var CELLS = [
    { k: 'go', name: '起点', sub: 'GO' },
    pr('杏花村', 0, 60, [2, 10, 30, 90, 160, 250]),
    { k: 'chest', name: '命运' },
    pr('稻香里', 0, 60, [4, 20, 60, 180, 320, 450]),
    { k: 'tax', name: '所得税', cost: 200 },
    { k: 'rail', name: '东站', price: 200 },
    pr('青石桥', 1, 100, [6, 30, 90, 270, 400, 550]),
    { k: 'chance', name: '机会' },
    pr('乌衣巷', 1, 100, [6, 30, 90, 270, 400, 550]),
    pr('白塔寺', 1, 120, [8, 40, 100, 300, 450, 600]),
    { k: 'jail', name: '监狱', sub: '探监' },
    pr('望江路', 2, 140, [10, 50, 150, 450, 625, 750]),
    { k: 'util', name: '自来水厂', price: 150 },
    pr('临湖道', 2, 140, [10, 50, 150, 450, 625, 750]),
    pr('听雨轩', 2, 160, [12, 60, 180, 500, 700, 900]),
    { k: 'rail', name: '南站', price: 200 },
    pr('姑苏街', 3, 180, [14, 70, 200, 550, 750, 950]),
    { k: 'chest', name: '命运' },
    pr('钱塘渡', 3, 180, [14, 70, 200, 550, 750, 950]),
    pr('广陵坊', 3, 200, [16, 80, 220, 600, 800, 1000]),
    { k: 'park', name: '免费停车' },
    pr('洛阳道', 4, 220, [18, 90, 250, 700, 875, 1050]),
    { k: 'chance', name: '机会' },
    pr('金陵坊', 4, 220, [18, 90, 250, 700, 875, 1050]),
    pr('长安街', 4, 240, [20, 100, 300, 750, 925, 1100]),
    { k: 'rail', name: '西站', price: 200 },
    pr('泰山顶', 5, 260, [22, 110, 330, 800, 975, 1150]),
    pr('华山路', 5, 260, [22, 110, 330, 800, 975, 1150]),
    { k: 'util', name: '电力公司', price: 150 },
    pr('衡山道', 5, 280, [24, 120, 360, 850, 1025, 1200]),
    { k: 'gotojail', name: '入狱' },
    pr('黄鹤楼', 6, 300, [26, 130, 390, 900, 1100, 1275]),
    pr('大明湖', 6, 300, [26, 130, 390, 900, 1100, 1275]),
    { k: 'chest', name: '命运' },
    pr('滕王阁', 6, 320, [28, 150, 450, 1000, 1200, 1400]),
    { k: 'rail', name: '北站', price: 200 },
    { k: 'chance', name: '机会' },
    pr('紫禁城', 7, 350, [35, 175, 500, 1100, 1300, 1500]),
    { k: 'tax', name: '奢侈税', cost: 100 },
    pr('蓬莱岛', 7, 400, [50, 200, 600, 1400, 1700, 2000])
  ];

  /* 各组所含格号 */
  var GROUP_CELLS = [[], [], [], [], [], [], [], []];
  (function () {
    for (var i = 0; i < NC; i++) if (CELLS[i].k === 'prop') GROUP_CELLS[CELLS[i].g].push(i);
  })();

  /* ───────── 机会 / 命运牌 ───────── */
  var CHANCE = [
    { t: 'move', to: 0, text: '前进到起点，领取 $200' },
    { t: 'move', to: 24, text: '前进到长安街' },
    { t: 'move', to: 11, text: '前进到望江路' },
    { t: 'money', v: 50, text: '银行派息，收取 $50' },
    { t: 'money', v: -15, text: '违规停车，缴纳 $15' },
    { t: 'rail', text: '前进到最近的车站，租金加倍' },
    { t: 'rail', text: '前进到最近的车站，租金加倍' },
    { t: 'money', v: -100, text: '违章建筑罚款，缴纳 $100' },
    { t: 'each', v: 50, text: '当选董事长，每位对手各付你 $50' },
    { t: 'moveBy', n: -3, text: '后退三步' },
    { t: 'util', text: '前进到最近的公用事业，按骰点十倍计租' },
    { t: 'repair', house: 25, hotel: 100, text: '房屋维修：每房 $25，每酒店 $100' }
  ];
  var CHEST = [
    { t: 'move', to: 0, text: '前进到起点，领取 $200' },
    { t: 'money', v: 200, text: '银行出错，收取 $200' },
    { t: 'money', v: -100, text: '医药费，缴纳 $100' },
    { t: 'money', v: 50, text: '出售股票，收取 $50' },
    { t: 'jail', text: '入狱，不经起点不领薪水' },
    { t: 'money', v: -50, text: '节日酬神，缴纳 $50' },
    { t: 'money', v: 20, text: '退税，收取 $20' },
    { t: 'money', v: 100, text: '继承遗产，收取 $100' },
    { t: 'money', v: 100, text: '人寿保险到期，收取 $100' },
    { t: 'money', v: -100, text: '住院费用，缴纳 $100' },
    { t: 'money', v: -50, text: '缴纳学费 $50' },
    { t: 'repair', house: 40, hotel: 115, text: '房屋维修：每房 $40，每酒店 $115' }
  ];

  /* ═══════════════════════════════════════════════════════ */
  function Monopoly(cfg) {
    Hub.Base.call(this, cfg);
    cfg = cfg || {};
    this.players = (cfg.players >= 2 && cfg.players <= 4) ? (cfg.players | 0) : 2;
    /* rnd 仅供掷骰使用；牌堆另用 Math.random 洗，便于测试注入确定骰点 */
    this.rnd = (typeof cfg.rnd === 'function') ? cfg.rnd : Math.random;
    this.startMoney = cfg.startMoney > 0 ? cfg.startMoney : 1500;
    this.maxRound = cfg.maxRound > 0 ? cfg.maxRound : 120;
    this.showRent = cfg.showRent !== false;
    this.reset();
  }
  Monopoly.prototype = Object.create(Hub.Base.prototype);
  Monopoly.prototype.constructor = Monopoly;

  Monopoly.prototype.reset = function () {
    var s;
    this.pos = []; this.money = []; this.jail = []; this.out = [];
    for (s = 0; s < this.players; s++) {
      this.pos[s] = 0; this.money[s] = this.startMoney;
      this.jail[s] = 0; this.out[s] = false;
    }
    this.b = new Int8Array(NC);        // 0 无主；否则 seat+1
    this.house = new Int8Array(NC);    // 0..4 房；5 酒店
    this.turn = 0;
    this.d1 = 0; this.d2 = 0;
    this.doubles = 0;
    this.phase = 'roll';               // roll | buy | act | over
    this.offer = -1;                   // 待购格
    this.sel = -1;                     // 选中格（查看 / 盖房目标）
    this.pendingDouble = false;        // 本回合掷出对子，结束后可再掷
    this.card = null;                  // 最近一张牌 {w, text}
    this.round = 1;
    this.msg = SEAT_NAME[0] + ' 先掷骰。';
    this.deckC = U.shuffle(CHANCE.map(function (_, i) { return i; }), Math.random);
    this.deckK = U.shuffle(CHEST.map(function (_, i) { return i; }), Math.random);
    this.ptrC = 0; this.ptrK = 0;
    this.history = [];
    this.lastMark = null;
    this.sugg = null;
    this._over = null;
    this._hover = -1;
  };

  Monopoly.prototype.seatCount = function () { return this.players; };

  /* ───────── 快照 / 悔棋 ───────── */
  Monopoly.prototype.snapshot = function () {
    return {
      pos: this.pos.slice(), money: this.money.slice(),
      jail: this.jail.slice(), out: this.out.slice(),
      b: this.b.slice(), house: this.house.slice(),
      turn: this.turn, d1: this.d1, d2: this.d2, doubles: this.doubles,
      phase: this.phase, offer: this.offer, sel: this.sel,
      pendingDouble: this.pendingDouble, card: this.card,
      round: this.round, msg: this.msg, lastMark: this.lastMark,
      ptrC: this.ptrC, ptrK: this.ptrK,
      deckC: this.deckC.slice(), deckK: this.deckK.slice(),
      _over: this._over
    };
  };
  Monopoly.prototype.restore = function (s) {
    this.pos = s.pos.slice(); this.money = s.money.slice();
    this.jail = s.jail.slice(); this.out = s.out.slice();
    this.b = s.b.slice(); this.house = s.house.slice();
    this.turn = s.turn; this.d1 = s.d1; this.d2 = s.d2; this.doubles = s.doubles;
    this.phase = s.phase; this.offer = s.offer; this.sel = s.sel;
    this.pendingDouble = s.pendingDouble; this.card = s.card;
    this.round = s.round; this.msg = s.msg; this.lastMark = s.lastMark;
    this.ptrC = s.ptrC; this.ptrK = s.ptrK;
    this.deckC = s.deckC.slice(); this.deckK = s.deckK.slice();
    this._over = s._over || null;
    this.sugg = null;
  };
  Monopoly.prototype.canUndo = function () { return this.history.length > 0 && !this.thinking; };
  Monopoly.prototype.undo = function () {
    if (!this.history.length) return false;
    this.restore(this.history.pop());
    return true;
  };

  /* 一次操作压一条快照，快照上挂「记录数组」，供 log() 展开 */
  Monopoly.prototype._begin = function () {
    this.history.push(this.snapshot());
    this.history[this.history.length - 1].rec = [];
  };
  Monopoly.prototype._rec = function (x) {
    var h = this.history[this.history.length - 1];
    if (!h) return;
    if (!h.rec) h.rec = [];
    h.rec.push(x);
  };

  /* ───────── 产权查询 ───────── */
  Monopoly.prototype.owner = function (i) { return this.b[i] ? this.b[i] - 1 : -1; };
  Monopoly.prototype.priceOf = function (i) { return CELLS[i].price || 0; };

  Monopoly.prototype.countKind = function (seat, kind) {
    var n = 0, i;
    for (i = 0; i < NC; i++) if (this.b[i] === seat + 1 && CELLS[i].k === kind) n++;
    return n;
  };
  Monopoly.prototype.countGroup = function (seat, g) {
    var cells = GROUP_CELLS[g], n = 0, k;
    for (k = 0; k < cells.length; k++) if (this.b[cells[k]] === seat + 1) n++;
    return n;
  };
  Monopoly.prototype.groupComplete = function (seat, g) {
    return this.countGroup(seat, g) === GROUP_CELLS[g].length;
  };
  /** 该座位的地产总数（含车站与公用事业） */
  Monopoly.prototype.countProps = function (seat) {
    var n = 0, i;
    for (i = 0; i < NC; i++) if (this.b[i] === seat + 1) n++;
    return n;
  };
  /** 零散房屋数（不含酒店，酒店另计） */
  Monopoly.prototype.countHouses = function (seat) {
    var n = 0, i;
    for (i = 0; i < NC; i++) {
      if (this.b[i] === seat + 1 && this.house[i] < 5) n += this.house[i];
    }
    return n;
  };
  Monopoly.prototype.countHotels = function (seat) {
    var n = 0, i;
    for (i = 0; i < NC; i++) if (this.b[i] === seat + 1 && this.house[i] === 5) n++;
    return n;
  };
  Monopoly.prototype.netWorth = function (seat) {
    var v = this.money[seat], i;
    for (i = 0; i < NC; i++) {
      if (this.b[i] !== seat + 1) continue;
      v += this.priceOf(i);
      if (CELLS[i].k === 'prop') v += this.house[i] * HOUSE_COST[CELLS[i].g];
    }
    return v;
  };

  /** 租金；d 为本次骰点之和（公用事业按倍率计租时用） */
  Monopoly.prototype.rentOf = function (i, d, opt) {
    var c = CELLS[i], o = this.owner(i);
    if (o < 0 || this.out[o]) return 0;
    opt = opt || {};
    if (c.k === 'prop') {
      var h = this.house[i];
      var v = c.rent[h];
      if (h === 0 && this.groupComplete(o, c.g)) v *= 2;   // 满组空地租金加倍
      return v;
    }
    if (c.k === 'rail') {
      var n = U.clamp(this.countKind(o, 'rail'), 1, 4);
      var rv = RAIL_RENT[n - 1];
      return opt.mul ? rv * opt.mul : rv;
    }
    if (c.k === 'util') {
      var dice = Math.max(1, d || 7);
      if (opt.utilTen) return 10 * dice;
      return (this.countKind(o, 'util') >= 2 ? 10 : 4) * dice;
    }
    return 0;
  };

  /* ───────── 盖房 / 卖房 ───────── */
  Monopoly.prototype.canBuild = function (seat, i) {
    var c = CELLS[i];
    if (this.out[seat] || c.k !== 'prop') return false;
    if (this.b[i] !== seat + 1) return false;
    if (!this.groupComplete(seat, c.g)) return false;      // 须集齐同组
    if (this.house[i] >= 5) return false;
    if (this.money[seat] < HOUSE_COST[c.g]) return false;
    /* 均衡兴建：同组内每处都盖到同一间数后，才能盖下一间 */
    var cells = GROUP_CELLS[c.g], k;
    for (k = 0; k < cells.length; k++) if (this.house[cells[k]] < this.house[i]) return false;
    return true;
  };
  Monopoly.prototype.buildHouse = function (seat, i) {
    if (this._over || !this.canBuild(seat, i)) return false;
    this.house[i]++;
    this.money[seat] -= HOUSE_COST[CELLS[i].g];
    return true;
  };
  Monopoly.prototype.canSell = function (seat, i) {
    if (this.out[seat]) return false;
    if (this.b[i] !== seat + 1 || this.house[i] <= 0) return false;
    /* 均衡拆房：只能从同组中房数最多的一处开始卖 */
    var cells = GROUP_CELLS[CELLS[i].g], k;
    for (k = 0; k < cells.length; k++) if (this.house[cells[k]] > this.house[i]) return false;
    return true;
  };
  Monopoly.prototype.sellHouse = function (seat, i) {
    if (!this.canSell(seat, i)) return false;
    this.house[i]--;
    this.money[seat] += Math.floor(HOUSE_COST[CELLS[i].g] / 2);
    return true;
  };
  /** 自动挑选盖房目标：优先选中格，否则取房数最少、地价最高者 */
  Monopoly.prototype.buildTarget = function (seat) {
    if (this.sel >= 0 && this.canBuild(seat, this.sel)) return this.sel;
    var cand = [], i;
    for (i = 0; i < NC; i++) if (this.canBuild(seat, i)) cand.push(i);
    if (!cand.length) return -1;
    var self = this;
    cand.sort(function (x, y) {
      return (self.house[x] - self.house[y]) || (CELLS[y].price - CELLS[x].price) || (x - y);
    });
    return cand[0];
  };
  Monopoly.prototype.sellTarget = function (seat) {
    if (this.sel >= 0 && this.canSell(seat, this.sel)) return this.sel;
    var cand = [], i;
    for (i = 0; i < NC; i++) if (this.canSell(seat, i)) cand.push(i);
    if (!cand.length) return -1;
    var self = this;
    cand.sort(function (x, y) { return (self.house[y] - self.house[x]) || (x - y); });
    return cand[0];
  };
  /** 房数最多的一处（破产变现时优先卖） */
  Monopoly.prototype._mostHoused = function (seat) {
    var best = -1, bh = 0, i;
    for (i = 0; i < NC; i++) {
      if (this.b[i] !== seat + 1 || this.house[i] <= bh) continue;
      bh = this.house[i]; best = i;
    }
    return best;
  };

  /* ───────── 资金结算 ───────── */
  /** seat 支付 amount；to<0 表示付给银行。现金不足自动卖房，仍不足则破产 */
  Monopoly.prototype.charge = function (seat, amount, to, why) {
    if (this.out[seat] || !(amount > 0)) return 0;
    amount = Math.round(amount);
    var i, sold = 0;
    while (this.money[seat] < amount) {
      i = this._mostHoused(seat);
      if (i < 0) break;
      this.house[i]--;
      this.money[seat] += Math.floor(HOUSE_COST[CELLS[i].g] / 2);
      sold++;
    }
    if (sold) this._rec({ k: 'liquid', s: seat, n: sold });

    if (this.money[seat] >= amount) {
      this.money[seat] -= amount;
      if (to >= 0 && !this.out[to]) this.money[to] += amount;
      return amount;
    }
    /* 破产：现金尽付债主，产业易主 */
    var paid = Math.max(0, this.money[seat]);
    this.money[seat] = 0;
    if (to >= 0 && !this.out[to]) this.money[to] += paid;
    this.bankrupt(seat, to, why, amount);
    return paid;
  };

  Monopoly.prototype.bankrupt = function (seat, creditor, why, amount) {
    this.out[seat] = true;
    this.jail[seat] = 0;
    this.offer = -1;
    var i, n = 0;
    for (i = 0; i < NC; i++) {
      if (this.b[i] !== seat + 1) continue;
      this.house[i] = 0;
      this.b[i] = (creditor >= 0 && !this.out[creditor]) ? creditor + 1 : 0;
      n++;
    }
    this._rec({ k: 'bankrupt', s: seat, n: n, why: why || '', v: amount || 0 });
    this.checkWin();
  };

  Monopoly.prototype.checkWin = function () {
    var s, alive = [];
    for (s = 0; s < this.players; s++) if (!this.out[s]) alive.push(s);
    if (alive.length <= 1) {
      var w = alive.length ? alive[0] : null;
      this._over = {
        winner: w,
        title: w == null ? '和局' : (SEAT_NAME[w] + '胜'),
        text: w == null ? '各家同时破产，无人胜出。'
          : '其余各家尽数破产，' + SEAT_NAME[w] + ' 独占全城（第 ' + this.round + ' 回合，净资产 $' + this.netWorth(w) + '）。'
      };
      this.phase = 'over';
      return true;
    }
    return false;
  };

  Monopoly.prototype._judgeByWorth = function () {
    var s, best = -1, bv = -Infinity, txt = [];
    for (s = 0; s < this.players; s++) {
      if (this.out[s]) continue;
      var v = this.netWorth(s);
      txt.push(SEAT_NAME[s] + ' $' + v);
      if (v > bv) { bv = v; best = s; }
    }
    this._over = {
      winner: best,
      title: SEAT_NAME[best] + '胜',
      text: '已达 ' + this.maxRound + ' 回合上限，按净资产判定 —— ' + txt.join('　') + '。'
    };
    this.phase = 'over';
  };

  /* ───────── 行进 ───────── */
  Monopoly.prototype.die = function () { return 1 + ((this.rnd() * 6) | 0); };

  /** 前进 steps 格；过起点领 $200 */
  Monopoly.prototype.advance = function (seat, steps, collectGo) {
    var from = this.pos[seat], to = (from + steps) % NC;
    this.lastMark = { s: seat, from: from, to: to };
    if (collectGo !== false && to < from) {
      this.money[seat] += 200;
      this._rec({ k: 'go', s: seat });
    }
    this.pos[seat] = to;
    return to;
  };
  /** 直接移动到某格；collectGo 为真时过起点领薪 */
  Monopoly.prototype.moveTo = function (seat, target, collectGo) {
    var from = this.pos[seat];
    this.lastMark = { s: seat, from: from, to: target };
    if (collectGo && target < from) {
      this.money[seat] += 200;
      this._rec({ k: 'go', s: seat });
    }
    this.pos[seat] = target;
    return target;
  };
  Monopoly.prototype.toJail = function (seat) {
    var from = this.pos[seat];
    this.lastMark = { s: seat, from: from, to: 10 };
    this.pos[seat] = 10;
    this.jail[seat] = 1;
    this.doubles = 0;
    this.pendingDouble = false;
    this._rec({ k: 'jail', s: seat });
  };
  /** 自 seat 起顺时针最近的某类格 */
  Monopoly.prototype.nearest = function (seat, kind) {
    for (var s = 1; s <= NC; s++) {
      var i = (this.pos[seat] + s) % NC;
      if (CELLS[i].k === kind) return i;
    }
    return this.pos[seat];
  };

  /* ───────── 掷骰 ───────── */
  Monopoly.prototype.roll = function () {
    if (this._over || this.phase !== 'roll') return false;
    var seat = this.turn;
    if (this.out[seat]) { this._begin(); this._nextTurn(); return true; }
    this._begin();

    var a = this.die(), b = this.die(), d = a + b, dbl = (a === b);
    this.d1 = a; this.d2 = b;
    this.sugg = null;

    /* 狱中：掷出对子方可出狱；第三回合仍不出则须付 $50 */
    if (this.jail[seat] > 0) {
      this._rec({ k: 'roll', s: seat, a: a, b: b, jail: true });
      if (dbl) {
        this.jail[seat] = 0;
        this.msg = SEAT_NAME[seat] + ' 掷出对子 ' + a + '，出狱并前进 ' + d + ' 格。';
        this.advance(seat, d, true);
        this.pendingDouble = false;                    // 出狱这一掷不追加
        this.resolveLanding(seat, 0);
        return true;
      }
      this.jail[seat]++;
      if (this.jail[seat] > 3) {
        this.jail[seat] = 0;
        this.msg = SEAT_NAME[seat] + ' 第三回合仍未掷出对子，缴纳 $50 出狱。';
        this.charge(seat, 50, -1, '保释金');
        if (this.out[seat]) { this._nextTurn(); return true; }
        this.advance(seat, d, true);
        this.pendingDouble = false;
        this.resolveLanding(seat, 0);
        return true;
      }
      this.msg = SEAT_NAME[seat] + ' 在狱中第 ' + (this.jail[seat] - 1) + ' 回合未掷出对子，继续服刑。';
      this.phase = 'act';
      this.pendingDouble = false;
      this._nextTurn();
      return true;
    }

    this._rec({ k: 'roll', s: seat, a: a, b: b });
    this.msg = SEAT_NAME[seat] + ' 掷出 ' + a + ' + ' + b + ' = ' + d + (dbl ? '（对子）' : '') + '。';

    /* 连三次对子：直接入狱 */
    if (dbl) {
      this.doubles++;
      if (this.doubles >= 3) {
        this.msg = SEAT_NAME[seat] + ' 连掷三次对子，超速行进，直接入狱。';
        this.toJail(seat);
        this.phase = 'act';
        this._nextTurn();
        return true;
      }
    } else {
      this.doubles = 0;
    }

    this.advance(seat, d, true);
    this.pendingDouble = dbl;
    this.resolveLanding(seat, 0);
    return true;
  };

  /** 付保释金出狱（不移动，本回合仍可掷骰） */
  Monopoly.prototype.payBail = function () {
    var seat = this.turn;
    if (this._over || this.phase !== 'roll') return false;
    if (this.jail[seat] <= 0 || this.money[seat] < 50) return false;
    this._begin();
    this.charge(seat, 50, -1, '保释金');
    this.jail[seat] = 0;
    this.msg = SEAT_NAME[seat] + ' 缴纳 $50 保释金出狱。';
    this._rec({ k: 'bail', s: seat });
    return true;
  };

  /* ───────── 落地结算 ─────────
     depth 用于限制卡牌连锁移动的深度 */
  Monopoly.prototype.resolveLanding = function (seat, depth, opt) {
    depth = depth || 0;
    opt = opt || {};
    if (this._over) { this.phase = 'over'; return; }
    if (depth > 6) { this.phase = 'act'; return; }
    var i = this.pos[seat], c = CELLS[i], o;
    this.sel = i;

    switch (c.k) {
      case 'prop':
      case 'rail':
      case 'util':
        o = this.owner(i);
        if (o < 0) {
          if (this.money[seat] >= c.price) {
            this.offer = i; this.phase = 'buy';
            this.msg += ' 落到无主的' + c.name + '，可出 $' + c.price + ' 购入。';
          } else {
            this.offer = -1; this.phase = 'act';
            this.msg += ' 落到无主的' + c.name + '，但现金不足，无法购入。';
          }
        } else if (o === seat) {
          this.phase = 'act';
          this.msg += ' 回到自己的' + c.name + '。';
        } else {
          var rent = this.rentOf(i, this.d1 + this.d2, opt);
          this.phase = 'act';
          if (rent > 0) {
            this.msg += ' 停在' + SEAT_NAME[o] + '的' + c.name + '，须付租金 $' + rent + '。';
            this._rec({ k: 'rent', s: seat, i: i, v: rent, to: o });
            this.charge(seat, rent, o, c.name + '租金');
          } else {
            this.msg += ' 停在' + SEAT_NAME[o] + '的' + c.name + '。';
          }
        }
        break;

      case 'tax':
        this.phase = 'act';
        this.msg += ' 缴纳' + c.name + ' $' + c.cost + '。';
        this._rec({ k: 'tax', s: seat, i: i, v: c.cost });
        this.charge(seat, c.cost, -1, c.name);
        break;

      case 'gotojail':
        this.phase = 'act';
        this.msg += ' 落在「入狱」格，直接下狱。';
        this.toJail(seat);
        this._nextTurn();
        break;

      case 'chance':
      case 'chest':
        this.phase = 'act';
        this.msg += ' 抽一张' + c.name + '。';
        this.drawCard(seat, c.k, depth);
        break;

      default:                                  // go / jail / park
        this.phase = 'act';
        if (i === 0) this.msg += ' 停在起点。';
        else if (i === 10) this.msg += ' 只是探监，安然无事。';
        else if (i === 20) this.msg += ' 免费停车，歇一歇。';
    }
  };

  /* ───────── 卡牌 ───────── */
  Monopoly.prototype.drawCard = function (seat, which, depth) {
    var deck, list, ptrKey, card, idx;
    if (which === 'chance') { deck = this.deckC; list = CHANCE; ptrKey = 'ptrC'; }
    else { deck = this.deckK; list = CHEST; ptrKey = 'ptrK'; }
    if (this[ptrKey] >= deck.length) {
      U.shuffle(deck, Math.random);
      this[ptrKey] = 0;
    }
    idx = deck[this[ptrKey]++];
    card = list[idx];
    this.card = { w: which, text: card.text, s: seat };
    this._rec({ k: 'card', s: seat, w: which, text: card.text });
    this.applyCard(seat, card, depth);
    return card;
  };

  Monopoly.prototype.applyCard = function (seat, card, depth) {
    var s, t, v, i;
    switch (card.t) {
      case 'move':
        this.moveTo(seat, card.to, true);
        this.resolveLanding(seat, depth + 1);
        break;
      case 'moveBy':
        t = ((this.pos[seat] + card.n) % NC + NC) % NC;
        this.moveTo(seat, t, card.n > 0);        // 后退不过起点领薪
        this.resolveLanding(seat, depth + 1);
        break;
      case 'money':
        if (card.v >= 0) {
          this.money[seat] += card.v;
        } else {
          this._rec({ k: 'pay', s: seat, v: -card.v, to: -1 });
          this.charge(seat, -card.v, -1, card.text);
        }
        break;
      case 'each':
        for (s = 0; s < this.players; s++) {
          if (s === seat || this.out[s]) continue;
          this._rec({ k: 'pay', s: s, v: card.v, to: seat });
          this.charge(s, card.v, seat, card.text);
        }
        break;
      case 'jail':
        this.toJail(seat);
        this.phase = 'act';
        this._nextTurn();
        break;
      case 'repair':
        v = this.countHouses(seat) * card.house + this.countHotels(seat) * card.hotel;
        if (v > 0) {
          this._rec({ k: 'pay', s: seat, v: v, to: -1 });
          this.charge(seat, v, -1, '房屋维修');
        }
        break;
      case 'rail':
        i = this.nearest(seat, 'rail');
        this.moveTo(seat, i, true);
        this.msg = '机会：' + card.text + '（' + CELLS[i].name + '）。';
        this.resolveLanding(seat, depth + 1, { mul: 2 });
        break;
      case 'util':
        i = this.nearest(seat, 'util');
        this.moveTo(seat, i, true);
        this.msg = '机会：' + card.text + '（' + CELLS[i].name + '）。';
        this.resolveLanding(seat, depth + 1, { utilTen: true });
        break;
    }
  };

  /* ───────── 购入 / 放弃 ───────── */
  Monopoly.prototype.buy = function () {
    if (this._over || this.phase !== 'buy' || this.offer < 0) return false;
    var seat = this.turn, i = this.offer, price = CELLS[i].price;
    if (this.out[seat] || this.money[seat] < price) return false;
    this._begin();
    this.money[seat] -= price;
    this.b[i] = seat + 1;
    this.offer = -1; this.sel = i; this.sugg = null;
    this.phase = 'act';
    this.msg = SEAT_NAME[seat] + ' 以 $' + price + ' 买下' + CELLS[i].name + '。';
    this._rec({ k: 'buy', s: seat, i: i, v: price });
    return true;
  };
  Monopoly.prototype.skipBuy = function () {
    if (this._over || this.phase !== 'buy') return false;
    var seat = this.turn, i = this.offer;
    this._begin();
    this.offer = -1; this.sugg = null;
    this.phase = 'act';
    this.msg = SEAT_NAME[seat] + ' 放弃购入' + CELLS[i].name + '。';
    this._rec({ k: 'skip', s: seat, i: i });
    return true;
  };

  /* ───────── 盖房 / 卖房 / 结束回合 ───────── */
  /** 盖一间房；want 为可选的指定格（电脑按回报率挑，人类按选中格） */
  Monopoly.prototype.actBuild = function (want) {
    var seat = this.turn;
    if (this._over || this.out[seat]) return false;
    if (this.phase !== 'act' && this.phase !== 'buy') return false;
    var i = (want != null && want >= 0 && this.canBuild(seat, want)) ? want : this.buildTarget(seat);
    if (i < 0) {
      if (Hub.App) Hub.App.toast('无处可盖：须集齐同组地产且现金足够');
      return false;
    }
    this._begin();
    this.buildHouse(seat, i);
    this.sel = i; this.sugg = null;
    this.msg = SEAT_NAME[seat] + ' 在' + CELLS[i].name +
      (this.house[i] === 5 ? ' 建成酒店' : (' 盖起第 ' + this.house[i] + ' 间房')) +
      '，花费 $' + HOUSE_COST[CELLS[i].g] + '。';
    this._rec({ k: 'build', s: seat, i: i, h: this.house[i] });
    return true;
  };
  Monopoly.prototype.actSell = function () {
    var seat = this.turn;
    if (this._over || this.out[seat]) return false;
    if (this.phase !== 'act' && this.phase !== 'buy') return false;
    var i = this.sellTarget(seat);
    if (i < 0) {
      if (Hub.App) Hub.App.toast('无房可卖');
      return false;
    }
    this._begin();
    this.sellHouse(seat, i);
    this.sel = i; this.sugg = null;
    this.msg = SEAT_NAME[seat] + ' 卖掉' + CELLS[i].name + '的一间房，收回 $' +
      Math.floor(HOUSE_COST[CELLS[i].g] / 2) + '。';
    this._rec({ k: 'sell', s: seat, i: i, h: this.house[i] });
    return true;
  };

  /** 内部换家（不压快照） */
  Monopoly.prototype._nextTurn = function () {
    var guard = 0;
    this.offer = -1;
    this.phase = 'roll';
    this.pendingDouble = false;
    do {
      this.turn = (this.turn + 1) % this.players;
      if (this.turn === 0) this.round++;
      guard++;
    } while (this.out[this.turn] && guard <= this.players + 1);
    if (this.round > this.maxRound && !this._over) this._judgeByWorth();
    else this.checkWin();
  };

  Monopoly.prototype.endTurn = function () {
    if (this._over) return false;
    if (this.phase !== 'act' && this.phase !== 'buy') return false;
    var seat = this.turn;
    if (this.out[seat]) { this._begin(); this._nextTurn(); return true; }
    this._begin();
    this.sugg = null;
    /* 掷出对子且未入狱：同一玩家再掷一次 */
    if (this.pendingDouble && this.jail[seat] === 0) {
      this.offer = -1;
      this.phase = 'roll';
      this.pendingDouble = false;
      this.msg = SEAT_NAME[seat] + ' 掷出对子，可再掷一次。';
      this._rec({ k: 'again', s: seat });
      return true;
    }
    this.doubles = 0;
    this._nextTurn();
    this.msg = '轮到' + SEAT_NAME[this.turn] + '。';
    this._rec({ k: 'end', s: seat, to: this.turn });
    return true;
  };

  Monopoly.prototype.resign = function (seat) {
    var s, i, best = -1, bv = -Infinity;
    this.out[seat] = true;
    for (i = 0; i < NC; i++) {
      if (this.b[i] !== seat + 1) continue;
      this.house[i] = 0; this.b[i] = 0;
    }
    this.money[seat] = 0;
    for (s = 0; s < this.players; s++) {
      if (s === seat || this.out[s]) continue;
      var v = this.netWorth(s);
      if (v > bv) { bv = v; best = s; }              // 并列时取靠前座位
    }
    this.phase = 'over';
    this._over = {
      winner: best,
      title: SEAT_NAME[best] + '胜',
      text: SEAT_NAME[seat] + ' 认输离场，产业归还银行；' +
        '其余各家按净资产比较，' + SEAT_NAME[best] + '（$' + bv + '）领先。'
    };
  };

  /* ───────── 界面契约 ───────── */
  Monopoly.prototype.seat = function () { return this._over ? -1 : this.turn; };
  Monopoly.prototype.seatName = function (i) { return SEAT_NAME[i] || ('第' + (i + 1) + '家'); };
  Monopoly.prototype.seatFilled = function (i) { return i % 2 === 0; };
  Monopoly.prototype.seatCaptured = function (i) {
    if (this.out[i]) return '破产出局';
    return '$' + this.money[i] + ' · ' + this.countProps(i) + ' 产';
  };

  Monopoly.prototype.status = function () {
    if (this._over) return '<b>' + this._over.title + '</b>';
    var s = '<b>' + this.seatName(this.turn) + '</b> ';
    if (this.out[this.turn]) return s + '已破产，自动跳过';
    if (this.phase === 'roll') {
      s += this.jail[this.turn] > 0
        ? ('在狱中，掷骰求对子（第 ' + this.jail[this.turn] + ' 回合）')
        : '掷骰子';
    } else if (this.phase === 'buy') {
      s += '决定是否买下 ' + CELLS[this.offer].name + '（$' + CELLS[this.offer].price + '）';
    } else {
      s += this.pendingDouble ? '掷出对子，可盖房后再掷' : '可盖房 / 结束回合';
    }
    return s + '　·　第 ' + this.round + ' 回合';
  };

  Monopoly.prototype.hint = function () {
    if (this._over) return '';
    var seat = this.turn;
    if (this.phase === 'roll') {
      if (this.jail[seat] > 0) {
        return '在狱中：掷出对子即可出狱并照点数行进；也可先付 $50 保释金出狱。第三回合仍不出对子则强制付 $50。';
      }
      return '点右侧「掷骰子」掷两枚骰子行进。掷出对子可在本回合结束后再掷一次，但连三次对子直接入狱。';
    }
    if (this.phase === 'buy') {
      var i = this.offer, c = CELLS[i];
      return '「' + c.name + '」无主，售价 $' + c.price + '（你现有 $' + this.money[seat] + '）。' +
        (c.k === 'prop'
          ? ('同组共 ' + GROUP_CELLS[c.g].length + ' 处，集齐即可盖房，每房 $' + HOUSE_COST[c.g] + '。')
          : (c.k === 'rail' ? '车站按持有数计租：25 / 50 / 100 / 200。' : '公用事业按骰点计租：一处 4 倍，两处 10 倍。'));
    }
    if (this.sel >= 0) {
      return '已选中「' + CELLS[this.sel].name + '」，详情见下方信息栏。点「盖房」优先在此处动工，点「结束回合」交给下一家。';
    }
    return '可点盘面任一格查看详情；「盖房」会自动挑同组中房数最少的一处动工。';
  };

  Monopoly.prototype.logText = function (r) {
    var nm = SEAT_NAME[r.s] || ('第' + (r.s + 1) + '家');
    switch (r.k) {
      case 'roll': return nm + ' 掷出 ' + r.a + '+' + r.b + '=' + (r.a + r.b) + (r.a === r.b ? '（对子）' : '') + (r.jail ? ' 狱中' : '');
      case 'go': return nm + ' 过起点，领 $200';
      case 'bail': return nm + ' 付 $50 保释出狱';
      case 'jail': return nm + ' 入狱';
      case 'buy': return nm + ' 以 $' + r.v + ' 买下' + CELLS[r.i].name;
      case 'skip': return nm + ' 放弃' + CELLS[r.i].name;
      case 'build': return nm + ' 在' + CELLS[r.i].name + (r.h === 5 ? ' 建成酒店' : (' 盖第 ' + r.h + ' 间房'));
      case 'sell': return nm + ' 卖掉' + CELLS[r.i].name + '一间房';
      case 'liquid': return nm + ' 变卖 ' + r.n + ' 间房抵债';
      case 'rent': return nm + ' 付' + SEAT_NAME[r.to] + '租金 $' + r.v + '（' + CELLS[r.i].name + '）';
      case 'tax': return nm + ' 缴' + CELLS[r.i].name + ' $' + r.v;
      case 'pay': return nm + (r.to >= 0 ? (' 付' + SEAT_NAME[r.to] + ' $' + r.v) : (' 支出 $' + r.v));
      case 'card': return nm + ' 抽到' + (r.w === 'chance' ? '机会' : '命运') + '：' + r.text;
      case 'bankrupt': return nm + ' 破产出局' + (r.n ? ('，' + r.n + ' 处产业易主') : '');
      case 'again': return nm + ' 掷出对子，再掷一次';
      case 'end': return nm + ' 结束回合';
      default: return nm + ' ' + (r.k || '');
    }
  };

  Monopoly.prototype.log = function () {
    var out = [], k, j, rs;
    for (k = 0; k < this.history.length; k++) {
      rs = this.history[k].rec || [];
      for (j = 0; j < rs.length; j++) {
        out.push({
          n: (out.length + 1) + '.',
          v: this.logText(rs[j]),
          hi: (k === this.history.length - 1 && j === rs.length - 1)
        });
      }
    }
    return out;
  };

  Monopoly.prototype.actions = function () {
    if (this._over) return [];
    var seat = this.turn, i, out = [];
    if (this.out[seat]) return [{ id: 'end', label: '跳过', primary: true }];
    if (this.phase === 'roll') {
      if (this.jail[seat] > 0 && this.money[seat] >= 50) {
        out.push({ id: 'bail', label: '付 $50 出狱', title: '缴纳保释金立即出狱，本回合仍可掷骰' });
      }
      out.push({
        id: 'roll', primary: true,
        label: this.jail[seat] > 0 ? '掷骰（狱中）' : '掷骰子',
        title: '掷两枚骰子'
      });
      return out;
    }
    if (this.phase === 'buy') {
      i = this.offer;
      out.push({
        id: 'buy', primary: true,
        label: '买下 ' + CELLS[i].name + '（$' + CELLS[i].price + '）',
        title: '购入这处产业'
      });
      out.push({ id: 'skip', label: '放弃', title: '不买，保留现金' });
      return out;
    }
    out.push({
      id: 'build', label: '盖房',
      disabled: this.buildTarget(seat) < 0,
      title: '在集齐的同组地产上盖一间房（须均衡兴建）'
    });
    out.push({
      id: 'sell', label: '卖房',
      disabled: this.sellTarget(seat) < 0,
      title: '卖掉一间房，收回半价'
    });
    out.push({
      id: 'end', primary: true,
      label: this.pendingDouble ? '结束并再掷' : '结束回合',
      title: this.pendingDouble ? '掷出对子，结束后仍可再掷一次' : '交给下一家'
    });
    return out;
  };
  Monopoly.prototype.onAction = function (id) {
    if (id === 'roll') this.roll();
    else if (id === 'bail') this.payBail();
    else if (id === 'buy') this.buy();
    else if (id === 'skip') this.skipBuy();
    else if (id === 'build') this.actBuild();
    else if (id === 'sell') this.actSell();
    else if (id === 'end') this.endTurn();
  };

  Monopoly.prototype.info = function () {
    var h = '', s, i, c;
    h += '<div class="kv"><span>回合</span><span>' + this.round + ' / ' + this.maxRound + '</span></div>' +
      '<div class="kv"><span>骰点</span><span>' + (this.d1 ? (this.d1 + ' + ' + this.d2 + ' = ' + (this.d1 + this.d2)) : '—') + '</span></div>';
    if (this.card) {
      h += '<div class="kv"><span>' + (this.card.w === 'chance' ? '机会' : '命运') + '</span><span>' + U.esc(this.card.text) + '</span></div>';
    }
    h += '<h5>各家账目（现金 / 产业 / 房 / 酒店 / 净资产）</h5>';
    for (s = 0; s < this.players; s++) {
      h += '<div class="kv"><span>' + (s + 1) + ' ' + SEAT_NAME[s] + (this.out[s] ? '（破产）' : '') + '</span>' +
        '<span>$' + this.money[s] + ' · ' + this.countProps(s) + ' · ' +
        this.countHouses(s) + ' · ' + this.countHotels(s) + ' · $' + this.netWorth(s) + '</span></div>';
    }
    if (this.sel >= 0) {
      i = this.sel; c = CELLS[i];
      h += '<h5>「' + U.esc(c.name) + '」详情</h5>';
      h += '<div class="kv"><span>持有者</span><span>' +
        (this.owner(i) < 0 ? '无主（银行）' : SEAT_NAME[this.owner(i)]) + '</span></div>';
      if (c.price) h += '<div class="kv"><span>售价</span><span>$' + c.price + '</span></div>';
      if (c.k === 'prop') {
        h += '<div class="kv"><span>组别 / 房价</span><span>' + GROUP_NAME[c.g] + ' 组 · $' + HOUSE_COST[c.g] + '</span></div>';
        h += '<div class="kv"><span>已建</span><span>' + (this.house[i] === 5 ? '酒店' : (this.house[i] + ' 间房')) + '</span></div>';
        h += '<div class="kv"><span>同组持有</span><span>' + this.countGroup(this.owner(i) < 0 ? 0 : this.owner(i), c.g) +
          ' / ' + GROUP_CELLS[c.g].length + '</span></div>';
        if (this.showRent) {
          h += '<div class="kv"><span>租金（空 / 1–4 房 / 酒店）</span><span>' +
            c.rent.join(' · ') + '</span></div>';
          h += '<div style="font-size:11.5px;color:var(--ink-3)">空地若已集齐同组，租金加倍。</div>';
        }
      } else if (c.k === 'rail' && this.showRent) {
        h += '<div class="kv"><span>租金（按持有数）</span><span>' + RAIL_RENT.join(' · ') + '</span></div>';
      } else if (c.k === 'util' && this.showRent) {
        h += '<div class="kv"><span>租金</span><span>一处 4×骰点 · 两处 10×骰点</span></div>';
      } else if (c.k === 'tax') {
        h += '<div class="kv"><span>应缴</span><span>$' + c.cost + '</span></div>';
      }
      if (this.owner(i) >= 0 && this.showRent) {
        h += '<div class="kv"><span>当前租金</span><span>$' + this.rentOf(i, this.d1 + this.d2 || 7) + '</span></div>';
      }
    }
    h += '<h5>产权记号</h5>' +
      '<div style="font-size:11.5px;line-height:1.9">' +
      '格外框线型即持有者：1 实线 · 2 长虚 · 3 点线 · 4 长短虚；<br>' +
      '内缘色带为组别（甲→辛由浅至深，隔组加斜纹），带上小方块为房屋，大方块为酒店。</div>';
    return h;
  };

  /* ═════════ 交互与绘制 ═════════ */
  var KAI = '"Kaiti SC","STKaiti","KaiTi","楷体",serif';
  /* 四家产权各用一种外框线型，黑白下也能分辨 */
  var DASH = [null, [7, 3.5], [1.6, 2.4], [10, 3, 2.2, 3]];

  /** 组带矩形（贴内缘）与沿长轴取点，a ∈ [-.5,.5] */
  function bandFrame(x, y, cell, dx, dy) {
    var d = cell * .22, horizontal = (dy !== 0), rect;
    if (horizontal) rect = (dy === -1) ? [x, y, cell, d] : [x, y + cell - d, cell, d];
    else rect = (dx === 1) ? [x + cell - d, y, d, cell] : [x, y, d, cell];
    return {
      rect: rect, horizontal: horizontal,
      pt: function (a) {
        var mx = rect[0] + rect[2] / 2, my = rect[1] + rect[3] / 2;
        return horizontal ? [mx + a * rect[2], my] : [mx, my + a * rect[3]];
      }
    };
  }

  /* 逐字换行（适配中文，无空格分词） */
  function wrapText(v, str, maxW, o) {
    var out = [], line = '', k, t;
    str = String(str == null ? '' : str);
    for (k = 0; k < str.length; k++) {
      t = line + str.charAt(k);
      if (line && v.measure(t, o) > maxW) { out.push(line); line = str.charAt(k); }
      else line = t;
    }
    if (line) out.push(line);
    return out;
  }

  Monopoly.prototype.layout = function (w, h) {
    var s = Math.min(w, h);
    this.cell = s / GW;
    this.ox = (w - this.cell * GW) / 2;
    this.oy = (h - this.cell * GW) / 2;
    this.W = w; this.H = h;
  };
  Monopoly.prototype.cx = function (c) { return this.ox + (c + .5) * this.cell; };
  Monopoly.prototype.cy = function (r) { return this.oy + (r + .5) * this.cell; };
  Monopoly.prototype.cellXY = function (i) { return [this.cx(RC[i][1]), this.cy(RC[i][0])]; };

  Monopoly.prototype.pick = function (x, y) {
    if (!this.cell) return null;
    var c = Math.floor((x - this.ox) / this.cell);
    var r = Math.floor((y - this.oy) / this.cell);
    if (r < 0 || r >= GW || c < 0 || c >= GW) return null;
    return { r: r, c: c, i: cellIndex(r, c) };
  };
  Monopoly.prototype.pickHint = function (hit) {
    return !!(hit && hit.i >= 0 && !this._over);
  };
  Monopoly.prototype.hover = function (hit) { this._hover = (hit && hit.i != null) ? hit.i : -1; };

  /** 点格只用于查看与指定盖房目标，不改变局面 */
  Monopoly.prototype.click = function (hit) {
    if (!hit || hit.i == null || hit.i < 0) { this.sel = -1; return false; }
    if (this._over) return false;
    this.sel = (this.sel === hit.i) ? -1 : hit.i;
    this.sugg = null;
    if (Hub.App) Hub.App.toast(this.cellBrief(hit.i));
    return false;
  };

  Monopoly.prototype.cellBrief = function (i) {
    var c = CELLS[i], o = this.owner(i), s = c.name;
    if (c.k === 'prop' || c.k === 'rail' || c.k === 'util') {
      s += ' · $' + c.price + ' · ';
      s += (o < 0) ? '无主' : (SEAT_NAME[o] + '持有');
      if (o >= 0 && c.k === 'prop') {
        s += ' · ' + (this.house[i] === 5 ? '酒店' : (this.house[i] + ' 房'));
        s += ' · 现租 $' + this.rentOf(i, this.d1 + this.d2 || 7);
      }
      if (c.k === 'prop') s += ' · ' + GROUP_NAME[c.g] + '组（房价 $' + HOUSE_COST[c.g] + '）';
    } else if (c.k === 'tax') {
      s += ' · 应缴 $' + c.cost;
    } else if (c.k === 'chance' || c.k === 'chest') {
      s += ' · 到此抽一张牌';
    }
    return s;
  };

  /* 四种座位记号：实心圆 / 空心方 / 实心三角 / 空心菱 */
  Monopoly.prototype._glyph = function (v, x, y, r, seat, label) {
    var k = ((seat % 4) + 4) % 4, fg = '#fff', dy = 0;
    if (k === 0) {
      v.circle(x, y, r, { fill: P.ink, stroke: P.ink, w: 1.2 });
    } else if (k === 1) {
      v.rect(x - r * .88, y - r * .88, r * 1.76, r * 1.76, { fill: P.paper, stroke: P.ink, w: 1.4 });
      fg = P.ink;
    } else if (k === 2) {
      v.polygon([[x, y - r * 1.12], [x + r * 1.05, y + r * .78], [x - r * 1.05, y + r * .78]],
        { fill: P.ink2, stroke: P.ink, w: 1.1 });
      dy = r * .16;
    } else {
      v.polygon([[x, y - r], [x + r, y], [x, y + r], [x - r, y]], { fill: P.paper, stroke: P.ink, w: 1.4 });
      fg = P.ink;
    }
    if (label && r > 4.5) {
      v.text(label, x, y + dy, {
        size: Math.max(5.5, r * .95), family: 'monospace', weight: 700, color: fg
      });
    }
  };

  /* 骰子：一点到六点的标准点阵，n=0 时画「骰」字 */
  Monopoly.prototype._drawDie = function (v, cx, cy, size, n) {
    var h = size / 2;
    v.rect(cx - h, cy - h, size, size, { fill: P.paper, stroke: P.ink, w: 1.3, r: size * .16 });
    if (!n) {
      v.text('骰', cx, cy, { size: Math.max(6, size * .34), color: P.ink4, family: KAI });
      return;
    }
    var d = size * .10, ox = size * .25, oy = size * .25, i;
    var pts = {
      1: [[0, 0]],
      2: [[-1, -1], [1, 1]],
      3: [[-1, -1], [0, 0], [1, 1]],
      4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
      5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
      6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]
    }[n] || [];
    for (i = 0; i < pts.length; i++) v.circle(cx + pts[i][0] * ox, cy + pts[i][1] * oy, d, { fill: P.ink });
  };

  Monopoly.prototype._drawHouses = function (v, bf, n, cell) {
    if (!n) return;
    var k, p, s;
    if (n >= 5) {
      p = bf.pt(.12); s = cell * .16;
      v.rect(p[0] - s / 2, p[1] - s / 2, s, s, { fill: P.ink, stroke: P.ink, w: 1 });
      v.cross(p[0], p[1], s * .58, { color: '#fff', w: 1 });
      return;
    }
    s = Math.min(cell * .105, cell * .50 / n);
    for (k = 0; k < n; k++) {
      p = bf.pt(-.14 + (k + .5) * (.52 / n));
      v.rect(p[0] - s / 2, p[1] - s / 2, s, s, { fill: P.ink, stroke: P.ink, w: .8 });
    }
  };

  /* ───────── 主绘制 ───────── */
  Monopoly.prototype.draw = function (v) {
    if (!this.cell) return;
    var cell = this.cell, i;

    /* 内外框 */
    v.rect(this.ox, this.oy, cell * GW, cell * GW, { fill: P.paper, stroke: P.ink, w: 1.6 });
    for (i = 0; i < NC; i++) this._drawCell(v, i);
    v.rect(this.ox + cell, this.oy + cell, cell * (GW - 2), cell * (GW - 2),
      { stroke: P.ink, w: 1.2, a: .8 });

    this._drawCenter(v);
    this._drawTokens(v);
    this._drawSuggest(v);
  };

  Monopoly.prototype._drawCell = function (v, i) {
    var cell = this.cell, rc = RC[i], c = CELLS[i];
    var x = this.ox + rc[1] * cell, y = this.oy + rc[0] * cell;
    if (isCorner(i)) { this._drawCorner(v, i); return; }

    var iw = inward(i), dx = iw[0], dy = iw[1];
    var mx = x + cell / 2, my = y + cell / 2;
    /* 局部坐标：t 沿内缘方向（-.5 外缘 → +.5 内缘），s 垂直 */
    function at(t, s) { return [mx + dx * cell * t - dy * cell * s, my + dy * cell * t + dx * cell * s]; }

    v.rect(x, y, cell, cell, { fill: P.paper2, stroke: P.ruleSoft, w: .7 });
    if (i === this.sel) v.rect(x + 1, y + 1, cell - 2, cell - 2, { fill: P.ink, fillA: .055 });
    else if (i === this._hover) v.rect(x + 1, y + 1, cell - 2, cell - 2, { fill: P.ink, fillA: .03 });

    var o = this.owner(i), p, fs = Math.max(5.5, cell * .185);

    if (c.k === 'prop') {
      /* 组带：底色深浅 + 隔组斜纹，带上写组名与房屋 */
      var bf = bandFrame(x, y, cell, dx, dy), st = GSTYLE[c.g], br = bf.rect;
      v.rect(br[0], br[1], br[2], br[3], { fill: P.ink, fillA: st.a, stroke: P.ink, w: .7, a: .55 });
      if (st.h) {
        v.hatch(br[0], br[1], br[2], br[3], Math.max(3, cell * .085),
          { color: st.a >= .5 ? P.paper : P.ink, w: .7, a: st.a >= .5 ? .30 : .45 });
      }
      p = bf.pt(-.36);
      v.text(GROUP_NAME[c.g], p[0], p[1], {
        size: Math.max(6, cell * .16), family: KAI, weight: 700,
        color: st.a >= .45 ? '#fff' : P.ink2
      });
      this._drawHouses(v, bf, this.house[i], cell);
    }

    /* 名称与副行：上下两行横排，左右两列竖排（逐字堆叠，避开格宽不足） */
    var nm = String(c.name), sub = this._cellSub(i);
    var sdir = (dx === -1) ? -1 : 1;      // 右列的 s 轴朝上，需反号才能自上而下阅读
    function vstack(str, t, o) {
      var step = (o.size || 12) * 1.04 / cell, k, q;
      for (k = 0; k < str.length; k++) {
        q = at(t, sdir * (k - (str.length - 1) / 2) * step);
        v.text(str.charAt(k), q[0], q[1], o);
      }
    }
    if (dy !== 0) {
      p = at(-.08, 0);
      v.text(nm, p[0], p[1], {
        size: nm.length > 3 ? Math.max(5, cell * .165) : fs,
        family: KAI, weight: 600, color: P.ink
      });
      if (sub) {
        p = at(.16, 0);
        v.text(sub, p[0], p[1], {
          size: Math.max(5, cell * (sub.length > 6 ? .11 : .135)),
          color: P.ink3, family: sub.length > 6 ? KAI : 'monospace'
        });
      }
    } else {
      vstack(nm, -.12, { size: Math.max(5, cell * .168), family: KAI, weight: 600, color: P.ink });
      if (sub && sub.charAt(0) === '$') {
        /* 侧列价格旋转 90° 排版，且不标座号（外框线型已表明持有者） */
        p = at(.13, 0);
        v.text(sub.split(' ·')[0], p[0], p[1], {
          size: Math.max(4.5, cell * .12), color: P.ink3, family: 'monospace', rotate: Math.PI / 2
        });
      }
    }

    /* 非地产格的内缘图标（侧列的税格只靠旋转价格表达，不再叠图标） */
    if (c.k !== 'prop' && (dy !== 0 || c.k !== 'tax')) {
      this._drawKindMark(v, at(dy !== 0 ? .36 : .38, 0), cell, c, dy !== 0 ? .12 : .11);
    }

    /* 产权外框：四种线型对应四家 */
    if (o >= 0) {
      v.rect(x + 1.5, y + 1.5, cell - 3, cell - 3,
        { stroke: P.ink, w: 1.9, dash: DASH[o % 4], a: .92 });
    }
    /* 待购高亮 */
    if (i === this.offer && this.phase === 'buy') {
      v.rect(x + 1.5, y + 1.5, cell - 3, cell - 3, { stroke: P.warn, w: 1.7, dash: [4, 3] });
      v.corners(x + 2.5, y + 2.5, cell - 5, cell - 5, cell * .18, { color: P.warn, w: 1.6 });
    }
  };

  Monopoly.prototype._cellSub = function (i) {
    var c = CELLS[i], o = this.owner(i);
    if (c.k === 'prop' || c.k === 'rail' || c.k === 'util') {
      var s = '$' + c.price;
      if (o >= 0) s += ' ·' + (o + 1);
      return s;
    }
    if (c.k === 'tax') return '$' + c.cost;
    if (c.k === 'chance' || c.k === 'chest') return '抽一张';
    return '';
  };

  /** 车站 / 公用事业 / 机会 / 命运 / 税 的小图标 */
  Monopoly.prototype._drawKindMark = function (v, p, cell, c, rk) {
    var x = p[0], y = p[1], r = cell * (rk || .13), k;
    if (c.k === 'rail') {
      /* 铁轨：两道轨 + 横枕 */
      v.line(x - r, y - r * .62, x + r, y - r * .62, { color: P.ink, w: 1.2 });
      v.line(x - r, y + r * .62, x + r, y + r * .62, { color: P.ink, w: 1.2 });
      for (k = -1; k <= 1; k++) {
        v.line(x + k * r * .62, y - r * .9, x + k * r * .62, y + r * .9, { color: P.ink3, w: .9 });
      }
    } else if (c.k === 'util') {
      if (/电/.test(c.name)) {
        v.polyline([[x - r * .35, y - r], [x + r * .18, y - r * .1],
          [x - r * .18, y + r * .1], [x + r * .35, y + r]], { color: P.ink, w: 1.4 });
      } else {
        v.polyline([[x, y - r], [x + r * .72, y + r * .1], [x, y + r], [x - r * .72, y + r * .1]],
          { color: P.ink, w: 1.2 });
        v.arc(x, y + r * .18, r * .5, Math.PI * .15, Math.PI * .85, { color: P.ink3, w: 1 });
      }
    } else if (c.k === 'chance') {
      v.circle(x, y, r * .95, { stroke: P.ink, w: 1.2 });
      v.text('?', x, y + r * .06, { size: Math.max(6, r * 1.25), family: 'monospace', weight: 700 });
    } else if (c.k === 'chest') {
      v.rect(x - r, y - r * .68, r * 2, r * 1.36, { stroke: P.ink, w: 1.2 });
      v.polyline([[x - r, y - r * .68], [x, y + r * .1], [x + r, y - r * .68]], { color: P.ink3, w: 1 });
    } else if (c.k === 'tax') {
      v.text('¥', x, y, { size: Math.max(6, r * 1.5), family: 'monospace', weight: 700, color: P.ink2 });
    }
  };

  Monopoly.prototype._drawCorner = function (v, i) {
    var cell = this.cell, rc = RC[i];
    var x = this.ox + rc[1] * cell, y = this.oy + rc[0] * cell;
    var mx = x + cell / 2, my = y + cell / 2, k;
    v.rect(x, y, cell, cell, { fill: P.paper, stroke: P.ruleSoft, w: .7 });
    if (i === this.sel) v.rect(x + 1, y + 1, cell - 2, cell - 2, { fill: P.ink, fillA: .055 });
    else if (i === this._hover) v.rect(x + 1, y + 1, cell - 2, cell - 2, { fill: P.ink, fillA: .03 });

    var t1 = Math.max(7, cell * .27), t2 = Math.max(5, cell * .15);
    if (i === 0) {
      v.text('起点', mx, my - cell * .18, { size: t1, family: KAI, weight: 700 });
      v.text('GO', mx, my + cell * .06, { size: t2, family: 'monospace', color: P.ink3, tracking: cell * .03 });
      v.text('过此领 $200', mx, my + cell * .24, { size: Math.max(4.5, cell * .115), color: P.ink3, family: KAI });
      /* 行进方向：自起点向左 */
      v.arrow(mx + cell * .24, my + cell * .39, mx - cell * .24, my + cell * .39,
        { color: P.ink, w: 1.2, head: Math.max(4, cell * .10) });
    } else if (i === 10) {
      v.text('监狱', mx, my - cell * .20, { size: t1, family: KAI, weight: 700 });
      v.text('探监', mx, my + cell * .02, { size: t2, family: KAI, color: P.ink3 });
      v.line(x + cell * .12, my + cell * .18, x + cell * .88, my + cell * .18, { color: P.ink, w: 1.1, a: .6 });
      for (k = 1; k <= 4; k++) {
        v.line(x + cell * k * .2, my + cell * .18, x + cell * k * .2, y + cell * .90,
          { color: P.ink, w: 1, a: .55 });
      }
    } else if (i === 20) {
      v.circle(mx, my - cell * .13, cell * .24, { stroke: P.ink, w: 1.4 });
      v.text('停', mx, my - cell * .13, { size: Math.max(7, cell * .26), family: KAI, weight: 700 });
      v.text('免费停车', mx, my + cell * .27, { size: t2, family: KAI });
    } else {
      v.text('入狱', mx, my - cell * .22, { size: t1, family: KAI, weight: 700 });
      v.arrow(mx + cell * .22, my + cell * .02, mx - cell * .18, my + cell * .20,
        { color: P.ink, w: 1.4, head: Math.max(4, cell * .11) });
      v.text('直送监狱', mx, my + cell * .34, { size: Math.max(4.5, cell * .12), color: P.ink3, family: KAI });
    }
  };

  /* ───────── 中央情报区 ───────── */
  Monopoly.prototype._drawCenter = function (v) {
    var cell = this.cell;
    var x0 = this.ox + cell, y0 = this.oy + cell, w0 = cell * (GW - 2);
    var mx = x0 + w0 / 2, s, k;

    /* 标题 */
    v.text('大富翁', mx, y0 + cell * .92, {
      size: Math.max(11, cell * .74), family: KAI, weight: 700, tracking: cell * .05
    });
    v.text('M O N O P O L Y', mx, y0 + cell * 1.55, {
      size: Math.max(5, cell * .20), color: P.ink3, tracking: cell * .04
    });
    v.line(x0 + cell * .5, y0 + cell * 1.88, x0 + w0 - cell * .5, y0 + cell * 1.88,
      { color: P.ruleFaint, w: 1 });

    /* 骰子 */
    this._drawDie(v, mx - cell * .76, y0 + cell * 2.66, cell * .80, this.d1);
    this._drawDie(v, mx + cell * .76, y0 + cell * 2.66, cell * .80, this.d2);
    if (this.d1 && this.d1 === this.d2) {
      v.text('对子', mx, y0 + cell * 3.26, { size: Math.max(5, cell * .17), color: P.warn, family: KAI });
    }

    /* 刚抽到的牌 */
    var ny = y0 + cell * 3.62;
    if (this.card) {
      var cw = w0 - cell * .9, cxs = x0 + cell * .45;
      v.rect(cxs, ny, cw, cell * .80, { stroke: P.ink, w: 1.1, r: cell * .07, fill: P.paper2 });
      var tag = this.card.w === 'chance' ? '机会' : '命运';
      v.text(tag, cxs + cell * .42, ny + cell * .40, {
        size: Math.max(6, cell * .21), family: KAI, weight: 700
      });
      v.line(cxs + cell * .78, ny + cell * .14, cxs + cell * .78, ny + cell * .66, { color: P.ruleSoft, w: .8 });
      var cl = wrapText(v, this.card.text, cw - cell * 1.05,
        { size: Math.max(5, cell * .155), family: KAI });
      for (k = 0; k < Math.min(cl.length, 3); k++) {
        v.text(cl[k], cxs + cell * .92, ny + cell * (.40 + (k - Math.min(cl.length, 3) / 2 + .5) * .245), {
          size: Math.max(5, cell * .155), family: KAI, align: 'left', color: P.ink2
        });
      }
      ny += cell * .98;
    }

    /* 当前状况 */
    var bh = cell * 1.06;
    v.rect(x0 + cell * .45, ny, w0 - cell * .9, bh, { stroke: P.ruleSoft, w: 1, r: cell * .07 });
    var ml = wrapText(v, this.msg, w0 - cell * 1.3, { size: Math.max(5, cell * .165), family: KAI });
    var shown = ml.slice(0, 3), lh = cell * .28;
    for (k = 0; k < shown.length; k++) {
      v.text(shown[k], mx, ny + bh / 2 + (k - (shown.length - 1) / 2) * lh, {
        size: Math.max(5, cell * .165), family: KAI, color: k === 0 ? P.ink : P.ink2
      });
    }

    /* 各家账目 */
    var ty = ny + bh + cell * .34;
    var aCash = x0 + w0 - cell * 4.55, aProp = x0 + w0 - cell * 2.55, aNet = x0 + w0 - cell * .45;
    var hs = Math.max(5, cell * .145);
    v.text('家', x0 + cell * .92, ty, { size: hs, color: P.ink4, align: 'left', family: KAI });
    v.text('现金', aCash, ty, { size: hs, color: P.ink4, align: 'right', family: KAI });
    v.text('产业', aProp, ty, { size: hs, color: P.ink4, align: 'right', family: KAI });
    v.text('净资产', aNet, ty, { size: hs, color: P.ink4, align: 'right', family: KAI });
    v.line(x0 + cell * .45, ty + cell * .13, x0 + w0 - cell * .45, ty + cell * .13,
      { color: P.ruleFaint, w: .9 });

    var ry = ty + cell * .13, rh = cell * .48;
    for (s = 0; s < this.players; s++) {
      var yy = ry + (s + .5) * rh;
      var cur = (!this._over && this.turn === s);
      if (cur) v.rect(x0 + cell * .45, ry + s * rh, w0 - cell * .9, rh, { fill: P.ink, fillA: .05 });
      if (this.out[s]) {
        v.hatch(x0 + cell * .45, ry + s * rh, w0 - cell * .9, rh, Math.max(4, cell * .10),
          { color: P.ink3, w: .7, a: .28 });
      }
      this._glyph(v, x0 + cell * .72, yy, cell * .135, s, String(s + 1));
      v.text((cur ? '▶ ' : '') + SEAT_NAME[s], x0 + cell * .95, yy, {
        size: Math.max(6, cell * .185), family: KAI, align: 'left', weight: cur ? 700 : 400,
        color: this.out[s] ? P.ink4 : P.ink
      });
      v.text('$' + this.money[s], aCash, yy, {
        size: Math.max(6, cell * .175), family: 'monospace', align: 'right',
        color: this.out[s] ? P.ink4 : P.ink
      });
      v.text(this.countProps(s) + '产 ' + this.countHouses(s) + '房', aProp, yy, {
        size: Math.max(5, cell * .155), family: KAI, align: 'right',
        color: this.out[s] ? P.ink4 : P.ink3
      });
      v.text('$' + this.netWorth(s), aNet, yy, {
        size: Math.max(6, cell * .175), family: 'monospace', align: 'right',
        color: this.out[s] ? P.ink4 : P.ink2
      });
      if (s < this.players - 1) {
        v.line(x0 + cell * .55, ry + (s + 1) * rh, x0 + w0 - cell * .55, ry + (s + 1) * rh,
          { color: P.ruleFaint, w: .7 });
      }
    }

    /* 回合与上限 */
    var fy = y0 + w0 - cell * .30;
    v.text('第 ' + this.round + ' / ' + this.maxRound + ' 回合' +
      (this.phase === 'over' ? '　·　已终局' : ''), mx, fy, {
      size: Math.max(5, cell * .16), color: P.ink4, family: KAI
    });
  };

  /* 多家同格时错开摆放：[沿垂直方向, 沿内缘方向] */
  var TOKOFF = {
    1: [[0, 0]],
    2: [[-.115, 0], [.115, 0]],
    3: [[-.145, .07], [.145, .07], [0, -.09]],
    4: [[-.125, .085], [.125, .085], [-.125, -.085], [.125, -.085]]
  };
  /* 角格图案居中，棋子改放外角 */
  var CORNER_TOKEN = {
    0: [.78, .80], 10: [.22, .80], 20: [.22, .18], 30: [.78, .18]
  };

  Monopoly.prototype._drawTokens = function (v) {
    var cell = this.cell, byCell = {}, s, i, j;
    for (s = 0; s < this.players; s++) {
      if (this.out[s]) continue;
      i = this.pos[s];
      if (!byCell[i]) byCell[i] = [];
      byCell[i].push(s);
    }
    for (i = 0; i < NC; i++) {
      var list = byCell[i];
      if (!list || !list.length) continue;
      var rc = RC[i], iw = inward(i);
      var off = TOKOFF[list.length] || TOKOFF[4], R = cell * .112;
      var bx, by, axX, axY;
      if (isCorner(i)) {
        /* 角格：棋子靠外角，沿与对角垂直的方向错开，让开居中的图案 */
        var ca = CORNER_TOKEN[i];
        bx = this.ox + rc[1] * cell + ca[0] * cell;
        by = this.oy + rc[0] * cell + ca[1] * cell;
        axX = -iw[1] * .7071; axY = iw[0] * .7071;
      } else {
        /* 边格：棋子靠外缘，让开名称、副行与内缘组带 */
        bx = this.cx(rc[1]) - iw[0] * cell * .36;
        by = this.cy(rc[0]) - iw[1] * cell * .36;
        axX = -iw[1]; axY = iw[0];
      }
      for (j = 0; j < list.length; j++) {
        var sp = isCorner(i) ? .75 : 1;          // 角格空间小，错开幅度收窄
        var so = off[j][0] * cell * sp, to = off[j][1] * cell * sp;
        var tx = bx + axX * so + iw[0] * to;
        var ty = by + axY * so + iw[1] * to;
        if (!this._over && list[j] === this.turn) {
          v.circle(tx, ty, R * 1.55, { stroke: P.warn, w: 1.3, a: .85, dash: [3, 2.5] });
        }
        this._glyph(v, tx, ty, R, list[j], String(list[j] + 1));
      }
    }
  };

  Monopoly.prototype._drawSuggest = function (v) {
    if (!this.sugg || !(this.sugg.i >= 0)) return;
    var cell = this.cell, rc = RC[this.sugg.i];
    var x = this.ox + rc[1] * cell, y = this.oy + rc[0] * cell;
    v.corners(x + 3, y + 3, cell - 6, cell - 6, cell * .24, { color: P.warn, w: 2.2 });
  };

  /* ───────── 大厅图标 ───────── */
  function icon(v, w, h) {
    var n = 7, cell = Math.min(w, h) / (n + .8);
    var ox = (w - cell * n) / 2, oy = (h - cell * n) / 2, i;
    v.rect(ox, oy, cell * n, cell * n, { stroke: P.ink, w: 1.3 });
    v.rect(ox + cell, oy + cell, cell * (n - 2), cell * (n - 2), { stroke: P.ruleSoft, w: .9 });
    /* 外圈分格 */
    for (i = 1; i < n; i++) {
      v.line(ox + i * cell, oy, ox + i * cell, oy + cell, { color: P.ruleSoft, w: .7 });
      v.line(ox + i * cell, oy + (n - 1) * cell, ox + i * cell, oy + n * cell, { color: P.ruleSoft, w: .7 });
      v.line(ox, oy + i * cell, ox + cell, oy + i * cell, { color: P.ruleSoft, w: .7 });
      v.line(ox + (n - 1) * cell, oy + i * cell, ox + n * cell, oy + i * cell, { color: P.ruleSoft, w: .7 });
    }
    /* 几道组带：由浅至深 */
    var bands = [[.06, 1], [.20, 2], [.42, 3], [.80, 4]];  // [alpha, 位置]
    for (i = 0; i < bands.length; i++) {
      var bx = ox + bands[i][1] * cell;
      v.rect(bx, oy + cell * .74, cell, cell * .26, { fill: P.ink, fillA: bands[i][0] });
      v.rect(bx, oy + n * cell - cell, cell, cell * .26, { fill: P.ink, fillA: bands[i][0] });
    }
    /* 中央：骰子与「富」 */
    var ccx = ox + cell * n / 2, ccy = oy + cell * n / 2;
    v.text('富', ccx, ccy - cell * .28, {
      size: cell * 1.35, family: '"Kaiti SC","STKaiti","KaiTi",serif', weight: 700
    });
    v.rect(ccx - cell * .78, ccy + cell * .62, cell * .62, cell * .62, { stroke: P.ink, w: 1, r: cell * .1 });
    v.rect(ccx + cell * .16, ccy + cell * .62, cell * .62, cell * .62, { fill: P.ink, r: cell * .1 });
    v.circle(ccx - cell * .47, ccy + cell * .93, cell * .075, { fill: P.ink });
    v.circle(ccx + cell * .47, ccy + cell * .93, cell * .075, { fill: P.paper });
  }

  /* ───────── 注册 ───────── */
  Hub.register({
    id: 'monopoly',
    name: '大富翁',
    en: 'MONOPOLY',
    sub: '购地建房，机会命运，让对手破产收场',
    tag: '骰子',
    aspect: 1,
    players: 4,
    minP: 2,
    maxP: 4,
    seatNames: SEAT_NAME,
    ai: true,
    setupNote: '黑白线稿下四家以「实心圆 / 空心方 / 实心三角 / 空心菱」四种记号区分，记号内标有座号 1–4；地产外框线型也对应持有者。',
    options: [
      {
        key: 'players', label: '人数', def: 2,
        choices: [
          { v: 2, label: '2 人', note: '红方对黄方' },
          { v: 3, label: '3 人', note: '红 / 黄 / 蓝' },
          { v: 4, label: '4 人', note: '四家混战' }
        ],
        note: '人数越多，地产被分摊得越快，局势越乱。'
      },
      {
        key: 'startMoney', label: '起始资金', def: 1500,
        choices: [
          { v: 1000, label: '$1000', note: '钱少，易破产' },
          { v: 1500, label: '$1500', note: '标准开局' },
          { v: 2500, label: '$2500', note: '钱多，易盖房' }
        ]
      },
      {
        key: 'maxRound', label: '回合上限', def: 120,
        choices: [
          { v: 60, label: '60 回合', note: '短局' },
          { v: 120, label: '120 回合', note: '标准' },
          { v: 300, label: '300 回合', note: '长局，等破产分出胜负' }
        ],
        note: '达上限后按净资产判定胜负，避免无限拖延。'
      },
      {
        key: 'showRent', label: '租金表', def: true,
        choices: [{ v: true, label: '显示', note: '信息栏列出各级租金' }, { v: false, label: '隐藏' }]
      }
    ],
    rules: {
      intro: '各家自备 $1500，从「起点」出发，掷两枚骰子沿外圈 40 格行进。买尽地产、集齐同组、盖房建店，<b>让其余各家付不出租金而破产</b>者胜。<b>红方先行</b>。',
      sections: [
        {
          title: '回合流程', items: [
            '轮到你时点「掷骰子」，两枚骰子点数之和即行进格数。',
            '<b>过起点领 $200</b>（后退不过起点时不领）。',
            '落地后按格型结算：无主产业可买、他人产业付租、抽牌、缴税或入狱。',
            '结算完毕进入行动阶段：可「盖房」「卖房」，再点「结束回合」。',
            '<b>掷出对子</b>（两骰同点）可在结束本回合后再掷一次；<b>连三次对子直接入狱</b>。'
          ]
        },
        {
          title: '地产与盖房', items: [
            '22 处地产分为 <b>甲乙丙丁戊己庚辛</b> 八组，盘面内缘色带即组别（由浅至深，隔组加斜纹）。',
            '落到<b>无主</b>产业可照价购入；也可「放弃」（本作不设拍卖）。',
            '<b>集齐同组全部地产</b>后方可盖房，房价见组别（$50–$200）。',
            '盖房须<b>均衡</b>：同组每处都盖到同一间数后，才能盖下一间；卖房同理，只能从房数最多的一处开始。',
            '五间房即成<b>酒店</b>，租金最高。卖房收回半价。'
          ]
        },
        {
          title: '租金', items: [
            '地产：按已建房数查表；<b>空地若已集齐同组，租金加倍</b>。',
            '车站（四座）：按持有数计租 —— 25 / 50 / 100 / 200。',
            '公用事业（自来水厂、电力公司）：持一处收 <b>4×骰点</b>，持两处收 <b>10×骰点</b>。',
            '机会牌可能要求「到最近车站租金加倍」或「公用事业按十倍骰点计租」。'
          ],
          table: {
            head: ['组别', '房价', '空地租（首处 / 次处）', '酒店租'],
            rows: [
              ['甲', '$50', '2 / 4', '250 / 450'],
              ['乙', '$50', '6 / 6 / 8', '550 / 550 / 600'],
              ['丙', '$100', '10 / 10 / 12', '750 / 750 / 900'],
              ['丁', '$100', '14 / 14 / 16', '950 / 950 / 1000'],
              ['戊', '$150', '18 / 18 / 20', '1050 / 1050 / 1100'],
              ['己', '$150', '22 / 22 / 24', '1150 / 1150 / 1200'],
              ['庚', '$200', '26 / 26 / 28', '1275 / 1275 / 1400'],
              ['辛', '$200', '35 / 50', '1500 / 2000']
            ]
          }
        },
        {
          title: '机会与命运', items: [
            '落到「机会」（3 处）或「命运」（3 处）即抽一张牌，牌面效果立即生效。',
            '效果包括：移动到某格、前进 / 后退若干格、收钱 / 付钱、向每家收钱、直接入狱、房屋维修费。',
            '<b>卡牌引起的移动会再次结算落点</b>（可能再买、再付租、再抽牌）。',
            '牌堆抽完自动重洗；中央情报区会显示最近一张牌。'
          ]
        },
        {
          title: '监狱', items: [
            '落入「入狱」格、抽到入狱牌、或连掷三次对子，均送入<b>监狱</b>（左下角）。',
            '在狱中仍可正常掷骰：<b>掷出对子</b>即出狱并照点数行进（不追加一掷）。',
            '也可先点「<b>付 $50 出狱</b>」缴纳保释金，本回合照常掷骰。',
            '<b>第三回合</b>仍未掷出对子，强制付 $50 并照点数行进。',
            '停在监狱格（未入狱）只是「探监」，无事；入狱期间名下产业<b>仍照收租金</b>。'
          ]
        },
        {
          title: '破产与胜负', items: [
            '应付金额超过现金时，<b>自动从房数最多的一处开始卖房</b>抵债（半价）。',
            '卖房后仍不足则<b>破产出局</b>：现金尽付债主，产业连同其上房屋一并移交债主（债主为银行则产业归公、房屋拆除）。',
            '<b>其余各家尽数破产者获胜</b>。',
            '若达回合上限仍未分胜负，按<b>净资产</b>（现金 + 地产原价 + 已建房造价）判定。'
          ]
        },
        {
          title: '盘面记号', items: [
            '外圈 40 格，自右下角「起点」<b>向左</b>逆时针绕行一周。',
            '产业格外框线型代表持有者：<b>1 实线 · 2 长虚 · 3 点线 · 4 长短虚</b>。',
            '内缘色带上的小方块为房屋，带十字的大方块为酒店。',
            '价格行的 <code>·1</code> 为持有者座号；待购格套<b>红色虚线框与四角记号</b>。',
            '玩家棋子为四种形状，当前行棋家外套<b>红色虚线圈</b>。',
            '中央依次显示：骰点、最近卡牌、当前状况、各家账目与回合数。',
            '<b>点盘面任一格</b>可在右侧信息栏查看该格的持有者、房价与各级租金。'
          ]
        },
        {
          title: '本作未收录', items: [
            '为保持界面简洁，本作<b>不设抵押、拍卖与玩家间交易</b>。',
            '付不出钱时直接自动卖房抵债，仍不足即破产。',
            '机会 / 命运牌各 12 张，<b>不含「出狱卡」</b>。'
          ]
        }
      ]
    },
    icon: icon,
    create: function (cfg) { return new Monopoly(cfg); }
  });

  Hub.Monopoly = Monopoly;
  Hub.MP = {
    GW: GW, NC: NC, CELLS: CELLS, RC: RC, GROUP_NAME: GROUP_NAME,
    GROUP_CELLS: GROUP_CELLS, HOUSE_COST: HOUSE_COST, RAIL_RENT: RAIL_RENT,
    GSTYLE: GSTYLE, CHANCE: CHANCE, CHEST: CHEST, SEAT_NAME: SEAT_NAME,
    cellRC: cellRC, cellIndex: cellIndex, inward: inward, isCorner: isCorner
  };

})(window);
