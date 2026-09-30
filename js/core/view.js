/* ════════════════════════════════════════════════════════════
   view.js —— 画布封装与「黑白线稿」绘图图元
   ════════════════════════════════════════════════════════════
   所有棋种共用同一套绘图语言：细黑线、留白、无渐变无阴影。
   坐标系一律使用 CSS 像素（内部已按 devicePixelRatio 缩放）。
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var Hub = global.GameHub;

  /* ── 统一色板（极简黑白） ── */
  Hub.PAL = {
    ink:     '#14161a',   // 主墨色
    ink2:    '#3d424b',
    ink3:    '#7b818c',
    ink4:    '#b9bec6',
    rule:    '#14161a',   // 棋盘线
    ruleSoft:'rgba(20,22,26,.42)',
    ruleFaint:'rgba(20,22,26,.16)',
    paper:   '#ffffff',
    paper2:  '#f7f8f9',
    paper3:  '#eef0f2',
    wash:    'rgba(20,22,26,.055)',  // 极淡底色块
    wash2:   'rgba(20,22,26,.11)',
    wash3:   'rgba(20,22,26,.18)',
    warn:    '#a02020'
  };

  var P = Hub.PAL;

  /* ────────────────────────────────────────────────────────
     View
     ──────────────────────────────────────────────────────── */
  function View(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
  }

  View.prototype.resize = function (cssW, cssH) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    cssW = Math.max(1, Math.round(cssW));
    cssH = Math.max(1, Math.round(cssH));
    if (this.w === cssW && this.h === cssH && this.dpr === dpr) return false;
    this.w = cssW; this.h = cssH; this.dpr = dpr;
    this.cv.width = Math.round(cssW * dpr);
    this.cv.height = Math.round(cssH * dpr);
    this.cv.style.width = cssW + 'px';
    this.cv.style.height = cssH + 'px';
    return true;
  };

  View.prototype.begin = function (bg) {
    var c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    if (bg) { c.fillStyle = bg; c.fillRect(0, 0, this.w, this.h); }
    c.lineCap = 'round';
    c.lineJoin = 'round';
    return c;
  };

  /* ── 基础图元 ── */
  View.prototype.line = function (x1, y1, x2, y2, o) {
    o = o || {};
    var c = this.ctx;
    c.save();
    c.strokeStyle = o.color || P.rule;
    c.lineWidth = o.w == null ? 1 : o.w;
    c.globalAlpha = o.a == null ? 1 : o.a;
    if (o.dash) c.setLineDash(o.dash);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.restore();
  };

  View.prototype.polyline = function (pts, o) {
    o = o || {};
    if (pts.length < 2) return;
    var c = this.ctx;
    c.save();
    c.strokeStyle = o.color || P.rule;
    c.lineWidth = o.w == null ? 1 : o.w;
    c.globalAlpha = o.a == null ? 1 : o.a;
    if (o.dash) c.setLineDash(o.dash);
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (o.close) c.closePath();
    c.stroke();
    c.restore();
  };

  View.prototype.rect = function (x, y, w, h, o) {
    o = o || {};
    var c = this.ctx;
    c.save();
    if (o.r) {
      this._roundRect(x, y, w, h, o.r);
    } else {
      c.beginPath(); c.rect(x, y, w, h);
    }
    if (o.fill) { c.fillStyle = o.fill; c.globalAlpha = o.fillA == null ? 1 : o.fillA; c.fill(); c.globalAlpha = 1; }
    if (o.stroke) {
      c.strokeStyle = o.stroke; c.lineWidth = o.w == null ? 1 : o.w;
      c.globalAlpha = o.a == null ? 1 : o.a;
      if (o.dash) c.setLineDash(o.dash);
      c.stroke();
    }
    c.restore();
  };

  View.prototype._roundRect = function (x, y, w, h, r) {
    var c = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };

  View.prototype.circle = function (cx, cy, r, o) {
    o = o || {};
    var c = this.ctx;
    c.save();
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
    if (o.fill) { c.fillStyle = o.fill; c.globalAlpha = o.fillA == null ? 1 : o.fillA; c.fill(); c.globalAlpha = 1; }
    if (o.stroke) {
      c.strokeStyle = o.stroke; c.lineWidth = o.w == null ? 1 : o.w;
      c.globalAlpha = o.a == null ? 1 : o.a;
      if (o.dash) c.setLineDash(o.dash);
      c.stroke();
    }
    c.restore();
  };

  View.prototype.arc = function (cx, cy, r, a0, a1, o) {
    o = o || {};
    var c = this.ctx;
    c.save();
    c.strokeStyle = o.color || P.rule;
    c.lineWidth = o.w == null ? 1 : o.w;
    c.globalAlpha = o.a == null ? 1 : o.a;
    c.beginPath(); c.arc(cx, cy, r, a0, a1, !!o.ccw); c.stroke();
    c.restore();
  };

  View.prototype.polygon = function (pts, o) {
    o = o || {};
    var c = this.ctx;
    c.save();
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    if (o.fill) { c.fillStyle = o.fill; c.fill(); }
    if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = o.w == null ? 1 : o.w; c.stroke(); }
    c.restore();
  };

  /**
   * 文字
   * o = {size, family, weight, color, align, baseline, alpha, tracking, rotate}
   * tracking 为字间距（逐字绘制，用于书法感排版）
   */
  View.prototype.text = function (str, x, y, o) {
    o = o || {};
    var c = this.ctx;
    var size = o.size || 13;
    var family = o.family || '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
    var weight = o.weight || 400;
    c.save();
    c.font = weight + ' ' + size + 'px ' + family;
    c.fillStyle = o.color || P.ink;
    c.globalAlpha = o.alpha == null ? 1 : o.alpha;
    c.textAlign = o.align || 'center';
    c.textBaseline = o.baseline || 'middle';
    if (o.rotate) { c.translate(x, y); c.rotate(o.rotate); x = 0; y = 0; }
    if (o.tracking) {
      var chars = String(str).split('');
      var tw = 0, i;
      for (i = 0; i < chars.length; i++) tw += c.measureText(chars[i]).width + o.tracking;
      tw -= o.tracking;
      var sx = x - (c.textAlign === 'center' ? tw / 2 : (c.textAlign === 'right' ? tw : 0));
      var prev = c.textAlign; c.textAlign = 'left';
      for (i = 0; i < chars.length; i++) {
        c.fillText(chars[i], sx, y);
        sx += c.measureText(chars[i]).width + o.tracking;
      }
      c.textAlign = prev;
    } else {
      c.fillText(str, x, y);
    }
    c.restore();
  };

  View.prototype.measure = function (str, o) {
    o = o || {};
    var c = this.ctx;
    var size = o.size || 13;
    var family = o.family || '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
    c.save();
    c.font = (o.weight || 400) + ' ' + size + 'px ' + family;
    var w = c.measureText(str).width;
    c.restore();
    return w;
  };

  /* ── 线稿专用记号 ── */

  /* 十字标记（围棋星位 / 落点提示） */
  View.prototype.cross = function (cx, cy, s, o) {
    o = o || {};
    this.line(cx - s, cy, cx + s, cy, o);
    this.line(cx, cy - s, cx, cy + s, o);
  };

  /* 实心小圆点 */
  View.prototype.dot = function (cx, cy, r, color, a) {
    this.circle(cx, cy, r, { fill: color || P.ink, fillA: a == null ? 1 : a });
  };

  /* 空心小圈：可选落点 */
  View.prototype.ring = function (cx, cy, r, o) {
    o = o || {};
    this.circle(cx, cy, r, {
      stroke: o.color || P.ink, w: o.w == null ? 1 : o.w,
      a: o.a == null ? .5 : o.a, dash: o.dash
    });
  };

  /* 选中框：四角直角短线，线稿风格的「聚焦」记号 */
  View.prototype.corners = function (x, y, w, h, len, o) {
    o = o || {};
    var col = o.color || P.ink, lw = o.w == null ? 1.6 : o.w;
    len = Math.min(len, w / 2 - 1, h / 2 - 1);
    var pts = [
      [[x, y + len], [x, y], [x + len, y]],
      [[x + w - len, y], [x + w, y], [x + w, y + len]],
      [[x + w, y + h - len], [x + w, y + h], [x + w - len, y + h]],
      [[x + len, y + h], [x, y + h], [x, y + h - len]]
    ];
    for (var i = 0; i < 4; i++) this.polyline(pts[i], { color: col, w: lw, a: o.a });
  };

  /* 斜线填充（河流 / 禁区 / 不可用区域） */
  View.prototype.hatch = function (x, y, w, h, gap, o) {
    o = o || {};
    var c = this.ctx;
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.strokeStyle = o.color || P.ruleSoft;
    c.lineWidth = o.w == null ? .7 : o.w;
    c.globalAlpha = o.a == null ? .55 : o.a;
    var step = gap || 7, d = w + h;
    for (var t = -h; t < d; t += step) {
      c.beginPath();
      c.moveTo(x + t, y + h);
      c.lineTo(x + t + h, y);
      c.stroke();
    }
    c.restore();
  };

  /* 波浪线（河流水纹） */
  View.prototype.wave = function (x, y, w, amp, waves, o) {
    o = o || {};
    var c = this.ctx;
    c.save();
    c.strokeStyle = o.color || P.ruleSoft;
    c.lineWidth = o.w == null ? .9 : o.w;
    c.globalAlpha = o.a == null ? .75 : o.a;
    var n = Math.max(1, waves | 0), seg = w / (n * 2), i;
    c.beginPath(); c.moveTo(x, y);
    for (i = 0; i < n * 2; i++) {
      var dir = (i % 2 === 0) ? -1 : 1;
      c.quadraticCurveTo(x + seg * (i + .5), y + dir * amp, x + seg * (i + 1), y);
    }
    c.stroke();
    c.restore();
  };

  /* 箭头 */
  View.prototype.arrow = function (x1, y1, x2, y2, o) {
    o = o || {};
    var col = o.color || P.ink;
    var lw = o.w == null ? 1.3 : o.w;
    var head = o.head == null ? 7 : o.head;
    var ang = Math.atan2(y2 - y1, x2 - x1);
    var bx = x2 - Math.cos(ang) * head * .8, by = y2 - Math.sin(ang) * head * .8;
    this.line(x1, y1, bx, by, { color: col, w: lw, a: o.a, dash: o.dash });
    this.polygon([
      [x2, y2],
      [x2 - Math.cos(ang - .42) * head, y2 - Math.sin(ang - .42) * head],
      [x2 - Math.cos(ang + .42) * head, y2 - Math.sin(ang + .42) * head]
    ], { fill: col });
  };

  /* ── 棋子图元（各棋种共用） ── */

  /**
   * 圆形棋子
   * filled=true  → 墨底白字（后手/黑方）
   * filled=false → 白底墨字墨边（先手/红方）
   */
  View.prototype.disc = function (cx, cy, r, o) {
    o = o || {};
    var filled = !!o.filled;
    var c = this.ctx;
    /* 底 */
    this.circle(cx, cy, r, {
      fill: filled ? P.ink : P.paper,
      stroke: P.ink,
      w: o.w == null ? 1.3 : o.w,
      a: o.a
    });
    /* 内圈（线稿棋子的双层环） */
    if (o.ring !== false && r > 9) {
      this.circle(cx, cy, r * (o.ringK == null ? .78 : o.ringK), {
        stroke: filled ? 'rgba(255,255,255,.6)' : 'rgba(20,22,26,.34)',
        w: .8
      });
    }
    if (o.label) {
      this.text(o.label, cx, cy + (o.dy || 0), {
        size: o.size || Math.round(r * 1.02),
        family: o.family || '"Kaiti SC","STKaiti","KaiTi","楷体",serif',
        weight: o.weight || 600,
        color: filled ? '#fff' : P.ink
      });
    }
    return c;
  };

  /**
   * 方形/圆角棋子（斗兽棋、大富翁之类用）
   */
  View.prototype.tile = function (cx, cy, w, h, o) {
    o = o || {};
    var filled = !!o.filled;
    this._roundRect(cx - w / 2, cy - h / 2, w, h, o.r == null ? 3 : o.r);
    var c = this.ctx;
    c.save();
    c.fillStyle = filled ? P.ink : P.paper;
    c.globalAlpha = o.a == null ? 1 : o.a;
    c.fill();
    c.strokeStyle = P.ink;
    c.lineWidth = o.lw == null ? 1.2 : o.lw;
    c.stroke();
    c.restore();
    if (o.label) {
      this.text(o.label, cx, cy + (o.dy || 0), {
        size: o.size || Math.round(Math.min(w, h) * .52),
        family: o.family || '"Kaiti SC","STKaiti","KaiTi","楷体",serif',
        weight: o.weight || 600,
        color: filled ? '#fff' : P.ink
      });
    }
  };

  Hub.View = View;

})(window);
