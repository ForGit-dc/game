/** Keyboard + mouse state with pointer lock. Keys use physical `code`s so AZERTY players get ZQSD for free. */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false, x: 0, y: 0 };
    this.locked = false;
    this.allowUnlocked = false; // debug / automation
    this.onLockChange = null;
    this.onKey = null;
    this.layout = null;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.onKey?.(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouse.left = this.mouse.right = false;
    });
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.locked || this.allowUnlocked) {
        // clamp giant spikes some browsers emit on lock
        const mx = Math.max(-250, Math.min(250, e.movementX || 0));
        const my = Math.max(-250, Math.min(250, e.movementY || 0));
        this.mouse.dx += mx;
        this.mouse.dy += my;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.mouse.left = this.mouse.right = false;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this.onLockChange?.(false);
    });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => this.canvas.requestPointerLock?.()?.catch?.(() => {}));
    } catch {
      /* some browsers throw when called too soon after unlocking */
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(...codes) {
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  wasReleased(...codes) {
    return codes.some((c) => this.released.has(c));
  }

  consumeMouse() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.leftPressed = false;
    this.mouse.rightPressed = false;
  }

  /** Resolve key labels for the user's actual keyboard layout (Chromium only; falls back to QWERTY). */
  async loadLayout() {
    try {
      if (navigator.keyboard?.getLayoutMap) this.layout = await navigator.keyboard.getLayoutMap();
    } catch {
      this.layout = null;
    }
    // Heuristic fallback for French users without the Keyboard API
    if (!this.layout && /^fr\b/i.test(navigator.language || '')) {
      this.layout = new Map([['KeyW', 'z'], ['KeyA', 'q'], ['KeyQ', 'a'], ['KeyS', 's'], ['KeyD', 'd'], ['KeyF', 'f'], ['KeyP', 'p']]);
    }
  }

  label(code) {
    const v = this.layout?.get?.(code);
    if (v) return v.toUpperCase();
    return code.replace('Key', '').replace('Digit', '');
  }
}
