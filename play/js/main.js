/* ============================================================
 * 方块世界 · 主控制器（游戏循环 / 输入 / 昼夜 / 联机协议 / 存档）
 * ============================================================ */
(function () {
  'use strict';
  const BWC = window.BWC;
  const U = BWC.util;
  const CFG = BWC.CONFIG;

  const PARTICLE_COLORS = {
    1: '#5fae3c', 2: '#8a6544', 3: '#7f7f7f', 4: '#868686', 5: '#e3d9a4',
    6: '#7a5a33', 7: '#3e8a2d', 8: '#b08a4f', 9: '#a2412f', 10: '#dfeff5',
    11: '#3a6fd8', 12: '#f6faff', 13: '#f2d67f', 14: '#241c36', 15: '#f0cf4a',
    16: '#57d8cf', 17: '#3a3a3a', 18: '#3d8b3d',
  };

  const SAVE_KEY = 'bwc.save';
  const state = {
    phase: 'boot',           // boot | menu | loading | playing | paused
    preset: null,
    world: null,
    player: null,
    remotes: null,
    net: null,
    hotbar: BWC.DEFAULT_HOTBAR.slice(),
    hotSelected: 0,
    time: 0.32,              // 0~1 一天中的位置
    myId: 'host',
    role: null,              // host | guest | null（单机）
    roomCode: null,
    players: new Map(),      // 联机：id -> {name, hue}（含自己）
    pendingStart: null,
    respawnPoint: null,
    fps: 0, _fpsAcc: 0, _fpsN: 0,
    ping: null,
    _netAcc: 0, _pingAcc: 0, _timeAcc: 0,
    debugOn: false,
    chatOpen: false,
    mouseHeld: { left: false, right: false },
    _breakRepeat: 0,
    localAvatar: null,
    _toastOnceFlags: {},
  };

  let renderer, scene, camera, highlight, particles, clouds, hemi, dirLight, ambient;
  const keys = new Set();
  const last = { t: 0 };

  /* ================= 启动 ================= */
  function boot() {
    // WebGL 检查
    try {
      const test = document.createElement('canvas');
      const gl = test.getContext('webgl2') || test.getContext('webgl');
      if (!gl) throw new Error('no webgl');
    } catch (e) {
      document.body.innerHTML = '<div style="padding:40px;color:#eee;font-family:sans-serif"><h2>无法启动 3D 渲染</h2><p>你的浏览器不支持 WebGL，请更换 Chrome / Edge / Firefox 最新版。</p></div>';
      return;
    }

    const params = new URLSearchParams(location.search);
    const presetKey = params.get('preset') || 'std';
    state.preset = CFG.PRESETS[presetKey] || CFG.PRESETS.std;

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game'), antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.preset.pixelRatioMax));
    renderer.setSize(window.innerWidth, window.innerHeight);
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a1020');

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 1200);

    hemi = new THREE.HemisphereLight('#bfe3ff', '#6b7a52', 1.0);
    scene.add(hemi);
    dirLight = new THREE.DirectionalLight('#fff6e0', 0.85);
    dirLight.position.set(80, 100, 30);
    scene.add(dirLight);
    ambient = new THREE.AmbientLight('#ffffff', 0.12);
    scene.add(ambient);

    // 选中方块高亮框
    const boxGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(boxGeo);
    highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 }));
    highlight.visible = false;
    scene.add(highlight);

    particles = new ParticleSystem(scene, 240);
    clouds = makeClouds(scene);
    scene.fog = new THREE.Fog(new THREE.Color('#79b7f2'), 40, 100);

    BWC.UI.init(handlers());
    wireInput();

    // 主菜单信息
    const save = U.loadLocal(SAVE_KEY, null);
    if (save && save.v === 1 && save.seed) {
      UI.els['btn-continue'].classList.remove('hidden');
      if (UI.els['btn-continue-info']) {
        UI.els['btn-continue-info'].textContent = '存档：' + save.seed + ' · ' + new Date(save.savedAt || Date.now()).toLocaleString();
      }
    }

    // URL 参数
    if (params.get('name')) UI.els['input-name'].value = params.get('name');
    if (params.get('seed')) UI.els['input-seed'].value = params.get('seed');
    if (params.get('panel') === 'multi') UI.showScreen('multi');
    if (params.get('join')) {
      UI.els['input-join-code'].value = params.get('join').toUpperCase();
      UI.showScreen('multi');
      const joinTab = document.querySelector('#multi-tabs .tab[data-tab="join"]');
      if (joinTab) joinTab.click();
    }

    window.addEventListener('resize', onResize);
    window.addEventListener('beforeunload', () => { autoSave(); });

    if (location.protocol === 'file:') {
      setTimeout(() => UI.toast('提示：用 start.bat 启动本地服务器体验更完整（联机也建议这样）', 'warn'), 1200);
    }

    UI.showScreen('menu');
    state.phase = 'menu';
    requestAnimationFrame(animate);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ================= 云层 ================= */
  function makeClouds(scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    const rand = U.mulberry32(20240607);
    for (let i = 0; i < 26; i++) {
      const x = (rand() * 128) | 0, y = (rand() * 128) | 0;
      const w = 8 + ((rand() * 26) | 0), h = 5 + ((rand() * 14) | 0);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + rand() * 0.45).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 112;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }

  /* ================= 粒子 ================= */
  class ParticleSystem {
    constructor(scene, max) {
      this.max = max;
      this.pos = new Float32Array(max * 3);
      this.col = new Float32Array(max * 3);
      this.vel = new Float32Array(max * 3);
      this.life = new Float32Array(max);
      this.next = 0;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
      this.geo = g;
      this.points = new THREE.Points(g, new THREE.PointsMaterial({
        size: 0.15, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.95,
      }));
      this.points.frustumCulled = false;
      scene.add(this.points);
      for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
      this._color = new THREE.Color();
    }
    spawn(x, y, z, hex, count) {
      count = count || 8;
      this._color.set(hex);
      for (let n = 0; n < count; n++) {
        const i = this.next; this.next = (this.next + 1) % this.max;
        this.pos[i * 3] = x + Math.random();
        this.pos[i * 3 + 1] = y + Math.random();
        this.pos[i * 3 + 2] = z + Math.random();
        this.vel[i * 3] = (Math.random() - 0.5) * 3.2;
        this.vel[i * 3 + 1] = 1.5 + Math.random() * 3.5;
        this.vel[i * 3 + 2] = (Math.random() - 0.5) * 3.2;
        this.life[i] = 0.5 + Math.random() * 0.5;
        const j = 0.85 + Math.random() * 0.3;
        this.col[i * 3] = this._color.r * j;
        this.col[i * 3 + 1] = this._color.g * j;
        this.col[i * 3 + 2] = this._color.b * j;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
    update(dt) {
      let any = false;
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) continue;
        any = true;
        this.life[i] -= dt;
        if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
        this.vel[i * 3 + 1] -= 12 * dt;
        this.pos[i * 3] += this.vel[i * 3] * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      }
      if (any) this.geo.attributes.position.needsUpdate = true;
    }
    clear() {
      for (let i = 0; i < this.max; i++) { this.life[i] = 0; this.pos[i * 3 + 1] = -999; }
      this.geo.attributes.position.needsUpdate = true;
    }
  }

  /* ================= 世界生命周期 ================= */
  function createWorld(seed, rdOverride) {
    if (state.world) {
      worldCleanup();
    }
    const rd = rdOverride || BWC.UI.settings.renderDistance || state.preset.renderDistance;
    const world = new BWC.World(scene, seed, { renderDistance: rd });
    world.onBlockChanged = (x, y, z, id) => {
      if (state.net && state.net.role) {
        state.net.send({ t: 'e', x, y, z, id });
      }
    };
    state.world = world;
    state.remotes = new BWC.RemoteManager(scene);
    state.players.clear();
    state.myId = 'host';
    state.time = 0.32;
    return world;
  }

  function worldCleanup() {
    if (state.localAvatar) { state.localAvatar.remove(); state.localAvatar = null; }
    if (state.remotes) { state.remotes.clear(); state.remotes = null; }
    if (state.world) { state.world.dispose(); state.world = null; }
    particles.clear();
    highlight.visible = false;
  }

  function applyRenderDistance(rd) {
    if (!state.world) return;
    const value = rd || state.preset.renderDistance;
    state.world.renderDistance = value;
    state.world.offsets = state.world._makeOffsets(value);
    const far = value * CFG.CHUNK - 6;
    camera.far = far + 260;
    camera.updateProjectionMatrix();
  }

  /* ================= 单机 ================= */
  function startSingle(useSave) {
    let seed, save = null;
    if (useSave) {
      save = U.loadLocal(SAVE_KEY, null);
      if (!save || save.v !== 1) { UI.toast('没有找到存档'); return; }
      seed = save.seed;
    } else {
      seed = UI.getSeed() || ('世界' + U.shortCode(6));
    }
    BWC.Audio.init();
    UI.setGameStarted(true);
    UI.setLoading('正在生成世界…', 0.02);
    UI.showScreen('loading');

    createWorld(seed);
    const spawn = state.world.findSpawn();
    state.respawnPoint = spawn;

    if (save) {
      state.time = save.time || 0.32;
      (save.edits || []).forEach((e) => {
        if (e.length === 4) state.world.applyRemoteEdit(e[0], e[1], e[2], e[3]);
      });
    }
    state.phase = 'loading';
    state.pendingStart = {
      seed,
      spawn: save && save.pos ? { x: save.pos.x, y: save.pos.y, z: save.pos.z, yaw: save.pos.yaw || 0, pitch: save.pitch || save.pos.pitch || 0 } : spawn,
      guest: false,
    };
    // 角色
    state.player = new BWC.LocalPlayer(state.world, camera);
    state.player.respawn(state.pendingStart.spawn.x, state.pendingStart.spawn.y, state.pendingStart.spawn.z);
    state.player.yaw = state.pendingStart.spawn.yaw || 0;
    state.player.pitch = state.pendingStart.spawn.pitch || 0;
    state.role = null;
    state.roomCode = null;
    UI.setNetBadge(null);
    applyRenderDistance();
  }

  /* ================= 多人（房主） ================= */
  function createRoom(server) {
    if (state.net && state.net.role) { UI.toast('已在联机中，请先离开房间'); return; }
    if (state.net && !state.world) { state.net.close(); state.net = null; }  // 复用未进入世界的连接
    const code = U.shortCode(5);
    const net = makeNet();
    UI.els['host-status'].innerHTML = '正在连接信令服务器…';
    net.startHost(code, server).then((okCode) => {
      UI.els['room-code'].textContent = okCode.split('').join(' ');
      UI.els['room-code'].dataset.code = okCode;
      UI.els['btn-copy-code'].classList.remove('hidden');
      UI.els['host-status'].innerHTML = '<span class="ok">房间已创建！把房间码发给好友，好友在「加入房间」中输入即可。</span>';
      UI.els['btn-host-enter'].classList.remove('hidden');
      UI.els['btn-host-enter'].textContent = '进入世界（好友可随时加入）';
      UI.toast('房间码：' + okCode + '（点击复制）');
      U.copyText(okCode).catch(() => {});
    }).catch((err) => {
      UI.els['host-status'].innerHTML = '<span class="err">' + U.esc(err.message) + '</span>';
    });
  }

  function hostEnterWorld() {
    if (state.phase === 'playing' || state.phase === 'loading') return; // 已在世界里
    state.role = 'host';
    state.myId = 'host';
    state.roomCode = state.net ? state.net.code : null;
    startHostedWorld();
  }

  function startHostedWorld() {
    BWC.Audio.init();
    UI.setGameStarted(true);
    UI.setLoading('正在生成世界…', 0.02);
    UI.showScreen('loading');
    const seed = UI.getSeed() || state._roomSeed || (state._roomSeed = '房间' + U.shortCode(6));
    createWorld(seed);
    state.players.set('host', { name: UI.getName(), hue: UI.getHue() });
    const spawn = state.world.findSpawn();
    state.respawnPoint = spawn;
    state.player = new BWC.LocalPlayer(state.world, camera);
    state.player.respawn(spawn.x, spawn.y, spawn.z);
    state.phase = 'loading';
    state.pendingStart = { seed, spawn, guest: false };
    UI.setNetBadge('房间 ' + (state.roomCode || '') + ' · 1人');
    applyRenderDistance();
    // 补处理等待中的加入请求
    if (state._pendingHellos && state._pendingHellos.length) {
      const q = state._pendingHellos;
      state._pendingHellos = [];
      q.forEach((h) => hostHandleHello(h.id, h.msg));
    }
  }

  /* ================= 多人（访客） ================= */
  function joinRoom(codeInput) {
    const code = String(codeInput || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,8}$/.test(code)) {
      UI.els['join-status'].innerHTML = '<span class="err">请输入 3~8 位房间码（字母数字）</span>';
      return;
    }
    if (state.net && state.net.role) { UI.toast('已在联机中，请先离开房间'); return; }
    const net = makeNet();
    UI.els['join-status'].innerHTML = '正在连接房间 ' + U.esc(code) + ' …';
    net.join(code, UI.els['input-server'] ? UI.els['input-server'].value.trim() : '')
      .then(() => {
        UI.els['join-status'].innerHTML = '<span class="ok">已连接，等待房主初始化世界…</span>';
        net.send({ t: 'hello', name: UI.getName(), hue: UI.getHue() });
        state._joinTimeout = setTimeout(() => {
          UI.els['join-status'].innerHTML = '<span class="err">房主未响应（可能版本不一致或已离线）</span>';
          net.close();
        }, 15000);
      })
      .catch((err) => {
        UI.els['join-status'].innerHTML = '<span class="err">' + U.esc(err.message) + '</span>';
      });
  }

  function startGuestWorld(w) {
    if (state._joinTimeout) clearTimeout(state._joinTimeout);
    BWC.Audio.init();
    state.role = 'guest';
    state.myId = w.yourId || 'guest';
    state.roomCode = w.room || state.net.code;
    UI.setGameStarted(true);
    UI.setLoading('正在生成世界（与房主同步）…', 0.02);
    UI.showScreen('loading');

    createWorld(w.seed);
    state.time = w.time || 0.32;
    (w.edits || []).forEach((e) => {
      if (e.length === 4) state.world.applyRemoteEdit(e[0], e[1], e[2], e[3]);
    });

    const spawn = w.spawn || state.world.findSpawn();
    state.respawnPoint = spawn;
    state.player = new BWC.LocalPlayer(state.world, camera);
    state.player.respawn(spawn.x, spawn.y, spawn.z);

    state.players.clear();
    state.players.set('host', { name: w.hostName || '房主', hue: w.hostHue || 200 });
    (w.players || []).forEach((p) => {
      state.players.set(p.id, { name: p.name, hue: p.hue });
      if (p.id !== state.myId) {
        const rp = state.remotes.add(p.id, { name: p.name, hue: p.hue });
        rp.snap({ x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0, pitch: p.pitch || 0 });
        if (p.id !== 'host') state.remotes.snapTo(p.id, { x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0, pitch: p.pitch || 0 });
      }
    });
    const hostRp = state.remotes.add('host', { name: w.hostName || '房主', hue: w.hostHue || 200 });
    if (w.hostState) hostRp.snap(w.hostState);

    state.phase = 'loading';
    state.pendingStart = { seed: w.seed, spawn, guest: true };
    UI.setNetBadge('房间 ' + (state.roomCode || '') + ' · ' + (state.players.size) + '人');
    applyRenderDistance();
  }

  /* ================= 网络事件 ================= */
  function makeNet() {
    const net = new BWC.Net();
    state.net = net;
    net.onStatus = (level, d) => {
      UI.toast(d.message, level === 'error' ? 'err' : 'warn');
    };
    net.onPeersChanged = () => {
      updateNetBadge();
      // 访客已连上但房主还在菜单 → 房主自动进入世界
      if (net.role === 'host' && state.phase === 'menu' && net.transports.size > 0) hostEnterWorld();
    };
    net.onMessage = (msg, fromId) => onNetMessage(msg, fromId);
    return net;
  }

  function onNetMessage(msg, fromId) {
    if (!msg || typeof msg !== 'object' || !msg.t) return;
    const net = state.net;
    switch (msg.t) {
      case '__peer-left': {
        if (net.role !== 'host') break;
        const gone = state.players.get(fromId);
        state.players.delete(fromId);
        if (state.remotes) state.remotes.remove(fromId);
        net.send({ t: 'leave', id: fromId });
        if (gone) {
          BWC.UI.chatSystem(gone.name + ' 离开了游戏');
          UI.toast(gone.name + ' 离开了游戏');
          BWC.Audio.play('leave');
        }
        updateNetBadge();
        break;
      }
      case '__host-left': {
        UI.toast('与房主断开连接（可继续单机游玩）', 'err');
        UI.chatSystem('与房主断开连接，编辑将不再同步');
        state.role = null;
        updateNetBadge();
        break;
      }
      case 'hello': {
        if (net.role !== 'host') break;
        if (!state.world) {
          // 房主世界还在创建：先缓存，建好后补处理
          (state._pendingHellos = state._pendingHellos || []).push({ id: fromId, msg });
          break;
        }
        hostHandleHello(fromId, msg);
        break;
      }
      case 'welcome': {
        if (net.role !== 'guest') break;
        try { startGuestWorld(msg); } catch (e) {
          UI.fatal('进入房间失败：' + e.message);
        }
        break;
      }
      case 'join': {
        if (!state.remotes || msg.id === state.myId) break;
        // 访客收到其他人加入（由房主转发）
        state.players.set(msg.id, { name: msg.name, hue: msg.hue });
        state.remotes.add(msg.id, { name: msg.name, hue: msg.hue });
        BWC.UI.chatSystem((msg.name || '玩家') + ' 加入了游戏');
        BWC.Audio.play('join');
        updateNetBadge();
        break;
      }
      case 'leave': {
        if (!state.remotes || msg.id === state.myId) break;
        const p = state.players.get(msg.id);
        state.players.delete(msg.id);
        state.remotes.remove(msg.id);
        if (p) BWC.UI.chatSystem(p.name + ' 离开了游戏');
        updateNetBadge();
        break;
      }
      case 's': {
        if (!state.remotes) break;
        if (msg.id && msg.id !== state.myId) state.remotes.applyState(msg.id, msg);
        break;
      }
      case 'e': {
        if (!state.world) break;
        if (typeof msg.x === 'number') state.world.applyRemoteEdit(msg.x | 0, msg.y | 0, msg.z | 0, msg.id | 0);
        break;
      }
      case 'chat': {
        BWC.UI.chatAdd(msg.name || '玩家', String(msg.text || '').slice(0, 120), 'hsl(' + (msg.hue || 200) + ',70%,70%)');
        BWC.Audio.play('chat');
        break;
      }
      case 'time': {
        if (typeof msg.v === 'number') state.time = msg.v;
        break;
      }
      case 'ping': {
        if (state.net.role === 'host') state.net.sendTo(fromId, { t: 'pong', ts: msg.ts });
        break;
      }
      case 'pong': {
        if (typeof msg.ts === 'number') state.ping = Math.max(1, Math.round(Date.now() - msg.ts));
        break;
      }
    }
  }

  function hostHandleHello(fromId, msg) {
    const net = state.net;
    if (!net || net.role !== 'host' || !state.world) return;
    const name = String(msg.name || '玩家').slice(0, 12);
    const hue = typeof msg.hue === 'number' ? msg.hue : 200;
    const id = fromId;
    state.players.set(id, { name, hue });
    state.remotes.add(id, { name, hue });
    // 发送欢迎包（种子 / 编辑 / 玩家列表）
    const players = [];
    state.players.forEach((p, pid) => {
      const rp = pid === 'host' ? null : state.remotes.players.get(pid);
      players.push({
        id: pid, name: p.name, hue: p.hue,
        x: rp ? rp.cur.x : state.player.pos.x,
        y: rp ? rp.cur.y : state.player.pos.y,
        z: rp ? rp.cur.z : state.player.pos.z,
        yaw: rp ? rp.cur.yaw : state.player.yaw,
        pitch: rp ? rp.pitch : state.player.pitch,
      });
    });
    net.sendTo(id, {
      t: 'welcome',
      yourId: id,
      seed: state.world.seed,
      time: state.time,
      spawn: state.respawnPoint,
      edits: state.world.serializeEdits(),
      hostName: state.players.get('host') ? state.players.get('host').name : '房主',
      hostHue: state.players.get('host') ? state.players.get('host').hue : 200,
      hostState: { x: state.player.pos.x, y: state.player.pos.y, z: state.player.pos.z, yaw: state.player.yaw, pitch: state.player.pitch },
      room: net.code,
      players,
    });
    net.send({ t: 'join', id, name, hue });
    BWC.UI.chatSystem(name + ' 加入了游戏');
    UI.toast(name + ' 加入了游戏');
    BWC.Audio.play('join');
    updateNetBadge();
  }

  function updateNetBadge() {
    if (!state.net || !state.net.role) { UI.setNetBadge(null); return; }
    const n = state.players.size || 1;
    UI.setNetBadge('房间 ' + (state.roomCode || state.net.code || '') + ' · ' + n + '人');
  }

  /* ================= 玩家输入 ================= */
  function wireInput() {
    const canvas = UI.els['game'];

    window.addEventListener('keydown', (e) => {
      const inChat = UI.chatIsOpen();
      if (inChat) {
        if (e.key === 'Escape') { UI.chatClose(false); e.preventDefault(); }
        if (e.key === 'Enter') { UI.chatClose(true); e.preventDefault(); }
        return;
      }
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (!keys.has(e.code)) {
        // 首次按下
        switch (e.code) {
          case 'KeyT':
          case 'Enter':
            if (state.phase === 'playing' || state.phase === 'paused') {
              openChat();
              e.preventDefault();
              return;
            }
            break;
          case 'KeyE':
            if (state.phase === 'playing') { togglePalette(); e.preventDefault(); return; }
            break;
          case 'F3':
            state.debugOn = !state.debugOn;
            if (!state.debugOn) UI.setDebug(null);
            e.preventDefault();
            return;
          case 'F5':
            if (state.player) {
              state.player.thirdPerson = !state.player.thirdPerson;
              UI.toast(state.player.thirdPerson ? '第三人称视角' : '第一人称视角');
            }
            e.preventDefault();
            return;
          case 'KeyF':
            if (state.player && state.phase === 'playing') {
              UI.toast(state.player.toggleFly() ? '飞行模式：开（空格上升 / Shift 下降）' : '飞行模式：关');
            }
            break;
          case 'Space':
            if (state.player && state.phase === 'playing' && !state.player.flying) state.player.handleSpacePressed();
            break;
          case 'Escape':
            if (state.phase === 'playing') pauseGame();
            else if (state.phase === 'paused' && UI.state.screen === 'pause') resumeGame();
            else if (UI.state.screen === 'settings') UI.showScreen('pause');
            else if (UI.state.screen !== 'menu') UI.showScreen('menu');
            break;
          case 'Tab':
            if (state.phase === 'playing' || state.phase === 'paused') {
              UI.els['players-panel'].classList.remove('hidden');
              e.preventDefault();
            }
            return;
        }
        if (/^Digit[1-9]$/.test(e.code) && state.phase === 'playing') {
          selectHotbar(parseInt(e.code.slice(5), 10) - 1);
        }
      }
      keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      keys.delete(e.code);
      if (e.code === 'Tab') UI.els['players-panel'].classList.add('hidden');
      if (e.code === 'Escape' && UI.chatIsOpen()) UI.chatClose(false);
    });

    // 鼠标（指针锁定）
    canvas.addEventListener('click', () => {
      if (state.phase === 'playing' && !UI.isTouch && document.pointerLockElement !== canvas) {
        canvas.requestPointerLock && canvas.requestPointerLock();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      if (state.phase !== 'playing' || !state.player) return;
      const sens = 0.0022 * (UI.settings.sensitivity || 1);
      state.player.yaw -= e.movementX * sens;
      state.player.pitch -= e.movementY * sens;
      state.player.pitch = U.clamp(state.player.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    });

    document.addEventListener('mousedown', (e) => {
      if (state.phase !== 'playing') return;
      if (UI.chatIsOpen()) return;
      if (document.pointerLockElement !== canvas && !UI.isTouch) return;
      if (e.button === 0) { state.mouseHeld.left = true; doBreak(); }
      else if (e.button === 2) { state.mouseHeld.right = true; doPlace(); }
      else if (e.button === 1) { pickBlock(); e.preventDefault(); }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) state.mouseHeld.left = false;
      if (e.button === 2) state.mouseHeld.right = false;
    });
    document.addEventListener('contextmenu', (e) => {
      if (state.phase === 'playing') e.preventDefault();
    });

    document.addEventListener('pointerlockchange', () => {
      if (state.phase === 'playing' && document.pointerLockElement !== canvas && !UI.isTouch) {
        if (!UI.chatIsOpen() && UI.state.screen !== 'palette') pauseGame();
      }
    });

    // 滚轮切换快捷栏
    window.addEventListener('wheel', (e) => {
      if (state.phase !== 'playing') return;
      selectHotbar((state.hotSelected + (e.deltaY > 0 ? 1 : -1) + state.hotbar.length) % state.hotbar.length);
    }, { passive: true });

    // 触屏：拖拽视角 / 点按操作
    let touchLookActive = false, lookX = 0, lookY = 0, touchStart = 0, touchMoved = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (!UI.isTouch || state.phase !== 'playing') return;
      touchLookActive = true;
      lookX = e.clientX; lookY = e.clientY;
      touchStart = performance.now();
      touchMoved = 0;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!touchLookActive || !state.player) return;
      const dx = e.clientX - lookX, dy = e.clientY - lookY;
      lookX = e.clientX; lookY = e.clientY;
      touchMoved += Math.abs(dx) + Math.abs(dy);
      const sens = 0.0032 * (UI.settings.sensitivity || 1);
      state.player.yaw -= dx * sens;
      state.player.pitch -= dy * sens;
      state.player.pitch = U.clamp(state.player.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!touchLookActive) return;
      touchLookActive = false;
      const quick = (performance.now() - touchStart) < 300 && touchMoved < 12;
      if (quick && state.phase === 'playing') {
        if (UI.touch.action === 'place') { doPlace(); UI.touch.action = null; }
        else doBreak();
      }
    });
  }

  /* ================= 游戏内动作 ================= */
  function openChat() {
    UI.chatOpenInput();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function selectHotbar(i) {
    state.hotSelected = U.clamp(i, 0, state.hotbar.length - 1);
    UI.selectHotbar(state.hotbar, state.hotSelected);
  }

  function togglePalette() {
    if (UI.state.screen === 'palette') { closePalette(); return; }
    UI.renderPalette((blockId) => {
      state.hotbar[state.hotSelected] = blockId;
      UI.renderHotbar(state.hotbar, state.hotSelected);
      closePalette();
      UI.toast('已放入快捷栏：' + BWC.BLOCKS[blockId].name);
    });
    UI.showScreen('palette');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function closePalette() {
    UI.showScreen('none');
    const canvas = UI.els['game'];
    if (!UI.isTouch && canvas.requestPointerLock) canvas.requestPointerLock();
  }

  function raycastView() {
    if (!state.player || !state.world) return null;
    const eye = state.player.getEyePos();
    const d = state.player.getViewDir();
    return state.world.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, CFG.REACH);
  }

  function doBreak() {
    if (state.phase !== 'playing' || !state.player) return;
    const hit = raycastView();
    if (!hit) return;
    const def = BWC.BLOCKS[hit.id];
    if (!def || def.unbreakable) { if (def && def.unbreakable) UI.toast('基岩无法破坏'); return; }
    if (state.world.setBlock(hit.x, hit.y, hit.z, 0)) {
      particles.spawn(hit.x, hit.y, hit.z, PARTICLE_COLORS[hit.id] || '#888888', 9);
      BWC.Audio.play('dig');
    }
  }

  function doPlace() {
    if (state.phase !== 'playing' || !state.player) return;
    const hit = raycastView();
    if (!hit) return;
    const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
    const cur = state.world.getBlock(px, py, pz);
    if (cur !== 0 && cur !== 11) return;                    // 只能替换空气/水
    const blockId = state.hotbar[state.hotSelected];
    const def = BWC.BLOCKS[blockId];
    if (def.solid && state.player.intersectsBlock(px, py, pz)) return; // 别把自己埋了
    if (state.world.setBlock(px, py, pz, blockId)) {
      particles.spawn(px, py, pz, PARTICLE_COLORS[blockId] || '#888888', 5);
      BWC.Audio.play('place');
    }
  }

  function pickBlock() {
    const hit = raycastView();
    if (!hit) return;
    if (BWC.PALETTE.indexOf(hit.id) < 0) return;
    state.hotbar[state.hotSelected] = hit.id;
    UI.renderHotbar(state.hotbar, state.hotSelected);
    UI.toast('已选取：' + BWC.BLOCKS[hit.id].name);
  }

  /* ================= 暂停 / 继续 / 离开 ================= */
  function pauseGame() {
    if (state.phase !== 'playing') return;
    state.phase = 'paused';
    UI.showScreen('pause');
    if (state.role) {
      UI.els['pause-info'].innerHTML = '房间码：<b id="pause-code">' + U.esc(state.roomCode || '') + '</b>　（' + state.players.size + ' 人在线）';
    } else {
      UI.els['pause-info'].textContent = '单机世界 · 种子：' + (state.world ? state.world.seed : '');
    }
    UI.els['btn-pause-copy'].classList.toggle('hidden', !state.role);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function resumeGame() {
    if (state.phase !== 'paused') return;
    state.phase = 'playing';
    UI.showScreen('none');
    const canvas = UI.els['game'];
    if (!UI.isTouch && canvas.requestPointerLock) canvas.requestPointerLock();
  }

  function leaveGame() {
    autoSave();
    if (state.net) { state.net.close(); state.net = null; }
    if (state._joinTimeout) { clearTimeout(state._joinTimeout); state._joinTimeout = null; }
    worldCleanup();
    state.phase = 'menu';
    state.role = null;
    state.roomCode = null;
    state.player = null;
    state.pendingStart = null;
    keys.clear();
    UI.setGameStarted(false);
    UI.setNetBadge(null);
    UI.showScreen('menu');
  }

  /* ================= 存档 ================= */
  function collectSave() {
    if (!state.world) return null;
    return {
      v: 1,
      seed: state.world.seed,
      time: state.time,
      edits: state.world.serializeEdits(),
      pos: { x: state.player.pos.x, y: state.player.pos.y, z: state.player.pos.z, yaw: state.player.yaw, pitch: state.player.pitch },
      savedAt: Date.now(),
    };
  }

  function autoSave() {
    if (!state.world || state.role) return;   // 联机世界不写本地存档
    const save = collectSave();
    if (save) U.saveLocal(SAVE_KEY, save);
  }

  function exportSave() {
    const save = collectSave();
    if (!save) return;
    U.saveJSON(save, 'blockworld-' + save.seed + '.json');
    UI.toast('存档已导出到下载文件夹');
  }

  function importSave(text) {
    try {
      const save = JSON.parse(text);
      if (!save || save.v !== 1 || !save.seed) throw new Error('格式不对');
      U.saveLocal(SAVE_KEY, save);
      UI.toast('存档已导入，正在加载…');
      if (state.net) { state.net.close(); state.net = null; }
      worldCleanup();
      state.phase = 'menu';
      UI.setGameStarted(false);
      startSingle(true);
    } catch (e) {
      UI.toast('导入失败：' + e.message, 'err');
    }
  }

  /* ================= UI 回调 ================= */
  function handlers() {
    return {
      onStart: (useSave) => startSingle(useSave),
      onCreateRoom: () => createRoom(UI.els['input-server'] ? UI.els['input-server'].value.trim() : ''),
      onHostEnter: () => hostEnterWorld(),
      onJoinRoom: (code) => joinRoom(code),
      onDirectCreate: () => directCreate(),
      onDirectAccept: (answer) => directAccept(answer),
      onDirectJoin: (offer) => directJoin(offer),
      onResume: () => resumeGame(),
      onLeave: () => leaveGame(),
      onCopyRoomCode: () => {
        if (state.roomCode) U.copyText(state.roomCode).then((ok) => UI.toast(ok ? '房间码已复制' : '复制失败'));
      },
      onExportSave: () => exportSave(),
      onImportSave: (text) => importSave(text),
      onRenderDistance: (rd) => applyRenderDistance(rd),
      onChatSend: (text) => sendChat(text),
      onChatClosed: () => {
        if (state.phase === 'playing' && !UI.isTouch) {
          const canvas = UI.els['game'];
          canvas.requestPointerLock && canvas.requestPointerLock();
        }
      },
      onHotbarSelect: (i) => selectHotbar(i),
      onKeyAction: (name) => { if (name === 'palette') togglePalette(); },
    };
  }

  function sendChat(text) {
    if (text.startsWith('/')) {
      const cmd = text.slice(1).trim().toLowerCase();
      if (cmd === 'seed') { BWC.UI.chatSystem('世界种子：' + (state.world ? state.world.seed : '无')); return; }
      if (cmd === 'help') { BWC.UI.chatSystem('指令：/seed 查看种子，/pos 查看坐标'); return; }
      if (cmd === 'pos') {
        if (state.player) BWC.UI.chatSystem('坐标：' + state.player.pos.x.toFixed(1) + ', ' + state.player.pos.y.toFixed(1) + ', ' + state.player.pos.z.toFixed(1));
        return;
      }
      BWC.UI.chatSystem('未知指令：' + text);
      return;
    }
    const name = UI.getName();
    const hue = UI.getHue();
    BWC.UI.chatAdd(name, text, 'hsl(' + hue + ',70%,70%)');
    if (state.net && state.net.role) {
      state.net.send({ t: 'chat', id: state.myId, name, hue, text });
    }
  }

  /* ================= 无服务器直连 ================= */
  async function directCreate() {
    try {
      const net = makeNet();
      UI.els['direct-status'].textContent = '正在生成邀请码（收集网络候选）…';
      const code = await net.createManualOffer();
      UI.els['direct-offer'].value = code;
      UI.els['btn-copy-offer'].classList.remove('hidden');
      UI.els['direct-status'].textContent = '邀请码已生成：复制发给好友，收到「应答码」后粘贴到下方并点击「连接好友」。';
      U.copyText(code).then((ok) => UI.toast(ok ? '邀请码已复制' : '请手动复制邀请码'));
    } catch (e) {
      UI.els['direct-status'].textContent = '生成失败：' + e.message;
    }
  }

  async function directAccept(answer) {
    try {
      if (!state.net || state.net.kind !== 'manual') throw new Error('请先在上方生成邀请码');
      UI.els['direct-status'].textContent = '正在连接好友…';
      const id = await state.net.acceptManualAnswer(answer);
      UI.els['direct-status'].innerHTML = '<span class="ok">连接成功！可以进入世界了。</span>';
      UI.toast('与好友直连成功');
      state.role = 'host';
      state.myId = 'host';
      state.roomCode = '直连';
      hostEnterWorld();
    } catch (e) {
      UI.els['direct-status'].innerHTML = '<span class="err">' + U.esc(e.message) + '</span>';
    }
  }

  async function directJoin(offer) {
    try {
      const net = makeNet();
      UI.els['direct-status'].textContent = '正在生成应答码…';
      const { answerCode, ready } = await net.joinViaManualOffer(offer);
      UI.els['direct-output'].value = answerCode;
      UI.els['direct-output'].classList.remove('hidden');
      UI.els['btn-copy-answer'].classList.remove('hidden');
      UI.els['direct-status'].textContent = '应答码已生成：复制发回给房主，等待连接…';
      U.copyText(answerCode).catch(() => {});
      await ready;
      state.role = 'guest';
      UI.els['direct-status'].innerHTML = '<span class="ok">连接成功！等待房主初始化世界…</span>';
      net.send({ t: 'hello', name: UI.getName(), hue: UI.getHue() });
      state._joinTimeout = setTimeout(() => {
        UI.els['direct-status'].innerHTML = '<span class="err">房主未响应，请重试</span>';
      }, 15000);
    } catch (e) {
      UI.els['direct-status'].innerHTML = '<span class="err">' + U.esc(e.message) + '</span>';
    }
  }

  /* ================= 输入读取 ================= */
  function readInput() {
    const input = { f: 0, r: 0, jump: false, sneak: false, sprint: false };
    if (state.phase !== 'playing' || !state.player) return input;
    if (keys.has('KeyW')) input.f += 1;
    if (keys.has('KeyS')) input.f -= 1;
    if (keys.has('KeyD')) input.r += 1;
    if (keys.has('KeyA')) input.r -= 1;
    if (UI.isTouch) {
      input.f += UI.touch.f;
      input.r += UI.touch.r;
      if (UI.touch.flyTap) { UI.touch.flyTap = false; state.player.toggleFly(); }
    }
    input.f = U.clamp(input.f, -1, 1);
    input.r = U.clamp(input.r, -1, 1);
    input.jump = keys.has('Space') || UI.touch.jump;
    input.sneak = keys.has('ShiftLeft') || keys.has('ShiftRight') || UI.touch.sneak;
    input.sprint = keys.has('ControlLeft') || keys.has('ControlRight');
    return input;
  }

  /* ================= 昼夜与天空 ================= */
  const SKY = {
    night: new THREE.Color('#070b18'),
    day: new THREE.Color('#79b7f2'),
    sunset: new THREE.Color('#ff8c4a'),
    hemiNight: new THREE.Color('#25304d'),
    dirDay: new THREE.Color('#fff6e0'),
    dirSunset: new THREE.Color('#ffb377'),
  };
  const _sky = new THREE.Color();
  const _bg = new THREE.Color();

  function updateSky(dt) {
    if (!state.world) return;
    state.time = (state.time + dt / CFG.DAY_LENGTH) % 1;
    const ang = state.time * Math.PI * 2 - Math.PI / 2;
    const sinA = Math.sin(ang);
    const dayF = U.smoothstep(-0.12, 0.22, sinA);
    const sunsetF = U.clamp(1 - Math.abs(sinA) * 2.6, 0, 1) * U.smoothstep(-0.25, 0.05, sinA);

    _sky.copy(SKY.night).lerp(SKY.day, dayF);
    if (sunsetF > 0) _sky.lerp(SKY.sunset, sunsetF * 0.5);

    _bg.copy(_sky);
    scene.background = _bg;
    if (scene.fog) {
      scene.fog.color.copy(_sky);
      const far = state.world.renderDistance * CFG.CHUNK - 6;
      scene.fog.near = far * 0.45;
      scene.fog.far = far;
    }
    hemi.intensity = 0.25 + 0.85 * dayF;
    hemi.color.setRGB(0.75, 0.89, 1).lerp(SKY.hemiNight, 1 - dayF);
    dirLight.intensity = 0.12 + 0.8 * dayF;
    dirLight.color.copy(SKY.dirDay);
    if (sunsetF > 0.2) dirLight.color.lerp(SKY.dirSunset, sunsetF * 0.6);
    dirLight.position.set(Math.cos(ang) * 90, Math.max(-40, sinA * 100), 30);

    if (clouds) {
      clouds.visible = state.preset.clouds;
      if (clouds.visible) {
        clouds.position.x = camera.position.x;
        clouds.position.z = camera.position.z;
        const t = performance.now() * 0.000004;
        clouds.material.map.offset.set(t % 1, (t * 0.6) % 1);
        clouds.material.opacity = 0.35 + 0.5 * dayF;
      }
    }
  }

  /* ================= 主循环 ================= */
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min((now - (last.t || now)) / 1000, 0.1);
    last.t = now;
    step(dt, now);
  }

  /** 单帧推进（也被调试泵复用） */
  function step(dt, now, skipRender) {
    if (now === undefined) now = performance.now();
    if (dt > 0) {
      state._fpsAcc += dt; state._fpsN++;
      if (state._fpsAcc > 0.5) { state.fps = state._fpsN / state._fpsAcc; state._fpsAcc = 0; state._fpsN = 0; }
    }

    if (state.phase === 'loading' && state.world && state.pendingStart) {
      const sp = state.pendingStart.spawn;
      state.world.update(_tmpVec.set(sp.x, sp.y, sp.z));
      const ready = state.world.readyRatio(sp.x, sp.z, 2);
      const ratio = Math.min(0.98, ready * 0.7 + Math.min(1, state.world.stats.meshed / 90) * 0.3);
      UI.setLoading(state.pendingStart.guest ? '正在生成世界（与房主同步）…' : '正在生成世界…', ratio);
      updateSky(dt * 0.5);
      if (ready >= 0.5) finishLoading();
    } else if (state.phase === 'playing') {
      stepGame(dt);
    } else if (state.phase === 'paused') {
      updateSky(dt * 0.15);
    }

    if (state.phase === 'menu' || state.phase === 'paused') {
      // 菜单时缓慢环绕天空
      const t = now * 0.00005;
      if (state.phase === 'menu') {
        camera.position.set(Math.cos(t) * 30, 80, Math.sin(t) * 30);
        camera.rotation.set(-0.2, -t - Math.PI / 2, 0, 'YXZ');
      }
    } else if (state.player && (state.phase === 'playing' || state.phase === 'loading')) {
      state.player.updateCamera();
    }

    if (!skipRender) renderer.render(scene, camera);
  }
  const _tmpVec = new THREE.Vector3();

  function finishLoading() {
    const ps = state.pendingStart;
    state.pendingStart = null;
    state.phase = 'playing';
    state.player.respawn(ps.spawn.x, ps.spawn.y, ps.spawn.z);
    UI.setGameStarted(true);
    UI.showScreen('none');
    UI.renderHotbar(state.hotbar, state.hotSelected);
    BWC.UI.chatSystem(ps.guest ? '已加入房间，WASD 移动，T 聊天' : '欢迎来到方块世界！WASD 移动，空格跳跃，E 选方块');
    if (state.role) {
      if (state.role === 'host') BWC.UI.chatSystem('房间码：' + state.roomCode + '（朋友输入即可加入）');
      updateNetBadge();
    }
    if (!UI.isTouch) {
      const canvas = UI.els['game'];
      canvas.requestPointerLock && canvas.requestPointerLock();
    }
    if (state.role === 'guest') sendState(true);
  }

  function stepGame(dt) {
    const input = readInput();
    state.player.update(dt, input);

    // 本地玩家模型（第三人称）
    if (state.player.thirdPerson) {
      if (!state.localAvatar) {
        const av = BWC.buildAvatar(UI.getHue());
        state.localAvatar = av.group;
        scene.add(state.localAvatar);
      }
      state.localAvatar.visible = true;
      state.localAvatar.position.set(state.player.pos.x, state.player.pos.y, state.player.pos.z);
      state.localAvatar.rotation.y = state.player.yaw + Math.PI;
    } else if (state.localAvatar) {
      state.localAvatar.visible = false;
    }

    state.world.update(state.player.pos);
    state.remotes.update(dt);
    particles.update(dt);
    updateSky(dt);

    // 高亮
    const hit = raycastView();
    if (hit) {
      highlight.visible = true;
      highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      highlight.visible = false;
    }

    // 按住连续破坏
    if (state.mouseHeld.left) {
      state._breakRepeat -= dt;
      if (state._breakRepeat <= 0) { doBreak(); state._breakRepeat = 0.22; }
    } else {
      state._breakRepeat = 0;
    }
    if (state.mouseHeld.right) {
      // 单次放置（按住不连发，避免破坏体验）
    }

    // 联机同步
    if (state.net && state.net.role) {
      state._netAcc += dt;
      const interval = 1 / CFG.NET_STATE_HZ;
      if (state._netAcc >= interval) {
        state._netAcc = 0;
        sendState(false);
      }
      if (state.role === 'host') {
        state._timeAcc += dt;
        if (state._timeAcc > 20) { state._timeAcc = 0; state.net.send({ t: 'time', v: state.time }); }
      } else {
        state._pingAcc += dt;
        if (state._pingAcc > 2.5) { state._pingAcc = 0; state.net.send({ t: 'ping', ts: Date.now() }); }
      }
    }

    // 调试
    if (state.debugOn) updateDebug(hit);
    updateSidePanels();
  }

  function sendState(snap) {
    if (!state.net || !state.net.role || !state.player) return;
    state.net.send({
      t: 's',
      id: state.myId,
      x: +state.player.pos.x.toFixed(2),
      y: +state.player.pos.y.toFixed(2),
      z: +state.player.pos.z.toFixed(2),
      yaw: +state.player.yaw.toFixed(3),
      pitch: +state.player.pitch.toFixed(3),
      fly: state.player.flying ? 1 : 0,
      snap: snap ? 1 : 0,
    });
  }

  let _debugAcc = 0;
  function updateDebug(hit) {
    _debugAcc++;
    if (_debugAcc % 6 !== 0) return;
    const p = state.player;
    const lines = [
      'FPS ' + state.fps.toFixed(0) + ' · 方块世界 v1.0',
      '坐标 ' + p.pos.x.toFixed(1) + ' / ' + p.pos.y.toFixed(1) + ' / ' + p.pos.z.toFixed(1),
      '区块 ' + Math.floor(p.pos.x / 16) + ', ' + Math.floor(p.pos.z / 16) +
        ' · 已载入 ' + state.world.stats.meshed + '/' + state.world.stats.chunks,
      '朝向 ' + (p.yaw * 180 / Math.PI).toFixed(0) + '° · ' + (p.flying ? '飞行' : (p.inWater ? '游泳' : '步行')),
      '目标 ' + (hit ? (BWC.BLOCKS[hit.id] ? BWC.BLOCKS[hit.id].name : '?') + ' @ ' + hit.x + ',' + hit.y + ',' + hit.z : '无'),
      '种子 ' + state.world.seed,
      '视距 ' + state.world.renderDistance + ' 区块 · 绘制调用 ' + renderer.info.render.calls + ' · 三角面 ' + (renderer.info.render.triangles / 1000).toFixed(0) + 'k',
    ];
    if (state.role) {
      lines.push('联机 ' + (state.role === 'host' ? '房主' : '访客') + ' · ' + state.players.size + '人' +
        (state.role === 'guest' ? ' · 延迟 ' + (state.ping != null ? state.ping + 'ms' : '—') : ''));
    }
    UI.setDebug(lines.join('\n'));
  }

  let _panelAcc = 0;
  function updateSidePanels() {
    _panelAcc++;
    if (_panelAcc % 12 !== 0) return;
    if (!UI.els['players-panel'].classList.contains('hidden')) {
      const list = [];
      if (state.role) {
        state.players.forEach((p, id) => {
          list.push({
            name: p.name,
            hue: p.hue,
            self: id === state.myId,
            host: id === 'host',
            ping: id === 'host' ? (state.role === 'guest' ? state.ping : null) : null,
          });
        });
      } else {
        list.push({ name: UI.getName() + '（单机）', hue: UI.getHue(), self: true });
      }
      UI.renderPlayers(list);
    }
  }

  /* ================= 调试 API（供自动化 / 控制台） ================= */
  BWC.debug = {
    state,
    startSingle: (seed) => { if (seed) UI.els['input-seed'].value = seed; startSingle(false); },
    createRoom: (server) => createRoom(server || ''),
    hostRoomWithCode: async (code) => {
      // 测试用：指定房间码开房
      if (state.net) state.net.close();
      const net = makeNet();
      await net.startHost(code);
      state.role = 'host';
      state.roomCode = net.code;
      return net.code;
    },
    joinRoom: (code) => joinRoom(code),
    directCreate,
    directAccept,
    directJoin,
    teleport: (x, y, z) => { if (state.player) state.player.respawn(x, y, z); },
    place: (x, y, z, id) => { if (state.world) state.world.setBlock(x, y, z, id === undefined ? state.hotbar[state.hotSelected] : id); },
    breakAt: (x, y, z) => { if (state.world) state.world.setBlock(x, y, z, 0); },
    doBreak,
    doPlace,
    lookAt: (yaw, pitch) => { if (state.player) { state.player.yaw = yaw; state.player.pitch = pitch; } },
    info: () => ({
      phase: state.phase, role: state.role, roomCode: state.roomCode, myId: state.myId,
      players: Array.from(state.players.entries()),
      remotes: state.remotes ? Array.from(state.remotes.players.keys()) : [],
      peers: state.net ? state.net.peerIds() : [],
      pos: state.player ? [state.player.pos.x, state.player.pos.y, state.player.pos.z] : null,
      seed: state.world ? state.world.seed : null,
      chunks: state.world ? state.world.stats : null,
      fps: +state.fps.toFixed(1),
      ping: state.ping,
      loadingRatio: state.world && state.player ? state.world.readyRatio(state.player.pos.x, state.player.pos.z, 2) : 0,
    }),
    world: () => state.world,
    player: () => state.player,
    getBlock: (x, y, z) => state.world ? state.world.getBlock(x, y, z) : -1,
    setTime: (t) => { state.time = t; },
    /** 后台标签页 rAF 不跑时，手动推进游戏若干秒（用于自动化测试） */
    pump: (seconds, doRender) => {
      const dt = 1 / 60;
      let t = 0;
      let guard = 0;
      while (t < seconds && guard < 200000) { step(dt, performance.now(), !doRender); t += dt; guard++; }
      renderer.render(scene, camera);
      return BWC.debug.info();
    },
  };

  let UI = null;

  function ready() {
    UI = BWC.UI;
    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
