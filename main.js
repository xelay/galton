/**
 * Triangle Quincunx — PWA Game
 *
 * Physics model (pilot balls):
 *   • Triangular pegs have 3 line-segment faces.
 *   • Reflection uses the specular (mirror) law: v' = v - 2(v·n)n
 *   • Global border walls (left/right/bottom) reflect balls.
 *   • Section cup walls are solid vertical lines; balls bounce off them.
 *   • A ball that crosses the cup floor is "captured" — animates as rising fill level.
 *
 * Distribution (instant, for all ballCount):
 *   Probability transition matrix through the peg rows.
 */

'use strict';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ── Constants ────────────────────────────────────────────────────────────────
const ROWS        = 12;
const MAX_ROT     = 270;    // max CCW rotation per peg (degrees)
const PEG_S       = 9;      // triangle half-size (px)
const PILOT_N     = 60;     // animated pilot balls
const BALL_R      = 3;
const GRAVITY     = 260;    // px/s²
const RESTITUTION = 0.62;   // energy kept on bounce
const WALL_COLOR  = '#444';
const BORDER_COLOR = '#2a2a2a';

// ── State ───────────────────────────────────────────────────────────────────
let canvas, ctx, W, H;
let pegs      = [];
let sections  = [];
let targetSection = 0;
let numSections   = 9;
let ballCount     = 2000;
let angleStep     = 15;
let wins = 0, losses = 0;
let gameState = 'idle';  // idle | running | result

// zones
let fZ = {}, pZ = {}, sZ = {}; // funnel, peg, section zones

// border rect for the playfield
let border = {}; // {x, y, w, h}

// modes
let rotateMode = 'single';
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

// fill animation targets (animated from 0 → final ratio per section)
let fillAnim = [];  // array of current fill ratio per section (0..1)

// precomputed peg triangle faces (world-space) for collision
let pegFaces = [];

// ── Init ─────────────────────────────────────────────────────────────────────
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
  buildPegs();
  buildSections();
  render();
}

function computeZones() {
  const pad = 8;
  fZ = { y: pad,          h: H * 0.14 };
  pZ = { y: H * 0.14,     h: H * 0.50 };
  sZ = { y: H * 0.64,     h: H * 0.32 };

  // playfield border: left/right walls from funnel base to section bottom
  const mx = W * 0.055;
  border = { x: mx, y: fZ.y + fZ.h, w: W - mx * 2, h: sZ.y + sZ.h - (fZ.y + fZ.h) };
}

// ── Build geometry ────────────────────────────────────────────────────────────

/**
 * Pyramid layout: row r has r+1 pegs, uniform horizontal pitch.
 * Faces are 3 line segments of the rotated triangle (world-space).
 */
function buildPegs(keepRotations = false) {
  const prev = keepRotations ? pegs.map(p => ({ r: p.row, c: p.col, rot: p.rotation })) : [];
  pegs = [];

  const baseW    = border.w - 2;          // usable width aligns with border
  const colPitch = baseW / ROWS;
  const rowH     = pZ.h / ROWS;
  const bx       = border.x + 1;         // align left edge with border

  for (let r = 0; r < ROWS; r++) {
    const cols     = r + 1;
    const rowSpan  = colPitch * r;
    const startX   = bx + (baseW - rowSpan) / 2;
    const y        = pZ.y + rowH * (r + 0.5);

    for (let c = 0; c < cols; c++) {
      let rotation = 0;
      if (keepRotations) {
        const p = prev.find(p => p.r === r && p.c === c);
        if (p) rotation = p.rot;
      }
      pegs.push({ row: r, col: c, x: startX + c * colPitch, y, rotation, locked: false });
    }
  }
  rebuildPegFaces();
}

/**
 * Recompute world-space triangle vertices + 3 face normals for each peg.
 * Each face = { ax, ay, bx, by, nx, ny } where n is inward normal.
 */
function rebuildPegFaces() {
  const s = PEG_S;
  // Triangle vertices in local space (tip up)
  const localV = [
    { x:  0,        y: -s },           // tip
    { x:  s * 0.88, y:  s * 0.65 },   // bottom-right
    { x: -s * 0.88, y:  s * 0.65 },   // bottom-left
  ];

  pegFaces = pegs.map(peg => {
    const rad = (peg.rotation * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    // Rotate vertices
    const v = localV.map(({ x, y }) => ({
      x: peg.x + x * cos - y * sin,
      y: peg.y + x * sin + y * cos,
    }));
    // 3 faces: 0-1, 1-2, 2-0
    return [0, 1, 2].map(i => {
      const a = v[i], b = v[(i + 1) % 3];
      const edgeX = b.x - a.x, edgeY = b.y - a.y;
      // outward normal (pointing away from centroid)
      const len = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
      let nx = -edgeY / len, ny = edgeX / len;
      // ensure outward (centroid of triangle)
      const cx = (v[0].x + v[1].x + v[2].x) / 3;
      const cy = (v[0].y + v[1].y + v[2].y) / 3;
      const mx = (a.x + b.x) / 2 - cx;
      const my = (a.y + b.y) / 2 - cy;
      if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
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
      x: border.x + i * sw,
      w: sw,
      count: keepCounts ? (prev[i] || 0) : 0,
      isTarget: i === targetSection,
    });
  }
  fillAnim = new Array(numSections).fill(0);
}

// ── UI ───────────────────────────────────────────────────────────────────────────
function bindUI() {
  document.getElementById('btn-launch').addEventListener('click', launchBalls);
  document.getElementById('btn-new-round').addEventListener('click', () => newRound(true));
  document.getElementById('btn-reset-pegs').addEventListener('click', resetPegs);
  document.getElementById('btn-next').addEventListener('click', () => newRound(true));

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

  canvas.addEventListener('pointerdown',  onPointerDown,  { passive: false });
  canvas.addEventListener('pointermove',  onPointerMove,  { passive: false });
  canvas.addEventListener('pointerup',    onPointerUp,    { passive: false });
  canvas.addEventListener('pointercancel',onPointerUp,    { passive: false });
  canvas.addEventListener('touchstart',   onTouchStart,   { passive: false });
  canvas.addEventListener('touchmove',    onTouchMove,    { passive: false });
  canvas.addEventListener('touchend',     onTouchEnd,     { passive: false });
}

// ── Game logic ────────────────────────────────────────────────────────────────

function newRound(resetPegsFlag) {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  targetSection = Math.floor(Math.random() * numSections);
  document.getElementById('target-display').textContent = targetSection + 1;
  buildSections(false);
  gameState = 'idle';
  pilotBalls = [];
  animDone   = false;
  fillAnim   = new Array(numSections).fill(0);
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
  rebuildPegFaces(); // update faces after rotation
}

// ── Distribution (matrix) ─────────────────────────────────────────────────────────
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
  const total = ROWS + 1;
  const result = new Float64Array(numSections);
  for (let i = 0; i < total; i++) {
    const sec = Math.min(Math.floor(i / (total / numSections)), numSections - 1);
    result[sec] += incoming[i];
  }
  const sum = result.reduce((a, b) => a + b, 0);
  if (sum > 0) result.forEach((_, i) => result[i] /= sum);
  return result;
}

// ── Launch ──────────────────────────────────────────────────────────────────────
function launchBalls() {
  if (gameState === 'running') return;
  gameState = 'running';
  animDone  = false;
  fillAnim  = new Array(numSections).fill(0);

  const dist = computeDistribution();
  let total  = 0;
  sections.forEach((s, i) => { s.count = Math.round(dist[i] * ballCount); total += s.count; });
  sections[targetSection].count += ballCount - total; // fix rounding

  // spawn pilot balls with staggered delays
  pilotBalls = [];
  for (let k = 0; k < PILOT_N; k++) spawnBall(k);

  let lastTs = null;
  function step(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.04);
    lastTs = ts;

    updateBalls(dt);
    animateFill(dt, dist);
    render();

    if (pilotBalls.some(b => !b.done)) {
      animFrame = requestAnimationFrame(step);
    } else {
      animDone  = true;
      gameState = 'result';
      render();
      evaluateResult();
    }
  }
  animFrame = requestAnimationFrame(step);
}

function spawnBall(k) {
  pilotBalls.push({
    x:  W / 2 + (Math.random() - 0.5) * 6,
    y:  fZ.y + fZ.h * 0.15,
    vx: (Math.random() - 0.5) * 30,
    vy: 20 + Math.random() * 30,
    delay: k * 0.05,
    active: false,
    done:   false,
    trail:  [],
    captured: false,
    capSec: -1,
  });
}

/**
 * Smoothly animate fill levels toward final distribution ratios.
 */
function animateFill(dt, dist) {
  const speed = 0.7; // fill speed (ratio/s)
  const maxCount = Math.max(...sections.map(s => s.count), 1);
  sections.forEach((sec, i) => {
    const target = sec.count / ballCount; // final ratio
    if (fillAnim[i] < target) {
      fillAnim[i] = Math.min(fillAnim[i] + speed * dt, target);
    }
  });
}

// ── Physics ─────────────────────────────────────────────────────────────────────

function updateBalls(dt) {
  pilotBalls.forEach(ball => {
    if (ball.done) return;
    ball.delay -= dt;
    if (ball.delay > 0) return;
    ball.active = true;

    // gravity
    ball.vy += GRAVITY * dt;
    ball.x  += ball.vx * dt;
    ball.y  += ball.vy * dt;

    // ─ Border walls (left/right of playfield) ─
    if (ball.x - BALL_R < border.x) {
      ball.x  = border.x + BALL_R;
      ball.vx = Math.abs(ball.vx) * RESTITUTION;
    }
    if (ball.x + BALL_R > border.x + border.w) {
      ball.x  = border.x + border.w - BALL_R;
      ball.vx = -Math.abs(ball.vx) * RESTITUTION;
    }

    // ─ Peg face reflections (mirror law) ─
    if (ball.y >= pZ.y - PEG_S && ball.y <= pZ.y + pZ.h + PEG_S) {
      for (let pi = 0; pi < pegs.length; pi++) {
        const peg = pegs[pi];
        // Quick bounding-box pre-check
        if (Math.abs(ball.x - peg.x) > PEG_S + BALL_R + 2) continue;
        if (Math.abs(ball.y - peg.y) > PEG_S + BALL_R + 2) continue;

        const faces = pegFaces[pi];
        for (const face of faces) {
          if (reflectOffSegment(ball, face, BALL_R, RESTITUTION)) break;
        }
      }
    }

    // ─ Section zone: cup walls and capture ─
    if (ball.y >= sZ.y) {
      const sw = border.w / numSections;
      // Find which cup the ball is in
      const secIdx = Math.floor((ball.x - border.x) / sw);
      const clamped = Math.max(0, Math.min(numSections - 1, secIdx));
      const cupX = border.x + clamped * sw;
      const wallThick = 1.5;

      // Left wall of cup (not the global border)
      if (clamped > 0 && ball.x - BALL_R < cupX + wallThick) {
        ball.x  = cupX + wallThick + BALL_R;
        ball.vx = Math.abs(ball.vx) * RESTITUTION;
      }
      // Right wall of cup
      if (clamped < numSections - 1 && ball.x + BALL_R > cupX + sw - wallThick) {
        ball.x  = cupX + sw - wallThick - BALL_R;
        ball.vx = -Math.abs(ball.vx) * RESTITUTION;
      }

      // Cup floor → capture
      if (ball.y + BALL_R > sZ.y + sZ.h - 4) {
        ball.done     = true;
        ball.captured = true;
        ball.capSec   = clamped;
      }
    }

    // trail
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 6) ball.trail.shift();

    // safety: off-screen
    if (ball.y > H + 20) ball.done = true;
  });
}

/**
 * Mirror-law reflection of a ball off a line segment.
 * v' = v - 2(v·n)n  (specular reflection)
 * Returns true if collision occurred.
 */
function reflectOffSegment(ball, face, radius, rest) {
  const { ax, ay, bx, by, nx, ny } = face;

  // Distance from ball centre to segment
  const dist = pointSegDist(ball.x, ball.y, ax, ay, bx, by);
  if (dist > radius + 1) return false;

  // Only reflect if ball is moving toward the face (v · n < 0 → approaching)
  const vDotN = ball.vx * nx + ball.vy * ny;
  if (vDotN >= 0) return false;

  // Mirror reflection
  ball.vx = (ball.vx - 2 * vDotN * nx) * rest;
  ball.vy = (ball.vy - 2 * vDotN * ny) * rest;

  // Push ball outside the segment
  const push = radius + 1.5 - dist;
  ball.x += nx * push;
  ball.y += ny * push;

  return true;
}

/** Signed distance from point (px,py) to segment (ax,ay)-(bx,by) */
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
  const hr = PEG_S * 2.4;
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
  if (gameState === 'running') return;
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
  if (e.touches.length === 2) {
    e.preventDefault();
    twoFingerStart = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2 };
  }
}
function onTouchMove(e) { if (e.touches.length === 2 && twoFingerStart) e.preventDefault(); }
function onTouchEnd(e) {
  if (!twoFingerStart || !e.changedTouches.length) return;
  const lastX = [...e.changedTouches].reduce((s, t) => s + t.clientX, 0) / e.changedTouches.length;
  const dx = lastX - twoFingerStart.x;
  if (Math.abs(dx) > 20) {
    const rect  = canvas.getBoundingClientRect();
    const cx    = twoFingerStart.x - rect.left;
    const ex    = lastX - rect.left;
    pegs.filter(p => p.x >= Math.min(cx, ex) - 20 && p.x <= Math.max(cx, ex) + 20)
        .forEach(p => { if (!p.locked) { p.rotation = Math.min(p.rotation + angleStep / 2, MAX_ROT); if (p.rotation >= MAX_ROT) p.locked = true; } });
    rebuildPegFaces();
    render();
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

/** Outer border of the entire playfield */
function drawBorder() {
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(border.x, border.y, border.w, border.h);
}

function drawFunnel() {
  const cx = W / 2;
  const fy = fZ.y, fh = fZ.h;
  const spoutW = 10;

  // Funnel walls
  ctx.strokeStyle = '#333';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(cx - border.w * 0.48, fy); ctx.lineTo(cx - spoutW / 2, fy + fh); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + border.w * 0.48, fy); ctx.lineTo(cx + spoutW / 2, fy + fh); ctx.stroke();

  if (gameState === 'idle') {
    const rng = mulberry32(42);
    const n   = Math.min(ballCount, 700);
    ctx.fillStyle = '#ddd';
    for (let i = 0; i < n; i++) {
      const t  = rng();
      ctx.beginPath();
      ctx.arc(cx + (rng() - 0.5) * border.w * 0.9 * t, fy + 4 + rng() * (fh - 8), 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0ff';
    ctx.font = 'bold 12px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(ballCount + ' шаров', cx, fy + fh * 0.48);
  }
}

function drawPegs() {
  const s = PEG_S;
  pegs.forEach((peg, pi) => {
    ctx.save();
    ctx.translate(peg.x, peg.y);
    ctx.rotate((peg.rotation * Math.PI) / 180);

    if (peg.locked)        { ctx.strokeStyle = '#f44'; ctx.fillStyle = 'rgba(255,68,68,0.12)'; }
    else if (peg.rotation) { ctx.strokeStyle = '#0ff'; ctx.fillStyle = 'rgba(0,255,255,0.07)'; }
    else                   { ctx.strokeStyle = '#fff'; ctx.fillStyle = 'rgba(255,255,255,0.04)'; }

    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0,          -s);
    ctx.lineTo( s * 0.88,   s * 0.65);
    ctx.lineTo(-s * 0.88,   s * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (peg.rotation > 0 && !peg.locked) {
      ctx.fillStyle = '#0ff';
      ctx.beginPath(); ctx.arc(0, -s * 0.35, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  });
}

/**
 * Draw the cup array (section zone).
 * Each cup:
 *   • Outer rectangle (walls + floor).
 *   • Fill: animated liquid level rising from floor up.
 *   • Target cup highlighted green.
 */
function drawCups() {
  const zY = sZ.y, zH = sZ.h;
  const sw = border.w / numSections;

  sections.forEach((sec, i) => {
    const x = sec.x, w = sec.w;
    const isTarget = i === targetSection;

    // Cup interior background
    ctx.fillStyle = isTarget ? 'rgba(0,255,0,0.04)' : 'rgba(255,255,255,0.02)';
    ctx.fillRect(x + 1, zY, w - 2, zH - 1);

    // Animated fill (liquid)
    const fillH = fillAnim[i] * (zH - 2);
    if (fillH > 0) {
      // gradient: darker at bottom, brighter at surface
      const grad = ctx.createLinearGradient(x, zY + zH - fillH, x, zY + zH);
      if (isTarget) {
        grad.addColorStop(0, 'rgba(0,255,80,0.75)');
        grad.addColorStop(1, 'rgba(0,180,40,0.55)');
      } else {
        grad.addColorStop(0, 'rgba(180,220,255,0.55)');
        grad.addColorStop(1, 'rgba(80,120,200,0.40)');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x + 2, zY + zH - fillH - 1, w - 4, fillH);

      // Surface shimmer line
      ctx.strokeStyle = isTarget ? 'rgba(100,255,130,0.8)' : 'rgba(200,220,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 2, zY + zH - fillH - 1);
      ctx.lineTo(x + w - 2, zY + zH - fillH - 1);
      ctx.stroke();
    }

    // Cup walls (drawn on top of fill)
    ctx.strokeStyle = isTarget ? '#00cc44' : WALL_COLOR;
    ctx.lineWidth   = isTarget ? 1.5 : 1;
    // Left wall (skip global border)
    if (i > 0) {
      ctx.beginPath(); ctx.moveTo(x, zY); ctx.lineTo(x, zY + zH); ctx.stroke();
    }
    // Right wall (skip global border)
    if (i < numSections - 1) {
      ctx.beginPath(); ctx.moveTo(x + w, zY); ctx.lineTo(x + w, zY + zH); ctx.stroke();
    }
    // Floor
    ctx.beginPath(); ctx.moveTo(x, zY + zH); ctx.lineTo(x + w, zY + zH); ctx.stroke();

    // Section number
    ctx.fillStyle   = isTarget ? '#0f0' : '#555';
    ctx.font        = '10px Courier New';
    ctx.textAlign   = 'center';
    ctx.fillText(i + 1, x + w / 2, zY + 13);

    // Ball count (when known)
    if (sec.count > 0) {
      ctx.fillStyle = isTarget ? '#0f0' : '#888';
      ctx.font      = '9px Courier New';
      ctx.fillText(sec.count, x + w / 2, zY + zH - 5);
    }
  });

  // "TARGET" arrow above target cup
  const tSec = sections[targetSection];
  if (tSec) {
    ctx.fillStyle = '#0f0';
    ctx.font      = 'bold 10px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('▼ ЦЕЛЬ', tSec.x + tSec.w / 2, zY - 5);
  }

  // Global cup border (left + right outer walls + top edge)
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth   = 1.5;
  // already drawn by drawBorder, but re-stroke bottom for clarity
}

function drawPilotBalls() {
  pilotBalls.forEach(ball => {
    if (!ball.active || ball.captured) return;

    // Trail
    if (ball.trail.length > 1) {
      ctx.strokeStyle = 'rgba(0,200,255,0.18)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ball.trail.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
    }

    ctx.fillStyle = '#00ccff';
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
  const w = Math.abs(selRect.x2 - selRect.x1), h = Math.abs(selRect.y2 - selRect.y1);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
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
