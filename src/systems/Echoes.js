import * as THREE from 'three';
import { makeBeamMaterial } from '../world/Materials.js';

const ECHO_COLOR = '#a6fffb';

/** The memory fragments scattered through the city. Each one is a floating crystal with a sky beam. */
export class Echoes {
  constructor(game, spots) {
    this.game = game;
    this.items = spots.map((spot, i) => this._build(spot, i));
  }

  _build(spot, i) {
    const g = new THREE.Group();
    const base = spot.pos.clone();
    g.position.copy(base).y += 1.3;
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(ECHO_COLOR).multiplyScalar(5) });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), coreMat);
    core.scale.set(1, 1.5, 1);
    g.add(core);
    const shell = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.62, 0)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(ECHO_COLOR).multiplyScalar(2.5), transparent: true, opacity: 0.9 }),
    );
    g.add(shell);
    const rings = [];
    for (let k = 0; k < 2; k++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.9 + k * 0.25, 0.018, 6, 48), coreMat);
      r.rotation.x = Math.PI / 2 + (k ? 0.5 : -0.4);
      g.add(r);
      rings.push(r);
    }
    const beamMat = makeBeamMaterial(ECHO_COLOR, 0.9);
    const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 90, 16, 1, true);
    beamGeo.translate(0, 45, 0);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.copy(base);
    this.game.scene.add(beam);
    // base glyph on the ground
    const glyph = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 6), coreMat);
    glyph.rotation.x = -Math.PI / 2;
    glyph.position.copy(base).y += 0.04;
    this.game.scene.add(glyph);
    this.game.scene.add(g);
    return { i, spot, base, group: g, core, shell, rings, beam, beamMat, glyph, collected: false, t: Math.random() * 10, fade: 0 };
  }

  reset() {
    for (const e of this.items) {
      e.collected = false;
      e.fade = 0;
      e.group.visible = true;
      e.glyph.visible = true;
      e.beam.visible = true;
      e.beamMat.uniforms.uStrength.value = 0.9;
      e.group.scale.setScalar(1);
    }
  }

  get remaining() {
    return this.items.filter((e) => !e.collected);
  }

  get collectedCount() {
    return this.items.filter((e) => e.collected).length;
  }

  update(dt, player) {
    for (const e of this.items) {
      e.t += dt;
      if (e.collected) {
        if (e.fade > 0) {
          e.fade = Math.max(0, e.fade - dt);
          const k = e.fade;
          e.beamMat.uniforms.uStrength.value = 0.9 * k + (1 - k) * 0 + Math.sin(e.t * 30) * 0.1 * k;
          e.group.scale.setScalar(1 + (1 - k) * 2);
          if (k <= 0) {
            e.beam.visible = false;
            e.group.visible = false;
          }
        }
        continue;
      }
      const g = e.group;
      g.position.y = e.base.y + 1.3 + Math.sin(e.t * 1.8) * 0.18;
      e.core.rotation.y += dt * 1.6;
      e.shell.rotation.y -= dt * 0.7;
      e.shell.rotation.x += dt * 0.4;
      e.rings[0].rotation.z += dt * 1.2;
      e.rings[1].rotation.z -= dt * 0.9;
      e.beamMat.uniforms.uStrength.value = 0.75 + Math.sin(e.t * 2.2) * 0.15;
      if (Math.random() < dt * 8) {
        const a = Math.random() * Math.PI * 2;
        this.game.particles.spawn(
          e.base.x + Math.cos(a) * 0.9, e.base.y + 0.1, e.base.z + Math.sin(a) * 0.9,
          0, 1.2 + Math.random(), 0, 1.4, 0.12, 0, _c.set(ECHO_COLOR).multiplyScalar(3), _c2.set(0, 0, 0), -0.2, 0.2,
        );
      }
      if (!player.dead) {
        const dx = player.pos.x - e.base.x, dz = player.pos.z - e.base.z;
        const dy = player.pos.y + 0.9 - (e.base.y + 1.3);
        if (dx * dx + dz * dz < 1.7 * 1.7 && Math.abs(dy) < 1.8) this.collect(e);
      }
    }
  }

  collect(e) {
    e.collected = true;
    e.fade = 1;
    e.glyph.visible = false;
    this.game.onEchoCollected(e);
  }
}

const _c = new THREE.Color();
const _c2 = new THREE.Color();
