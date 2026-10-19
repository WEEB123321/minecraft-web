/* ============================================================
 * 方块世界 · UI：菜单 / HUD / 聊天 / 快捷栏 / 触屏控制
 * ============================================================ */
(function () {
  'use strict';
  const BWC = window.BWC;
  const U = BWC.util;

  const $ = (id) => document.getElementById(id);

  const UI = (BWC.UI = {
    els: {},
    state: { screen: 'menu' },
    chatOpen: false,
    chatLog: [],
    settings: null,
    touch: { f: 0, r: 0, jump: false, sneak: false, lookX: 0, lookY: 0, action: null, flyTap: false },
    isTouch: false,
    _handlers: {},
    _prevScreen: 'menu',
    _toastTimers: [],

    init(handlers) {
      this._handlers = handlers || {};
      const ids = [
        'game', 'hud', 'crosshair', 'chat-log', 'chat-input-wrap', 'chat-input',
        'hotbar', 'debug', 'players-panel', 'toasts', 'net-badge',
        'overlay-menu', 'overlay-multi', 'overlay-settings', 'overlay-help',
        'overlay-pause', 'overlay-loading', 'overlay-palette', 'palette-grid',
        'loading-text', 'loading-bar', 'fatal',
        'input-name', 'input-hue', 'input-seed', 'hue-dot',
        'btn-single', 'btn-continue', 'btn-multi', 'btn-settings', 'btn-help',
        'btn-continue-info',
        'multi-tabs', 'room-code', 'btn-create-room', 'btn-copy-code',
        'host-status', 'host-players', 'btn-host-enter', 'input-server',
        'input-join-code', 'btn-join-room', 'join-status',
        'btn-direct-create', 'direct-offer', 'btn-copy-offer',
        'direct-answer', 'btn-direct-accept',
        'direct-input', 'btn-direct-join', 'direct-output', 'btn-copy-answer',
        'direct-status', 'btn-multi-back',
        'btn-pause-resume', 'btn-pause-copy', 'btn-pause-settings',
        'btn-pause-export', 'btn-pause-import', 'file-import',
        'btn-pause-leave', 'pause-info',
        'set-sens', 'set-sens-val', 'set-sound', 'set-rd', 'set-rd-val',
        'btn-fullscreen', 'btn-settings-back',
        'btn-help-back', 'touch', 'joy', 'joy-knob',
        't-jump', 't-fly', 't-place', 't-palette', 't-sneak',
      ];
      ids.forEach((id) => { this.els[id] = $(id); });

      this.settings = U.loadLocal('bwc.settings', {
        sensitivity: 1.0,
        sound: true,
        renderDistance: 0, // 0 = 跟随画质预设
      });

      this.isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

      this._bind(handlers);
      this._initTouch();
      return this;
    },

    /* ---------------- 事件绑定 ---------------- */
    _bind(h) {
      const on = (id, fn) => {
        const el = this.els[id];
        if (el) el.addEventListener('click', (e) => { BWC.Audio.play('click'); fn(e); });
      };
      on('btn-single', () => h.onStart && h.onStart(false));
      on('btn-continue', () => h.onStart && h.onStart(true));
      on('btn-multi', () => this.showScreen('multi'));
      on('btn-settings', () => this.showScreen('settings'));
      on('btn-help', () => this.showScreen('help'));
      on('btn-multi-back', () => this.showScreen('menu'));
      on('btn-settings-back', () => this.showScreen(this._prevScreen === 'settings' ? 'menu' : this._prevScreen));
      on('btn-help-back', () => this.showScreen('menu'));

      on('btn-create-room', () => h.onCreateRoom && h.onCreateRoom());
      on('btn-copy-code', () => {
        const code = (this.els['room-code'].dataset.code || '');
        U.copyText(code).then((ok) => this.toast(ok ? '房间码已复制' : '复制失败，请手动选择复制'));
      });
      on('btn-host-enter', () => h.onHostEnter && h.onHostEnter());
      on('btn-join-room', () => h.onJoinRoom && h.onJoinRoom(this.els['input-join-code'].value));

      on('btn-direct-create', () => h.onDirectCreate && h.onDirectCreate());
      on('btn-copy-offer', () => {
        U.copyText(this.els['direct-offer'].value).then((ok) => this.toast(ok ? '邀请码已复制' : '复制失败'));
      });
      on('btn-direct-accept', () => h.onDirectAccept && h.onDirectAccept(this.els['direct-answer'].value));
      on('btn-direct-join', () => h.onDirectJoin && h.onDirectJoin(this.els['direct-input'].value));
      on('btn-copy-answer', () => {
        U.copyText(this.els['direct-output'].value).then((ok) => this.toast(ok ? '应答码已复制，发回给房主' : '复制失败'));
      });

      on('btn-pause-resume', () => h.onResume && h.onResume());
      on('btn-pause-copy', () => h.onCopyRoomCode && h.onCopyRoomCode());
      on('btn-pause-settings', () => this.showScreen('settings'));
      on('btn-pause-export', () => h.onExportSave && h.onExportSave());
      on('btn-pause-import', () => this.els['file-import'].click());
      on('btn-pause-leave', () => h.onLeave && h.onLeave());
      on('btn-fullscreen', () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
        else document.exitFullscreen().catch(() => {});
      });

      const fi = this.els['file-import'];
      if (fi) {
        fi.addEventListener('change', () => {
          const file = fi.files && fi.files[0];
          if (!file || !h.onImportSave) return;
          const reader = new FileReader();
          reader.onload = () => h.onImportSave(String(reader.result));
          reader.readAsText(file);
          fi.value = '';
        });
      }

      // 多人面板 tab 切换
      const tabs = document.querySelectorAll('#multi-tabs .tab');
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          BWC.Audio.play('click');
          tabs.forEach((t) => t.classList.toggle('active', t === tab));
          document.querySelectorAll('.tab-page').forEach((p) => {
            p.classList.toggle('hidden', p.dataset.page !== tab.dataset.tab);
          });
        });
      });

      // 设置
      const sens = this.els['set-sens'];
      const rd = this.els['set-rd'];
      const sound = this.els['set-sound'];
      if (sens) {
        sens.value = String(this.settings.sensitivity);
        this.els['set-sens-val'].textContent = Number(this.settings.sensitivity).toFixed(1) + 'x';
        sens.addEventListener('input', () => {
          this.settings.sensitivity = Number(sens.value);
          this.els['set-sens-val'].textContent = this.settings.sensitivity.toFixed(1) + 'x';
          this._saveSettings();
        });
      }
      if (rd) {
        rd.value = String(this.settings.renderDistance || 0);
        this.els['set-rd-val'].textContent = this.settings.renderDistance ? this.settings.renderDistance + ' 区块' : '跟随画质';
        rd.addEventListener('input', () => {
          this.settings.renderDistance = Number(rd.value);
          this.els['set-rd-val'].textContent = this.settings.renderDistance ? this.settings.renderDistance + ' 区块' : '跟随画质';
          this._saveSettings();
          h.onRenderDistance && h.onRenderDistance(this.settings.renderDistance);
        });
      }
      if (sound) {
        sound.checked = !!this.settings.sound;
        BWC.Audio.setEnabled(this.settings.sound);
        sound.addEventListener('change', () => {
          this.settings.sound = !!sound.checked;
          BWC.Audio.setEnabled(this.settings.sound);
          this._saveSettings();
        });
      }

      // 昵称与颜色
      const name = this.els['input-name'];
      const hue = this.els['input-hue'];
      const dot = this.els['hue-dot'];
      const applyHue = () => {
        if (dot) dot.style.background = 'hsl(' + hue.value + ', 60%, 45%)';
      };
      if (name) {
        name.value = U.loadLocal('bwc.name', '');
        name.addEventListener('change', () => U.saveLocal('bwc.name', name.value.trim().slice(0, 12)));
      }
      if (hue) {
        hue.value = String(U.loadLocal('bwc.hue', 210));
        applyHue();
        hue.addEventListener('input', () => {
          applyHue();
          U.saveLocal('bwc.hue', Number(hue.value));
        });
      }

      // 触屏按键
      const t = h.onTouchAction;
      const tap = (id, fn) => {
        const el = this.els[id];
        if (!el) return;
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
      };
      tap('t-fly', () => { this.touch.flyTap = true; BWC.Audio.play('click'); });
      tap('t-place', () => { this.touch.action = 'place'; BWC.Audio.play('click'); });
      tap('t-palette', () => h.onKeyAction && h.onKeyAction('palette'));
      const jumpEl = this.els['t-jump'];
      if (jumpEl) {
        const setJump = (v) => (e) => { e.preventDefault(); e.stopPropagation(); this.touch.jump = v; };
        jumpEl.addEventListener('pointerdown', setJump(true));
        jumpEl.addEventListener('pointerup', setJump(false));
        jumpEl.addEventListener('pointercancel', setJump(false));
        jumpEl.addEventListener('pointerleave', setJump(false));
      }
      const sneakEl = this.els['t-sneak'];
      if (sneakEl) {
        const setSn = (v) => (e) => { e.preventDefault(); e.stopPropagation(); this.touch.sneak = v; };
        sneakEl.addEventListener('pointerdown', setSn(true));
        sneakEl.addEventListener('pointerup', setSn(false));
        sneakEl.addEventListener('pointercancel', setSn(false));
      }
    },

    _saveSettings() {
      U.saveLocal('bwc.settings', this.settings);
    },

    getName() {
      const v = (this.els['input-name'] && this.els['input-name'].value || '').trim();
      return v ? v.slice(0, 12) : '玩家' + ((Math.random() * 900 + 100) | 0);
    },
    getHue() {
      const v = this.els['input-hue'] ? Number(this.els['input-hue'].value) : 210;
      return isFinite(v) ? v : 210;
    },
    getSeed() {
      const v = (this.els['input-seed'] && this.els['input-seed'].value || '').trim();
      return v ? v.slice(0, 24) : '';
    },

    /* ---------------- 屏幕切换 ---------------- */
    showScreen(name) {
      if (name !== 'settings') this._prevScreen = this.state.screen;
      this.state.screen = name;
      const map = {
        menu: 'overlay-menu',
        multi: 'overlay-multi',
        settings: 'overlay-settings',
        help: 'overlay-help',
        pause: 'overlay-pause',
        loading: 'overlay-loading',
        palette: 'overlay-palette',
      };
      Object.keys(map).forEach((k) => {
        const el = this.els[map[k]];
        if (el) el.classList.toggle('hidden', k !== name);
      });
      const inGame = (name === 'none' || name === 'pause' || name === 'palette' || name === 'settings');
      if (this.els['hud']) this.els['hud'].classList.toggle('hidden', name === 'menu' || name === 'loading' || name === 'help');
      if (this.els['touch']) this.els['touch'].classList.toggle('hidden', !(this.isTouch && inGame && this.state.gameStarted));
    },

    setGameStarted(v) {
      this.state.gameStarted = !!v;
      const showTouch = this.isTouch && v && ['none', 'pause', 'palette', 'settings'].indexOf(this.state.screen) >= 0;
      if (this.els['touch']) this.els['touch'].classList.toggle('hidden', !showTouch);
      if (this.els['hud']) this.els['hud'].classList.toggle('hidden', !v || this.state.screen === 'menu' || this.state.screen === 'loading');
    },

    setLoading(text, ratio) {
      if (this.els['loading-text']) this.els['loading-text'].textContent = text;
      if (this.els['loading-bar']) {
        this.els['loading-bar'].style.width = Math.round(U.clamp(ratio || 0, 0, 1) * 100) + '%';
      }
    },

    fatal(msg) {
      const el = this.els['fatal'];
      if (el) {
        el.classList.remove('hidden');
        el.innerHTML = '<div class="fatal-box"><h2>出错了</h2><p>' + U.esc(msg) + '</p><p class="hint">如果是联机问题，可尝试「无服务器直连」模式；如果是游戏打不开，请用 start.bat 启动后再访问。</p></div>';
      }
    },

    /* ---------------- 提示 ---------------- */
    toast(text, kind) {
      const box = this.els['toasts'];
      if (!box) return;
      const div = document.createElement('div');
      div.className = 'toast' + (kind ? ' ' + kind : '');
      div.textContent = text;
      box.appendChild(div);
      requestAnimationFrame(() => div.classList.add('show'));
      setTimeout(() => {
        div.classList.remove('show');
        setTimeout(() => div.remove(), 300);
      }, 3200);
      while (box.children.length > 4) box.removeChild(box.firstChild);
    },

    setNetBadge(text) {
      const el = this.els['net-badge'];
      if (!el) return;
      if (!text) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      el.textContent = text;
    },

    /* ---------------- 快捷栏 ---------------- */
    renderHotbar(hotbar, selected) {
      const el = this.els['hotbar'];
      if (!el) return;
      el.innerHTML = '';
      hotbar.forEach((blockId, i) => {
        const slot = document.createElement('div');
        slot.className = 'slot' + (i === selected ? ' selected' : '');
        const canvas = BWC.Textures.blockIconCanvas(blockId, 36);
        canvas.className = 'icon';
        slot.appendChild(canvas);
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = String(i + 1);
        slot.appendChild(num);
        const def = BWC.BLOCKS[blockId];
        slot.title = def ? def.name : '';
        slot.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this._handlers.onHotbarSelect && this._handlers.onHotbarSelect(i);
        });
        el.appendChild(slot);
      });
    },

    selectHotbar(hotbar, selected) {
      const el = this.els['hotbar'];
      if (!el || !el.children[selected]) return;
      Array.from(el.children).forEach((c, i) => c.classList.toggle('selected', i === selected));
    },

    /* ---------------- 背包（方块选择） ---------------- */
    renderPalette(onPick) {
      const grid = this.els['palette-grid'];
      if (!grid) return;
      grid.innerHTML = '';
      BWC.PALETTE.forEach((blockId) => {
        const def = BWC.BLOCKS[blockId];
        const item = document.createElement('div');
        item.className = 'p-item';
        item.title = def.name;
        const canvas = BWC.Textures.blockIconCanvas(blockId, 40);
        item.appendChild(canvas);
        const label = document.createElement('span');
        label.textContent = def.name;
        item.appendChild(label);
        item.addEventListener('click', () => {
          BWC.Audio.play('click');
          onPick(blockId);
        });
        grid.appendChild(item);
      });
    },

    /* ---------------- 聊天 ---------------- */
    chatAdd(name, text, color) {
      const log = this.els['chat-log'];
      if (!log) return;
      const div = document.createElement('div');
      div.className = 'chat-line';
      div.innerHTML = '<span class="who" style="color:' + (color || '#8fd0ff') + '">' + U.esc(name) + '</span> ' + U.esc(text);
      log.appendChild(div);
      while (log.children.length > 40) log.removeChild(log.firstChild);
      setTimeout(() => div.classList.add('fade'), 15000);
      log.scrollTop = log.scrollHeight;
    },

    chatSystem(text) { this.chatAdd('系统', text, '#ffd479'); },

    chatIsOpen() { return this.chatOpen; },

    chatOpenInput() {
      if (this.chatOpen) return;
      this.chatOpen = true;
      this.els['chat-input-wrap'].classList.remove('hidden');
      const inp = this.els['chat-input'];
      inp.value = '';
      setTimeout(() => inp.focus(), 0);
    },

    chatClose(send) {
      if (!this.chatOpen) return;
      this.chatOpen = false;
      const inp = this.els['chat-input'];
      const text = inp.value.trim();
      this.els['chat-input-wrap'].classList.add('hidden');
      inp.blur();
      if (send && text) {
        this._handlers.onChatSend && this._handlers.onChatSend(text);
      }
      this._handlers.onChatClosed && this._handlers.onChatClosed();
    },

    /* ---------------- 玩家列表 ---------------- */
    renderPlayers(list) {
      const el = this.els['players-panel'];
      if (!el) return;
      let html = '<div class="pp-title">玩家 (' + list.length + ')</div>';
      list.forEach((p) => {
        html += '<div class="pp-row"><span class="pp-dot" style="background:hsl(' + (p.hue || 200) + ',60%,50%)"></span>' +
          '<span class="pp-name">' + U.esc(p.name) + (p.self ? ' <em>(你)</em>' : '') + (p.host ? ' <em>房主</em>' : '') + '</span>' +
          '<span class="pp-ping">' + (p.ping != null ? p.ping + 'ms' : '—') + '</span></div>';
      });
      el.innerHTML = html;
    },

    /* ---------------- 调试信息 ---------------- */
    setDebug(text) {
      const el = this.els['debug'];
      if (!el) return;
      if (text === null) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      el.textContent = text;
    },

    /* ---------------- 触屏 ---------------- */
    _initTouch() {
      const joy = this.els['joy'];
      const knob = this.els['joy-knob'];
      if (!joy || !knob) return;
      let active = false;
      let cx = 0, cy = 0;

      const setFrom = (e) => {
        const rect = joy.getBoundingClientRect();
        cx = rect.left + rect.width / 2;
        cy = rect.top + rect.height / 2;
        const R = rect.width / 2;
        let dx = e.clientX - cx, dy = e.clientY - cy;
        const len = Math.hypot(dx, dy);
        if (len > R) { dx = dx / len * R; dy = dy / len * R; }
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        this.touch.r = U.clamp(dx / R, -1, 1);
        this.touch.f = U.clamp(-dy / R, -1, 1);
      };

      joy.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        active = true;
        joy.setPointerCapture(e.pointerId);
        setFrom(e);
      });
      joy.addEventListener('pointermove', (e) => {
        if (!active) return;
        e.preventDefault();
        setFrom(e);
      });
      const end = (e) => {
        if (!active) return;
        active = false;
        knob.style.transform = 'translate(0,0)';
        this.touch.f = 0;
        this.touch.r = 0;
      };
      joy.addEventListener('pointerup', end);
      joy.addEventListener('pointercancel', end);
    },
  });

  return UI;
})();
