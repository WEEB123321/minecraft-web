/* ============================================================
 * 方块世界 · 程序化材质（无需任何图片文件）
 * 所有方块贴图在运行时用 Canvas 绘制并合成一张图集
 * ============================================================ */
(function () {
  'use strict';
  const BWC = window.BWC;
  const U = BWC.util;

  const COLS = 8;
  const ROWS = 4;        // 8 x 4 = 32 格 ≥ 21 个 tile，且整体 128x64 为 2 的幂
  const TS = 16;         // 单 tile 像素
  const ATLAS_W = COLS * TS;
  const ATLAS_H = ROWS * TS;
  const INSET = 0.5;     // 半像素内缩，避免 mipmap 溢色

  /* ---------------- 绘图小工具 ---------------- */
  function makeCtx(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return { c, ctx };
  }
  function px(ctx, x, y, color) { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); }
  function fill(ctx, color) { ctx.fillStyle = color; ctx.fillRect(0, 0, TS, TS); }
  function noiseFill(ctx, base, variants, rand, density) {
    density = density === undefined ? 0.45 : density;
    fill(ctx, base);
    const n = variants.length;
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        if (rand() < density) px(ctx, x, y, variants[(rand() * n) | 0]);
      }
    }
  }
  function rndRect(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }

  /* ---------------- 各 tile 的绘制函数 ---------------- */
  const PAINTERS = {
    grass_top(ctx, rand) {
      noiseFill(ctx, '#5fae3c', ['#57a335', '#6cbb47', '#4f9a2f', '#63b23f'], rand, 0.5);
      for (let i = 0; i < 10; i++) px(ctx, (rand() * 16) | 0, (rand() * 16) | 0, '#79c85a');
    },
    grass_side(ctx, rand) {
      noiseFill(ctx, '#8a6544', ['#7b5a3c', '#966f4c', '#82603f'], rand, 0.5);
      for (let x = 0; x < 16; x++) {
        const d = 3 + ((rand() * 2) | 0);
        for (let y = 0; y < d; y++)
          px(ctx, x, y, ['#5fae3c', '#57a335', '#6cbb47', '#4f9a2f'][(rand() * 4) | 0]);
        if (rand() < 0.35) px(ctx, x, d, '#57a335');
      }
    },
    dirt(ctx, rand) {
      noiseFill(ctx, '#8a6544', ['#7b5a3c', '#966f4c', '#82603f'], rand, 0.5);
      for (let i = 0; i < 8; i++) px(ctx, (rand() * 16) | 0, (rand() * 16) | 0, '#6d503a');
    },
    stone(ctx, rand) {
      noiseFill(ctx, '#7f7f7f', ['#767676', '#8a8a8a', '#6e6e6e', '#848484'], rand, 0.5);
      for (let i = 0; i < 6; i++) {
        const x = (rand() * 13) | 0, y = (rand() * 13) | 0;
        rndRect(ctx, x, y, 2 + ((rand() * 2) | 0), 2 + ((rand() * 2) | 0), '#6a6a6a');
      }
    },
    cobble(ctx, rand) {
      fill(ctx, '#5e5e5e');
      const blobs = [[0, 0, 6, 4], [7, 0, 5, 5], [13, 0, 3, 6], [0, 5, 5, 5], [6, 6, 6, 4], [13, 7, 3, 4], [0, 11, 7, 5], [8, 11, 8, 5]];
      for (const [bx, by, bw, bh] of blobs) {
        rndRect(ctx, bx, by, bw, bh, '#868686');
        ctx.fillStyle = '#9a9a9a';
        ctx.fillRect(bx, by, bw, 1);
        ctx.fillStyle = '#6b6b6b';
        ctx.fillRect(bx, by + bh - 1, bw, 1);
        ctx.fillRect(bx + bw - 1, by, 1, bh);
      }
      for (let i = 0; i < 22; i++) px(ctx, (rand() * 16) | 0, (rand() * 16) | 0, rand() < 0.5 ? '#7d7d7d' : '#8f8f8f');
    },
    sand(ctx, rand) {
      noiseFill(ctx, '#e3d9a4', ['#d8cd93', '#efe6b5', '#d1c488'], rand, 0.5);
    },
    log_side(ctx, rand) {
      fill(ctx, '#7a5a33');
      for (let x = 0; x < 16; x++) {
        const shade = ['#6b4d2a', '#7a5a33', '#84643a', '#71522d'][(rand() * 4) | 0];
        for (let y = 0; y < 16; y++) px(ctx, x, y, shade);
      }
      for (let y = 0; y < 16; y++) {
        if (rand() < 0.4) px(ctx, (rand() * 16) | 0, y, '#5c4526');
        if (rand() < 0.3) px(ctx, (rand() * 16) | 0, y, '#8f6e40');
      }
      for (let y = 0; y < 16; y++) { px(ctx, 0, y, '#5c4526'); px(ctx, 15, y, '#5c4526'); }
    },
    log_top(ctx, rand) {
      fill(ctx, '#a5824f');
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
          const ring = Math.floor(d);
          const col = ['#b3905c', '#8a6a3d', '#a5824f', '#7d5f36'][ring % 4];
          px(ctx, x, y, col);
        }
      }
      rndRect(ctx, 7, 7, 2, 2, '#5c4526');
    },
    leaves(ctx, rand) {
      noiseFill(ctx, '#3e8a2d', ['#367c26', '#48993a', '#2f6d20', '#439134'], rand, 0.55);
      for (let i = 0; i < 14; i++) {
        ctx.clearRect((rand() * 16) | 0, (rand() * 16) | 0, 1, 1);
      }
      for (let i = 0; i < 8; i++) px(ctx, (rand() * 16) | 0, (rand() * 16) | 0, '#57a83f');
    },
    planks(ctx, rand) {
      for (let y = 0; y < 16; y++) {
        const row = (y / 4) | 0;
        const base = ['#b08a4f', '#a98247', '#b98f52', '#a37c42'][row % 4];
        for (let x = 0; x < 16; x++) {
          px(ctx, x, y, rand() < 0.25 ? (rand() < 0.5 ? '#a07a40' : '#c09a5c') : base);
        }
        if (y % 4 === 3) for (let x = 0; x < 16; x++) px(ctx, x, y, '#8a6a3c');
      }
      for (let row = 0; row < 4; row++) {
        const sx = (row % 2 === 0) ? 3 : 11;
        for (let y = row * 4; y < row * 4 + 3; y++) px(ctx, sx, y, '#8a6a3c');
      }
    },
    brick(ctx, rand) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (y % 4 === 3) { px(ctx, x, y, '#c8bfae'); continue; }
          const off = (((y / 4) | 0) % 2) * 4;
          if ((x + off) % 8 === 7) { px(ctx, x, y, '#c8bfae'); continue; }
          px(ctx, x, y, ['#a2412f', '#98402e', '#ad4a36', '#8f3b2a'][(rand() * 4) | 0]);
        }
      }
    },
    glass(ctx, rand) {
      ctx.clearRect(0, 0, 16, 16);
      ctx.fillStyle = 'rgba(226,242,248,0.92)';
      ctx.fillRect(0, 0, 16, 1); ctx.fillRect(0, 15, 16, 1);
      ctx.fillRect(0, 0, 1, 16); ctx.fillRect(15, 0, 1, 16);
      for (let i = 0; i < 16; i++) {
        const x = i, y = 12 - i;
        if (x > 1 && x < 14 && y > 1 && y < 14) px(ctx, x, y, 'rgba(255,255,255,0.30)');
        if (y + 3 > 1 && y + 3 < 14) px(ctx, x, y + 3, 'rgba(255,255,255,0.18)');
      }
    },
    water(ctx, rand) {
      ctx.clearRect(0, 0, 16, 16);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const a = 0.68 + (rand() * 0.1);
          px(ctx, x, y, 'rgba(' + (46 + ((rand() * 22) | 0)) + ',' + (104 + ((rand() * 26) | 0)) + ',' + (212 + ((rand() * 30) | 0)) + ',' + a.toFixed(2) + ')');
        }
      }
      for (let i = 0; i < 6; i++) {
        const y = (rand() * 16) | 0;
        for (let x = (rand() * 8) | 0; x < 16 && x < ((rand() * 8) | 0) + 8; x++) px(ctx, x, y, 'rgba(180,215,255,0.45)');
      }
    },
    snow(ctx, rand) {
      noiseFill(ctx, '#f6faff', ['#eef4fb', '#ffffff', '#e8f0f8'], rand, 0.5);
    },
    glowstone(ctx, rand) {
      noiseFill(ctx, '#e5c163', ['#d9b455', '#eecb6e'], rand, 0.45);
      for (let i = 0; i < 7; i++) {
        const x = (rand() * 13) | 0, y = (rand() * 13) | 0;
        rndRect(ctx, x, y, 2 + ((rand() * 2) | 0), 2 + ((rand() * 2) | 0), rand() < 0.5 ? '#fff3b0' : '#f8dc8a');
      }
      for (let i = 0; i < 10; i++) px(ctx, (rand() * 16) | 0, (rand() * 16) | 0, '#b8923f');
    },
    obsidian(ctx, rand) {
      noiseFill(ctx, '#241c36', ['#2b2242', '#1d1629', '#332a4e'], rand, 0.5);
      for (let i = 0; i < 7; i++) px(ctx, (rand() * 16) | 0, (rand() * 16) | 0, '#5b4787');
      for (let i = 0; i < 3; i++) px(ctx, (rand() * 16) | 0, (rand() * 16) | 0, '#8a74c0');
    },
    gold(ctx, rand) {
      noiseFill(ctx, '#f0cf4a', ['#e2c03c', '#f8dc63', '#d8b535'], rand, 0.5);
      for (let i = 0; i < 4; i++) {
        const x = 1 + ((rand() * 9) | 0), y = 1 + ((rand() * 9) | 0);
        px(ctx, x, y, '#fff3a6'); px(ctx, x + 1, y, '#fff3a6'); px(ctx, x, y + 1, '#fff3a6');
      }
    },
    diamond(ctx, rand) {
      noiseFill(ctx, '#57d8cf', ['#48c9c0', '#74e6dd', '#3fb8b0'], rand, 0.5);
      const spots = [[3, 3], [11, 5], [6, 11]];
      for (const [sx, sy] of spots) {
        px(ctx, sx, sy - 1, '#c8fbf6'); px(ctx, sx - 1, sy, '#c8fbf6');
        px(ctx, sx, sy, '#eafffd'); px(ctx, sx + 1, sy, '#c8fbf6'); px(ctx, sx, sy + 1, '#c8fbf6');
      }
    },
    bedrock(ctx, rand) {
      fill(ctx, '#3a3a3a');
      for (let i = 0; i < 16; i++) {
        const x = (rand() * 13) | 0, y = (rand() * 13) | 0;
        rndRect(ctx, x, y, 2 + ((rand() * 3) | 0), 2 + ((rand() * 3) | 0), ['#2c2c2c', '#4a4a4a', '#575757', '#232323'][(rand() * 4) | 0]);
      }
    },
    cactus_side(ctx, rand) {
      fill(ctx, '#3d8b3d');
      for (let y = 0; y < 16; y++) {
        for (let x = 2; x < 14; x++) px(ctx, x, y, ['#357c35', '#469a46', '#3f8a3f'][(rand() * 3) | 0]);
        px(ctx, 0, y, '#2c672c'); px(ctx, 1, y, '#2f6b2f');
        px(ctx, 14, y, '#2f6b2f'); px(ctx, 15, y, '#2c672c');
      }
      for (let i = 0; i < 9; i++) px(ctx, 3 + ((rand() * 10) | 0), (rand() * 16) | 0, '#d9f2c8');
    },
    cactus_top(ctx, rand) {
      fill(ctx, '#2f6b2f');
      rndRect(ctx, 1, 1, 14, 14, '#4f9a4f');
      rndRect(ctx, 3, 3, 10, 10, '#5fae5f');
      for (let i = 0; i < 12; i++) px(ctx, 3 + ((rand() * 10) | 0), 3 + ((rand() * 10) | 0), '#6fbe6f');
      rndRect(ctx, 7, 7, 2, 2, '#2f6b2f');
    },
  };

  /* ---------------- 构建图集 ---------------- */
  let atlasCanvas = null;
  const tileCanvases = [];

  function buildTiles() {
    BWC.TILE_NAMES.forEach((name, i) => {
      const { c, ctx } = makeCtx(TS, TS);
      const rand = U.mulberry32(0x9e3779b9 ^ U.hashStr(name));
      const painter = PAINTERS[name];
      if (painter) painter(ctx, rand);
      else noiseFill(ctx, '#ff00ff', ['#000000'], rand, 0.9); // 缺失材质：醒目品红
      tileCanvases[i] = c;
    });
  }

  function composeAtlas() {
    const { c, ctx } = makeCtx(ATLAS_W, ATLAS_H);
    for (let i = 0; i < tileCanvases.length; i++) {
      const col = i % COLS, row = (i / COLS) | 0;
      ctx.drawImage(tileCanvases[i], col * TS, row * TS);
    }
    atlasCanvas = c;
  }

  const uvCache = [];
  function buildUV() {
    for (let i = 0; i < BWC.TILE_NAMES.length; i++) {
      const col = i % COLS, row = (i / COLS) | 0;
      const u0 = (col * TS + INSET) / ATLAS_W;
      const u1 = ((col + 1) * TS - INSET) / ATLAS_W;
      const v1 = 1 - (row * TS + INSET) / ATLAS_H;         // 画布上部 → uv 上沿
      const v0 = 1 - ((row + 1) * TS - INSET) / ATLAS_H;
      uvCache[i] = { u0, v0, u1, v1 };
    }
  }

  BWC.Textures = {
    texture: null,
    enabledFs: true,

    build() {
      buildTiles();
      composeAtlas();
      buildUV();
      const tex = new THREE.CanvasTexture(atlasCanvas);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.texture = tex;
      this._uvCache = uvCache;
      this._tileCanvases = tileCanvases;
      return tex;
    },

    uv(tileIndex) { return uvCache[tileIndex]; },

    /** 快捷栏/背包图标：tile 放大到指定尺寸 */
    icon(tileIndex, size) {
      size = size || 32;
      const { c, ctx } = makeCtx(size, size);
      const src = tileCanvases[tileIndex];
      if (src) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(src, 0, 0, size, size);
        // 右下暗角，制造一点立体感
        const g = ctx.createLinearGradient(0, 0, size, size);
        g.addColorStop(0, 'rgba(255,255,255,0.10)');
        g.addColorStop(0.5, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.22)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }
      return c;
    },

    /** 方块图标：优先展示侧面（如草方块） */
    blockIconCanvas(blockId, size) {
      const def = BWC.BLOCKS[blockId] || BWC.BLOCKS[0];
      const tile = BWC.blockTile(def, 'side');
      return this.icon(tile, size);
    },
  };
})();
