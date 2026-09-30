/* ════════════════════════════════════════════════════════════
   hub.js —— 命名空间、棋种注册表、通用工具、对局基类契约
   ════════════════════════════════════════════════════════════
   每个棋种在 js/games/*.js 中调用 GameHub.register(meta) 注册。
   meta 结构：
   {
     id, name, en, sub,            // 标识与文案
     aspect,                       // 棋盘绘制区宽高比（w/h）
     players: 2,                   // 座位数
     ai: true|false,               // 是否内置电脑
     options: [ {key,label,type,choices,default,note} ],  // 开局可选项
     rules: { intro, sections:[{title, items:[]}] },      // 规则说明
     create(cfg) -> Game           // 工厂
   }

   Game 实例需实现的契约（ui.js 只依赖这些方法）：
     layout(w, h)          计算绘制几何
     draw(view)            用 view 提供的线稿图元绘制
     pick(x, y)            画布坐标 -> {r,c} 之类的落点对象，或 null
     click(hit)            处理落点；返回 true 表示局面已改变
     hover(hit|null)       悬停反馈（可选）
     aiMove(level)         电脑行棋；返回 true 表示已落子
     undo()                悔一步；返回 true 表示成功
     seat()                当前行棋方索引
     seatName(i)           座位名，如「红方」
     seatCaptured(i)       该座位已提/吃的子（文本，可选）
     status()              状态行文本
     hint()                提示行文本（可选）
     over()                null | {winner:i|null, title, text}
     log()                 [{n, v, hi}] 记录行（可选）
     info()                HTML 字符串，侧栏信息（可选）
     actions()             [{id,label,title,disabled}] 额外按钮（可选）
     onAction(id)          处理额外按钮
     thinking              true 表示电脑正在计算
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var Hub = global.GameHub = global.GameHub || {};
  Hub.version = '1.0.0';
  Hub.games = {};       // id -> meta
  Hub.order = [];       // 注册顺序

  /* ─────────── 注册 ─────────── */
  Hub.register = function (meta) {
    if (!meta || !meta.id) throw new Error('register: 缺少 id');
    if (Hub.games[meta.id]) throw new Error('register: 重复注册 ' + meta.id);
    Hub.games[meta.id] = meta;
    Hub.order.push(meta.id);
    return meta;
  };
  Hub.get = function (id) { return Hub.games[id] || null; };
  Hub.list = function () { return Hub.order.map(function (id) { return Hub.games[id]; }); };

  /* ─────────── 通用工具 ─────────── */
  var U = Hub.util = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },

    /* 二维数组深拷贝（元素为原始值） */
    clone2d: function (m) {
      var out = new Array(m.length);
      for (var i = 0; i < m.length; i++) out[i] = m[i].slice();
      return out;
    },

    /* 一维 Int8Array / Array 拷贝 */
    clone1d: function (a) { return a.slice(); },

    shuffle: function (arr, rnd) {
      var r = rnd || Math.random;
      for (var i = arr.length - 1; i > 0; i--) {
        var j = (r() * (i + 1)) | 0;
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },

    /* 可复现的伪随机数发生器（mulberry32） */
    rng: function (seed) {
      var s = (seed >>> 0) || 1;
      return function () {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        var t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },

    now: function () {
      return (global.performance && performance.now) ? performance.now() : Date.now();
    },

    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    /* 简易 DOM 构造 */
    el: function (tag, cls, html) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html != null) e.innerHTML = html;
      return e;
    },

    /* 中文数字（象棋着法用） */
    cnNum: ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  };

  /* ─────────── 座位/模式常量 ─────────── */
  Hub.MODE = { PVP: 'pvp', PVE: 'pve' };
  Hub.LEVEL = [
    { v: 1, label: '入门', note: '随性应对，适合初学' },
    { v: 2, label: '进阶', note: '会算两三步，有攻有守' },
    { v: 3, label: '高手', note: '搜索更深，需认真应对' }
  ];

  /* ─────────── 对局基类：提供通用样板 ─────────── */
  function Base(cfg) {
    this.cfg = cfg || {};
    this.history = [];
    this.thinking = false;
    this._over = null;
  }
  Base.prototype = {
    layout: function () {}, draw: function () {}, pick: function () { return null; },
    click: function () { return false; }, hover: function () {},
    undo: function () { return false; },
    aiMove: function () { return false; },
    seat: function () { return 0; },
    seatName: function (i) { return '玩家' + (i + 1); },
    seatCaptured: function () { return ''; },
    status: function () { return ''; },
    hint: function () { return ''; },
    over: function () { return this._over; },
    log: function () { return []; },
    info: function () { return ''; },
    actions: function () { return []; },
    onAction: function () {},
    /* 悔棋步数：人机对局一次退两步（退掉电脑那步） */
    undoSpan: function () { return 1; }
  };
  Hub.Base = Base;

  /* 供各棋种复用的几何小工具 */
  Hub.geom = {
    /* 在给定的可用宽高内，按 aspect 与内边距求出棋盘绘制区 */
    fit: function (W, H, aspect, pad) {
      pad = pad == null ? 0 : pad;
      var aw = W - pad * 2, ah = H - pad * 2;
      if (aw <= 0 || ah <= 0) return { w: 1, h: 1, x: pad, y: pad };
      var w = aw, h = w / aspect;
      if (h > ah) { h = ah; w = h * aspect; }
      return { w: w, h: h, x: (W - w) / 2, y: (H - h) / 2 };
    }
  };

})(window);
