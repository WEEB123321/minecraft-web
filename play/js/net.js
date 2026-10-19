/* ============================================================
 * 方块世界 · P2P 网络层（WebRTC）
 *
 * 两种信令模式：
 *  1) 房间码（PeerJS 公共信令服务器）：房主生成 5 位房间码，好友输码加入
 *  2) 无服务器直连：房主生成「邀请码」，好友回传「应答码」，双方复制粘贴
 *
 * 拓扑：星型。所有访客只与房主连接，房主自动中转消息（fromId 保留原发送者）。
 * ============================================================ */
(function () {
  'use strict';
  const BWC = window.BWC;
  const U = BWC.util;
  const CFG = BWC.CONFIG;

  const CODE_PREFIX = 'BWC1|';

  class Net {
    constructor() {
      this.role = null;           // 'host' | 'guest'
      this.kind = null;           // 'peerjs' | 'manual'
      this.peer = null;
      this.code = null;
      this.selfId = 'host';
      this.transports = new Map();// id -> {id, send(obj), close(), kind}
      this.onMessage = null;      // (obj, fromId) => void
      this.onPeersChanged = null; // () => void
      this.onStatus = null;       // (level, {message}) => void
      this._guestSeq = 0;
      this._pendingGuest = null;  // 直连模式：等待应答的访客
      this._pendingHostPc = null; // 直连模式：访客侧 PC
      this._closed = false;
    }

    /* ---------------- 基础 ---------------- */
    _status(level, message) {
      try { this.onStatus && this.onStatus(level, { message }); } catch (e) { console.warn(e); }
    }
    _emit(obj, fromId) {
      try { this.onMessage && this.onMessage(obj, fromId); } catch (e) { console.warn(e); }
    }
    _peersChanged() {
      try { this.onPeersChanged && this.onPeersChanged(); } catch (e) { console.warn(e); }
    }
    _addTransport(id, t) {
      this.transports.set(id, t);
      if (this.role === 'guest') this.selfId = 'guest';
      this._peersChanged();
    }
    _dropTransport(id) {
      if (this.transports.delete(id)) {
        this._peersChanged();
        this._emit({ t: '__peer-left' }, id);
      }
    }

    peerIds() { return Array.from(this.transports.keys()); }
    peerCount() { return this.transports.size; }

    /** 发送：房主→所有访客；访客→房主（由房主中转，fromId 为原发送者） */
    send(obj) {
      if (this.role === 'host') {
        this.transports.forEach((t) => { try { t.send(obj); } catch (e) {} });
      } else if (this.role === 'guest') {
        const t = this.transports.get('host');
        if (t) try { t.send(obj); } catch (e) {}
      }
    }

    /** 定向发送（不中转） */
    sendTo(id, obj) {
      const t = this.transports.get(id);
      if (t) try { t.send(obj); } catch (e) {}
    }

    /** 中转 + 分发：收到消息时调用 */
    _dispatch(obj, fromId) {
      // 房主：把访客的消息转给其他访客
      if (this.role === 'host' && this.transports.has(fromId)) {
        this.transports.forEach((t, id) => {
          if (id !== fromId) { try { t.send(obj); } catch (e) {} }
        });
      }
      this._emit(obj, fromId);
    }

    _errText(type) {
      switch (type) {
        case 'unavailable-id': return '房间码已被占用，请重新生成';
        case 'peer-unavailable': return '房间不存在或房主已离线';
        case 'network':
        case 'server-error':
        case 'socket-error':
        case 'socket-closed': return '无法连接公共信令服务器（可能被网络拦截），可改用「无服务器直连」模式';
        case 'browser-incompatible': return '当前浏览器不支持 WebRTC';
        case 'webrtc': return 'WebRTC 直连失败（NAT 限制），可改用其它网络或「无服务器直连」模式';
        default: return '联机出错：' + (type || '未知错误');
      }
    }

    _peerOptions(server) {
      const opts = { debug: 1, config: { iceServers: CFG.STUN_SERVERS } };
      if (server) {
        const m = String(server).trim().match(/^([^:/#\s]+)(?::(\d+))?(\/?[^\s]*)?$/);
        if (m) {
          opts.host = m[1];
          opts.port = Number(m[2]) || 443;
          opts.path = m[3] || '/';
          opts.secure = opts.port === 443;
        }
      }
      return opts;
    }

    /* ================= PeerJS 房间码模式 ================= */

    startHost(code, server) {
      const self = this;
      this.role = 'host';
      this.kind = 'peerjs';
      this.code = String(code).toUpperCase();
      const peerId = CFG.PEER_PREFIX + this.code;
      return new Promise((resolve, reject) => {
        let opened = false;
        let peer;
        try {
          peer = new Peer(peerId, self._peerOptions(server));
        } catch (e) {
          reject(new Error('初始化联机组件失败：' + e.message));
          return;
        }
        self.peer = peer;
        const timer = setTimeout(() => {
          if (!opened) {
            try { peer.destroy(); } catch (e) {}
            reject(new Error('连接信令服务器超时，请检查网络，或改用「无服务器直连」模式'));
          }
        }, 15000);

        peer.on('open', () => {
          opened = true;
          clearTimeout(timer);
          resolve(self.code);
        });

        peer.on('connection', (conn) => self._acceptPeerJSConn(conn));

        peer.on('error', (err) => {
          const type = err && err.type;
          if (!opened) {
            clearTimeout(timer);
            try { peer.destroy(); } catch (e) {}
            reject(new Error(self._errText(type)));
          } else {
            self._status('error', self._errText(type));
          }
        });

        peer.on('disconnected', () => {
          if (self._closed) return;
          self._status('warn', '与信令服务器断开，尝试重连…');
          try { peer.reconnect(); } catch (e) {}
        });
      });
    }

    _acceptPeerJSConn(conn) {
      const self = this;
      if (self.role !== 'host') return;
      if (self.transports.size >= CFG.MAX_PLAYERS - 1) {
        this._status('warn', '房间已满，拒绝了一个连接');
        try { conn.close(); } catch (e) {}
        return;
      }
      conn.on('open', () => {
        const id = conn.peer;
        self._addTransport(id, {
          id,
          kind: 'peerjs',
          send(o) { conn.send(o); },
          close() { try { conn.close(); } catch (e) {} },
        });
      });
      conn.on('data', (d) => self._dispatch(normalize(d), conn.peer));
      conn.on('close', () => self._dropTransport(conn.peer));
      conn.on('error', (e) => console.warn('[net] 连接错误', e));
    }

    join(code, server) {
      const self = this;
      this.role = 'guest';
      this.kind = 'peerjs';
      this.code = String(code).toUpperCase();
      return new Promise((resolve, reject) => {
        let peer;
        try {
          peer = new Peer(null, self._peerOptions(server));
        } catch (e) {
          reject(new Error('初始化联机组件失败：' + e.message));
          return;
        }
        self.peer = peer;
        let opened = false;

        const timer = setTimeout(() => {
          if (!self._guestConnOpen) {
            try { peer.destroy(); } catch (e) {}
            reject(new Error('连接超时：请检查房间码与网络，或改用「无服务器直连」模式'));
          }
        }, 20000);

        peer.on('open', () => {
          opened = true;
          self.selfId = peer.id;
          const conn = peer.connect(CFG.PEER_PREFIX + self.code, { reliable: true });
          conn.on('open', () => {
            self._guestConnOpen = true;
            clearTimeout(timer);
            self._addTransport('host', {
              id: 'host',
              kind: 'peerjs',
              send(o) { conn.send(o); },
              close() { try { conn.close(); } catch (e) {} },
            });
            resolve();
          });
          conn.on('data', (d) => self._dispatch(normalize(d), 'host'));
          conn.on('close', () => self._dropTransport('host'));
          conn.on('error', (err) => {
            const msg = self._errText(err && err.type);
            if (!self._guestConnOpen) {
              clearTimeout(timer);
              try { peer.destroy(); } catch (e) {}
              reject(new Error(msg));
            } else {
              self._status('error', msg);
            }
          });
        });

        peer.on('error', (err) => {
          const msg = self._errText(err && err.type);
          if (!opened) {
            clearTimeout(timer);
            try { peer.destroy(); } catch (e) {}
            reject(new Error(msg));
          } else {
            self._status('error', msg);
          }
        });
      });
    }

    /* ================= 无服务器直连（复制粘贴） ================= */

    /** 房主：生成邀请码 */
    async createManualOffer() {
      this.role = 'host';
      this.kind = 'manual';
      const pc = new RTCPeerConnection({ iceServers: CFG.STUN_SERVERS });
      const dc = pc.createDataChannel('bwc', { ordered: true });
      const guest = { pc, dc, id: null };
      this._pendingGuest = guest;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIce(pc, 6000);
      return CODE_PREFIX + await encodeText(pc.localDescription.sdp);
    }

    /** 房主：接受好友回传的应答码 */
    async acceptManualAnswer(answerCode) {
      const guest = this._pendingGuest;
      if (!guest) throw new Error('没有等待中的直连邀请，请先点击「生成邀请码」');
      const raw = String(answerCode).trim();
      if (!raw.startsWith(CODE_PREFIX)) throw new Error('应答码格式不对（应以 BWC1| 开头）');
      let sdp;
      try {
        sdp = await decodeText(raw.slice(CODE_PREFIX.length));
      } catch (e) {
        throw new Error('应答码解析失败，请确认复制完整');
      }
      await guest.pc.setRemoteDescription({ type: 'answer', sdp });
      this._pendingGuest = null;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('连接建立超时：请重试，或改用房间码模式'));
        }, 25000);
        guest.dc.onopen = () => {
          clearTimeout(timer);
          const id = 'g' + (++this._guestSeq);
          guest.id = id;
          this._addTransport(id, {
            id,
            kind: 'manual',
            send(o) { try { guest.dc.send(JSON.stringify(o)); } catch (e) {} },
            close() { try { guest.pc.close(); } catch (e) {} },
          });
          resolve(id);
        };
        guest.dc.onmessage = (e) => {
          if (!guest.id) return;
          let o = null;
          try { o = JSON.parse(e.data); } catch (err) { return; }
          this._dispatch(o, guest.id);
        };
        guest.dc.onclose = () => {
          if (guest.id) this._dropTransport(guest.id);
        };
      });
    }

    /** 访客：用邀请码生成应答码 */
    async joinViaManualOffer(offerCode) {
      this.role = 'guest';
      this.kind = 'manual';
      const raw = String(offerCode).trim();
      if (!raw.startsWith(CODE_PREFIX)) throw new Error('邀请码格式不对（应以 BWC1| 开头）');
      let sdp;
      try {
        sdp = await decodeText(raw.slice(CODE_PREFIX.length));
      } catch (e) {
        throw new Error('邀请码解析失败，请确认复制完整');
      }
      const pc = new RTCPeerConnection({ iceServers: CFG.STUN_SERVERS });
      this._pendingHostPc = pc;

      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('与房主建立连接超时，请重试')), 30000);
        pc.ondatachannel = (e) => {
          const dc = e.channel;
          dc.onopen = () => {
            clearTimeout(timer);
            this._addTransport('host', {
              id: 'host',
              kind: 'manual',
              send(o) { try { dc.send(JSON.stringify(o)); } catch (err) {} },
              close() { try { pc.close(); } catch (err) {} },
            });
            resolve();
          };
          dc.onmessage = (e) => {
            let o = null;
            try { o = JSON.parse(e.data); } catch (err) { return; }
            this._dispatch(o, 'host');
          };
          dc.onclose = () => this._dropTransport('host');
        };
      });

      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIce(pc, 6000);

      return {
        answerCode: CODE_PREFIX + await encodeText(pc.localDescription.sdp),
        ready,
      };
    }

    /* ---------------- 关闭 ---------------- */
    close() {
      this._closed = true;
      this.transports.forEach((t) => { try { t.close(); } catch (e) {} });
      this.transports.clear();
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }
      if (this._pendingGuest) {
        try { this._pendingGuest.pc.close(); } catch (e) {}
        this._pendingGuest = null;
      }
      if (this._pendingHostPc) {
        try { this._pendingHostPc.close(); } catch (e) {}
        this._pendingHostPc = null;
      }
      this.role = null;
      this.kind = null;
      this._guestConnOpen = false;
    }
  }

  function normalize(d) {
    if (typeof d === 'string') {
      try { return JSON.parse(d); } catch (e) { return null; }
    }
    return d;
  }

  function waitIce(pc, timeoutMs) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const timer = setTimeout(finish, timeoutMs);
      function finish() {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
      function check() {
        if (pc.iceGatheringState === 'complete') finish();
      }
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  /** 压缩（gzip 可用时）+ base64 */
  async function encodeText(str) {
    try {
      if (typeof CompressionStream === 'function') {
        const cs = new CompressionStream('gzip');
        const stream = new Blob([str]).stream().pipeThrough(cs);
        const buf = await new Response(stream).arrayBuffer();
        return 'G' + bytesToB64(new Uint8Array(buf));
      }
    } catch (e) { /* 回退 */ }
    return 'P' + U.b64encode(str);
  }

  async function decodeText(payload) {
    const tag = payload.charAt(0);
    const body = payload.slice(1);
    if (tag === 'G') {
      if (typeof DecompressionStream !== 'function') throw new Error('浏览器不支持解压');
      const bytes = b64ToBytes(body);
      const ds = new DecompressionStream('gzip');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      const buf = await new Response(stream).arrayBuffer();
      return new TextDecoder().decode(buf);
    }
    return U.b64decode(body);
  }

  function bytesToB64(bytes) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  BWC.Net = Net;
  BWC.NET_CODE_PREFIX = CODE_PREFIX;
})();
