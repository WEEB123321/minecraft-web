/* ============================================================
 * 方块世界 · 方块定义
 * ============================================================ */
(function () {
  'use strict';
  const BWC = window.BWC;

  // 材质图集内的 tile 名称（顺序即 tile 索引，textures.js 按此绘图）
  BWC.TILE_NAMES = [
    'grass_top', 'grass_side', 'dirt', 'stone', 'cobble', 'sand',
    'log_side', 'log_top', 'leaves', 'planks', 'brick', 'glass',
    'water', 'snow', 'glowstone', 'obsidian', 'gold', 'diamond',
    'bedrock', 'cactus_side', 'cactus_top',
  ];
  const T = (BWC.T = {});
  BWC.TILE_NAMES.forEach((n, i) => (T[n] = i));

  function def(id, key, name, opt) {
    return Object.assign({
      id, key, name,
      solid: true,      // 参与碰撞
      opaque: true,     // 遮挡相邻面 / AO
      cutout: false,    // 使用 alphaTest 镂空
      liquid: false,
      unbreakable: false,
      tiles: null,      // {all} 或 {top, side, bottom}
    }, opt || {});
  }

  const B = [];
  B[0] = def(0, 'air', '空气', { solid: false, opaque: false });
  B[1] = def(1, 'grass', '草方块', { tiles: { top: T.grass_top, side: T.grass_side, bottom: T.dirt } });
  B[2] = def(2, 'dirt', '泥土', { tiles: { all: T.dirt } });
  B[3] = def(3, 'stone', '石头', { tiles: { all: T.stone } });
  B[4] = def(4, 'cobble', '圆石', { tiles: { all: T.cobble } });
  B[5] = def(5, 'sand', '沙子', { tiles: { all: T.sand } });
  B[6] = def(6, 'log', '原木', { tiles: { top: T.log_top, bottom: T.log_top, side: T.log_side } });
  B[7] = def(7, 'leaves', '树叶', { tiles: { all: T.leaves }, cutout: true, opaque: false });
  B[8] = def(8, 'planks', '木板', { tiles: { all: T.planks } });
  B[9] = def(9, 'brick', '砖块', { tiles: { all: T.brick } });
  B[10] = def(10, 'glass', '玻璃', { tiles: { all: T.glass }, cutout: true, opaque: false });
  B[11] = def(11, 'water', '水', { tiles: { all: T.water }, liquid: true, solid: false, opaque: false });
  B[12] = def(12, 'snow', '雪块', { tiles: { all: T.snow } });
  B[13] = def(13, 'glowstone', '荧石', { tiles: { all: T.glowstone } });
  B[14] = def(14, 'obsidian', '黑曜石', { tiles: { all: T.obsidian } });
  B[15] = def(15, 'gold', '金块', { tiles: { all: T.gold } });
  B[16] = def(16, 'diamond', '钻石块', { tiles: { all: T.diamond } });
  B[17] = def(17, 'bedrock', '基岩', { tiles: { all: T.bedrock }, unbreakable: true });
  B[18] = def(18, 'cactus', '仙人掌', { tiles: { top: T.cactus_top, bottom: T.cactus_top, side: T.cactus_side } });

  BWC.BLOCKS = B;

  /** 取方块在某个面使用哪块 tile："top" | "bottom" | "side" */
  BWC.blockTile = function (bdef, faceKey) {
    const t = bdef.tiles;
    if (!t) return 0;
    if (t.all !== undefined) return t.all;
    if (faceKey === 'top') return t.top;
    if (faceKey === 'bottom') return t.bottom;
    return t.side;
  };

  // 创造模式方块列表（不含基岩 / 空气 / 水可直接放置）
  BWC.PALETTE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18];
  // 默认快捷栏
  BWC.DEFAULT_HOTBAR = [1, 3, 4, 8, 6, 7, 5, 10, 13];
})();
