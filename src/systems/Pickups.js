import * as THREE from 'three';

/** Small repair / energy motes dropped by destroyed drones. They home in on the courier. */
export class Pickups {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.geo = new THREE.OctahedronGeometry(0.16, 0);
    this.mats = {
      hp: new THREE.MeshBasicMaterial({ color: new THREE.Color('#20ffa0').multiplyScalar(4) }),
      energy: new THREE.MeshBasicMaterial({ color: new THREE.Color('#9b7bff').multiplyScalar(4) }),
    };
  }

  drop(pos, kind) {
    const mesh = new THREE.Mesh(this.geo, this.mats[kind]);
    mesh.position.copy(pos);
    this.game.scene.add(mesh);
    const v = new THREE.Vector3((Math.random() - 0.5) * 4, 3 + Math.random() * 2, (Math.random() - 0.5) * 4);
    this.items.push({ mesh, kind, v, t: 0, life: 14 });
  }

  update(dt) {
    const p = this.game.player;
    const target = _t.set(p.pos.x, p.pos.y + 1, p.pos.z);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.life -= dt;
      const m = it.mesh;
      const d = _d.subVectors(target, m.position);
      const dist = d.length();
      if (it.t > 0.4 && dist < 7 && !p.dead) {
        it.v.lerp(d.normalize().multiplyScalar(18), Math.min(1, dt * 6));
      } else {
        it.v.multiplyScalar(Math.exp(-2 * dt));
        it.v.y -= 2 * dt;
      }
      m.position.addScaledVector(it.v, dt);
      m.rotation.y += dt * 4;
      m.scale.setScalar(it.life < 2 ? Math.max(0.01, it.life / 2) : 1 + Math.sin(it.t * 8) * 0.15);
      if (dist < 1 && !p.dead) {
        this.game.onPickup(it.kind, m.position);
        this.remove(i);
      } else if (it.life <= 0) this.remove(i);
    }
  }

  remove(i) {
    this.game.scene.remove(this.items[i].mesh);
    this.items.splice(i, 1);
  }

  clear() {
    for (let i = this.items.length - 1; i >= 0; i--) this.remove(i);
  }
}

const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
