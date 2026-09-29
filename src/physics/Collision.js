import * as THREE from 'three';

const EPS = 1e-4;

/** Axis-aligned solid box. The whole walkable world is made of these. */
export class Collider {
  constructor(minX, minY, minZ, maxX, maxY, maxZ, tag = 'solid') {
    this.min = new THREE.Vector3(minX, minY, minZ);
    this.max = new THREE.Vector3(maxX, maxY, maxZ);
    this.tag = tag;
    this.enabled = true;
    /** Displacement applied this frame (moving platforms carry the player). */
    this.delta = new THREE.Vector3();
    this.userData = {};
  }

  translate(dx, dy, dz) {
    this.min.x += dx; this.min.y += dy; this.min.z += dz;
    this.max.x += dx; this.max.y += dy; this.max.z += dz;
    this.delta.x += dx; this.delta.y += dy; this.delta.z += dz;
  }
}

export class CollisionWorld {
  constructor() {
    this.colliders = [];
  }

  /** Box from center-x/z, top y, and size. Returns collider. */
  addTopBox(cx, topY, cz, w, h, d, tag) {
    return this.add(new Collider(cx - w / 2, topY - h, cz - d / 2, cx + w / 2, topY, cz + d / 2, tag));
  }

  /** Box from center and size. */
  addCenterBox(cx, cy, cz, w, h, d, tag) {
    return this.add(new Collider(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, tag));
  }

  add(c) {
    this.colliders.push(c);
    return c;
  }

  clearDeltas() {
    for (const c of this.colliders) c.delta.set(0, 0, 0);
  }

  _overlapChar(p, r, h, c) {
    return (
      p.x + r > c.min.x + EPS && p.x - r < c.max.x - EPS &&
      p.z + r > c.min.z + EPS && p.z - r < c.max.z - EPS &&
      p.y + h > c.min.y + EPS && p.y < c.max.y - EPS
    );
  }

  /**
   * Move a character (feet position `pos`, square footprint `r`, height `h`)
   * by `disp`, sliding along walls and stepping onto low ledges.
   */
  moveCharacter(pos, disp, r, h, stepHeight, out) {
    out.grounded = false;
    out.ground = null;
    out.hitWall = false;
    out.hitCeiling = false;
    out.stepped = false;

    const len = Math.sqrt(disp.x * disp.x + disp.z * disp.z) + Math.abs(disp.y);
    const steps = Math.max(1, Math.ceil(len / 0.3));
    const sx = disp.x / steps, sy = disp.y / steps, sz = disp.z / steps;
    const cols = this.colliders;

    for (let s = 0; s < steps; s++) {
      // --- horizontal X ---
      pos.x += sx;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c.enabled || !this._overlapChar(pos, r, h, c)) continue;
        const climb = c.max.y - pos.y;
        if (climb > 0 && climb <= stepHeight && !this._blockedAbove(pos, r, h, c.max.y, c)) {
          pos.y = c.max.y + EPS;
          out.stepped = true;
          continue;
        }
        const penA = pos.x + r - c.min.x;
        const penB = c.max.x - (pos.x - r);
        if (penA < penB) pos.x -= penA + EPS;
        else pos.x += penB + EPS;
        out.hitWall = true;
      }
      // --- horizontal Z ---
      pos.z += sz;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c.enabled || !this._overlapChar(pos, r, h, c)) continue;
        const climb = c.max.y - pos.y;
        if (climb > 0 && climb <= stepHeight && !this._blockedAbove(pos, r, h, c.max.y, c)) {
          pos.y = c.max.y + EPS;
          out.stepped = true;
          continue;
        }
        const penA = pos.z + r - c.min.z;
        const penB = c.max.z - (pos.z - r);
        if (penA < penB) pos.z -= penA + EPS;
        else pos.z += penB + EPS;
        out.hitWall = true;
      }
      // --- vertical ---
      pos.y += sy;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c.enabled || !this._overlapChar(pos, r, h, c)) continue;
        const penTop = c.max.y - pos.y;
        const penBottom = pos.y + h - c.min.y;
        if (sy <= 0 || penTop < penBottom) {
          pos.y = c.max.y;
          out.grounded = true;
          out.ground = c;
        } else {
          pos.y = c.min.y - h - EPS;
          out.hitCeiling = true;
        }
      }
    }
    return out;
  }

  _blockedAbove(pos, r, h, y, ignore) {
    const probe = _probe.set(pos.x, y + EPS * 2, pos.z);
    for (const c of this.colliders) {
      if (c === ignore || !c.enabled) continue;
      if (this._overlapChar(probe, r * 0.9, h, c)) return true;
    }
    return false;
  }

  /** Highest collider top under the footprint within [y - maxDrop, y + 0.05]. */
  probeGround(pos, r, maxDrop) {
    let bestY = -Infinity;
    let best = null;
    for (const c of this.colliders) {
      if (!c.enabled) continue;
      if (pos.x + r <= c.min.x || pos.x - r >= c.max.x || pos.z + r <= c.min.z || pos.z - r >= c.max.z) continue;
      const top = c.max.y;
      if (top <= pos.y + 0.05 && top >= pos.y - maxDrop && top > bestY) {
        bestY = top;
        best = c;
      }
    }
    return best ? { y: bestY, collider: best } : null;
  }

  /** Is there any solid ground straight below this point (within depth)? */
  hasGroundBelow(x, y, z, depth = 200) {
    for (const c of this.colliders) {
      if (!c.enabled) continue;
      if (x < c.min.x || x > c.max.x || z < c.min.z || z > c.max.z) continue;
      if (c.max.y <= y + 0.1 && c.max.y > y - depth) return true;
    }
    return false;
  }

  /**
   * Slab ray test. Returns distance of first hit or Infinity.
   * Colliders that contain the origin are ignored.
   */
  raycast(origin, dir, maxDist, outNormal) {
    let best = maxDist;
    let hit = false;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    for (const c of this.colliders) {
      if (!c.enabled) continue;
      if (ox > c.min.x && ox < c.max.x && oy > c.min.y && oy < c.max.y && oz > c.min.z && oz < c.max.z) continue;
      let tmin = 0, tmax = best, axis = -1, sign = 0;
      // X
      if (Math.abs(dx) < 1e-9) {
        if (ox < c.min.x || ox > c.max.x) continue;
      } else {
        let t1 = (c.min.x - ox) / dx, t2 = (c.max.x - ox) / dx, s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Y
      if (Math.abs(dy) < 1e-9) {
        if (oy < c.min.y || oy > c.max.y) continue;
      } else {
        let t1 = (c.min.y - oy) / dy, t2 = (c.max.y - oy) / dy, s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Z
      if (Math.abs(dz) < 1e-9) {
        if (oz < c.min.z || oz > c.max.z) continue;
      } else {
        let t1 = (c.min.z - oz) / dz, t2 = (c.max.z - oz) / dz, s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (tmin < best) {
        best = tmin;
        hit = true;
        if (outNormal) {
          outNormal.set(0, 0, 0);
          if (axis === 0) outNormal.x = sign;
          else if (axis === 1) outNormal.y = sign;
          else if (axis === 2) outNormal.z = sign;
        }
      }
    }
    return hit ? best : Infinity;
  }

  /** Push a sphere out of all colliders. Returns true when it touched something. */
  resolveSphere(pos, radius) {
    let touched = false;
    for (const c of this.colliders) {
      if (!c.enabled) continue;
      const qx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
      const qy = Math.max(c.min.y, Math.min(pos.y, c.max.y));
      const qz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
      const dx = pos.x - qx, dy = pos.y - qy, dz = pos.z - qz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= radius * radius) continue;
      touched = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (radius - d) / d;
        pos.x += dx * push; pos.y += dy * push; pos.z += dz * push;
      } else {
        pos.y = c.max.y + radius;
      }
    }
    return touched;
  }

  /** Point inside any solid? */
  pointInside(p) {
    for (const c of this.colliders) {
      if (!c.enabled) continue;
      if (p.x > c.min.x && p.x < c.max.x && p.y > c.min.y && p.y < c.max.y && p.z > c.min.z && p.z < c.max.z) return c;
    }
    return null;
  }
}

const _probe = new THREE.Vector3();
