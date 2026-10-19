/* ============================================================
 * 方块世界 · 全局配置与工具函数
 * ============================================================ */
(function () {
  'use strict';
  const BWC = (window.BWC = window.BWC || {});

  BWC.CONFIG = {
    CHUNK: 16,
    HEIGHT: 96,
    SEA_LEVEL: 30,
    DAY_LENGTH: 600,            // 一整天时长（秒）
    MAX_PLAYERS: 8,
    REACH: 6,                   // 交互距离（格）
    GRAVITY: 30,
    JUMP_SPEED: 9.2,
    WALK_SPEED: 4.5,
    SPRINT_SPEED: 7.0,
    FLY_SPEED: 11,
    FLY_SPRINT: 22,
    SWIM_FACTOR: 0.55,
    PLAYER_W: 0.6,
    PLAYER_H: 1.8,
    EYE_H: 1.62,
    NET_STATE_HZ: 10,           // 每秒同步位置次数
    PEER_PREFIX: 'bwcp2p-',     // PeerJS 房间 ID 前缀

    PRESETS: {
      lite:  { key: 'lite',  name: '流畅版', renderDistance: 4, pixelRatioMax: 1,   clouds: false },
      std:   { key: 'std',   name: '标准版', renderDistance: 6, pixelRatioMax: 1.5, clouds: true },
      ultra: { key: 'ultra', name: '超清版', renderDistance: 9, pixelRatioMax: 2,   clouds: true },
    },

    // WebRTC ICE：公共 STUN + 公益 TURN（TURN 仅作兜底，连不上不影响）
    STUN_SERVERS: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.miwifi.com:3478' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
  };

  const U = (BWC.util = {});

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smoothstep = (a, b, x) => {
    const t = U.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  /* ---------- 确定性哈希（跨端一致） ---------- */
  U.hashStr = function (str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  U.hash2i = function (seed, x, y) {
    let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return h >>> 0;
  };
  U.rand01 = (seed, x, y) => U.hash2i(seed, x, y) / 4294967296;

  U.mulberry32 = function (a) {
    a = a | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.shortCode = function (len) {
    len = len || 5;
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < len; i++) s += A[(Math.random() * A.length) | 0];
    return s;
  };

  U.esc = function (s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  U.copyText = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  };

  U.saveJSON = function (obj, filename) {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  U.loadLocal = function (key, def) {
    try {
      const s = localStorage.getItem(key);
      return s ? JSON.parse(s) : def;
    } catch (e) {
      return def;
    }
  };
  U.saveLocal = function (key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* 隐私模式等 */ }
  };

  /* ---------- Base64（UTF-8 安全）+ gzip（可选） ---------- */
  U.b64encode = function (str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  };
  U.b64decode = function (b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };
})();
