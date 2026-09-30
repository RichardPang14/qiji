/* ════════════════════════════════════════════════════════════
   ui.js —— 应用控制器：大厅、开局设置、对局面板、电脑驱动
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var Hub = global.GameHub;
  var P = Hub.PAL;
  var U = Hub.util;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* 尚未实现的棋种，先在大厅占位；id 与正式注册名一致，一旦实现会自动从这里消失 */
  var UPCOMING = [
    { id: 'flight', name: '飞行棋', en: 'FLIGHT CHESS', sub: '掷骰绕行，同色跳飞，撞落对手回到起点。' },
    { id: 'monopoly', name: '大富翁', en: 'MONOPOLY', sub: '购地建房，机会命运，让对手破产收场。' }
  ];

  var App = Hub.App = {
    view: null,
    canvas: null,
    game: null,
    meta: null,
    cfg: null,
    seats: [],
    busy: false,
    paused: false,
    aiSeq: 0,
    hover: null,
    _ro: null
  };

  /* ════════════════ 启动 ════════════════ */
  App.init = function () {
    App.canvas = $('#board');
    App.view = new Hub.View(App.canvas);

    App.buildLobby();
    App.drawBrand();
    App.bindGlobal();

    global.addEventListener('resize', function () {
      App.drawBrand();
      App.refreshIcons();
      if (App.game) App.fitBoard();
    });
  };

  App.bindGlobal = function () {
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!t) return;
      var act = t.getAttribute('data-act');
      if (act === 'lobby') { if (!App.busy) App.toLobby(); }
      else if (act === 'rules') App.showRules(App.meta);
      else if (act === 'restart') App.confirmRestart();
      else if (act === 'close-modal') App.closeModal();
      else if (act === 'about') App.showAbout();
    });

    $('#modal').addEventListener('click', function (e) {
      if (e.target === this) App.closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#modal').classList.contains('hidden')) { App.closeModal(); return; }
      }
      if (!App.game) return;
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); App.doUndo(); }
      else if (mod && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); App.confirmRestart(); }
    });
  };

  /* ════════════════ 大厅 ════════════════ */
  App.buildLobby = function () {
    var grid = $('#game-grid');
    grid.innerHTML = '';
    Hub.list().forEach(function (meta) { grid.appendChild(App.card(meta)); });

    var up = $('#upcoming-grid');
    up.innerHTML = '';
    /* 已正式注册的棋种不再当作「待补」重复展示 */
    UPCOMING.forEach(function (m) {
      if (Hub.get(m.id)) return;
      up.appendChild(App.cardOff(m));
    });
    /* 全部补齐后隐去整个分区 */
    var label = up.previousElementSibling;
    if (label && label.classList.contains('section-label')) {
      label.classList.toggle('hidden', up.children.length === 0);
    }
  };

  /* 座位数：部分棋种（如跳棋）人数可在开局选项里调 */
  App.seatCountOf = function (meta, pend) {
    var n = pend && pend.opts && pend.opts.players;
    return (n && n > 0) ? n : meta.players;
  };

  App.card = function (meta) {
    var c = U.el('button', 'card');
    c.type = 'button';

    var ico = document.createElement('canvas');
    ico.className = 'card-ico';
    ico.dataset.ico = meta.id;
    c.appendChild(ico);

    var body = U.el('div', 'card-body');
    var tags = [meta.players === 2 ? '二人' : (meta.minP + '–' + meta.maxP + '人')];
    if (meta.ai) tags.push('内置电脑');
    tags.push(meta.tag || '棋类');
    body.innerHTML =
      '<div class="card-name">' + U.esc(meta.name) + '<em>' + U.esc(meta.en || '') + '</em></div>' +
      '<div class="card-sub">' + U.esc(meta.sub || '') + '</div>' +
      '<div class="card-tags">' + tags.map(function (t) { return '<span class="tag">' + U.esc(t) + '</span>'; }).join('') + '</div>';
    c.appendChild(body);

    c.addEventListener('click', function () { App.openSetup(meta); });
    return c;
  };

  App.cardOff = function (m) {
    var c = U.el('div', 'card off');
    c.innerHTML =
      '<canvas class="card-ico"></canvas>' +
      '<div class="card-soon">待补</div>' +
      '<div class="card-body">' +
        '<div class="card-name">' + U.esc(m.name) + '<em>' + U.esc(m.en) + '</em></div>' +
        '<div class="card-sub">' + U.esc(m.sub) + '</div>' +
      '</div>';
    return c;
  };

  /* 大厅缩略图（线稿小样） */
  App.refreshIcons = function () {
    $$('canvas.card-ico').forEach(function (cv) {
      var w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      var v = new Hub.View(cv);
      v.resize(w, h);
      v.begin(null);
      var id = cv.dataset.ico;
      var meta = id && Hub.get(id);
      if (meta && meta.icon) {
        try { meta.icon(v, w, h); } catch (e) { /* 忽略图标错误 */ }
      } else {
        App.drawPlaceholderIcon(v, w, h);
      }
    });
  };

  App.drawPlaceholderIcon = function (v, w, h) {
    var cx = w / 2, cy = h / 2, s = Math.min(w, h) * .16;
    v.line(cx - s * 2, cy, cx + s * 2, cy, { color: P.ruleSoft, w: 1 });
    v.line(cx, cy - s * 2, cx, cy + s * 2, { color: P.ruleSoft, w: 1 });
    v.circle(cx - s * .9, cy - s * .9, s * .55, { stroke: P.ink, w: 1.2 });
    v.circle(cx + s * .9, cy + s * .9, s * .55, { fill: P.ink });
  };

  App.drawBrand = function () {
    var cv = $('#brand-canvas');
    if (!cv) return;
    var box = cv.parentElement || cv.parentNode || { clientWidth: 52, clientHeight: 52 };
    var w = box.clientWidth || 52, h = box.clientHeight || w;
    var v = new Hub.View(cv);
    v.resize(w, h); v.begin(null);
    var s = Math.min(w, h);
    var pad = s * .17, n = 4, i;
    var step = (s - pad * 2) / n;
    var ox = (w - s) / 2, oy = (h - s) / 2;
    for (i = 0; i <= n; i++) {
      v.line(ox + pad, oy + pad + i * step, ox + s - pad, oy + pad + i * step, { color: P.ruleSoft, w: .9 });
      v.line(ox + pad + i * step, oy + pad, ox + pad + i * step, oy + s - pad, { color: P.ruleSoft, w: .9 });
    }
    v.circle(ox + pad + step * 1.5, oy + pad + step * 1.5, step * .42, { fill: P.ink });
    v.circle(ox + pad + step * 2.5, oy + pad + step * 2.5, step * .42, { stroke: P.ink, w: 1.4 });
  };

  /* ════════════════ 弹层 ════════════════ */
  App.modal = function (o) {
    $('#modal-title').textContent = o.title || '';
    var body = $('#modal-body');
    body.innerHTML = '';
    if (typeof o.body === 'string') body.innerHTML = o.body;
    else if (o.body) body.appendChild(o.body);

    var card = $('.modal-card');
    card.classList.toggle('wide', !!o.wide);

    var foot = $('#modal-foot');
    foot.innerHTML = '';
    (o.foot || []).forEach(function (b) {
      var el = U.el('button', 'btn ' + (b.cls || ''), U.esc(b.label));
      el.addEventListener('click', function () { if (b.onClick) b.onClick(); });
      foot.appendChild(el);
    });

    $('#modal').classList.remove('hidden');
    return body;
  };
  App.closeModal = function () { $('#modal').classList.add('hidden'); };

  App.toast = function (msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(App._tt);
    App._tt = setTimeout(function () { t.classList.add('hidden'); }, ms || 1600);
  };

  /* ════════════════ 开局设置 ════════════════ */
  App.openSetup = function (meta) {
    var pend = { mode: meta.ai ? 'pve' : 'pvp', seat: 0, level: 2, opts: {} };
    (meta.options || []).forEach(function (op) { pend.opts[op.key] = op.def; });

    var holder = U.el('div');
    var render = function () {
      holder.innerHTML = '';

      if (meta.ai) {
        holder.appendChild(App.fieldPills('对局方式', [
          { v: 'pvp', label: '双人对战', note: '同屏轮流落子' },
          { v: 'pve', label: '人机对战', note: '与电脑对弈' },
          { v: 'auto', label: '电脑对战', note: '多台电脑互相演示' }
        ], pend.mode, function (v) { pend.mode = v; render(); }));
      }

      /* 棋种自有选项（如人数、棋盘大小）先于「我执」，因为人数会影响座位列表 */
      (meta.options || []).forEach(function (op) {
        if (op.when && !op.when(pend)) return;
        holder.appendChild(App.fieldPills(op.label, op.choices.map(function (c) {
          return { v: c.v, label: c.label, note: c.note };
        }), pend.opts[op.key], function (v) {
          pend.opts[op.key] = v;
          /* 人数变少时，已选的座位号可能越界 */
          var n = App.seatCountOf(meta, pend);
          if (pend.seat >= n) pend.seat = 0;
          render();
        }, op.note));
      });

      if (pend.mode === 'pve') {
        var n = App.seatCountOf(meta, pend);
        /* 部分棋种的座位名随人数而变（如跳棋 2 人局是北 vs 南） */
        var names = meta.seatNamesFor ? meta.seatNamesFor(n) : meta.seatNames;
        var seats = [];
        for (var i = 0; i < n; i++) {
          var nm = (names && names[i]) ? names[i] : ('第' + (i + 1) + '方');
          seats.push({ v: i, label: nm, note: i === 0 ? '先手' : '第 ' + (i + 1) + ' 位' });
        }
        holder.appendChild(App.fieldPills('我执', seats, pend.seat, function (v) { pend.seat = v; }));
      }

      if (pend.mode === 'pve' || pend.mode === 'auto') {
        holder.appendChild(App.fieldPills('电脑强度', Hub.LEVEL.map(function (l) {
          return { v: l.v, label: l.label, note: l.note };
        }), pend.level, function (v) { pend.level = v; }));
      }

      if (meta.setupNote) {
        holder.appendChild(U.el('div', 'field-note', U.esc(meta.setupNote)));
      }
    };
    render();

    App.modal({
      title: meta.name + ' · 开局',
      body: holder,
      foot: [
        { label: '取消', cls: 'btn-ghost', onClick: App.closeModal },
        {
          label: '开始对局', cls: 'btn-solid', onClick: function () {
            App.closeModal();
            App.start(meta, pend);
          }
        }
      ]
    });
  };

  App.fieldPills = function (label, choices, cur, onPick, note) {
    var f = U.el('div', 'field');
    f.appendChild(U.el('label', null, U.esc(label)));
    var box = U.el('div', 'choices');
    choices.forEach(function (c) {
      var b = U.el('button', 'choice' + (c.v === cur ? ' on' : ''));
      b.type = 'button';
      b.innerHTML = U.esc(c.label) + (c.note ? '<small>' + U.esc(c.note) + '</small>' : '');
      b.addEventListener('click', function () {
        onPick(c.v);
        $$('.choice', box).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
      box.appendChild(b);
    });
    f.appendChild(box);
    if (note) f.appendChild(U.el('div', 'field-note', U.esc(note)));
    return f;
  };

  /* ════════════════ 开局 ════════════════ */
  App.start = function (meta, pend) {
    App.meta = meta;
    App.cfg = pend;
    App.paused = false;
    App.busy = false;
    App.hover = null;
    App.aiSeq++;

    /* 座位：谁是电脑 */
    App.seats = [];
    var nSeats = App.seatCountOf(meta, pend);
    for (var i = 0; i < nSeats; i++) {
      var kind = 'human';
      if (pend.mode === 'auto') kind = 'ai';
      else if (pend.mode === 'pve' && i !== pend.seat) kind = 'ai';
      App.seats.push({ kind: kind, level: pend.level });
    }

    var opts = {};
    for (var k in pend.opts) opts[k] = pend.opts[k];
    opts.mode = pend.mode;
    opts.humanSeat = pend.seat;
    opts.level = pend.level;
    opts.seats = App.seats;

    App.game = meta.create(opts);

    $('#screen-lobby').classList.add('hidden');
    $('#screen-table').classList.remove('hidden');
    $('#table-name').textContent = meta.name;
    $('#table-sub').textContent = (meta.en || '') + (meta.sub ? ' · ' + meta.sub : '');
    $('#board-overlay').classList.add('hidden');

    App.bindBoard();
    App.buildActions();
    App.fitBoard();
    App.refresh();
    App.pump();
  };

  App.toLobby = function () {
    App.aiSeq++;
    App.game = null; App.meta = null;
    if (App._ro && App._ro.disconnect) App._ro.disconnect();
    App._ro = null;
    $('#screen-table').classList.add('hidden');
    $('#screen-lobby').classList.remove('hidden');
    App.refreshIcons();
  };

  App.confirmRestart = function () {
    if (!App.game) return;
    App.modal({
      title: '重新开局',
      body: '<div class="about-block"><p>当前对局将被清空，按原有设置重新摆子。</p></div>',
      foot: [
        { label: '取消', cls: 'btn-ghost', onClick: App.closeModal },
        {
          label: '重开', cls: 'btn-solid', onClick: function () {
            App.closeModal();
            App.start(App.meta, App.cfg);
            App.toast('已重新开局');
          }
        }
      ]
    });
  };

  /* ════════════════ 画布尺寸与绘制 ════════════════ */
  App.fitBoard = function () {
    var wrap = $('#board-wrap');
    var pad = wrap.clientWidth < 520 ? 8 : 16;
    var W = wrap.clientWidth - pad * 2;
    var H = wrap.clientHeight - pad * 2;
    if (W < 40 || H < 40) return;
    var box = Hub.geom.fit(W, H, App.meta.aspect, 0);
    App.view.resize(box.w, box.h);
    App.game.layout(box.w, box.h);
    App.draw();

    if (!App._ro && global.ResizeObserver) {
      App._ro = new ResizeObserver(function () {
        if (App.game) App.fitBoard();
      });
      App._ro.observe(wrap);
    }
  };

  App.draw = function () {
    if (!App.game) return;
    App.view.begin(null);
    App.game.draw(App.view);
  };

  /* ════════════════ 输入 ════════════════ */
  App.bindBoard = function () {
    var cv = App.canvas;
    if (cv.__bound) return;
    cv.__bound = true;

    var pos = function (e) {
      var r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    cv.addEventListener('pointerdown', function (e) {
      if (!App.game || App.busy || App.paused) return;
      if (App.isAiTurn()) return;
      var p = pos(e);
      var hit = App.game.pick(p.x, p.y);
      if (!hit) { App.game.click(null); App.refresh(); return; }
      var changed = App.game.click(hit);
      if (changed) { App.afterMove(); } else { App.draw(); App.refresh(); }
    });

    cv.addEventListener('pointermove', function (e) {
      if (!App.game || App.busy) return;
      var p = pos(e);
      var hit = App.game.pick(p.x, p.y);
      var key = hit ? (hit.r + ',' + hit.c) : '';
      if (key === App._lastHover) return;
      App._lastHover = key;
      App.game.hover(hit);
      cv.style.cursor = (hit && App.game.pickHint && App.game.pickHint(hit)) ? 'pointer' : (hit ? 'pointer' : 'default');
      App.draw();
    });

    cv.addEventListener('pointerleave', function () {
      if (!App.game) return;
      App._lastHover = null;
      App.game.hover(null);
      App.draw();
    });
  };

  App.isAiTurn = function () {
    if (!App.game) return false;
    var s = App.seats[App.game.seat()];
    return !!(s && s.kind === 'ai');
  };

  /* ════════════════ 回合推进 ════════════════ */
  App.afterMove = function () {
    App.draw();
    App.refresh();
    App.checkOver();
    App.pump();
  };

  App.checkOver = function () {
    var r = App.game.over();
    if (!r) return false;
    App.busy = false;
    var ov = $('#board-overlay');
    var title = r.title || (r.winner == null ? '和局' : App.game.seatName(r.winner) + '胜');
    var btns = '<div class="ov-btns">' +
      '<button class="btn btn-ghost" data-ov="lobby">返回大厅</button>' +
      '<button class="btn btn-solid" data-ov="again">再来一局</button>' +
      '</div>';
    ov.innerHTML = '<div class="ov-card"><h4>' + U.esc(title) + '</h4><p>' + U.esc(r.text || '') + '</p>' + btns + '</div>';
    ov.classList.remove('hidden');
    $$('[data-ov]', ov).forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.ov === 'lobby') { ov.classList.add('hidden'); App.toLobby(); }
        else { ov.classList.add('hidden'); App.start(App.meta, App.cfg); }
      });
    });
    return true;
  };

  /* 电脑回合泵：只要轮到电脑且未结束就继续 */
  App.pump = function () {
    if (!App.game || App.game.over() || App.paused) return;
    if (!App.isAiTurn()) return;

    var seq = App.aiSeq;
    App.busy = true;
    App.game.thinking = true;
    App.refresh();

    setTimeout(function () {
      if (seq !== App.aiSeq || !App.game) return;
      var t0 = U.now();
      var ok = false;
      try {
        ok = App.game.aiMove(App.seats[App.game.seat()].level);
      } catch (err) {
        if (global.console) console.error('[AI]', err);
        App.toast('电脑行棋出错：' + (err && err.message ? err.message : err));
      }
      App.game.thinking = false;
      App.busy = false;
      if (seq !== App.aiSeq) return;

      App.draw(); App.refresh();
      if (App.checkOver()) return;
      if (!ok) return;              /* 电脑无着可走：交由 over() 判定，不再推进 */

      var waited = U.now() - t0;
      setTimeout(function () {
        if (seq !== App.aiSeq || !App.game) return;
        App.pump();
      }, Math.max(90, 300 - waited));
    }, 70);
  };

  /* ════════════════ 侧栏 ════════════════ */
  App.buildActions = function () {
    var row = $('#action-row');
    row.innerHTML = '';

    var mk = function (label, title, fn, id) {
      var b = U.el('button', 'btn btn-ghost btn-sm', U.esc(label));
      b.type = 'button';
      if (title) b.title = title;
      if (id) b.dataset.btn = id;
      b.addEventListener('click', fn);
      row.appendChild(b);
      return b;
    };

    mk('悔棋', '撤销上一步（Ctrl+Z）', function () { App.doUndo(); }, 'undo');
    if (App.game.suggest) mk('提示', '让电脑给出一步建议', function () { App.doSuggest(); }, 'hint');
    mk('认输', '当前行棋方认输', function () { App.doResign(); }, 'resign');

    /* 游戏自定义按钮 */
    var extra = $('#extra-row');
    extra.innerHTML = '';
    App._extraRow = extra;
    App.refreshExtraActions();
  };

  App.refreshExtraActions = function () {
    var extra = App._extraRow;
    if (!extra) return;
    extra.innerHTML = '';
    var list = App.game.actions ? App.game.actions() : [];
    list.forEach(function (a) {
      var b = U.el('button', 'btn btn-sm ' + (a.primary ? 'btn-solid' : 'btn-ghost'), U.esc(a.label));
      b.type = 'button';
      if (a.title) b.title = a.title;
      if (a.disabled) b.disabled = true;
      b.addEventListener('click', function () {
        if (App.busy) return;
        App.game.onAction(a.id);
        App.afterMove();
      });
      extra.appendChild(b);
    });

    if (App.cfg && App.cfg.mode === 'auto') {
      var p = U.el('button', 'btn btn-ghost btn-sm', App.paused ? '继续' : '暂停');
      p.type = 'button';
      p.addEventListener('click', function () {
        App.paused = !App.paused;
        p.textContent = App.paused ? '继续' : '暂停';
        App.refresh();
        if (!App.paused) App.pump();
      });
      extra.appendChild(p);
    }
  };

  App.refresh = function () {
    if (!App.game) return;
    var g = App.game;

    /* 座位 */
    var sl = $('#seat-list');
    sl.innerHTML = '';
        var nSeat = (g.seatCount ? g.seatCount() : App.meta.players);
    for (var i = 0; i < nSeat; i++) {
      var cur = (g.seat() === i && !g.over());
      var st = App.seats[i];
      var kindTxt = st.kind === 'ai' ? ('电脑 · ' + levelName(st.level)) :
        (App.cfg.mode === 'pvp' ? '玩家 ' + (i + 1) : (i === App.cfg.seat ? '你' : '电脑'));
      var cap = g.seatCaptured ? g.seatCaptured(i) : '';
      var filled = g.seatFilled ? g.seatFilled(i) : (i % 2 === 1);
      var row = U.el('div', 'seat' + (cur ? ' on' : ''));
      row.innerHTML =
        '<span class="seat-turn">' + (cur ? '▶' : '') + '</span>' +
        '<span class="seat-dot' + (filled ? ' fill' : '') + '"></span>' +
        '<span class="seat-name">' + U.esc(g.seatName(i)) + '</span>' +
        '<span class="seat-kind">' + U.esc(kindTxt) + '</span>' +
        (cap ? '<span class="seat-cap">' + U.esc(cap) + '</span>' : '');
      sl.appendChild(row);
    }

    /* 状态 */
    var sln = $('#status-line');
    var txt = g.thinking ? '电脑思考中…' : (g.status() || '');
    sln.innerHTML = txt;
    sln.classList.toggle('warn', /将军|被将|危险|警告/.test(sln.textContent));

    var hl = $('#hint-line');
    hl.textContent = App.paused ? '已暂停' : (g.hint ? g.hint() : '') || '';

    /* 记录 */
    var lb = $('#log-body');
    var logs = g.log ? g.log() : [];
    $('#panel-log').classList.toggle('hidden', !logs.length);
    if (logs.length) {
      var html = '';
      for (var j = 0; j < logs.length; j++) {
        var L = logs[j];
        html += '<div class="log-row' + (L.hi ? ' hi' : '') + '"><span class="n">' + U.esc(L.n) + '</span><span class="v">' + U.esc(L.v) + '</span></div>';
      }
      var atBottom = lb.scrollHeight - lb.scrollTop - lb.clientHeight < 40;
      lb.innerHTML = html;
      if (atBottom) lb.scrollTop = lb.scrollHeight;
    } else {
      lb.innerHTML = '';
    }

    /* 信息 */
    var eb = $('#extra-body');
    eb.innerHTML = g.info ? (g.info() || '') : '';

    /* 按钮可用性 */
    var u = $('[data-btn="undo"]');
    if (u) u.disabled = App.busy || (g.canUndo ? !g.canUndo() : false);
    var h = $('[data-btn="hint"]');
    if (h) h.disabled = App.busy || !!g.over() || (App.cfg.mode === 'auto');
    var r = $('[data-btn="resign"]');
    if (r) r.disabled = App.busy || !!g.over() || (App.cfg.mode === 'auto');

    App.refreshExtraActions();
    App.draw();
  };

  function levelName(v) {
    for (var i = 0; i < Hub.LEVEL.length; i++) if (Hub.LEVEL[i].v === v) return Hub.LEVEL[i].label;
    return '进阶';
  }

  /* ════════════════ 操作 ════════════════ */
  App.doUndo = function () {
    var g = App.game;
    if (!g || App.busy || !g.undo) return;
    /* 人机局：一次退到重新轮回来人类为止（多人局可能要退好几手） */
    var span = 1;
    if (App.cfg.mode === 'pve') {
      span = Math.max(2, g.seatCount ? g.seatCount() : App.meta.players);
    }
    var done = 0;
    for (var i = 0; i < span; i++) {
      if (!g.undo()) break;
      done++;
      if (App.cfg.mode === 'pve') {
        var st = App.seats[g.seat()];
        if (st && st.kind === 'human') break;
      }
    }
    if (!done) { App.toast('无可悔之着'); return; }
    App.paused = false;
    g.clearSuggestion && g.clearSuggestion();
    $('#board-overlay').classList.add('hidden');
    App.refresh();
    App.pump();
  };

  App.doSuggest = function () {
    var g = App.game;
    if (!g || !g.suggest || App.busy || g.over()) return;
    App.busy = true; g.thinking = true; App.refresh();
    setTimeout(function () {
      try { g.suggest(App.cfg.mode === 'auto' ? 3 : App.cfg.level); }
      catch (e) { if (global.console) console.error(e); }
      g.thinking = false; App.busy = false;
      App.refresh();
    }, 40);
  };

  App.doResign = function () {
    var g = App.game;
    if (!g || !g.resign || g.over()) return;
    var who = g.seat();
    App.modal({
      title: '认输',
      body: '<div class="about-block"><p><b>' + U.esc(g.seatName(who)) + '</b> 确认认输？此局立即结束。</p></div>',
      foot: [
        { label: '再想想', cls: 'btn-ghost', onClick: App.closeModal },
        {
          label: '确认认输', cls: 'btn-solid', onClick: function () {
            App.closeModal();
            g.resign(who);
            App.refresh();
            App.checkOver();
          }
        }
      ]
    });
  };

  /* ════════════════ 规则 / 关于 ════════════════ */
  App.showRules = function (meta) {
    if (!meta) return;
    var r = meta.rules || {};
    var html = '';
    if (r.intro) html += '<div class="rules-intro">' + r.intro + '</div>';
    (r.sections || []).forEach(function (s) {
      html += '<div class="rules-sec"><h4>' + U.esc(s.title) + '</h4>';
      if (s.items) {
        html += '<ul>' + s.items.map(function (it) { return '<li>' + it + '</li>'; }).join('') + '</ul>';
      }
      if (s.table) {
        html += '<table class="rules-table"><thead><tr>' +
          s.table.head.map(function (h) { return '<th>' + U.esc(h) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          s.table.rows.map(function (row) {
            return '<tr>' + row.map(function (c) { return '<td>' + U.esc(c) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table>';
      }
      html += '</div>';
    });
    App.modal({
      title: meta.name + ' · 玩法',
      body: html || '<div class="about-block">暂无说明。</div>',
      wide: true,
      foot: [{ label: '知道了', cls: 'btn-solid', onClick: App.closeModal }]
    });
  };

  App.showAbout = function () {
    var done = Hub.list().map(function (m) { return m.name; }).join(' · ');
    /* 已正式注册的不再算「待补」，七戏齐备时该行自动消失 */
    var todo = UPCOMING.filter(function (m) { return !Hub.get(m.id); })
      .map(function (m) { return m.name; }).join(' · ');
    App.modal({
      title: '关于棋集',
      body:
        '<div class="about-block">' +
        '<p>这是一套<b>纯前端</b>的棋类合集，无框架、无构建、不联网。双击 <code>index.html</code> 即可在浏览器中开局。</p>' +
        '<p><b>已完成：</b>' + done + '</p>' +
        (todo ? ('<p><b>待补完：</b>' + todo + '</p>') : '<p><b>七戏齐备。</b></p>') +
        '<p><b>操作：</b>鼠标点选棋子、再点目标位落子；<code>Ctrl+Z</code> 悔棋，<code>Ctrl+R</code> 重开，<code>Esc</code> 关闭弹层。</p>' +
        '<p><b>快捷键之外的按钮：</b>「提示」会请电脑给出一着建议并在盘上标出；「认输」立即结束当前对局。</p>' +
        '<p style="color:var(--ink-3);font-size:12px">电脑强度分入门 / 进阶 / 高手三档，均基于 alpha-beta 搜索或蒙特卡洛模拟，在浏览器内实时计算。</p>' +
        '</div>',
      foot: [{ label: '知道了', cls: 'btn-solid', onClick: App.closeModal }]
    });
  };

  /* ════════════════ 引导 ════════════════ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { App.init(); App.refreshIcons(); });
  } else {
    App.init();
    App.refreshIcons();
  }

})(window);
