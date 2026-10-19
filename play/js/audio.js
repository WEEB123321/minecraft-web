/* ============================================================
 * 方块世界 · 极简 WebAudio 音效（无需音频文件）
 * ============================================================ */
(function () {
  'use strict';
  const BWC = window.BWC;

  const Audio = (BWC.Audio = {
    enabled: true,
    ctx: null,
    _noiseBuf: null,
    _last: {},

    init() {
      if (!this.enabled) return;
      if (!this.ctx) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          this.ctx = AC ? new AC() : null;
        } catch (e) { this.ctx = null; }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    },

    setEnabled(v) { this.enabled = !!v; },

    _noise() {
      const ctx = this.ctx;
      if (!this._noiseBuf) {
        const len = Math.floor(ctx.sampleRate * 0.5);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this._noiseBuf = buf;
      }
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      return src;
    },

    /**
     * 播放一个音效
     * name: dig | place | step | jump | land | click | chat | join | leave
     */
    play(name, opts) {
      if (!this.enabled) return;
      // 防抖：同名音效最小间隔，避免噪音
      const now = performance.now();
      const minGap = name === 'step' ? 0 : 40;
      if (this._last[name] && now - this._last[name] < minGap) return;
      this._last[name] = now;

      this.init();
      const ctx = this.ctx;
      if (!ctx) return;
      opts = opts || {};
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.connect(ctx.destination);

      const mkGain = (a, d, peak) => {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + a);
        g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
        out.gain.value = 1;
        g.connect(out);
        return g;
      };
      const mkOsc = (type, f0, f1, dur, peak) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
        const g = mkGain(0.005, dur, peak);
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.05);
        return o;
      };
      const mkNoise = (fType, freq, dur, peak) => {
        const src = this._noise();
        const f = ctx.createBiquadFilter();
        f.type = fType;
        f.frequency.value = freq;
        src.connect(f);
        const g = mkGain(0.004, dur, peak);
        f.connect(g);
        src.start(t);
        src.stop(t + dur + 0.05);
      };

      switch (name) {
        case 'dig':
          mkNoise('bandpass', 480 + Math.random() * 380, 0.09, opts.volume || 0.28);
          break;
        case 'place':
          mkNoise('lowpass', 700, 0.07, 0.16);
          mkOsc('sine', 150, 90, 0.10, 0.16);
          break;
        case 'step':
          mkNoise('lowpass', 380 + Math.random() * 140, 0.05, 0.05);
          break;
        case 'jump':
          mkOsc('sine', 280, 420, 0.09, 0.05);
          break;
        case 'land':
          mkNoise('lowpass', 300, 0.10, 0.09);
          break;
        case 'click':
          mkOsc('square', 620, 520, 0.04, 0.045);
          break;
        case 'chat':
          mkOsc('sine', 880, 880, 0.09, 0.06);
          setTimeout(() => this.ctx && this._tone(1320, 0.10, 0.05), 80);
          break;
        case 'join':
          mkOsc('sine', 520, 780, 0.14, 0.06);
          break;
        case 'leave':
          mkOsc('sine', 600, 320, 0.18, 0.06);
          break;
        default:
          mkOsc('sine', 440, 440, 0.05, 0.04);
      }
    },

    _tone(freq, dur, peak) {
      const ctx = this.ctx;
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    },
  });
})();
