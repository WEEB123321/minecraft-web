/* ============================================================
 * 方块世界 · 远程玩家（联机形象 / 插值 / 名牌）
 * ============================================================ */
(function () {
  'use strict';
  const BWC = window.BWC;
  const U = BWC.util;

  function boxMesh(w, h, d, color) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
    return new THREE.Mesh(g, m);
  }

  /** 用色相生成一个方块小人（MC 风格比例，总高约 1.8） */
  function buildAvatar(hue) {
    const group = new THREE.Group();
    const torso = boxMesh(0.5, 0.68, 0.26, hsl(hue, 0.6, 0.45));
    torso.position.y = 1.06;
    group.add(torso);

    const head = boxMesh(0.44, 0.44, 0.44, hsl(hue, 0.35, 0.72));
    head.position.y = 1.62;
    group.add(head);
    // 简单“头发”顶盖，增加辨识度
    const hair = boxMesh(0.46, 0.1, 0.46, hsl(hue, 0.5, 0.3));
    hair.position.y = 1.86;
    group.add(hair);

    const armL = boxMesh(0.18, 0.68, 0.18, hsl(hue, 0.5, 0.36));
    armL.geometry.translate(0, -0.34, 0);
    armL.position.set(-0.34, 1.4, 0);
    group.add(armL);

    const armR = armL.clone();
    armR.position.set(0.34, 1.4, 0);
    group.add(armR);

    const legL = boxMesh(0.2, 0.72, 0.2, hsl(hue, 0.45, 0.3));
    legL.geometry.translate(0, -0.36, 0);
    legL.position.set(-0.13, 0.72, 0);
    group.add(legL);

    const legR = legL.clone();
    legR.position.set(0.13, 0.72, 0);
    group.add(legR);

    group.scale.setScalar(0.92);
    return { group, armL, armR, legL, legR, head };
  }

  function hsl(h, s, l) {
    const c = new THREE.Color();
    c.setHSL(((h % 360) + 360) % 360 / 360, s, l);
    return c;
  }

  function makeNameTag(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = 'bold 44px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.font = font;
    const w = Math.max(160, Math.ceil(ctx.measureText(text).width) + 48);
    canvas.width = w;
    canvas.height = 72;
    const ctx2 = canvas.getContext('2d');
    ctx2.font = font;
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'middle';
    // 半透明底
    ctx2.fillStyle = 'rgba(10,14,20,0.45)';
    roundRect(ctx2, 2, 8, w - 4, 56, 10);
    ctx2.fill();
    ctx2.lineWidth = 6;
    ctx2.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx2.strokeText(text, w / 2, 37);
    ctx2.fillStyle = '#ffffff';
    ctx2.fillText(text, w / 2, 37);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(w / 72 * 0.75, 0.75, 1);
    sprite.position.y = 2.25;
    return sprite;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  class RemotePlayer {
    constructor(id, info, scene) {
      this.id = id;
      this.name = (info && info.name) || '玩家';
      this.hue = (info && info.hue) || 200;
      this.scene = scene;

      const av = buildAvatar(this.hue);
      this.group = av.group;
      this.armL = av.armL; this.armR = av.armR;
      this.legL = av.legL; this.legR = av.legR; this.head = av.head;
      this.tag = makeNameTag(this.name);
      this.group.add(this.tag);
      scene.add(this.group);

      this.cur = { x: 0, y: 70, z: 0, yaw: 0 };
      this.target = { x: 0, y: 70, z: 0, yaw: 0 };
      this.pitch = 0;
      this.targetPitch = 0;
      this.walkPhase = 0;
      this.speed = 0;
      this.flying = false;
      this.invisible = false;
      this._place(this.cur.x, this.cur.y, this.cur.z, 0);
    }

    applyState(s) {
      if (typeof s.x === 'number' && isFinite(s.x)) this.target.x = s.x;
      if (typeof s.y === 'number' && isFinite(s.y)) this.target.y = s.y;
      if (typeof s.z === 'number' && isFinite(s.z)) this.target.z = s.z;
      if (typeof s.yaw === 'number' && isFinite(s.yaw)) this.target.yaw = s.yaw;
      if (typeof s.pitch === 'number' && isFinite(s.pitch)) this.targetPitch = s.pitch;
      this.flying = !!s.fly;
    }

    /** 初次出现时直接落位（避免从 0,0 飞过来） */
    snap(s) {
      this.cur.x = this.target.x = s.x;
      this.cur.y = this.target.y = s.y;
      this.cur.z = this.target.z = s.z;
      this.cur.yaw = this.target.yaw = s.yaw || 0;
      this.pitch = this.targetPitch = s.pitch || 0;
      this._place(this.cur.x, this.cur.y, this.cur.z, this.cur.yaw);
    }

    _place(x, y, z, yaw) {
      this.group.position.set(x, y, z);
      this.group.rotation.y = yaw;
    }

    update(dt) {
      const k = 1 - Math.exp(-11 * dt);
      const dx = this.target.x - this.cur.x;
      const dy = this.target.y - this.cur.y;
      const dz = this.target.z - this.cur.z;
      const dist = Math.hypot(dx, dy, dz);
      // 距离过远（如传送）直接落位
      if (dist > 24) {
        this.cur.x = this.target.x; this.cur.y = this.target.y; this.cur.z = this.target.z;
      } else {
        this.cur.x += dx * k;
        this.cur.y += dy * k;
        this.cur.z += dz * k;
      }
      // 偏航角最短路径插值
      let dyaw = this.target.yaw - this.cur.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.cur.yaw += dyaw * k;
      this.pitch = U.lerp(this.pitch, this.targetPitch, k);

      this.speed = dt > 0 ? dist / dt : 0;
      const swing = Math.min(1, this.speed / 4.2);
      if (this.speed > 0.15) this.walkPhase += dt * (6 + this.speed * 1.6);
      else this.walkPhase = U.lerp(this.walkPhase % (Math.PI * 2), 0, k * 0.4);

      const s = Math.sin(this.walkPhase) * 0.75 * swing;
      this.armL.rotation.x = s;
      this.armR.rotation.x = -s;
      this.legL.rotation.x = -s * 0.8;
      this.legR.rotation.x = s * 0.8;

      if (this.flying) {
        this.armL.rotation.x = this.armR.rotation.x = -0.9;
        this.legL.rotation.x = this.legR.rotation.x = 0.25;
      }

      this.head.rotation.x = U.clamp(this.pitch, -1.2, 1.2) * 0.85;
      this._place(this.cur.x, this.cur.y, this.cur.z, this.cur.yaw);
    }

    dispose() {
      this.scene.remove(this.group);
      this.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
  }

  class RemoteManager {
    constructor(scene) {
      this.scene = scene;
      this.players = new Map();      // id -> RemotePlayer
      this.meta = new Map();         // id -> {name, hue}
    }

    add(id, info) {
      if (this.players.has(id)) {
        this.applyMeta(id, info);
        return this.players.get(id);
      }
      const rp = new RemotePlayer(id, info, this.scene);
      this.players.set(id, rp);
      this.meta.set(id, { name: rp.name, hue: rp.hue });
      return rp;
    }

    applyMeta(id, info) {
      if (!info) return;
      const m = this.meta.get(id) || {};
      if (info.name) m.name = String(info.name).slice(0, 16);
      if (typeof info.hue === 'number') m.hue = info.hue;
      this.meta.set(id, m);
    }

    getMeta(id) { return this.meta.get(id); }

    remove(id) {
      const rp = this.players.get(id);
      if (rp) {
        rp.dispose();
        this.players.delete(id);
      }
      this.meta.delete(id);
    }

    applyState(id, s) {
      const rp = this.players.get(id);
      if (rp) rp.applyState(s);
    }

    snapTo(id, s) {
      const rp = this.players.get(id);
      if (rp) rp.snap(s);
    }

    update(dt) {
      this.players.forEach((rp) => rp.update(dt));
    }

    count() { return this.players.size; }

    clear() {
      this.players.forEach((rp) => rp.dispose());
      this.players.clear();
      this.meta.clear();
    }
  }

  BWC.RemoteManager = RemoteManager;
  BWC.buildAvatar = buildAvatar;
})();
