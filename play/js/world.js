/* ============================================================
 * 方块世界 · 世界与区块（地形生成 / 网格构建 / 光线投射 / 编辑同步）
 * ============================================================ */
(function () {
  'use strict';
  const BWC = window.BWC;
  const U = BWC.util;
  const CFG = BWC.CONFIG;
  const CS = CFG.CHUNK;
  const H = CFG.HEIGHT;

  // 面定义：n=法线，u/v=面内两个方向（u×v=n，保证外看逆时针）；shade=固定明暗
  const FACES = [
    { n: [1, 0, 0],  u: [0, 0, -1], v: [0, 1, 0], key: 'side',   shade: 0.76 },
    { n: [-1, 0, 0], u: [0, 0, 1],  v: [0, 1, 0], key: 'side',   shade: 0.76 },
    { n: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, -1], key: 'top',   shade: 1.0 },
    { n: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, 1], key: 'bottom', shade: 0.52 },
    { n: [0, 0, 1],  u: [1, 0, 0],  v: [0, 1, 0], key: 'side',   shade: 0.88 },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], key: 'side',   shade: 0.88 },
  ];
  const AO_LEVELS = [1.0, 0.84, 0.70, 0.56];
  const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const IDX_QUAD = [0, 1, 2, 0, 2, 3];

  class World {
    constructor(scene, seed, opts) {
      opts = opts || {};
      this.scene = scene;
      this.seed = String(seed);
      this.seedHash = U.hashStr(this.seed);
      this.noiseH = BWC.makeNoise(this.seed + '|height');
      this.noiseB = BWC.makeNoise(this.seed + '|biome');
      this.noiseD = BWC.makeNoise(this.seed + '|detail');

      this.chunks = new Map();          // "cx,cz" -> chunk
      this.editsByChunk = new Map();    // "cx,cz" -> Map("lx,y,lz" -> id)
      this.renderDistance = opts.renderDistance || CFG.PRESETS.std.renderDistance;
      this.offsets = this._makeOffsets(this.renderDistance);

      this.genQueue = [];
      this.meshQueue = [];
      this.onBlockChanged = null;       // (x,y,z,id) 本地改动回调

      BWC.Textures.build();
      this.matSolid = new THREE.MeshLambertMaterial({
        map: BWC.Textures.texture, vertexColors: true, alphaTest: 0.5,
      });
      this.matWater = new THREE.MeshLambertMaterial({
        map: BWC.Textures.texture, vertexColors: true,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      this.group = new THREE.Group();
      scene.add(this.group);

      this.stats = { chunks: 0, meshed: 0, faces: 0 };
    }

    /* ---------------- 区块索引 ---------------- */
    _makeOffsets(r) {
      const arr = [];
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = dx * dx + dz * dz;
          if (d <= (r + 0.5) * (r + 0.5)) arr.push([dx, dz, d]);
        }
      }
      arr.sort((a, b) => a[2] - b[2]);
      return arr;
    }

    key(cx, cz) { return cx + ',' + cz; }
    getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }

    ensureChunk(cx, cz) {
      const k = this.key(cx, cz);
      let c = this.chunks.get(k);
      if (!c) {
        c = {
          cx, cz,
          data: new Uint8Array(CS * H * CS),
          state: 0,               // 0=未生成 1=已生成 2=已出网格
          mesh: null, waterMesh: null,
          maxY: H - 1,
          genQueued: false, meshQueued: false,
        };
        this.chunks.set(k, c);
      }
      return c;
    }

    disposeChunk(c) {
      if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
      if (c.waterMesh) { this.group.remove(c.waterMesh); c.waterMesh.geometry.dispose(); c.waterMesh = null; }
      c.state = 0;
    }

    /* ---------------- 世界坐标方块访问 ----------------
     * 返回：0=空气；>0=方块 id；-1=所在区块尚未生成（网格剔除时视为实体） */
    getBlock(x, y, z) {
      if (y < 0) return 17;
      if (y >= H) return 0;
      const cx = x >> 4, cz = z >> 4;
      const c = this.chunks.get(this.key(cx, cz));
      if (!c || c.state === 0) return -1;
      return c.data[(y * CS + (z - (cz << 4))) * CS + (x - (cx << 4))];
    }

    isSolidAt(x, y, z) {
      const id = this.getBlock(x, y, z);
      if (id <= 0) return false;
      const d = BWC.BLOCKS[id];
      return !!(d && d.solid);
    }

    _opaqueAt(x, y, z) {
      const id = this.getBlock(x, y, z);
      if (id === -1) return true;
      if (id <= 0) return false;
      const d = BWC.BLOCKS[id];
      return !!(d && d.opaque);
    }

    /* ---------------- 修改方块 ----------------
     * opts: {record=true 记录编辑(存档/联机), notify=true 触发回调, remesh=true} */
    setBlock(x, y, z, id, opts) {
      opts = opts || {};
      if (y < 0 || y >= H) return false;
      const cx = x >> 4, cz = z >> 4;
      const c = this.ensureChunk(cx, cz);
      const lx = x - (cx << 4), lz = z - (cz << 4);
      const i = (y * CS + lz) * CS + lx;
      const prev = c.data[i];
      if (c.state > 0 && prev === id) return false;
      if (c.state > 0) c.data[i] = id;

      if (opts.record !== false) {
        const k = this.key(cx, cz);
        let m = this.editsByChunk.get(k);
        if (!m) { m = new Map(); this.editsByChunk.set(k, m); }
        m.set(lx + ',' + y + ',' + lz, id);
      }
      if (opts.remesh !== false) {
        this._queueRemesh(c);
        if (lx === 0) this._queueRemeshAt(cx - 1, cz);
        if (lx === CS - 1) this._queueRemeshAt(cx + 1, cz);
        if (lz === 0) this._queueRemeshAt(cx, cz - 1);
        if (lz === CS - 1) this._queueRemeshAt(cx, cz + 1);
      }
      if (opts.notify !== false && this.onBlockChanged) {
        this.onBlockChanged(x, y, z, id);
      }
      return true;
    }

    /** 应用远端编辑（不重复通知/记录同步） */
    applyRemoteEdit(x, y, z, id) {
      this.setBlock(x, y, z, id, { record: true, notify: false });
    }

    serializeEdits() {
      const out = [];
      this.editsByChunk.forEach((m, k) => {
        const parts = k.split(',');
        const bx = parseInt(parts[0], 10) * CS;
        const bz = parseInt(parts[1], 10) * CS;
        m.forEach((id, lk) => {
          const p = lk.split(',');
          out.push([bx + parseInt(p[0], 10), parseInt(p[1], 10), bz + parseInt(p[2], 10), id]);
        });
      });
      return out;
    }

    /* ---------------- 地形生成 ---------------- */
    heightAt(x, z) {
      const n1 = this.noiseH.fbm(x * 0.0085, z * 0.0085, 4);
      const n2 = this.noiseD.fbm(x * 0.045 + 13.7, z * 0.045 + 7.1, 2);
      const mountain = Math.max(0, n1 - 0.1) * 3.4;
      const h = Math.floor(CFG.SEA_LEVEL + 3 + n1 * 13 + mountain * 9 + n2 * 2);
      return U.clamp(h, 2, H - 26);
    }

    biomeAt(x, z) {
      const t = this.noiseB.fbm(x * 0.0032, z * 0.0032, 2);
      if (t > 0.34) return 'desert';
      if (t < -0.42) return 'snow';
      return 'plain';
    }

    findSpawn() {
      for (let r = 0; r <= 128; r += 4) {
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const x = Math.round(8 + Math.cos(ang) * r);
          const z = Math.round(8 + Math.sin(ang) * r);
          const h = this.heightAt(x, z);
          if (h > CFG.SEA_LEVEL + 2) {
            return { x: x + 0.5, y: h + 2.01, z: z + 0.5 };
          }
          if (r === 0) break;
        }
      }
      return { x: 8.5, y: 70, z: 8.5 };
    }

    _generate(c) {
      const data = c.data;
      const baseX = c.cx * CS, baseZ = c.cz * CS;
      const SEA = CFG.SEA_LEVEL;
      let maxY = 0;

      for (let lz = 0; lz < CS; lz++) {
        for (let lx = 0; lx < CS; lx++) {
          const wx = baseX + lx, wz = baseZ + lz;
          const h = this.heightAt(wx, wz);
          const biome = this.biomeAt(wx, wz);
          const beach = h <= SEA + 1;
          maxY = Math.max(maxY, h);
          for (let y = 0; y <= h; y++) {
            let id;
            if (y === 0) id = 17;
            else if (y === h) id = (biome === 'desert' || beach) ? 5 : biome === 'snow' ? 12 : 1;
            else if (y > h - 4) id = (biome === 'desert' || beach) ? 5 : 2;
            else id = 3;
            data[(y * CS + lz) * CS + lx] = id;
          }
          for (let y = h + 1; y <= SEA; y++) data[(y * CS + lz) * CS + lx] = 11;
        }
      }

      this._decorate(c);

      // 应用历史编辑（玩家改动优先于地形）
      const em = this.editsByChunk.get(this.key(c.cx, c.cz));
      if (em) {
        em.forEach((id, k) => {
          const p = k.split(',');
          data[(parseInt(p[1], 10) * CS + parseInt(p[2], 10)) * CS + parseInt(p[0], 10)] = id;
        });
      }

      c.maxY = Math.min(H - 1, maxY + 10);
      c.state = 1;
      c.genQueued = false;
    }

    _put(c, wx, wy, wz, id, onlyAir) {
      if (wy < 0 || wy >= H) return;
      const lx = wx - (c.cx << 4), lz = wz - (c.cz << 4);
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS) return;
      const i = (wy * CS + lz) * CS + lx;
      const cur = c.data[i];
      if (onlyAir) {
        if (cur === 0 || cur === 11 || cur === 7) c.data[i] = id;
      } else {
        if (cur !== 17) c.data[i] = id;
      }
    }

    /** 树与仙人掌：扫描区块外扩 2 格，保证跨区块的树冠确定且一致 */
    _decorate(c) {
      const baseX = c.cx * CS, baseZ = c.cz * CS;
      const SEED = this.seedHash;
      const SEA = CFG.SEA_LEVEL;
      for (let wz = baseZ - 2; wz <= baseZ + CS + 1; wz++) {
        for (let wx = baseX - 2; wx <= baseX + CS + 1; wx++) {
          const h = this.heightAt(wx, wz);
          if (h <= SEA + 1) continue;
          const biome = this.biomeAt(wx, wz);
          const r = U.rand01(SEED, wx * 3 + 1, wz * 3 + 7);
          if (biome === 'desert') {
            if (r < 0.006) {
              const ch = 2 + ((r * 10000) | 0) % 2;
              for (let y = h + 1; y <= h + ch; y++) this._put(c, wx, y, wz, 18, true);
            }
            continue;
          }
          const chance = biome === 'snow' ? 0.010 : 0.013;
          if (r >= chance) continue;
          const trunkH = 4 + (U.rand01(SEED, wx, wz) < 0.6 ? 1 : 0) + (biome === 'snow' ? 1 : 0);
          const topY = h + trunkH;
          // 树冠
          for (let dy = -2; dy <= 1; dy++) {
            const lyrY = topY + dy;
            const rad = dy >= 0 ? 1 : 2;
            for (let dz = -rad; dz <= rad; dz++) {
              for (let dx = -rad; dx <= rad; dx++) {
                if (dx === 0 && dz === 0 && dy < 0) continue;
                if (dx * dx + dz * dz > rad * rad + 1) continue;
                if (rad === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
                this._put(c, wx + dx, lyrY, wz + dz, 7, true);
              }
            }
          }
          // 树干（覆盖树叶）
          for (let y = h + 1; y <= topY; y++) this._put(c, wx, y, wz, 6, false);
        }
      }
    }

    /* ---------------- 网格构建 ---------------- */
    _queueRemesh(c) {
      if (c && (c.state === 1 || c.state === 2) && !c.meshQueued) {
        c.meshQueued = true;
        this.meshQueue.push(c);
      }
    }
    _queueRemeshAt(cx, cz) {
      const c = this.getChunk(cx, cz);
      if (c) this._queueRemesh(c);
    }

    _remesh(c) {
      c.meshQueued = false;
      const data = c.data;
      const baseX = c.cx * CS, baseZ = c.cz * CS;
      const solid = { pos: [], col: [], uv: [], nor: [], idx: [] };
      const water = { pos: [], col: [], uv: [], nor: [], idx: [] };
      const W = BWC.BLOCKS;
      const yMax = Math.min(H - 1, c.maxY);

      for (let y = 0; y <= yMax; y++) {
        for (let lz = 0; lz < CS; lz++) {
          for (let lx = 0; lx < CS; lx++) {
            const id = data[(y * CS + lz) * CS + lx];
            if (id === 0) continue;
            const def = W[id];
            if (!def) continue;
            const wx = baseX + lx, wz = baseZ + lz;
            const isWater = def.liquid;
            const t = isWater ? water : solid;

            for (let fi = 0; fi < FACES.length; fi++) {
              const f = FACES[fi];
              const nx = wx + f.n[0], ny = y + f.n[1], nz = wz + f.n[2];
              const nb = this.getBlock(nx, ny, nz);
              if (nb === -1) continue;                    // 邻区未生成 → 先剔除
              const nbDef = W[nb] || W[0];
              if (isWater) {
                if (f.n[1] === -1) continue;               // 水底不画
                if (nb === 11) continue;                   // 水-水不画
                if (nbDef.opaque) continue;                // 被不透明挡住
                if (nb !== 0) continue;                    // 只对空气
              } else {
                if (nbDef.opaque) continue;
                if (def.cutout && nb === id) continue;     // 玻璃/树叶自身相接不画
              }

              const uvR = BWC.Textures.uv(BWC.blockTile(def, f.key));
              const u = f.u, v = f.v;
              const b = [
                (u[0] > 0 || v[0] > 0) ? 0 : 1,
                (u[1] > 0 || v[1] > 0) ? 0 : 1,
                (u[2] > 0 || v[2] > 0) ? 0 : 1,
              ];
              const vBase = t.pos.length / 3;

              for (let ci = 0; ci < 4; ci++) {
                const su = CORNERS[ci][0], sv = CORNERS[ci][1];
                const pxp = wx + b[0] + u[0] * su + v[0] * sv;
                const pyp = y + b[1] + u[1] * su + v[1] * sv;
                const pzp = wz + b[2] + u[2] * su + v[2] * sv;
                t.pos.push(pxp, pyp, pzp);
                t.nor.push(f.n[0], f.n[1], f.n[2]);
                t.uv.push(su ? uvR.u1 : uvR.u0, sv ? uvR.v1 : uvR.v0);

                let shade = f.shade;
                if (!isWater) {
                  const du = su ? u : [-u[0], -u[1], -u[2]];
                  const dv = sv ? v : [-v[0], -v[1], -v[2]];
                  const s1 = this._opaqueAt(nx + du[0], ny + du[1], nz + du[2]) ? 1 : 0;
                  const s2 = this._opaqueAt(nx + dv[0], ny + dv[1], nz + dv[2]) ? 1 : 0;
                  const cc = this._opaqueAt(nx + du[0] + dv[0], ny + du[1] + dv[1], nz + du[2] + dv[2]) ? 1 : 0;
                  const occ = (s1 && s2) ? 3 : Math.min(3, s1 + s2 + cc);
                  shade *= AO_LEVELS[occ];
                }
                t.col.push(shade, shade, shade);
              }
              for (let qi = 0; qi < IDX_QUAD.length; qi++) t.idx.push(vBase + IDX_QUAD[qi]);
            }
          }
        }
      }

      this._buildMesh(c, solid, this.matSolid, false);
      this._buildMesh(c, water, this.matWater, true);
      c.state = 2;
    }

    _buildMesh(c, t, material, isWater) {
      const old = isWater ? c.waterMesh : c.mesh;
      if (old) { this.group.remove(old); old.geometry.dispose(); }
      if (t.idx.length === 0) {
        if (isWater) c.waterMesh = null; else c.mesh = null;
        return;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(t.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
      g.setIndex(t.idx);
      const cx = c.cx * CS + CS / 2, cz = c.cz * CS + CS / 2;
      g.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(cx, H / 2, cz),
        Math.sqrt(CS * CS / 2 + (H / 2) * (H / 2)) + 2
      );
      const m = new THREE.Mesh(g, material);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.renderOrder = isWater ? 2 : 1;
      this.group.add(m);
      if (isWater) c.waterMesh = m; else c.mesh = m;
    }

    /* ---------------- 每帧流式加载 ---------------- */
    update(playerPos) {
      const pcx = Math.floor(playerPos.x / CS);
      const pcz = Math.floor(playerPos.z / CS);
      const offs = this.offsets;
      const R = this.renderDistance;

      // 请求加载
      for (let i = 0; i < offs.length; i++) {
        const cx = pcx + offs[i][0], cz = pcz + offs[i][1];
        const c = this.ensureChunk(cx, cz);
        if (!c.genQueued && c.state === 0) {
          c.genQueued = true;
          c.dist2 = offs[i][2];
          this.genQueue.push(c);
        }
      }

      // 卸载远处
      const far = (R + 2.5);
      for (const [k, c] of this.chunks) {
        const ddx = c.cx - pcx, ddz = c.cz - pcz;
        if (ddx * ddx + ddz * ddz > far * far) {
          this.disposeChunk(c);
          this.chunks.delete(k);
        }
      }

      // 生成（限时）
      if (this.genQueue.length) {
        this.genQueue.sort((a, b) => a.dist2 - b.dist2);
        const t0 = performance.now();
        while (this.genQueue.length && performance.now() - t0 < 9) {
          const c = this.genQueue.shift();
          if (c.state !== 0 || !this.chunks.has(this.key(c.cx, c.cz))) continue;
          this._generate(c);
          this._queueRemesh(c);
          this._queueRemeshAt(c.cx - 1, c.cz);
          this._queueRemeshAt(c.cx + 1, c.cz);
          this._queueRemeshAt(c.cx, c.cz - 1);
          this._queueRemeshAt(c.cx, c.cz + 1);
        }
      }

      // 建网格（限时）
      if (this.meshQueue.length) {
        const t0 = performance.now();
        while (this.meshQueue.length && performance.now() - t0 < 10) {
          const c = this.meshQueue.shift();
          if (c.state !== 1) continue;
          this._remesh(c);
        }
      }

      // 统计
      let meshed = 0;
      this.chunks.forEach((c) => { if (c.state === 2) meshed++; });
      this.stats.chunks = this.chunks.size;
      this.stats.meshed = meshed;
    }

    /** 出生点附近已就绪比例（0~1），用于加载进度 */
    readyRatio(centerX, centerZ, radius) {
      radius = radius || 2;
      const pcx = Math.floor(centerX / CS), pcz = Math.floor(centerZ / CS);
      let total = 0, ok = 0;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          total++;
          const c = this.getChunk(pcx + dx, pcz + dz);
          if (c && c.state === 2) ok++;
        }
      }
      return total ? ok / total : 1;
    }

    /* ---------------- 体素光线投射（DDA） ---------------- */
    raycast(ox, oy, oz, dx, dy, dz, maxDist) {
      maxDist = maxDist || CFG.REACH;
      let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      const tdx = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
      const tdy = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
      const tdz = dz !== 0 ? 1 / Math.abs(dz) : Infinity;
      let tMaxX = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) / Math.abs(dx)) : Infinity;
      let tMaxY = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) / Math.abs(dy)) : Infinity;
      let tMaxZ = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) / Math.abs(dz)) : Infinity;
      let nx = 0, ny = 0, nz = 0;

      // 起点所在方块也算
      const first = this.getBlock(x, y, z);
      if (first > 0 && BWC.BLOCKS[first] && BWC.BLOCKS[first].solid && !BWC.BLOCKS[first].liquid) {
        return { x, y, z, id: first, nx: -sx, ny: 0, nz: 0, dist: 0 };
      }

      for (let i = 0; i < 256; i++) {
        let t;
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
          t = tMaxX; x += sx; tMaxX += tdx; nx = -sx; ny = 0; nz = 0;
        } else if (tMaxY < tMaxZ) {
          t = tMaxY; y += sy; tMaxY += tdy; nx = 0; ny = -sy; nz = 0;
        } else {
          t = tMaxZ; z += sz; tMaxZ += tdz; nx = 0; ny = 0; nz = -sz;
        }
        if (t > maxDist) return null;
        if (y < 0 || y >= H) {
          if (y >= H) continue;
          return null;
        }
        const id = this.getBlock(x, y, z);
        if (id > 0) {
          const d = BWC.BLOCKS[id];
          if (d && d.solid && !d.liquid) {
            return { x, y, z, id, nx, ny, nz, dist: t };
          }
        }
      }
      return null;
    }

    /** 某点是否被水占据（用于游泳判定） */
    isWaterAt(x, y, z) {
      return this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === 11;
    }

    dispose() {
      this.chunks.forEach((c) => this.disposeChunk(c));
      this.chunks.clear();
      this.genQueue.length = 0;
      this.meshQueue.length = 0;
      if (this.group.parent) this.group.parent.remove(this.group);
      this.matSolid.dispose();
      this.matWater.dispose();
    }
  }

  BWC.World = World;
})();
