/* ============================================================
 * 方块世界 · 本地玩家：移动物理 / 碰撞 / 相机
 * ============================================================ */
(function () {
  'use strict';
  const BWC = window.BWC;
  const U = BWC.util;
  const CFG = BWC.CONFIG;

  class LocalPlayer {
    constructor(world, camera) {
      this.world = world;
      this.camera = camera;
      this.pos = new THREE.Vector3(0, 80, 0);   // 脚底位置
      this.vel = new THREE.Vector3(0, 0, 0);
      this.yaw = 0;
      this.pitch = 0;
      this.onGround = false;
      this.flying = false;
      this.inWater = false;
      this.sprinting = false;
      this.thirdPerson = false;
      this.halfW = CFG.PLAYER_W / 2;
      this.height = CFG.PLAYER_H;
      this.eyeHeight = CFG.EYE_H;
      this._stepAcc = 0;
      this._flyDoubleSpace = 0;
      this.lastFlyToggle = 0;
    }

    respawn(x, y, z) {
      this.pos.set(x, y, z);
      this.vel.set(0, 0, 0);
      this.onGround = false;
      this.inWater = false;
    }

    getEyePos() {
      return {
        x: this.pos.x,
        y: this.pos.y + this.eyeHeight,
        z: this.pos.z,
      };
    }

    /** 视线方向（单位向量） */
    getViewDir() {
      const cp = Math.cos(this.pitch);
      return {
        x: -Math.sin(this.yaw) * cp,
        y: Math.sin(this.pitch),
        z: -Math.cos(this.yaw) * cp,
      };
    }

    getAABB() {
      return {
        minX: this.pos.x - this.halfW, maxX: this.pos.x + this.halfW,
        minY: this.pos.y, maxY: this.pos.y + this.height,
        minZ: this.pos.z - this.halfW, maxZ: this.pos.z + this.halfW,
      };
    }

    /** 新方块的 AABB 是否与玩家相交（放方块时防自埋） */
    intersectsBlock(bx, by, bz) {
      const a = this.getAABB();
      const e = 1e-4;
      return (bx + 1 > a.minX + e && bx < a.maxX - e &&
        by + 1 > a.minY + e && by < a.maxY - e &&
        bz + 1 > a.minZ + e && bz < a.maxZ - e);
    }

    toggleFly() {
      this.flying = !this.flying;
      if (this.flying) this.vel.y = 0;
      return this.flying;
    }

    handleSpacePressed() {
      const now = performance.now();
      if (now - this._flyDoubleSpace < 300) {
        this.toggleFly();
        BWC.Audio.play('click');
        this._flyDoubleSpace = 0;
      } else {
        this._flyDoubleSpace = now;
      }
    }

    /* ---------------- 主更新 ----------------
     * input: { f, r, jump, sneak, sprint } （f: 前后 -1..1, r: 左右 -1..1） */
    update(dt, input) {
      dt = Math.min(Math.max(dt, 0), 0.05);
      const w = this.world;

      // 水中判定（脚部或腰部入水）
      this.inWater = w.isWaterAt(this.pos.x, this.pos.y + 0.4, this.pos.z) ||
        w.isWaterAt(this.pos.x, this.pos.y + 1.2, this.pos.z);

      const f = U.clamp(input.f || 0, -1, 1);
      const r = U.clamp(input.r || 0, -1, 1);
      this.sprinting = !!input.sprint && (this.flying || f > 0.1);

      let speed;
      if (this.flying) speed = this.sprinting ? CFG.FLY_SPRINT : CFG.FLY_SPEED;
      else {
        speed = this.sprinting ? CFG.SPRINT_SPEED : CFG.WALK_SPEED;
        if (this.inWater) speed *= CFG.SWIM_FACTOR;
        if (!this.onGround) speed *= 0.92;
      }

      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const fx = -sin, fz = -cos;         // 前
      const rx = cos, rz = -sin;          // 右
      let wx = fx * f + rx * r;
      let wz = fz * f + rz * r;
      const len = Math.hypot(wx, wz);
      if (len > 0) { wx /= len; wz /= len; }

      const tvx = wx * speed, tvz = wz * speed;
      const accel = (this.onGround || this.flying) ? 14 : 5;
      const k = 1 - Math.exp(-accel * dt);
      this.vel.x = U.lerp(this.vel.x, tvx, k);
      this.vel.z = U.lerp(this.vel.z, tvz, k);

      // 竖直运动
      if (this.flying) {
        let vy = 0;
        if (input.jump) vy += speed;
        if (input.sneak) vy -= speed;
        this.vel.y = U.lerp(this.vel.y, vy, 1 - Math.exp(-12 * dt));
      } else if (this.inWater) {
        this.vel.y -= CFG.GRAVITY * 0.25 * dt;
        if (input.jump) this.vel.y = U.lerp(this.vel.y, 3.4, 1 - Math.exp(-9 * dt));
        this.vel.y = Math.max(this.vel.y, -4);
      } else {
        this.vel.y -= CFG.GRAVITY * dt;
        if (this.vel.y < -50) this.vel.y = -50;
        if (input.jump && this.onGround) {
          this.vel.y = CFG.JUMP_SPEED;
          this.onGround = false;
          BWC.Audio.play('jump');
        }
      }

      // 位移与碰撞
      const wasFalling = !this.onGround && this.vel.y < -12;
      this.onGround = false;
      this._moveAxis('x', this.vel.x * dt);
      this._moveAxis('z', this.vel.z * dt);
      const vyBefore = this.vel.y;
      this._moveAxis('y', this.vel.y * dt);
      if (this.onGround && wasFalling && vyBefore < -12) BWC.Audio.play('land');

      // 世界底部保护
      if (this.pos.y < -20) {
        const sp = this.world.findSpawn();
        this.respawn(sp.x, sp.y, sp.z);
      }

      // 脚步声
      const hspd = Math.hypot(this.vel.x, this.vel.z);
      if (this.onGround && hspd > 1.2) {
        this._stepAcc += dt * hspd;
        if (this._stepAcc > 2.8) {
          this._stepAcc = 0;
          BWC.Audio.play('step');
        }
      }
    }

    _moveAxis(axis, d) {
      if (d === 0) return;
      const w = this.world;
      this.pos[axis] += d;
      const hw = this.halfW, h = this.height;
      const minX = this.pos.x - hw, maxX = this.pos.x + hw;
      const minY = this.pos.y, maxY = this.pos.y + h;
      const minZ = this.pos.z - hw, maxZ = this.pos.z + hw;
      const x0 = Math.floor(minX), x1 = Math.floor(maxX - 1e-4);
      const y0 = Math.floor(minY), y1 = Math.floor(maxY - 1e-4);
      const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - 1e-4);

      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            const id = w.getBlock(x, y, z);
            if (id <= 0) continue;
            const def = BWC.BLOCKS[id];
            if (!def || !def.solid) continue;
            // 命中实体：沿该轴推出
            if (axis === 'x') {
              this.pos.x = d > 0 ? x - hw - 1e-3 : x + 1 + hw + 1e-3;
              this.vel.x = 0;
            } else if (axis === 'z') {
              this.pos.z = d > 0 ? z - hw - 1e-3 : z + 1 + hw + 1e-3;
              this.vel.z = 0;
            } else {
              if (d > 0) {
                this.pos.y = y - h - 1e-3;
                this.vel.y = Math.min(this.vel.y, 0);
              } else {
                this.pos.y = y + 1 + 1e-3;
                if (this.vel.y < -0.1) this.vel.y = 0;
                this.onGround = true;
              }
            }
            return;
          }
        }
      }
    }

    updateCamera() {
      const cam = this.camera;
      const eye = this.eyeHeight;
      if (!this.thirdPerson) {
        cam.position.set(this.pos.x, this.pos.y + eye, this.pos.z);
        cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
        return;
      }
      // 第三人称：从头部向后退，遇到方块则拉近
      const cp = Math.cos(this.pitch);
      const dx = Math.sin(this.yaw) * cp;
      const dy = -Math.sin(this.pitch);
      const dz = Math.cos(this.yaw) * cp;
      const hx = this.pos.x, hy = this.pos.y + eye, hz = this.pos.z;
      let dist = 4;
      const hit = this.world.raycast(hx, hy, hz, dx, dy, dz, 4);
      if (hit) dist = Math.max(0.7, hit.dist - 0.4);
      cam.position.set(hx + dx * dist, hy + dy * dist, hz + dz * dist);
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }
  }

  BWC.LocalPlayer = LocalPlayer;
})();
