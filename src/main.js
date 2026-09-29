import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/share-tech-mono/400.css';
import './styles.css';
import { Game } from './game/Game.js';

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const linesEl = document.getElementById('boot-lines');
const btn = document.getElementById('boot-btn');
const bootEl = document.getElementById('boot');

function line(text, cls = '') {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = text;
  linesEl.appendChild(d);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

async function main() {
  line('NEON//ECHO — K-7 REACTIVATION SEQUENCE');
  await wait(120);
  if (!webglOK()) {
    line('FATAL: WebGL2 is not available in this browser.', 'warn');
    line('Try a recent Chrome, Edge or Firefox with hardware acceleration on.', 'warn');
    btn.innerHTML = '<span>UNSUPPORTED</span>';
    return;
  }
  line('> neural lattice ........ ok', 'ok');
  // canvas text textures need the webfonts ready
  await Promise.race([
    Promise.all([
      document.fonts.load('700 64px "Chakra Petch"'),
      document.fonts.load('400 32px "Share Tech Mono"'),
    ]),
    wait(2500),
  ]);
  line('> glyph cache ........... ok', 'ok');

  const game = new Game(document.getElementById('game'), { debug, lowQuality: params.has('lowq') });
  if (debug) window.__game = game;
  try {
    await game.init((msg) => line(`> ${msg}`));
  } catch (err) {
    console.error(err);
    line(`FATAL: ${err.message}`, 'warn');
    btn.innerHTML = '<span>BOOT FAILED</span>';
    return;
  }
  line('> city core link ........ UNSTABLE', 'warn');
  line('ALL SYSTEMS NOMINAL. YOU SHOULD NOT BE AWAKE.', 'ok');
  btn.disabled = false;
  btn.innerHTML = '<span>[ WAKE UP ]</span>';
  btn.focus();

  const go = () => {
    btn.disabled = true;
    bootEl.classList.add('out');
    game.boot();
    setTimeout(() => bootEl.classList.add('hidden'), 900);
  };
  btn.addEventListener('click', go, { once: true });
  if (params.has('autostart')) go();
}

main();
