/**
 * Triangle Quincunx — PWA Game
 * Galton board with triangular pegs.
 * Physics: probability transition matrix for 2000+ balls (no per-ball animation).
 * A few "pilot" balls animate visually; final histogram shown instantly.
 */

'use strict';

// ── Service Worker registration ──────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('sw.js').catch(() => {})
  );
}

// ── Constants ────────────────────────────────────────────────────────────────
const ROWS = 12;            // peg rows
const MAX_ROTATION = 270;   // degrees total per peg
const PEG_SIZE = 9;         // half-size of triangle (px)
const PILOT_BALLS = 40;     // number of visually animated balls
const BALL_RADIUS = 3;
const COLORS = {
  bg: '#000000',
  peg: '#ffffff',
  pegSelected: '#00ffff',
  pegLocked: '#ff4444',
  ball: '#ffffff',
  pilotBall: '#00ccff',
  sectionTarget: 'rgba(0,255,0,0.18)',
  sectionFill: 'rgba(255,255,255,0.07)',
  sectionBorder: '#333',
  targetBorder: '#00ff00',
  histBar: 'rgba(255,255,255,0.5)',
  histTargetBar: 'rgba(0,255,100,0.85)',
};

// ── State ────────────────────────────────────────────────────────────────────
let canvas, ctx, W, H;
let pegs = [];          // {row, col, x, y, rotation, locked}
let sections = [];      // {x, w, count, isTarget}
let targetSection = 0;
let numSections = 9;
let ballCount = 2000;
let angleStep = 15;
let wins = 0, losses = 0;
let gameState = 'idle'; // idle | running | result

// Geometry zones (computed on resize)
let funnelZone = {};
let pegZone = {};
let sectionZone = {};

// Modes
let rotateMode = 'single';   // 'single' | 'batch'
let captureMode = 'row';     // 'row' | 'col'

// Batch selection (rectangle drag)
let selRect = null;
let selStart = null;
let isDragging = false;

// Two-finger swipe
let twoFingerStart = null;

// Long-press
let longPressTimer = null;
const LONG_PRESS_MS = 600;

// Pilot ball animation
let pilotBalls = [];
let animFrame = null;
let animDone = false;

// Histogram
let histogramData = null;

// ── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');

  bindUI();
  resize();
  window.addEventListener('resize', resize);

  newRound(false);
  render();
});

function resize() {
  const wrap = document.getElementById('canvas-wrap');
  W = wrap.clientWidth;
  H = wrap.clientHeight;
  canvas.width = W;
  canvas.height = H;
  computeZones();
  buildPegs();
  buildSections();
  render();
}

function computeZones() {
  // Funnel zone: top 15%
  funnelZone = { y: 0, h: H * 0.15 };
  // Peg zone: next 52%
  pegZone = { y: H * 0.15, h: H * 0.52 };
  // Section zone: bottom 33%
  sectionZone = { y: H * 0.67, h: H * 0.33 };
}

// ── Build geometry ────────────────────────────────────────────────────────────

/**
 * Build pegs in a TRUE pyramid (triangle) layout:
 *   Row 0 (top)    → 1 peg   (apex)
 *   Row 1          → 2 pegs
 *   ...
 *   Row ROWS-1     → ROWS pegs  (base)
 *
 * Horizontal spacing is UNIFORM across all rows:
 *   All pegs are placed on a grid where the column pitch = baseWidth / ROWS.
 *   Row r has (r+1) pegs, centered, with that fixed pitch.
 *   This produces a proper equilateral-triangle lattice (like the image).
 */
function buildPegs(keepRotations = false) {
  const prevRotations = keepRotations
    ? pegs.map(p => ({ row: p.row, col: p.col, rotation: p.rotation }))
    : [];

  pegs = [];

  const marginX = W * 0.07;
  const baseWidth = W - marginX * 2;   // full width used by the bottom row
  const colPitch  = baseWidth / ROWS;   // fixed horizontal step between pegs
  const rowH      = pegZone.h / ROWS;  // vertical step between rows

  for (let r = 0; r < ROWS; r++) {
    const cols = r + 1;                          // number of pegs in this row
    const rowWidth = colPitch * r;               // total span of this row
    const startX   = W / 2 - rowWidth / 2;      // leftmost peg x (centered)
    const y = pegZone.y + rowH * (r + 0.5);     // y position of this row

    for (let c = 0; c < cols; c++) {
      const x = startX + c * colPitch;
      let rotation = 0;
      if (keepRotations) {
        const prev = prevRotations.find(p => p.row === r && p.col === c);
        if (prev) rotation = prev.rotation;
      }
      pegs.push({ row: r, col: c, x, y, rotation, locked: false });
    }
  }
}

/**
 * Build bottom sections evenly spaced.
 */
function buildSections(keepCounts = false) {
  const prevCounts = keepCounts ? sections.map(s => s.count) : [];
  sections = [];
  const marginX = W * 0.06;
  const usableW = W - marginX * 2;
  const sw = usableW / numSections;
  for (let i = 0; i < numSections; i++) {
    sections.push({
      x: marginX + i * sw,
      w: sw,
      count: keepCounts && prevCounts[i] !== undefined ? prevCounts[i] : 0,
      isTarget: i === targetSection,
    });
  }
}

// ── UI bindings ───────────────────────────────────────────────────────────────
function bindUI() {
  document.getElementById('btn-launch').addEventListener('click', launchBalls);
  document.getElementById('btn-new-round').addEventListener('click', () => newRound(true));
  document.getElementById('btn-reset-pegs').addEventListener('click', resetPegs);
  document.getElementById('btn-next').addEventListener('click', () => newRound(true));

  document.getElementById('btn-mode').addEventListener('click', () => {
    rotateMode = rotateMode === 'single' ? 'batch' : 'single';
    document.getElementById('btn-mode').textContent =
      'Режим: ' + (rotateMode === 'single' ? 'Один' : 'Пакет');
    document.getElementById('btn-mode').classList.toggle('active', rotateMode === 'batch');
  });

  document.getElementById('btn-row-col').addEventListener('click', () => {
    captureMode = captureMode === 'row' ? 'col' : 'row';
    document.getElementById('btn-row-col').textContent =
      'Захват: ' + (captureMode === 'row' ? 'Ряд' : 'Колонка');
  });

  const ballSlider = document.getElementById('ball-slider');
  ballSlider.addEventListener('input', () => {
    ballCount = +ballSlider.value;
    document.getElementById('ball-count-display').textContent = ballCount;
  });

  document.getElementById('angle-select').addEventListener('change', e => {
    angleStep = +e.target.value;
  });

  document.getElementById('sections-select').addEventListener('change', e => {
    numSections = +e.target.value;
    if (targetSection >= numSections) targetSection = 0;
    buildSections();
    newRound(false);
    render();
  });

  document.getElementById('wins').textContent = wins;
  document.getElementById('losses').textContent = losses;

  // Canvas pointer events (unified mouse + touch via PointerEvents)
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  canvas.addEventListener('pointerup', onPointerUp, { passive: false });
  canvas.addEventListener('pointercancel', onPointerUp, { passive: false });

  // Touch events for two-finger gestures
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
}

// ── Game logic ────────────────────────────────────────────────────────────────

function newRound(resetPegsFlag) {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  targetSection = Math.floor(Math.random() * numSections);
  document.getElementById('target-display').textContent = targetSection + 1;
  buildSections(false);
  histogramData = null;
  gameState = 'idle';
  pilotBalls = [];
  animDone = false;
  document.getElementById('result-overlay').classList.remove('show');
  if (resetPegsFlag) resetPegs();
  render();
}

function resetPegs() {
  pegs.forEach(p => { p.rotation = 0; p.locked = false; });
  render();
}

/**
 * Rotate a peg CCW by angleStep degrees.
 * Clamp at MAX_ROTATION; lock when reached.
 */
function rotatePeg(peg) {
  if (peg.locked) return;
  peg.rotation = Math.min(peg.rotation + angleStep, MAX_ROTATION);
  if (peg.rotation >= MAX_ROTATION) peg.locked = true;
}

// ── Physics / Distribution ────────────────────────────────────────────────────

/**
 * Compute probability distribution across sections using a transition matrix.
 *
 * Model: each peg in row r deflects a ball left or right.
 * Default (rotation=0): peg is symmetric → p(left)=0.5, p(right)=0.5.
 * CCW rotation increases angle of left face → bias toward left.
 * Bias: leftProb = 0.5 + rotation/MAX_ROTATION * 0.45  (max bias ±45%)
 *
 * The peg grid maps "slots" between pegs. Row 0 has 1 peg → 2 slots.
 * Row r has (r+1) pegs → (r+2) slots.
 * After ROWS rows we have (ROWS+1) = 13 slots, mapped to numSections.
 *
 * Returns: Float64Array of length numSections, summing to 1.
 */
function computeDistribution() {
  const finalSlots = ROWS + 1; // 13

  let incoming = new Float64Array(1);
  incoming[0] = 1.0; // 100% enters through 1 funnel opening

  for (let r = 0; r < ROWS; r++) {
    const numPegs = r + 1;
    const rowPegs = pegs.filter(p => p.row === r);
    const outProb = new Float64Array(numPegs + 1);

    for (let j = 0; j < rowPegs.length; j++) {
      const peg = rowPegs[j];
      const bias = peg ? peg.rotation / MAX_ROTATION * 0.45 : 0;
      const leftP = 0.5 + bias;   // CCW rotation → left bias increases
      const rightP = 1 - leftP;
      const p = incoming[j] || 0;
      outProb[j]     += p * leftP;
      outProb[j + 1] += p * rightP;
    }

    incoming = outProb;
  }

  // Map ROWS+1 slots → numSections
  const result = new Float64Array(numSections);
  const slotsPerSection = finalSlots / numSections;
  for (let i = 0; i < finalSlots; i++) {
    const sec = Math.min(Math.floor(i / slotsPerSection), numSections - 1);
    result[sec] += incoming[i];
  }

  // Normalize
  const sum = result.reduce((a, b) => a + b, 0);
  if (sum > 0) for (let i = 0; i < numSections; i++) result[i] /= sum;
  return result;
}

/**
 * Launch balls:
 * 1. Compute distribution instantly.
 * 2. Assign ball counts to sections.
 * 3. Animate PILOT_BALLS falling through.
 * 4. After animation ends, evaluate win/lose.
 */
function launchBalls() {
  if (gameState === 'running') return;
  gameState = 'running';
  animDone = false;

  const dist = computeDistribution();
  histogramData = dist;

  // Assign counts
  let total = 0;
  for (let i = 0; i < numSections; i++) {
    sections[i].count = Math.round(dist[i] * ballCount);
    total += sections[i].count;
  }
  // Fix rounding
  sections[targetSection].count += ballCount - total;

  // Spawn pilot balls
  pilotBalls = [];
  for (let k = 0; k < PILOT_BALLS; k++) {
    spawnPilotBall(k);
  }

  // Start animation
  let lastTime = null;
  function step(ts) {
    if (!lastTime) lastTime = ts;
    const dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;
    updatePilotBalls(dt, dist);
    render();
    if (pilotBalls.some(b => !b.done)) {
      animFrame = requestAnimationFrame(step);
    } else {
      animDone = true;
      gameState = 'result';
      render();
      evaluateResult();
    }
  }
  animFrame = requestAnimationFrame(step);
}

function spawnPilotBall(index) {
  const delay = index * 0.04;
  pilotBalls.push({
    x: W / 2 + (Math.random() - 0.5) * 8,
    y: funnelZone.y + funnelZone.h * 0.2,
    vx: (Math.random() - 0.5) * 20,
    vy: 40 + Math.random() * 20,
    delay,
    active: false,
    done: false,
    trail: [],
  });
}

function updatePilotBalls(dt, dist) {
  pilotBalls.forEach(ball => {
    if (ball.done) return;
    ball.delay -= dt;
    if (ball.delay > 0) return;
    ball.active = true;

    // Gravity
    ball.vy += 200 * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Bounce off side walls
    const marginX = W * 0.06;
    if (ball.x < marginX) { ball.x = marginX; ball.vx = Math.abs(ball.vx); }
    if (ball.x > W - marginX) { ball.x = W - marginX; ball.vx = -Math.abs(ball.vx); }

    // Check peg collisions
    for (const peg of pegs) {
      const dx = ball.x - peg.x;
      const dy = ball.y - peg.y;
      const dist2 = dx * dx + dy * dy;
      const minDist = PEG_SIZE + BALL_RADIUS + 2;
      if (dist2 < minDist * minDist) {
        const angle = Math.atan2(dy, dx);
        const pegAngleRad = (peg.rotation * Math.PI) / 180;
        const deflection = 0.3 + pegAngleRad * 0.5;
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        ball.vx = Math.cos(angle - deflection) * speed * 0.7;
        ball.vy = Math.sin(angle - deflection) * Math.abs(speed) * 0.8 + 30;
        ball.x = peg.x + Math.cos(angle) * (minDist + 1);
        ball.y = peg.y + Math.sin(angle) * (minDist + 1);
      }
    }

    // Trail
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 5) ball.trail.shift();

    if (ball.y > sectionZone.y + sectionZone.h) ball.done = true;
  });
}

function evaluateResult() {
  const counts = sections.map(s => s.count);
  const targetCount = counts[targetSection];
  const maxOther = Math.max(...counts.filter((_, i) => i !== targetSection));
  const win = targetCount > maxOther;

  if (win) wins++; else losses++;
  document.getElementById('wins').textContent = wins;
  document.getElementById('losses').textContent = losses;

  const overlay = document.getElementById('result-overlay');
  const msg = document.getElementById('result-msg');
  const sub = document.getElementById('result-sub');
  msg.textContent = win ? '🎯 ПОБЕДА!' : '💥 ПОРАЖЕНИЕ';
  msg.className = win ? 'win' : 'lose';
  sub.textContent = `Секция ${targetSection + 1}: ${counts[targetSection]} шаров | Макс другой: ${maxOther}`;
  overlay.classList.add('show');
}

// ── Peg hit detection ─────────────────────────────────────────────────────────

function pegAtPoint(x, y) {
  const hitRadius = PEG_SIZE * 2.2;
  let best = null, bestDist = Infinity;
  for (const peg of pegs) {
    const dx = x - peg.x, dy = y - peg.y;
    const d = dx * dx + dy * dy;
    if (d < hitRadius * hitRadius && d < bestDist) {
      bestDist = d;
      best = peg;
    }
  }
  return best;
}

function pegsInRect(x1, y1, x2, y2) {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  return pegs.filter(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
}

// ── Pointer events ────────────────────────────────────────────────────────────

const activePointers = new Map();

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e) {
  e.preventDefault();
  if (gameState === 'running') return;

  const pos = getCanvasPos(e);
  activePointers.set(e.pointerId, pos);

  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    resetPegs();
  }, LONG_PRESS_MS);

  if (rotateMode === 'single') {
    const peg = pegAtPoint(pos.x, pos.y);
    if (peg) rotatePeg(peg);
    render();
  } else {
    selStart = pos;
    selRect = null;
    isDragging = false;
  }
}

function onPointerMove(e) {
  e.preventDefault();
  if (!activePointers.has(e.pointerId)) return;
  if (activePointers.size > 1) return;

  const pos = getCanvasPos(e);
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

  const pos = getCanvasPos(e);
  activePointers.delete(e.pointerId);

  if (rotateMode === 'batch') {
    if (isDragging && selRect) {
      pegsInRect(selRect.x1, selRect.y1, selRect.x2, selRect.y2).forEach(rotatePeg);
    } else if (!isDragging && selStart) {
      const peg = pegAtPoint(pos.x, pos.y);
      if (peg) {
        if (captureMode === 'row') {
          pegs.filter(p => p.row === peg.row).forEach(rotatePeg);
        } else {
          pegs.filter(p => Math.abs(p.x - peg.x) < 20).forEach(rotatePeg);
        }
      }
    }
    selRect = null;
    selStart = null;
    isDragging = false;
    render();
  }
}

// ── Touch events (2-finger swipe) ─────────────────────────────────────────────

function onTouchStart(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const t1 = e.touches[0], t2 = e.touches[1];
    twoFingerStart = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }
}

function onTouchMove(e) {
  if (e.touches.length === 2 && twoFingerStart) {
    e.preventDefault();
  }
}

function onTouchEnd(e) {
  if (twoFingerStart && e.changedTouches.length >= 1) {
    const rect = canvas.getBoundingClientRect();
    const allTouches = [...e.changedTouches];
    const lastX = allTouches.reduce((s, t) => s + t.clientX, 0) / allTouches.length;
    const dx = lastX - twoFingerStart.x;

    if (Math.abs(dx) > 20) {
      const centerX = twoFingerStart.x - rect.left;
      const endX = lastX - rect.left;
      const colPegs = pegs.filter(p => {
        const minX = Math.min(centerX, endX);
        const maxX = Math.max(centerX, endX);
        return p.x >= minX - 20 && p.x <= maxX + 20;
      });
      colPegs.forEach(p => {
        if (!p.locked) {
          p.rotation = Math.min(p.rotation + angleStep / 2, MAX_ROTATION);
          if (p.rotation >= MAX_ROTATION) p.locked = true;
        }
      });
      render();
    }
    twoFingerStart = null;
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  drawFunnel();
  drawPegs();
  drawSections();
  if (animDone || gameState === 'idle') drawHistogram();
  drawPilotBalls();
  drawSelectionRect();
}

/**
 * Draw funnel zone: cluster of waiting balls + narrow spout.
 * The spout narrows toward the APEX of the pyramid (top peg).
 */
function drawFunnel() {
  const cx = W / 2;
  const fH = funnelZone.h;

  // The top peg (apex) is at W/2, so funnel tip points there
  const spoutW = 10;
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - W * 0.28, 0);
  ctx.lineTo(cx - spoutW / 2, fH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + W * 0.28, 0);
  ctx.lineTo(cx + spoutW / 2, fH);
  ctx.stroke();

  if (gameState === 'idle') {
    // Draw ball cluster as a triangular mass of dots (mirror the pyramid)
    const clusterCount = Math.min(ballCount, 600);
    ctx.fillStyle = COLORS.ball;
    const seedRng = mulberry32(42);
    for (let i = 0; i < clusterCount; i++) {
      const t  = seedRng();
      const bx = cx + (seedRng() - 0.5) * W * 0.52 * t;
      const by = fH * 0.08 + seedRng() * fH * 0.78;
      ctx.beginPath();
      ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0ff';
    ctx.font = 'bold 12px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(ballCount + ' шаров', cx, fH * 0.48);
  }
}

/**
 * Draw triangular pegs.
 * Triangle: isoceles, tip pointing up by default.
 * Rotation applied via canvas transform around peg center.
 */
function drawPegs() {
  const s = PEG_SIZE;
  for (const peg of pegs) {
    ctx.save();
    ctx.translate(peg.x, peg.y);
    ctx.rotate((peg.rotation * Math.PI) / 180);

    if (peg.locked) {
      ctx.strokeStyle = COLORS.pegLocked;
      ctx.fillStyle = 'rgba(255,68,68,0.15)';
    } else if (peg.rotation > 0) {
      ctx.strokeStyle = COLORS.pegSelected;
      ctx.fillStyle = 'rgba(0,255,255,0.08)';
    } else {
      ctx.strokeStyle = COLORS.peg;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
    }

    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0,       -s);          // apex (top)
    ctx.lineTo( s * 0.88,  s * 0.65); // bottom-right
    ctx.lineTo(-s * 0.88,  s * 0.65); // bottom-left
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Small rotation-indicator dot at apex
    if (peg.rotation > 0 && !peg.locked) {
      ctx.fillStyle = '#0ff';
      ctx.beginPath();
      ctx.arc(0, -s * 0.35, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

/**
 * Draw bottom sections with ball count histogram bars.
 */
function drawSections() {
  const zY = sectionZone.y;
  const zH = sectionZone.h;
  const maxCount = Math.max(...sections.map(s => s.count), 1);

  sections.forEach((sec, i) => {
    const x = sec.x, w = sec.w;

    ctx.fillStyle = sec.isTarget ? COLORS.sectionTarget : COLORS.sectionFill;
    ctx.fillRect(x, zY, w, zH);

    ctx.strokeStyle = sec.isTarget ? COLORS.targetBorder : COLORS.sectionBorder;
    ctx.lineWidth = sec.isTarget ? 1.5 : 0.5;
    ctx.strokeRect(x, zY, w, zH);

    if (sec.count > 0) {
      const barH = (sec.count / maxCount) * (zH - 20);
      ctx.fillStyle = sec.isTarget ? COLORS.histTargetBar : COLORS.histBar;
      ctx.fillRect(x + 2, zY + zH - barH - 10, w - 4, barH);
    }

    ctx.fillStyle = sec.isTarget ? '#0f0' : '#555';
    ctx.font = '10px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(i + 1, x + w / 2, zY + 12);

    if (sec.count > 0) {
      ctx.fillStyle = sec.isTarget ? '#0f0' : '#888';
      ctx.font = '9px Courier New';
      ctx.fillText(sec.count, x + w / 2, zY + zH - 4);
    }
  });

  // Target label above target section
  const tSec = sections[targetSection];
  if (tSec) {
    ctx.fillStyle = '#0f0';
    ctx.font = 'bold 10px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('▼ ЦЕЛЬ', tSec.x + tSec.w / 2, zY - 4);
  }
}

function drawHistogram() {
  // Bars are drawn inline in drawSections()
}

function drawPilotBalls() {
  for (const ball of pilotBalls) {
    if (!ball.active) continue;

    if (ball.trail.length > 1) {
      ctx.strokeStyle = 'rgba(0,200,255,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ball.trail[0].x, ball.trail[0].y);
      for (let i = 1; i < ball.trail.length; i++) ctx.lineTo(ball.trail[i].x, ball.trail[i].y);
      ctx.stroke();
    }

    ctx.fillStyle = COLORS.pilotBall;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSelectionRect() {
  if (!selRect) return;
  ctx.strokeStyle = 'rgba(0,255,255,0.6)';
  ctx.fillStyle = 'rgba(0,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  const x = Math.min(selRect.x1, selRect.x2);
  const y = Math.min(selRect.y1, selRect.y2);
  const w = Math.abs(selRect.x2 - selRect.x1);
  const h = Math.abs(selRect.y2 - selRect.y1);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Deterministic PRNG (Mulberry32) for stable ball cluster visual */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
