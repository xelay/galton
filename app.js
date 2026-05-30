// Triangle Quincunx - Main Game Logic
'use strict';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CFG = {
  ROWS: 6,
  SECTIONS: 7,
  TOTAL_BALLS: 3000,
  VISUAL_BALLS: 120,       // animated balls shown on screen
  BALL_RADIUS: 3.5,
  TRI_SIZE: 24,            // half-width of triangle base
  ROW_GAP_Y: 62,
  COL_GAP_X: 52,
  FALL_SPEED: 260,         // px/sec
  GRAVITY: 340,
  BG: '#0a0a0a',
  WHITE: 'rgba(255,255,255,0.92)',
  WHITE_DIM: 'rgba(255,255,255,0.18)',
  WHITE_MID: 'rgba(255,255,255,0.55)',
  ACCENT: 'rgba(255,220,80,0.9)',
  ACCENT_DIM: 'rgba(255,220,80,0.25)',
};

// ─── STATE ───────────────────────────────────────────────────────────────────
let canvas, ctx, W, H;
let pinsData = [];        // {col, row, angle, x, y}
let bins = [];            // [count per section]
let targetBin = 0;
let attempt = 1;
let phase = 'idle';       // idle | running | result
let particles = [];       // visual animated balls
let simBalls = [];        // lightweight fast-sim balls
let ballsLaunched = 0;
let ballsSettled = 0;
let binX = [];            // left edges of bins
let binW = 0;
let pinsTop = 0;          // y of top of pyramid
let pinsBot = 0;          // y of bottom edge of pyramid
let binsTop = 0;
let binsBot = 0;
let funnelX = 0;
let funnelY = 0;
let lastTime = 0;
let rafId = null;

// queued simulation distribution (computed instantly)
let distribution = [];
let launchInterval = 0;
let launchAcc = 0;

// idle ball cluster positions
let clusterBalls = [];

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);

  document.getElementById('btn-new').addEventListener('click', newRound);
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  canvas.addEventListener('pointerup', onPointerUp, { passive: false });

  buildPins();
  buildBins();
  buildCluster();
  pickTarget();

  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);
}

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  buildLayout();
}

function buildLayout() {
  // Vertical layout: UI(40) | cluster(80) | pyramid | gap(20) | bins(H/3) | bottom
  const uiH = 52;
  funnelX = W / 2;
  funnelY = uiH + 70;

  const pyramidH = (CFG.ROWS - 1) * CFG.ROW_GAP_Y + CFG.TRI_SIZE * 2.4;
  pinsTop = funnelY + 10;
  pinsBot = pinsTop + pyramidH;

  binsTop = pinsBot + 28;
  binsBot = H - 30;

  binW = W / CFG.SECTIONS;
  binX = [];
  for (let i = 0; i <= CFG.SECTIONS; i++) binX.push(i * binW);
}

function buildPins() {
  pinsData = [];
  for (let row = 0; row < CFG.ROWS; row++) {
    for (let col = 0; col <= row; col++) {
      pinsData.push({ row, col, angle: 0 });
    }
  }
  layoutPins();
}

function layoutPins() {
  buildLayout();
  for (const p of pinsData) {
    const { row, col } = p;
    const cx = W / 2;
    const x = cx + (col - row / 2) * CFG.COL_GAP_X;
    const y = pinsTop + row * CFG.ROW_GAP_Y + CFG.TRI_SIZE * 1.2;
    p.x = x;
    p.y = y;
  }
}

function buildBins() {
  bins = new Array(CFG.SECTIONS).fill(0);
}

function buildCluster() {
  clusterBalls = [];
  // small cloud of ~18 balls above funnel
  for (let i = 0; i < 18; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 18;
    clusterBalls.push({
      x: W / 2 + Math.cos(angle) * r,
      y: funnelY - 30 + Math.sin(angle) * 10,
    });
  }
}

function pickTarget() {
  targetBin = Math.floor(Math.random() * CFG.SECTIONS);
}

// ─── SIMULATION ───────────────────────────────────────────────────────────────
// Fast probabilistic simulation using transition matrix approach
function computeDistribution() {
  // Each pin row splits the ball left or right with probability based on pin angle
  // angle = 0 → 50/50; angle > 0 → more right; angle < 0 → more left
  // We track probability mass across (ROWS+1) slots
  let prob = new Float64Array(CFG.ROWS + 1).fill(0);
  // Enter at slot 0..ROWS-1 centered: start at middle
  // For 6 rows, entry slot range is 0..6, center at row/2
  // We simulate entering at the center column for row 0

  // Probability distribution across "slots" (there are row+1 slots per row)
  // Start: single ball at center top slot (for row 0, slot 0)
  // After row 0: 2 slots; after row 1: 3 slots; ... after row 5: 7 slots = SECTIONS
  let dist = [1.0]; // distribution over current slots
  
  for (let row = 0; row < CFG.ROWS; row++) {
    const next = new Array(dist.length + 1).fill(0);
    for (let s = 0; s < dist.length; s++) {
      if (dist[s] === 0) continue;
      // Find pin at this row/slot position
      const pinCol = s; // pin column in this row
      const pin = pinsData.find(p => p.row === row && p.col === (s < row + 1 ? s : row));
      const angle = pin ? pin.angle : 0;
      // Convert angle to probability: clamp to ±PI, map to 0..1
      // neutral=0 → pRight=0.5; positive angle → more right
      const raw = 0.5 + Math.sin(angle) * 0.42;
      const pRight = Math.max(0.05, Math.min(0.95, raw));
      const pLeft = 1 - pRight;
      next[s] += dist[s] * pLeft;
      next[s + 1] += dist[s] * pRight;
    }
    dist = next;
  }

  // dist now has CFG.ROWS+1 = 7 slots = CFG.SECTIONS
  return dist;
}

// ─── ROUND CONTROL ───────────────────────────────────────────────────────────
function newRound() {
  attempt++;
  document.getElementById('attempt-label').textContent = `attempt: ${attempt}`;
  bins = new Array(CFG.SECTIONS).fill(0);
  particles = [];
  simBalls = [];
  ballsLaunched = 0;
  ballsSettled = 0;
  distribution = [];
  phase = 'idle';
  // Reset pin angles
  for (const p of pinsData) p.angle = 0;
  buildCluster();
  pickTarget();
}

function startRun() {
  if (phase === 'running') return;
  phase = 'running';
  bins = new Array(CFG.SECTIONS).fill(0);
  particles = [];
  simBalls = [];
  ballsLaunched = 0;
  ballsSettled = 0;

  // Compute full distribution instantly
  const dist = computeDistribution();
  // Scale to total balls
  distribution = dist.map(p => Math.round(p * CFG.TOTAL_BALLS));
  // Fix rounding error
  const sum = distribution.reduce((a, b) => a + b, 0);
  distribution[0] += CFG.TOTAL_BALLS - sum;

  // Launch rate: total visual balls spread over ~4 seconds
  launchInterval = 4000 / CFG.VISUAL_BALLS;
  launchAcc = 0;
}

function checkResult() {
  if (ballsSettled < CFG.VISUAL_BALLS) return;
  // final bins = distribution
  bins = [...distribution];
  phase = 'result';
}

// ─── PARTICLES ───────────────────────────────────────────────────────────────
function spawnBall() {
  // Pick which bin this ball goes to, weighted by distribution
  // Visual ball just follows a path through the pins
  const targetSec = weightedRandom(distribution);
  const targetX = binX[targetSec] + binW * 0.5;

  particles.push({
    x: funnelX + (Math.random() - 0.5) * 6,
    y: funnelY,
    vx: (Math.random() - 0.5) * 30,
    vy: 10,
    targetSec,
    targetX,
    r: CFG.BALL_RADIUS,
    pinned: false,
    settled: false,
    alpha: 1,
    trail: [],
  });
  ballsLaunched++;
}

function weightedRandom(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function updateParticles(dt) {
  for (const p of particles) {
    if (p.settled) continue;

    // Check pin collisions
    let hitPin = false;
    for (const pin of pinsData) {
      const dx = p.x - pin.x;
      const dy = p.y - pin.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < (CFG.TRI_SIZE * 0.8) ** 2 && p.y < pin.y + CFG.TRI_SIZE) {
        // Deflect based on pin angle and position relative to pin
        const side = (p.x > pin.x) ? 1 : -1;
        const angleBonus = Math.sin(pin.angle) * 1.5;
        p.vx = (side + angleBonus) * (80 + Math.random() * 40);
        p.vy = Math.abs(p.vy) * 0.3 + 20;
        p.y = pin.y + CFG.TRI_SIZE + 4;
        hitPin = true;
        break;
      }
    }

    if (!hitPin) {
      p.vy += CFG.GRAVITY * dt;
      // Gentle guide toward target X below pins
      if (p.y > pinsBot) {
        const dx = p.targetX - p.x;
        p.vx += dx * 2.5 * dt;
        p.vx *= 0.92;
      }
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Settle at bin bottom
    if (p.y > binsBot - 8) {
      p.y = binsBot - 8;
      p.vy = 0;
      p.vx = 0;
      p.settled = true;
      ballsSettled++;
    }

    // Clamp to screen
    p.x = Math.max(p.r, Math.min(W - p.r, p.x));
  }
}

// ─── INTERACTION ─────────────────────────────────────────────────────────────
let dragPin = null;
let dragStartX = 0;
let dragStartAngle = 0;
let pointerDown = false;
let pointerMoved = false;
let pointerStartX = 0;
let pointerStartY = 0;
let lastPointerX = 0;

function findPin(x, y) {
  let best = null;
  let bestD = 36 * 36; // ~36px touch radius
  for (const p of pinsData) {
    const dx = x - p.x, dy = y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function onPointerDown(e) {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left);
  const y = (e.clientY - rect.top);
  pointerDown = true;
  pointerMoved = false;
  pointerStartX = x;
  pointerStartY = y;
  lastPointerX = x;

  // Check if tapping cluster area (launch)
  if (phase === 'idle') {
    const cy = funnelY - 25;
    const dist = Math.sqrt((x - funnelX) ** 2 + (y - cy) ** 2);
    if (dist < 50) {
      startRun();
      return;
    }
  }

  if (phase !== 'running') {
    dragPin = findPin(x, y);
    if (dragPin) {
      dragStartX = x;
      dragStartAngle = dragPin.angle;
    }
  }
}

function onPointerMove(e) {
  e.preventDefault();
  if (!pointerDown) return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left);
  const y = (e.clientY - rect.top);
  const dx = x - pointerStartX;
  const dy = y - pointerStartY;
  if (Math.sqrt(dx * dx + dy * dy) > 4) pointerMoved = true;

  if (dragPin && phase !== 'running') {
    const delta = (x - dragStartX) / 60; // pixels → radians
    dragPin.angle = dragStartAngle + delta;
    // Normalize to -PI..PI
    dragPin.angle = ((dragPin.angle + Math.PI) % (Math.PI * 2)) - Math.PI;
  }
  lastPointerX = x;
}

function onPointerUp(e) {
  e.preventDefault();
  if (!pointerMoved && dragPin && phase !== 'running') {
    // Single tap: rotate 90 degrees clockwise
    dragPin.angle = (dragPin.angle + Math.PI / 2);
    if (dragPin.angle > Math.PI) dragPin.angle -= Math.PI * 2;
  }
  pointerDown = false;
  dragPin = null;
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;

  update(dt);
  render();

  rafId = requestAnimationFrame(loop);
}

function update(dt) {
  if (phase === 'running') {
    // Launch visual balls
    if (ballsLaunched < CFG.VISUAL_BALLS) {
      launchAcc += dt * 1000;
      while (launchAcc >= launchInterval && ballsLaunched < CFG.VISUAL_BALLS) {
        spawnBall();
        launchAcc -= launchInterval;
      }
    }
    updateParticles(dt);
    checkResult();
  }
}

function render() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = CFG.BG;
  ctx.fillRect(0, 0, W, H);

  drawBins();
  drawPins();

  if (phase === 'idle') {
    drawCluster();
  } else {
    drawParticles();
  }

  if (phase === 'result') {
    drawResult();
  }
}

function drawPins() {
  for (const pin of pinsData) {
    ctx.save();
    ctx.translate(pin.x, pin.y);
    ctx.rotate(pin.angle);
    drawTriangle(ctx, 0, 0, CFG.TRI_SIZE, pin === dragPin);
    ctx.restore();
  }
}

function drawTriangle(ctx, cx, cy, size, highlighted) {
  // Equilateral triangle pointing up
  const h = size * Math.sqrt(3);
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.67);        // apex
  ctx.lineTo(cx - size, cy + h * 0.33); // bottom-left
  ctx.lineTo(cx + size, cy + h * 0.33); // bottom-right
  ctx.closePath();
  ctx.fillStyle = highlighted ? 'rgba(255,255,255,0.95)' : CFG.WHITE;
  ctx.fill();
}

function drawBins() {
  const top = binsTop;
  const bot = binsBot;

  // Vertical divider lines
  ctx.strokeStyle = CFG.WHITE_DIM;
  ctx.lineWidth = 1;
  for (let i = 0; i <= CFG.SECTIONS; i++) {
    const x = binX[i];
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
    ctx.stroke();
  }

  // Target highlight — very subtle
  const tx = binX[targetBin];
  const tw = binW;
  ctx.fillStyle = CFG.ACCENT_DIM;
  ctx.fillRect(tx + 1, top, tw - 2, bot - top);

  // Target star/marker at bottom
  const starX = tx + tw * 0.5;
  const starY = bot - 14;
  drawStar(ctx, starX, starY, 5, 6, 3, CFG.ACCENT);

  // Draw fill bars if result
  if (phase === 'result' && distribution.length > 0) {
    const maxBalls = Math.max(...distribution);
    for (let i = 0; i < CFG.SECTIONS; i++) {
      const h = ((distribution[i] / maxBalls) * (bot - top - 10));
      ctx.fillStyle = i === targetBin ? CFG.ACCENT_DIM : CFG.WHITE_DIM;
      ctx.fillRect(binX[i] + 1, bot - h, binW - 2, h);
    }
    // Small count text
    ctx.font = '10px Courier New';
    ctx.textAlign = 'center';
    for (let i = 0; i < CFG.SECTIONS; i++) {
      ctx.fillStyle = i === targetBin ? CFG.ACCENT : CFG.WHITE_MID;
      ctx.fillText(distribution[i], binX[i] + binW * 0.5, bot - 4);
    }
  }

  // Show settled visual balls count (live)
  if (phase === 'running' && CFG.SECTIONS > 0) {
    const bins_live = new Array(CFG.SECTIONS).fill(0);
    for (const p of particles) {
      if (p.settled) {
        bins_live[p.targetSec] = (bins_live[p.targetSec] || 0) + 1;
      }
    }
    const maxL = Math.max(...bins_live, 1);
    for (let i = 0; i < CFG.SECTIONS; i++) {
      if (bins_live[i] > 0) {
        const h = (bins_live[i] / maxL) * 30;
        ctx.fillStyle = i === targetBin ? 'rgba(255,220,80,0.3)' : 'rgba(255,255,255,0.1)';
        ctx.fillRect(binX[i] + 1, bot - h, binW - 2, h);
      }
    }
  }
}

function drawStar(ctx, cx, cy, points, outer, inner, color) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawCluster() {
  // Small cloud of white balls + pulse hint
  for (const b of clusterBalls) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, CFG.BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = CFG.WHITE;
    ctx.fill();
  }
  // Tap hint: subtle pulsing ring
  const t = performance.now() / 1000;
  const pulse = 0.4 + 0.3 * Math.sin(t * 2);
  ctx.beginPath();
  ctx.arc(funnelX, funnelY - 25, 32, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,255,255,${pulse * 0.15})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawParticles() {
  for (const p of particles) {
    if (p.settled) continue;
    const alpha = p.alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha * 0.85})`;
    ctx.fill();
  }
}

function drawResult() {
  const won = isWin();
  // Result text
  const msg = won ? 'win' : 'miss';
  const col = won ? CFG.ACCENT : CFG.WHITE_MID;
  ctx.font = '13px Courier New';
  ctx.textAlign = 'center';
  ctx.fillStyle = col;
  ctx.fillText(msg, W / 2, binsBot + 22);
}

function isWin() {
  if (!distribution.length) return false;
  const targetCount = distribution[targetBin];
  return distribution.every((v, i) => i === targetBin || v < targetCount);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

// Expose for test hooks
window.render_game_to_text = () => JSON.stringify({
  phase,
  attempt,
  targetBin,
  bins: distribution,
  win: isWin(),
  pins: pinsData.map(p => ({ row: p.row, col: p.col, angle: +p.angle.toFixed(2) })),
});

window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i++) update(1 / 60);
  render();
};
