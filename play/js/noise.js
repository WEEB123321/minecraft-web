/* ============================================================
 * 方块世界 · 确定性值噪声（同一 seed 在任何设备生成一致地形）
 * ============================================================ */
(function () {
  'use strict';
  const BWC = window.BWC;
  const U = BWC.util;

  class ValueNoise {
    constructor(seedStr) {
      this.seed = U.hashStr(String(seedStr));
    }

    /** 基础值噪声，返回 [-1, 1] */
    value(x, y) {
      const seed = this.seed;
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = x - xi;
      const fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const a = U.rand01(seed, xi, yi);
      const b = U.rand01(seed, xi + 1, yi);
      const c = U.rand01(seed, xi, yi + 1);
      const d = U.rand01(seed, xi + 1, yi + 1);
      const top = a + (b - a) * sx;
      const bot = c + (d - c) * sx;
      return (top + (bot - top) * sy) * 2 - 1;
    }

    /** 分形叠加，返回 [-1, 1] */
    fbm(x, y, octaves) {
      octaves = octaves || 3;
      let sum = 0, amp = 1, freq = 1, norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += this.value(x * freq + i * 37.19, y * freq + i * 17.53) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      return sum / norm;
    }
  }

  BWC.makeNoise = (seedStr) => new ValueNoise(seedStr);
})();
