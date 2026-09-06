/*!
 * lobby.js — 《OI杀》v4 大厅界面（P6b-v2a）
 *
 * mountLobby(rootEl, client, opts) — 用纯 DOM 字符串构建大厅:
 *   · 昵称输入 + 观战复选框 + 加入按钮
 *   · 座位列表（最多 6 座, 房主/离线标记）
 *   · 房主配置（humanCount / aiFill / randomIdentity / difficulty, 仅房主可改, 改动即时 client.config）
 *   · 开局按钮（仅房主 + canStart 可用, 走 client.start(config)）
 *   · 房间 URL 展示（opts.url 或 client.url, 可复制）
 * 所有交互只经 client 门面（join/config/start/subscribe）; 页面切换信号经 opts 回调
 * (onHello/onLobby/onReject/onGameStart/onState) 交给集成阶段。
 * 样式类统一 .lobby-* 前缀, 由集成阶段（index.html/P6b 接线）提供 CSS。
 * 零依赖; CommonJS 导出 + 浏览器命名空间 OIKill.ui.lobby。
 */
(function (root) {
  'use strict';

  const MAX_SEATS = 6;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function mountLobby(rootEl, client, opts) {
    if (typeof document === 'undefined' || !rootEl || !client) return null; // node require 安全
    opts = opts || {};

    const S = {
      self: null, joined: false, lobby: null,
      config: { humanCount: 6, aiFill: null, randomIdentity: false, difficulty: 'normal' },
    };
    const urlText = opts.url || (client && client.url) || (typeof location !== 'undefined' ? location.href : '');

    rootEl.classList.add('lobby-root');
    rootEl.innerHTML =
      '<div class="lobby-panel">' +
        '<div class="lobby-title">OI杀 v4 · 房间大厅</div>' +
        '<div class="lobby-url">房间地址 <code class="lobby-url-text">' + esc(urlText) + '</code>' +
          '<button class="btn sm lobby-copy" type="button">复制</button></div>' +
        '<div class="lobby-join-row">' +
          '<input class="lobby-name" maxlength="20" placeholder="输入昵称" value="' + esc(opts.name || '') + '">' +
          '<label class="lobby-spectate"><input type="checkbox" class="lobby-spectate-box"' + (opts.spectate ? ' checked' : '') + '>观战</label>' +
          '<button class="btn primary lobby-join" type="button">加入</button>' +
        '</div>' +
        '<div class="lobby-seats"></div>' +
        '<div class="lobby-config">' +
          '<div class="lobby-config-title">房主设置</div>' +
          '<label class="lobby-cfg">人类数 <input class="lobby-human" type="number" min="1" max="6" step="1" value="6"></label>' +
          '<label class="lobby-cfg">AI补位 <input class="lobby-aifill" type="number" min="0" max="5" step="1" placeholder="自动"></label>' +
          '<label class="lobby-cfg"><input class="lobby-rand" type="checkbox">随机身份</label>' +
          '<label class="lobby-cfg">难度 <select class="lobby-diff">' +
            '<option value="easy">easy</option>' +
            '<option value="normal" selected>normal</option>' +
            '<option value="hard">hard</option>' +
          '</select></label>' +
        '</div>' +
        '<div class="lobby-actions"><button class="btn green lobby-start" type="button" disabled>开局</button></div>' +
        '<div class="lobby-status">—</div>' +
      '</div>';

    const q = (sel) => rootEl.querySelector(sel);
    const els = {
      name: q('.lobby-name'), spectate: q('.lobby-spectate-box'), join: q('.lobby-join'),
      seats: q('.lobby-seats'),
      human: q('.lobby-human'), aifill: q('.lobby-aifill'), rand: q('.lobby-rand'), diff: q('.lobby-diff'),
      start: q('.lobby-start'), status: q('.lobby-status'), copy: q('.lobby-copy'),
    };

    function status(txt) { els.status.textContent = txt; }

    function readConfig() {
      const humanCount = Math.max(1, Math.min(MAX_SEATS, parseInt(els.human.value, 10) || 6));
      const raw = els.aifill.value.trim();
      const aiFill = raw === '' ? null : Math.max(0, Math.min(MAX_SEATS - humanCount, parseInt(raw, 10) || 0));
      return { humanCount, aiFill, randomIdentity: !!els.rand.checked, difficulty: els.diff.value };
    }

    function applyConfig(cfg) {
      if (cfg.humanCount !== undefined) els.human.value = String(cfg.humanCount);
      if (cfg.aiFill !== undefined) els.aifill.value = cfg.aiFill === null || cfg.aiFill === undefined ? '' : String(cfg.aiFill);
      if (cfg.randomIdentity !== undefined) els.rand.checked = !!cfg.randomIdentity;
      if (cfg.difficulty !== undefined && ['easy', 'normal', 'hard'].indexOf(cfg.difficulty) >= 0) els.diff.value = cfg.difficulty;
      S.config = Object.assign({}, S.config, cfg);
    }

    function renderSeats(players) {
      const rows = [];
      for (let i = 0; i < MAX_SEATS; i++) {
        const p = players && players.find(x => x.seatId === i);
        if (p) {
          rows.push(
            '<div class="lobby-seat' + (S.self && S.self.seatId === i ? ' lobby-seat-me' : '') + '">' +
              '<span class="lobby-seat-no">' + (i + 1) + '号</span>' +
              '<span class="lobby-seat-name">' + esc(p.name) + '</span>' +
              (p.isHost ? '<span class="lobby-seat-host">房主</span>' : '') +
              (p.connected === false ? '<span class="lobby-seat-off">离线</span>' : '') +
            '</div>'
          );
        } else {
          rows.push(
            '<div class="lobby-seat lobby-seat-empty"><span class="lobby-seat-no">' + (i + 1) + '号</span><span class="lobby-seat-name">空位</span></div>'
          );
        }
      }
      els.seats.innerHTML = rows.join('');
    }

    function renderControls() {
      const isHost = !!(S.self && S.self.isHost);
      const hostOnly = [els.human, els.aifill, els.rand, els.diff];
      for (const el of hostOnly) el.disabled = !isHost;
      const canStart = isHost && S.lobby && S.lobby.canStart !== false;
      els.start.disabled = !canStart;
      els.join.disabled = S.joined;
      els.name.disabled = S.joined;
      els.spectate.disabled = S.joined;
    }

    /* ---------------- 交互（只经 client 门面） ---------------- */
    els.join.addEventListener('click', () => {
      if (S.joined) return;
      const name = els.name.value.trim() || ('玩家' + (1 + Math.floor(Math.random() * 999)));
      const wantSpec = !!els.spectate.checked;
      els.join.disabled = true;
      els.name.disabled = true;
      status('正在加入…');
      Promise.resolve(client.join({ name, spectate: wantSpec })).catch(e => {
        S.joined = false;
        els.join.disabled = false;
        els.name.disabled = false;
        els.spectate.disabled = false;
        status('加入失败: ' + ((e && e.message) || e));
      });
      if (opts.onJoin) opts.onJoin(name, wantSpec);
    });

    els.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') els.join.click();
    });

    els.start.addEventListener('click', () => {
      if (!(S.self && S.self.isHost)) { status('只有房主可以开局'); return; }
      status('开局中…');
      Promise.resolve(client.start(readConfig()));
      if (opts.onStart) opts.onStart(readConfig());
    });

    for (const el of [els.human, els.aifill, els.rand, els.diff]) {
      el.addEventListener('change', () => {
        if (S.self && S.self.isHost && client.config) client.config(readConfig());
        else status('只有房主可以修改配置');
      });
    }

    els.copy.addEventListener('click', () => {
      const txt = urlText;
      const done = () => status('已复制: ' + txt);
      const fallback = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = txt;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          done();
        } catch (e) { status(txt); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback);
      else fallback();
    });

    /* ---------------- 订阅（client 门面回调） ---------------- */
    function onMsg(m) {
      if (!m || !m.type) return;
      if (m.type === 'hello') {
        S.self = m.self || null;
        S.joined = true;
        renderControls();
        renderSeats(S.lobby && S.lobby.players);
        status(S.self
          ? (S.self.seatId !== null && S.self.seatId !== undefined ? '已入座 · ' + S.self.name + (S.self.isHost ? '(房主)' : '') : '已进入观战 · ' + S.self.name)
          : '已连接');
        if (opts.onHello) opts.onHello(m);
      } else if (m.type === 'lobby') {
        S.lobby = m;
        if (m.config) applyConfig(m.config);
        renderSeats(m.players);
        renderControls();
        if (opts.onLobby) opts.onLobby(m);
      } else if (m.type === 'reject') {
        status('被拒绝: ' + (m.why || '未知原因'));
        if (opts.onReject) opts.onReject(m);
      } else if (m.type === 'setup') {
        status('对局已开始…');
        if (opts.onGameStart) opts.onGameStart(m);
      } else if (m.type === 'state') {
        if (opts.onState) opts.onState(m);
      }
    }
    const unsubscribe = client.subscribe(onMsg);

    renderSeats([]);
    renderControls();

    return {
      el: rootEl,
      getConfig: readConfig,
      setSpectate(v) { els.spectate.checked = !!v; },
      destroy() {
        unsubscribe();
        rootEl.innerHTML = '';
        rootEl.classList.remove('lobby-root');
      },
    };
  }

  const api = { mountLobby, MAX_SEATS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    const NS = root.OIKill = root.OIKill || {};
    const UI = NS.ui = NS.ui || {};
    UI.lobby = api; // 浏览器命名空间: OIKill.ui.lobby
  }
})(typeof window !== 'undefined' ? window : globalThis);
