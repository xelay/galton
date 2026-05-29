/**
 * Triangle Quincunx — PWA Game
 *
 * • 13 rows = 91 pegs (closest triangular number to 100)
 * • Mirror-law (specular) reflection off triangular peg faces
 * • Global border walls; cup walls bounce balls; floor captures them
 * • On LOSS: pegs keep their rotations — player continues adjusting
 * • Balls animate back up to funnel after round ends (win or lose)
 * • Cup fill visualised in REAL-TIME as balls arrive (not just at end)
 */

'use strict';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ── Constants ────────────────────────────────────────────────────────────────
const ROWS        = 13;    // 1+2+…+13 = 91 pegs
const MAX_ROT     = 270;
const PEG_S       = 8;     // slightly smaller to fit 13 rows
const PILOT_N     = 80;    // more balls for 13 rows
const BALL_R      = 3;
const GRAVITY     = 280;
const RESTITUTION = 0.60;
const WALL_COLOR  = '#444';
const BORDER_COLOR = '#333';

// ── State ────────────────────────────────────────────────────────────────────
let canvas, ctx, W, H;
let pegs     = [];
let sections = [];
let targetSection = 0;
let numSections   = 9;
let ballCount     = 2000;
let angleStep     = 15;
let wins = 0, losses = 0;
let gameState = 'idle'; // idle | running | returning | result

// zones
let fZ = {}, pZ = {}, sZ = {};
let border = {};

// modes
let rotateMode  = 'single';
let captureMode = 'row';

// batch select
let selRect = null, selStart = null, isDragging = false;
let twoFingerStart = null;
let longPressTimer = null;
const LONG_MS = 600;

// animation
let pilotBalls = [];
let animFrame  = null;
let animDone   = false;

// real-time fill: accumulated captures per section during animation
let liveCaptures = []; // int count per section, updated as balls land
let fillAnim     = []; // 0..1 visual fill ratio (smooth)

// peg face cache
let pegFaces = [];

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('canvas');
  ctx    = canvas.getContext('2d');
  bindUI();
  resize();
  window.addEventListener('resize', resize);
  newRound(false);
});

function resize() {
  const wrap = document.getElementById('canvas-wrap');
  W = wrap.clientWidth;
  H = wrap.clientHeight;
  canvas.width  = W;
  canvas.height = H;
  computeZones();
  buildPegs(true);   // keep rotations on resize
  buildSections();
  render();
}

function computeZones() {
  const pad = 6;
  fZ = { y: pad,       h: H * 0.13 };
  pZ = { y: H * 0.13,  h: H * 0.52 };
  sZ = { y: H * 0.65,  h: H * 0.31 };
  const mx = W * 0.05;
  border = { x: mx, y: fZ.y + fZ.h, w: W - mx * 2, h: sZ.y + sZ.h - (fZ.y + fZ.h) };
}

// ── Geometry ──────────────────────────────────────────────────────────────────

function buildPegs(keepRotations = false) {
  const prev = keepRotations ? pegs.map(p => ({ r: p.row, c: p.col, rot: p.rotation, lk: p.locked })) : [];
  pegs = [];

  const baseW    = border.w - 4;
  const colPitch = baseW / ROWS;
  const rowH     = pZ.h / ROWS;
  const bx       = border.x + 2;

  for (let r = 0; r < ROWS; r++) {
    const cols    = r + 1;
    const rowSpan = colPitch * r;
    const startX  = bx + (baseW - rowSpan) / 2;
    const y       = pZ.y + rowH * (r + 0.5);

    for (let c = 0; c < cols; c++) {
      let rotation = 0, locked = false;
      if (keepRotations) {
        const p = prev.find(p => p.r === r && p.c === c);
        if (p) { rotation = p.rot; locked = p.lk; }
      }
      pegs.push({ row: r, col: c, x: startX + c * colPitch, y, rotation, locked });
    }
  }
  rebuildPegFaces();
}

function rebuildPegFaces() {
  const s = PEG_S;
  const localV = [
    { x: 0,         y: -s },
    { x:  s * 0.88, y:  s * 0.65 },
    { x: -s * 0.88, y:  s * 0.65 },
  ];
  pegFaces = pegs.map(peg => {
    const rad = (peg.rotation * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const v = localV.map(({ x, y }) => ({
      x: peg.x + x * cos - y * sin,
      y: peg.y + x * sin + y * cos,
    }));
    return [0, 1, 2].map(i => {
      const a = v[i], b = v[(i + 1) % 3];
      const ex = b.x - a.x, ey = b.y - a.y;
      const len = Math.sqrt(ex * ex + ey * ey);
      let nx = -ey / len, ny = ex / len;
      const cx = (v[0].x + v[1].x + v[2].x) / 3;
      const cy = (v[0].y + v[1].y + v[2].y) / 3;
      if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
      return { ax: a.x, ay: a.y, bx: b.x, by: b.y, nx, ny };
    });
  });
}

function buildSections(keepCounts = false) {
  const prev = keepCounts ? sections.map(s => s.count) : [];
  sections = [];
  const sw = border.w / numSections;
  for (let i = 0; i < numSections; i++) {
    sections.push({
      x: border.x + i * sw, w: sw,
      count: keepCounts ? (prev[i] || 0) : 0,
      isTarget: i === targetSection,
    });
  }
  liveCaptures = new Array(numSections).fill(0);
  fillAnim     = new Array(numSections).fill(0);
}

// ── UI ────────────────────────────────────────────────────────────────────────
function bindUI() {
  document.getElementById('btn-launch').addEventListener('click', launchBalls);

  // "New round" resets pegs too
  document.getElementById('btn-new-round').addEventListener('click', () => newRound(true));

  document.getElementById('btn-reset-pegs').addEventListener('click', resetPegs);

  // "Next" after result: keep pegs, just pick new target + return balls
  document.getElementById('btn-next').addEventListener('click', () => newRound(false));

  document.getElementById('btn-mode').addEventListener('click', () => {
    rotateMode = rotateMode === 'single' ? 'batch' : 'single';
    document.getElementById('btn-mode').textContent = 'Режим: ' + (rotateMode === 'single' ? 'Один' : 'Пакет');
    document.getElementById('btn-mode').classList.toggle('active', rotateMode === 'batch');
  });

  document.getElementById('btn-row-col').addEventListener('click', () => {
    captureMode = captureMode === 'row' ? 'col' : 'row';
    document.getElementById('btn-row-col').textContent = 'Захват: ' + (captureMode === 'row' ? 'Ряд' : 'Колонка');
  });

  const sl = document.getElementById('ball-slider');
  sl.addEventListener('input', () => {
    ballCount = +sl.value;
    document.getElementById('ball-count-display').textContent = ballCount;
  });
  document.getElementById('angle-select').addEventListener('change', e => { angleStep = +e.target.value; });
  document.getElementById('sections-select').addEventListener('change', e => {
    numSections = +e.target.value;
    if (targetSection >= numSections) targetSection = 0;
    buildSections(); newRound(false); render();
  });

  canvas.addEventListener('pointerdown',   onPointerDown,  { passive: false });
  canvas.addEventListener('pointermove',   onPointerMove,  { passive: false });
  canvas.addEventListener('pointerup',     onPointerUp,    { passive: false });
  canvas.addEventListener('pointercancel', onPointerUp,    { passive: false });
  canvas.addEventListener('touchstart',    onTouchStart,   { passive: false });
  canvas.addEventListener('touchmove',     onTouchMove,    { passive: false });
  canvas.addEventListener('touchend',      onTouchEnd,     { passive: false });
}

// ── Game logic ────────────────────────────────────────────────────────────────

/**
 * newRound:
 *   resetPegsFlag=true  → full reset (new game button)
 *   resetPegsFlag=false → keep peg rotations (retry after loss / next after win)
 */
function newRound(resetPegsFlag) {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  targetSection = Math.floor(Math.random() * numSections);
  document.getElementById('target-display').textContent = targetSection + 1;
  buildSections(false);
  gameState = 'idle';
  pilotBalls = [];
  animDone   = false;
  document.getElementById('result-overlay').classList.remove('show');
  if (resetPegsFlag) resetPegs();
  render();
}

function resetPegs() {
  pegs.forEach(p => { p.rotation = 0; p.locked = false; });
  rebuildPegFaces();
  render();
}

function rotatePeg(peg) {
  if (peg.locked) return;
  peg.rotation = Math.min(peg.rotation + angleStep, MAX_ROT);
  if (peg.rotation >= MAX_ROT) peg.locked = true;
  rebuildPegFaces();
}

// ── Distribution ──────────────────────────────────────────────────────────────
function computeDistribution() {
  let incoming = new Float64Array([1.0]);
  for (let r = 0; r < ROWS; r++) {
    const rowPegs = pegs.filter(p => p.row === r);
    const out = new Float64Array(rowPegs.length + 1);
    rowPegs.forEach((peg, j) => {
      const bias  = (peg.rotation / MAX_ROT) * 0.45;
      const leftP = 0.5 + bias;
      const p     = incoming[j] || 0;
      out[j]     += p * leftP;
      out[j + 1] += p * (1 - leftP);
    });
    incoming = out;
  }
  const total  = ROWS + 1;
  const result = new Float64Array(numSections);
  for (let i = 0; i < total; i++) {
    const sec = Math.min(Math.floor(i / (total / numSections)), numSections - 1);
    result[sec] += incoming[i];
  }
  const sum = result.reduce((a, b) => a + b, 0);
  if (sum > 0) result.forEach((_, i) => result[i] /= sum);
  return result;
}

// ── Launch ────────────────────────────────────────────────────────────────────
function launchBalls() {
  if (gameState === 'running' || gameState === 'returning') return;
  gameState = 'running';
  animDone  = false;

  // Reset live fill
  liveCaptures = new Array(numSections).fill(0);
  fillAnim     = new Array(numSections).fill(0);

  const dist = computeDistribution();
  let total  = 0;
  sections.forEach((s, i) => { s.count = Math.round(dist[i] * ballCount); total += s.count; });
  sections[targetSection].count += ballCount - total;

  pilotBalls = [];
  for (let k = 0; k < PILOT_N; k++) spawnBall(k);

  let lastTs = null;
  function step(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.04);
    lastTs = ts;

    updateBalls(dt);
    smoothFill(dt);
    render();

    if (pilotBalls.some(b => !b.done)) {
      animFrame = requestAnimationFrame(step);
    } else {
      // All balls landed — evaluate, then start return animation
      evaluateResult();
      startReturn();
    }
  }
  animFrame = requestAnimationFrame(step);
}

function spawnBall(k) {
  pilotBalls.push({
    x:  W / 2 + (Math.random() - 0.5) * 8,
    y:  fZ.y + fZ.h * 0.2,
    vx: (Math.random() - 0.5) * 25,
    vy: 15 + Math.random() * 25,
    delay:    k * 0.045,
    active:   false,
    done:     false,
    returning:false,
    trail:    [],
  });
}

/**
 * Smoothly animate fill toward live capture ratios.
 * Updated in real-time as liveCaptures accumulates.
 */
function smoothFill(dt) {
  const speed    = 2.5; // ratio/s — fast enough to track live arrivals
  const totalCap = liveCaptures.reduce((a, b) => a + b, 0) || 1;
  sections.forEach((_, i) => {
    const target = liveCaptures[i] / PILOT_N; // proportion of pilot balls
    if (fillAnim[i] < target) fillAnim[i] = Math.min(fillAnim[i] + speed * dt, target);
  });
}

// ── Return animation ──────────────────────────────────────────────────────────
/**
 * After round ends, animate balls flying back up into funnel.
 * Once all returned, switch back to idle so player can tweak pegs.
 */
function startReturn() {
  gameState = 'returning';
  animDone  = true;

  // Re-activate all done balls as "returning" particles
  pilotBalls.forEach(b => {
    b.returning = true;
    b.done      = false;
    b.active    = true;
    b.trail     = [];
    // give them an upward velocity
    b.vx = (Math.random() - 0.5) * 60;
    b.vy = -(180 + Math.random() * 120);
  });

  const targetY = fZ.y + fZ.h * 0.3;

  let lastTs = null;
  function step(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.04);
    lastTs = ts;

    // Move returning balls upward with slight gravity opposition
    pilotBalls.forEach(b => {
      if (b.done) return;
      b.vy += 60 * dt; // weak gravity so they slow down near top
      b.x  += b.vx * dt;
      b.y  += b.vy * dt;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 5) b.trail.shift();
      if (b.y < targetY) b.done = true; // reached funnel
    });

    render();

    if (pilotBalls.some(b => !b.done)) {
      animFrame = requestAnimationFrame(step);
    } else {
      // All back — clear, go idle, keep fill shown
      pilotBalls = [];
      gameState  = 'result'; // stay in result so overlay stays up
      render();
    }
  }
  animFrame = requestAnimationFrame(step);
}

// ── Physics ───────────────────────────────────────────────────────────────────
function updateBalls(dt) {
  pilotBalls.forEach(ball => {
    if (ball.done || ball.returning) return;
    ball.delay -= dt;
    if (ball.delay > 0) return;
    ball.active = true;

    ball.vy += GRAVITY * dt;
    ball.x  += ball.vx * dt;
    ball.y  += ball.vy * dt;

    // border walls
    if (ball.x - BALL_R < border.x) { ball.x = border.x + BALL_R; ball.vx = Math.abs(ball.vx) * RESTITUTION; }
    if (ball.x + BALL_R > border.x + border.w) { ball.x = border.x + border.w - BALL_R; ball.vx = -Math.abs(ball.vx) * RESTITUTION; }

    // peg reflections
    if (ball.y >= pZ.y - PEG_S && ball.y <= pZ.y + pZ.h + PEG_S) {
      for (let pi = 0; pi < pegs.length; pi++) {
        const peg = pegs[pi];
        if (Math.abs(ball.x - peg.x) > PEG_S + BALL_R + 2) continue;
        if (Math.abs(ball.y - peg.y) > PEG_S + BALL_R + 2) continue;
        const faces = pegFaces[pi];
        for (const face of faces) {
          if (reflectOffSegment(ball, face, BALL_R, RESTITUTION)) break;
        }
      }
    }

    // cup zone
    if (ball.y >= sZ.y) {
      const sw      = border.w / numSections;
      const secIdx  = Math.floor((ball.x - border.x) / sw);
      const idx     = Math.max(0, Math.min(numSections - 1, secIdx));
      const cupX    = border.x + idx * sw;
      const wt      = 1.5;

      if (idx > 0              && ball.x - BALL_R < cupX + wt)      { ball.x = cupX + wt + BALL_R;         ball.vx =  Math.abs(ball.vx) * RESTITUTION; }
      if (idx < numSections-1  && ball.x + BALL_R > cupX + sw - wt) { ball.x = cupX + sw - wt - BALL_R;    ball.vx = -Math.abs(ball.vx) * RESTITUTION; }

      if (ball.y + BALL_R > sZ.y + sZ.h - 4) {
        ball.done = true;
        liveCaptures[idx]++; // ← real-time fill update
      }
    }

    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 6) ball.trail.shift();
    if (ball.y > H + 20) ball.done = true;
  });
}

function reflectOffSegment(ball, face, radius, rest) {
  const { ax, ay, bx, by, nx, ny } = face;
  const dist = pointSegDist(ball.x, ball.y, ax, ay, bx, by);
  if (dist > radius + 1) return false;
  const vDotN = ball.vx * nx + ball.vy * ny;
  if (vDotN >= 0) return false;
  ball.vx = (ball.vx - 2 * vDotN * nx) * rest;
  ball.vy = (ball.vy - 2 * vDotN * ny) * rest;
  const push = radius + 1.5 - dist;
  ball.x += nx * push;
  ball.y += ny * push;
  return true;
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function evaluateResult() {
  const counts   = sections.map(s => s.count);
  const tCount   = counts[targetSection];
  const maxOther = Math.max(...counts.filter((_, i) => i !== targetSection));
  const win      = tCount > maxOther;
  if (win) wins++; else losses++;
  document.getElementById('wins').textContent   = wins;
  document.getElementById('losses').textContent = losses;

  const msg = document.getElementById('result-msg');
  const sub = document.getElementById('result-sub');
  msg.textContent = win ? '🎯 ПОБЕДА!' : '💥 ПОРАЖЕНИЕ';
  msg.className   = win ? 'win' : 'lose';
  sub.textContent = `Секция ${targetSection + 1}: ${tCount} шаров | Макс др.: ${maxOther}`;
  document.getElementById('result-overlay').classList.add('show');
}

// ── Hit detection ─────────────────────────────────────────────────────────────
function pegAtPoint(x, y) {
  const hr = PEG_S * 2.5;
  let best = null, bd = Infinity;
  pegs.forEach(p => {
    const d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d < hr * hr && d < bd) { bd = d; best = p; }
  });
  return best;
}

function pegsInRect(x1, y1, x2, y2) {
  const [minX, maxX] = [Math.min(x1, x2), Math.max(x1, x2)];
  const [minY, maxY] = [Math.min(y1, y2), Math.max(y1, y2)];
  return pegs.filter(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
}

// ── Pointer events ────────────────────────────────────────────────────────────
const activePointers = new Map();
function canvasPos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

function onPointerDown(e) {
  e.preventDefault();
  if (gameState === 'running' || gameState === 'returning') return;
  const pos = canvasPos(e);
  activePointers.set(e.pointerId, pos);
  longPressTimer = setTimeout(() => { longPressTimer = null; resetPegs(); }, LONG_MS);
  if (rotateMode === 'single') {
    const p = pegAtPoint(pos.x, pos.y);
    if (p) rotatePeg(p);
    render();
  } else {
    selStart = pos; selRect = null; isDragging = false;
  }
}

function onPointerMove(e) {
  e.preventDefault();
  if (!activePointers.has(e.pointerId) || activePointers.size > 1) return;
  const pos = canvasPos(e);
  activePointers.set(e.pointerId, pos);
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  if (rotateMode === 'batch' && selStart) {
    isDragging = true;
    selRect = { x1: selStart.x, y1: selStart.y, x2: pos.x, y2: pos.y };
    render();
  }
}

function onPointerUp(e) {
  e.preventDefault();
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  const pos = canvasPos(e);
  activePointers.delete(e.pointerId);
  if (rotateMode === 'batch') {
    if (isDragging && selRect) {
      pegsInRect(selRect.x1, selRect.y1, selRect.x2, selRect.y2).forEach(rotatePeg);
    } else if (!isDragging && selStart) {
      const p = pegAtPoint(pos.x, pos.y);
      if (p) {
        if (captureMode === 'row') pegs.filter(q => q.row === p.row).forEach(rotatePeg);
        else pegs.filter(q => Math.abs(q.x - p.x) < 22).forEach(rotatePeg);
      }
    }
    selRect = null; selStart = null; isDragging = false;
    render();
  }
}

function onTouchStart(e) {
  if (e.touches.length === 2) { e.preventDefault(); twoFingerStart = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2 }; }
}
function onTouchMove(e) { if (e.touches.length === 2 && twoFingerStart) e.preventDefault(); }
function onTouchEnd(e) {
  if (!twoFingerStart || !e.changedTouches.length) return;
  const lastX = [...e.changedTouches].reduce((s, t) => s + t.clientX, 0) / e.changedTouches.length;
  if (Math.abs(lastX - twoFingerStart.x) > 20) {
    const rect = canvas.getBoundingClientRect();
    const cx = twoFingerStart.x - rect.left, ex = lastX - rect.left;
    pegs.filter(p => p.x >= Math.min(cx, ex) - 20 && p.x <= Math.max(cx, ex) + 20)
        .forEach(p => { if (!p.locked) { p.rotation = Math.min(p.rotation + angleStep / 2, MAX_ROT); if (p.rotation >= MAX_ROT) p.locked = true; } });
    rebuildPegFaces(); render();
  }
  twoFingerStart = null;
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  drawBorder();
  drawFunnel();
  drawPegs();
  drawCups();
  drawPilotBalls();
  drawSelectionRect();
}

function drawBorder() {
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(border.x, border.y, border.w, border.h);
}

function drawFunnel() {
  const cx = W / 2, fy = fZ.y, fh = fZ.h, spoutW = 10;
  ctx.strokeStyle = '#333';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(cx - border.w * 0.47, fy); ctx.lineTo(cx - spoutW / 2, fy + fh); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + border.w * 0.47, fy); ctx.lineTo(cx + spoutW / 2, fy + fh); ctx.stroke();

  if (gameState === 'idle') {
    const rng = mulberry32(42), n = Math.min(ballCount, 800);
    ctx.fillStyle = '#ccc';
    for (let i = 0; i < n; i++) {
      const t = rng();
      ctx.beginPath();
      ctx.arc(cx + (rng() - 0.5) * border.w * 0.88 * t, fy + 4 + rng() * (fh - 8), 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0ff';
    ctx.font = 'bold 12px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(ballCount + ' шаров', cx, fy + fh * 0.5);
  }
}

function drawPegs() {
  const s = PEG_S;
  pegs.forEach(peg => {
    ctx.save();
    ctx.translate(peg.x, peg.y);
    ctx.rotate((peg.rotation * Math.PI) / 180);
    if (peg.locked)        { ctx.strokeStyle = '#f44'; ctx.fillStyle = 'rgba(255,68,68,0.10)'; }
    else if (peg.rotation) { ctx.strokeStyle = '#0ff'; ctx.fillStyle = 'rgba(0,255,255,0.06)'; }
    else                   { ctx.strokeStyle = '#aaa'; ctx.fillStyle = 'rgba(255,255,255,0.03)'; }
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0,        -s);
    ctx.lineTo( s*0.88,   s*0.65);
    ctx.lineTo(-s*0.88,   s*0.65);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (peg.rotation > 0 && !peg.locked) {
      ctx.fillStyle = '#0ff';
      ctx.beginPath(); ctx.arc(0, -s * 0.35, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  });
}

/**
 * Cups with real-time animated liquid fill.
 * Fill level tracks liveCaptures during animation,
 * then stays at final level showing ball counts.
 */
function drawCups() {
  const zY = sZ.y, zH = sZ.h;
  const sw = border.w / numSections;

  // Find current leader for highlighting
  const maxFill = Math.max(...fillAnim);

  sections.forEach((sec, i) => {
    const x = sec.x, w = sec.w;
    const isTarget  = i === targetSection;
    const isLeading = fillAnim[i] === maxFill && maxFill > 0;

    // Background
    ctx.fillStyle = isTarget ? 'rgba(0,255,0,0.03)' : 'rgba(255,255,255,0.015)';
    ctx.fillRect(x + 1, zY, w - 2, zH - 1);

    // Liquid fill
    const fillH = fillAnim[i] * (zH - 2);
    if (fillH > 0.5) {
      const grad = ctx.createLinearGradient(x, zY + zH - fillH, x, zY + zH);
      if (isTarget) {
        grad.addColorStop(0, 'rgba(0,255,80,0.80)');
        grad.addColorStop(1, 'rgba(0,150,40,0.55)');
      } else if (isLeading) {
        grad.addColorStop(0, 'rgba(255,200,0,0.75)');
        grad.addColorStop(1, 'rgba(180,100,0,0.50)');
      } else {
        grad.addColorStop(0, 'rgba(100,180,255,0.55)');
        grad.addColorStop(1, 'rgba(40,80,180,0.38)');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x + 2, zY + zH - fillH - 1, w - 4, fillH);

      // shimmer surface
      ctx.strokeStyle = isTarget ? 'rgba(120,255,140,0.9)' : isLeading ? 'rgba(255,220,80,0.9)' : 'rgba(160,210,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 2, zY + zH - fillH - 1);
      ctx.lineTo(x + w - 2, zY + zH - fillH - 1);
      ctx.stroke();
    }

    // Cup walls
    ctx.strokeStyle = isTarget ? '#00cc44' : WALL_COLOR;
    ctx.lineWidth   = isTarget ? 1.5 : 0.8;
    if (i > 0)              { ctx.beginPath(); ctx.moveTo(x,   zY); ctx.lineTo(x,   zY + zH); ctx.stroke(); }
    if (i < numSections-1)  { ctx.beginPath(); ctx.moveTo(x+w, zY); ctx.lineTo(x+w, zY + zH); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(x, zY + zH); ctx.lineTo(x + w, zY + zH); ctx.stroke();

    // Labels
    ctx.fillStyle = isTarget ? '#0f0' : '#555';
    ctx.font = '10px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(i + 1, x + w / 2, zY + 12);

    if (animDone && sec.count > 0) {
      ctx.fillStyle = isTarget ? '#0f0' : '#888';
      ctx.font = '9px Courier New';
      ctx.fillText(sec.count, x + w / 2, zY + zH - 4);
    }
  });

  // Target arrow
  const tSec = sections[targetSection];
  if (tSec) {
    ctx.fillStyle = '#0f0';
    ctx.font = 'bold 10px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('▼ ЦЕЛЬ', tSec.x + tSec.w / 2, zY - 4);
  }
}

function drawPilotBalls() {
  pilotBalls.forEach(ball => {
    if (!ball.active) return;

    const color = ball.returning ? 'rgba(255,160,0,0.7)' : '#00ccff';

    if (ball.trail.length > 1) {
      ctx.strokeStyle = ball.returning ? 'rgba(255,160,0,0.2)' : 'rgba(0,200,255,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ball.trail.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSelectionRect() {
  if (!selRect) return;
  ctx.strokeStyle = 'rgba(0,255,255,0.6)';
  ctx.fillStyle   = 'rgba(0,255,255,0.05)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([4, 3]);
  const x = Math.min(selRect.x1, selRect.x2), y = Math.min(selRect.y1, selRect.y2);
  ctx.fillRect(x, y, Math.abs(selRect.x2 - selRect.x1), Math.abs(selRect.y2 - selRect.y1));
  ctx.strokeRect(x, y, Math.abs(selRect.x2 - selRect.x1), Math.abs(selRect.y2 - selRect.y1));
  ctx.setLineDash([]);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
