/**
 * Triangle Quincunx — PWA Game
 *
 * GAME RULES:
 *   • Each round has a target section. Player adjusts pegs to direct balls there.
 *   • On LOSS: same target kept, same pegs kept — player tries again (attempt++).
 *     Balls fly back up automatically, overlay auto-dismissed → back to idle.
 *   • On WIN: new round starts (new target). Score = attempts used (lower is better).
 *   • "New round" button: force-starts a new round and resets pegs.
 *   • Cup fill visualised in REAL-TIME as balls arrive.
 *   • Balls animate back up to funnel after every launch.
 */

'use strict';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ── Constants ────────────────────────────────────────────────────────────────
const ROWS         = 13;   // 1+2+…+13 = 91 pegs
const MAX_ROT      = 270;
const PEG_S        = 8;
const PILOT_N      = 80;
const BALL_R       = 3;
const GRAVITY      = 280;
const RESTITUTION  = 0.60;
const WALL_COLOR   = '#444';
const BORDER_COLOR = '#333';

// ── State ────────────────────────────────────────────────────────────────────
let canvas, ctx, W, H;
let pegs      = [];
let sections  = [];
let targetSection = 0;
let numSections   = 9;
let ballCount     = 2000;
let angleStep     = 15;

// Scoring
let totalWins    = 0;
let totalLosses  = 0;   // total loss-attempts across all rounds
let roundAttempts = 0;  // attempts in the current round (increments on each launch)
let bestScore     = Infinity; // best (lowest) attempts-to-win ever

let gameState = 'idle'; // idle | running | returning | result
let lastWin   = false;

let fZ = {}, pZ = {}, sZ = {};
let border = {};

let rotateMode  = 'single';
let captureMode = 'row';

let selRect = null, selStart = null, isDragging = false;
let twoFingerStart = null;
let longPressTimer = null;
const LONG_MS = 600;

let pilotBalls   = [];
let animFrame    = null;
let animDone     = false;
let liveCaptures = [];
let fillAnim     = [];
let pegFaces     = [];

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('canvas');
  ctx    = canvas.getContext('2d');
  bindUI();
  resize();
  window.addEventListener('resize', resize);
  newRound(true);
});

function resize() {
  const wrap = document.getElementById('canvas-wrap');
  W = wrap.clientWidth;
  H = wrap.clientHeight;
  canvas.width  = W;
  canvas.height = H;
  computeZones();
  buildPegs(true);
  buildSections();
  render();
}

function computeZones() {
  fZ = { y: 6,        h: H * 0.13 };
  pZ = { y: H * 0.13, h: H * 0.52 };
  sZ = { y: H * 0.65, h: H * 0.31 };
  const mx = W * 0.05;
  border = { x: mx, y: fZ.y + fZ.h, w: W - mx * 2, h: sZ.y + sZ.h - (fZ.y + fZ.h) };
}

// ── Geometry ──────────────────────────────────────────────────────────────────
function buildPegs(keepRotations = false) {
  const prev = keepRotations
    ? pegs.map(p => ({ r: p.row, c: p.col, rot: p.rotation, lk: p.locked }))
    : [];
  pegs = [];
  const baseW = border.w - 4, colPitch = baseW / ROWS, rowH = pZ.h / ROWS, bx = border.x + 2;
  for (let r = 0; r < ROWS; r++) {
    const startX = bx + (baseW - colPitch * r) / 2;
    const y      = pZ.y + rowH * (r + 0.5);
    for (let c = 0; c <= r; c++) {
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
  const lv = [{ x: 0, y: -s }, { x: s*0.88, y: s*0.65 }, { x: -s*0.88, y: s*0.65 }];
  pegFaces = pegs.map(peg => {
    const rad = peg.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const v = lv.map(({ x, y }) => ({ x: peg.x + x*cos - y*sin, y: peg.y + x*sin + y*cos }));
    return [0,1,2].map(i => {
      const a = v[i], b = v[(i+1)%3], ex = b.x-a.x, ey = b.y-a.y, len = Math.hypot(ex,ey);
      let nx = -ey/len, ny = ex/len;
      const cx=(v[0].x+v[1].x+v[2].x)/3, cy=(v[0].y+v[1].y+v[2].y)/3;
      if (nx*((a.x+b.x)/2-cx)+ny*((a.y+b.y)/2-cy)<0) { nx=-nx; ny=-ny; }
      return { ax:a.x, ay:a.y, bx:b.x, by:b.y, nx, ny };
    });
  });
}

function buildSections() {
  sections = [];
  const sw = border.w / numSections;
  for (let i = 0; i < numSections; i++)
    sections.push({ x: border.x + i*sw, w: sw, count: 0, isTarget: i === targetSection });
  liveCaptures = new Array(numSections).fill(0);
  fillAnim     = new Array(numSections).fill(0);
}

// ── UI ────────────────────────────────────────────────────────────────────────
function bindUI() {
  document.getElementById('btn-launch').addEventListener('click', launchBalls);

  // Force new round: new target + reset pegs
  document.getElementById('btn-new-round').addEventListener('click', () => newRound(true));
  document.getElementById('btn-reset-pegs').addEventListener('click', resetPegs);

  // On WIN overlay: "Next" → new round, keep pegs
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

function updateScoreDisplay() {
  document.getElementById('wins').textContent   = totalWins;
  document.getElementById('losses').textContent = totalLosses;
  // Show current round attempt counter if element exists
  const el = document.getElementById('attempt-display');
  if (el) el.textContent = roundAttempts;
  const bl = document.getElementById('best-display');
  if (bl) bl.textContent = isFinite(bestScore) ? bestScore : '—';
}

// ── Game logic ────────────────────────────────────────────────────────────────

/**
 * newRound: pick a new random target, optionally reset pegs.
 * Called on: initial load, win (keep pegs), btn-new-round (reset pegs).
 */
function newRound(resetPegsFlag) {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  targetSection  = Math.floor(Math.random() * numSections);
  roundAttempts  = 0;
  document.getElementById('target-display').textContent = targetSection + 1;
  buildSections();
  gameState  = 'idle';
  pilotBalls = [];
  animDone   = false;
  lastWin    = false;
  document.getElementById('result-overlay').classList.remove('show');
  if (resetPegsFlag) resetPegs();
  updateScoreDisplay();
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
  let inc = new Float64Array([1.0]);
  for (let r = 0; r < ROWS; r++) {
    const rp = pegs.filter(p => p.row === r), out = new Float64Array(rp.length + 1);
    rp.forEach((peg, j) => {
      const lp = 0.5 + (peg.rotation / MAX_ROT) * 0.45, p = inc[j] || 0;
      out[j] += p * lp; out[j+1] += p * (1 - lp);
    });
    inc = out;
  }
  const total = ROWS + 1, res = new Float64Array(numSections);
  for (let i = 0; i < total; i++) res[Math.min(Math.floor(i / (total / numSections)), numSections-1)] += inc[i];
  const sum = res.reduce((a, b) => a + b, 0);
  if (sum > 0) res.forEach((_, i) => res[i] /= sum);
  return res;
}

// ── Launch ────────────────────────────────────────────────────────────────────
function launchBalls() {
  if (gameState === 'running' || gameState === 'returning') return;

  roundAttempts++;
  gameState    = 'running';
  animDone     = false;
  liveCaptures = new Array(numSections).fill(0);
  fillAnim     = new Array(numSections).fill(0);
  updateScoreDisplay();

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
      evaluateResult();
      startReturn();
    }
  }
  animFrame = requestAnimationFrame(step);
}

function spawnBall(k) {
  pilotBalls.push({
    x: W/2 + (Math.random()-0.5)*8, y: fZ.y + fZ.h*0.2,
    vx: (Math.random()-0.5)*25, vy: 15 + Math.random()*25,
    delay: k*0.045, active: false, done: false, returning: false, trail: [],
  });
}

function smoothFill(dt) {
  sections.forEach((_, i) => {
    const t = liveCaptures[i] / PILOT_N;
    if (fillAnim[i] < t) fillAnim[i] = Math.min(fillAnim[i] + 2.5*dt, t);
  });
}

// ── Return animation ──────────────────────────────────────────────────────────
function startReturn() {
  gameState = 'returning';
  animDone  = true;

  pilotBalls.forEach(b => {
    b.returning = true; b.done = false; b.active = true; b.trail = [];
    b.vx = (Math.random()-0.5)*60;
    b.vy = -(180 + Math.random()*120);
  });

  const targetY = fZ.y + fZ.h * 0.35;
  let lastTs = null;

  function step(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.04);
    lastTs = ts;
    pilotBalls.forEach(b => {
      if (b.done) return;
      b.vy += 55*dt; b.x += b.vx*dt; b.y += b.vy*dt;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 5) b.trail.shift();
      if (b.y <= targetY) b.done = true;
    });
    render();
    if (pilotBalls.some(b => !b.done)) {
      animFrame = requestAnimationFrame(step);
    } else {
      pilotBalls = [];
      if (lastWin) {
        // WIN: show overlay, wait for player to click "Next round"
        gameState = 'result';
      } else {
        // LOSS: auto-dismiss, return to idle—player adjusts pegs and retries
        gameState = 'idle';
        fillAnim  = new Array(numSections).fill(0);
        document.getElementById('result-overlay').classList.remove('show');
      }
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

    ball.vy += GRAVITY*dt; ball.x += ball.vx*dt; ball.y += ball.vy*dt;

    if (ball.x - BALL_R < border.x)            { ball.x = border.x + BALL_R;            ball.vx =  Math.abs(ball.vx)*RESTITUTION; }
    if (ball.x + BALL_R > border.x + border.w) { ball.x = border.x + border.w - BALL_R; ball.vx = -Math.abs(ball.vx)*RESTITUTION; }

    if (ball.y >= pZ.y - PEG_S && ball.y <= pZ.y + pZ.h + PEG_S) {
      for (let pi = 0; pi < pegs.length; pi++) {
        if (Math.abs(ball.x - pegs[pi].x) > PEG_S + BALL_R + 2) continue;
        if (Math.abs(ball.y - pegs[pi].y) > PEG_S + BALL_R + 2) continue;
        for (const face of pegFaces[pi]) { if (reflectOffSegment(ball, face)) break; }
      }
    }

    if (ball.y >= sZ.y) {
      const sw  = border.w / numSections;
      const idx = Math.max(0, Math.min(numSections-1, Math.floor((ball.x - border.x) / sw)));
      const cx  = border.x + idx * sw;
      if (idx > 0             && ball.x - BALL_R < cx + 1.5)      { ball.x = cx + 1.5 + BALL_R;      ball.vx =  Math.abs(ball.vx)*RESTITUTION; }
      if (idx < numSections-1 && ball.x + BALL_R > cx + sw - 1.5) { ball.x = cx + sw - 1.5 - BALL_R; ball.vx = -Math.abs(ball.vx)*RESTITUTION; }
      if (ball.y + BALL_R > sZ.y + sZ.h - 4) { ball.done = true; liveCaptures[idx]++; }
    }

    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 6) ball.trail.shift();
    if (ball.y > H + 20) ball.done = true;
  });
}

function reflectOffSegment(ball, face) {
  const { ax, ay, bx, by, nx, ny } = face;
  const dist = pointSegDist(ball.x, ball.y, ax, ay, bx, by);
  if (dist > BALL_R + 1) return false;
  const vDotN = ball.vx*nx + ball.vy*ny;
  if (vDotN >= 0) return false;
  ball.vx = (ball.vx - 2*vDotN*nx)*RESTITUTION;
  ball.vy = (ball.vy - 2*vDotN*ny)*RESTITUTION;
  ball.x += nx*(BALL_R + 1.5 - dist);
  ball.y += ny*(BALL_R + 1.5 - dist);
  return true;
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx-ax, dy = by-ay, lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return Math.hypot(px-ax, py-ay);
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / lenSq));
  return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
}

function evaluateResult() {
  const counts   = sections.map(s => s.count);
  const tCount   = counts[targetSection];
  const maxOther = Math.max(...counts.filter((_, i) => i !== targetSection));
  lastWin = tCount > maxOther;

  if (lastWin) {
    totalWins++;
    if (roundAttempts < bestScore) bestScore = roundAttempts;
  } else {
    totalLosses++;
  }
  updateScoreDisplay();

  const msg = document.getElementById('result-msg');
  const sub = document.getElementById('result-sub');

  if (lastWin) {
    msg.textContent = '🎯 ПОБЕДА!';
    msg.className   = 'win';
    sub.textContent = `Попыток: ${roundAttempts} | Секция ${targetSection+1}: ${tCount} | Макс др.: ${maxOther}`;
  } else {
    msg.textContent = `💥 Попытка ${roundAttempts}`;
    msg.className   = 'lose';
    sub.textContent = `Цель — секция ${targetSection+1} | Попало: ${tCount} | Надо: ${maxOther+1}`;
  }

  // Only show overlay on WIN (loss auto-dismisses after return animation)
  if (lastWin) {
    document.getElementById('btn-next').textContent = 'Следующий раунд';
    document.getElementById('result-overlay').classList.add('show');
  } else {
    // Show briefly during return, then auto-dismiss in startReturn()
    document.getElementById('result-overlay').classList.add('show');
  }
}

// ── Hit detection ─────────────────────────────────────────────────────────────
function pegAtPoint(x, y) {
  const hr = PEG_S*2.5; let best=null, bd=Infinity;
  pegs.forEach(p => { const d=(x-p.x)**2+(y-p.y)**2; if (d<hr*hr&&d<bd){bd=d;best=p;} });
  return best;
}
function pegsInRect(x1,y1,x2,y2) {
  const [mnX,mxX]=[Math.min(x1,x2),Math.max(x1,x2)],[mnY,mxY]=[Math.min(y1,y2),Math.max(y1,y2)];
  return pegs.filter(p=>p.x>=mnX&&p.x<=mxX&&p.y>=mnY&&p.y<=mxY);
}

// ── Pointer events ────────────────────────────────────────────────────────────
const activePointers = new Map();
function canvasPos(e) { const r=canvas.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; }

function onPointerDown(e) {
  e.preventDefault();
  if (gameState==='running'||gameState==='returning') return;
  const pos=canvasPos(e);
  activePointers.set(e.pointerId,pos);
  longPressTimer=setTimeout(()=>{longPressTimer=null;resetPegs();},LONG_MS);
  if (rotateMode==='single') {
    const p=pegAtPoint(pos.x,pos.y); if (p) rotatePeg(p); render();
  } else { selStart=pos; selRect=null; isDragging=false; }
}
function onPointerMove(e) {
  e.preventDefault();
  if (!activePointers.has(e.pointerId)||activePointers.size>1) return;
  const pos=canvasPos(e); activePointers.set(e.pointerId,pos);
  if (longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;}
  if (rotateMode==='batch'&&selStart){isDragging=true;selRect={x1:selStart.x,y1:selStart.y,x2:pos.x,y2:pos.y};render();}
}
function onPointerUp(e) {
  e.preventDefault();
  if (longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;}
  const pos=canvasPos(e); activePointers.delete(e.pointerId);
  if (rotateMode==='batch') {
    if (isDragging&&selRect) {
      pegsInRect(selRect.x1,selRect.y1,selRect.x2,selRect.y2).forEach(rotatePeg);
    } else if (!isDragging&&selStart) {
      const p=pegAtPoint(pos.x,pos.y);
      if (p) {
        if (captureMode==='row') pegs.filter(q=>q.row===p.row).forEach(rotatePeg);
        else pegs.filter(q=>Math.abs(q.x-p.x)<22).forEach(rotatePeg);
      }
    }
    selRect=null;selStart=null;isDragging=false;render();
  }
}
function onTouchStart(e) { if (e.touches.length===2){e.preventDefault();twoFingerStart={x:(e.touches[0].clientX+e.touches[1].clientX)/2};} }
function onTouchMove(e) { if (e.touches.length===2&&twoFingerStart) e.preventDefault(); }
function onTouchEnd(e) {
  if (!twoFingerStart||!e.changedTouches.length) return;
  const lastX=[...e.changedTouches].reduce((s,t)=>s+t.clientX,0)/e.changedTouches.length;
  if (Math.abs(lastX-twoFingerStart.x)>20) {
    const rect=canvas.getBoundingClientRect(),cx=twoFingerStart.x-rect.left,ex=lastX-rect.left;
    pegs.filter(p=>p.x>=Math.min(cx,ex)-20&&p.x<=Math.max(cx,ex)+20)
        .forEach(p=>{if(!p.locked){p.rotation=Math.min(p.rotation+angleStep/2,MAX_ROT);if(p.rotation>=MAX_ROT)p.locked=true;}});
    rebuildPegFaces();render();
  }
  twoFingerStart=null;
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0,0,W,H); ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  drawBorder(); drawFunnel(); drawPegs(); drawCups(); drawPilotBalls(); drawSelectionRect();
  drawAttemptBadge();
}

function drawBorder() {
  ctx.strokeStyle=BORDER_COLOR; ctx.lineWidth=1.5;
  ctx.strokeRect(border.x,border.y,border.w,border.h);
}

function drawFunnel() {
  const cx=W/2, fy=fZ.y, fh=fZ.h;
  ctx.strokeStyle='#333'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(cx-border.w*0.47,fy); ctx.lineTo(cx-5,fy+fh); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+border.w*0.47,fy); ctx.lineTo(cx+5,fy+fh); ctx.stroke();
  if (gameState==='idle') {
    const rng=mulberry32(42), n=Math.min(ballCount,800);
    ctx.fillStyle='#ccc';
    for (let i=0;i<n;i++) {
      const t=rng();
      ctx.beginPath(); ctx.arc(cx+(rng()-0.5)*border.w*0.88*t, fy+4+rng()*(fh-8), 1.3, 0, Math.PI*2); ctx.fill();
    }
    ctx.fillStyle='#0ff'; ctx.font='bold 12px Courier New'; ctx.textAlign='center';
    ctx.fillText(ballCount+' шаров', cx, fy+fh*0.5);
  }
}

function drawPegs() {
  const s=PEG_S;
  pegs.forEach(peg => {
    ctx.save(); ctx.translate(peg.x,peg.y); ctx.rotate(peg.rotation*Math.PI/180);
    if (peg.locked)        {ctx.strokeStyle='#f44';ctx.fillStyle='rgba(255,68,68,0.10)';}
    else if (peg.rotation) {ctx.strokeStyle='#0ff';ctx.fillStyle='rgba(0,255,255,0.06)';}
    else                   {ctx.strokeStyle='#aaa';ctx.fillStyle='rgba(255,255,255,0.03)';}
    ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,-s); ctx.lineTo(s*0.88,s*0.65); ctx.lineTo(-s*0.88,s*0.65); ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (peg.rotation>0&&!peg.locked) { ctx.fillStyle='#0ff'; ctx.beginPath(); ctx.arc(0,-s*0.35,1.4,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
  });
}

function drawCups() {
  const zY=sZ.y, zH=sZ.h, sw=border.w/numSections;
  const maxFill=Math.max(...fillAnim);
  sections.forEach((sec,i) => {
    const x=sec.x, w=sec.w, isTarget=i===targetSection, isLeading=fillAnim[i]===maxFill&&maxFill>0;
    ctx.fillStyle=isTarget?'rgba(0,255,0,0.03)':'rgba(255,255,255,0.015)';
    ctx.fillRect(x+1,zY,w-2,zH-1);
    const fillH=fillAnim[i]*(zH-2);
    if (fillH>0.5) {
      const grad=ctx.createLinearGradient(x,zY+zH-fillH,x,zY+zH);
      if (isTarget)       {grad.addColorStop(0,'rgba(0,255,80,0.80)');  grad.addColorStop(1,'rgba(0,150,40,0.55)');}
      else if (isLeading) {grad.addColorStop(0,'rgba(255,200,0,0.75)'); grad.addColorStop(1,'rgba(180,100,0,0.50)');}
      else                {grad.addColorStop(0,'rgba(100,180,255,0.55)');grad.addColorStop(1,'rgba(40,80,180,0.38)');}
      ctx.fillStyle=grad; ctx.fillRect(x+2,zY+zH-fillH-1,w-4,fillH);
      ctx.strokeStyle=isTarget?'rgba(120,255,140,0.9)':isLeading?'rgba(255,220,80,0.9)':'rgba(160,210,255,0.6)';
      ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x+2,zY+zH-fillH-1); ctx.lineTo(x+w-2,zY+zH-fillH-1); ctx.stroke();
    }
    ctx.strokeStyle=isTarget?'#00cc44':WALL_COLOR; ctx.lineWidth=isTarget?1.5:0.8;
    if (i>0)             {ctx.beginPath();ctx.moveTo(x,zY);ctx.lineTo(x,zY+zH);ctx.stroke();}
    if (i<numSections-1) {ctx.beginPath();ctx.moveTo(x+w,zY);ctx.lineTo(x+w,zY+zH);ctx.stroke();}
    ctx.beginPath(); ctx.moveTo(x,zY+zH); ctx.lineTo(x+w,zY+zH); ctx.stroke();
    ctx.fillStyle=isTarget?'#0f0':'#555'; ctx.font='10px Courier New'; ctx.textAlign='center';
    ctx.fillText(i+1,x+w/2,zY+12);
    if (animDone&&sec.count>0) { ctx.fillStyle=isTarget?'#0f0':'#888'; ctx.font='9px Courier New'; ctx.fillText(sec.count,x+w/2,zY+zH-4); }
  });
  const tSec=sections[targetSection];
  if (tSec) { ctx.fillStyle='#0f0'; ctx.font='bold 10px Courier New'; ctx.textAlign='center'; ctx.fillText('▼ ЦЕЛЬ',tSec.x+tSec.w/2,zY-4); }
}

/** Draw attempt counter badge in top-right of peg zone */
function drawAttemptBadge() {
  if (roundAttempts === 0) return;
  const x = border.x + border.w - 4, y = pZ.y + 14;
  ctx.fillStyle = roundAttempts <= 1 ? '#0f0' : roundAttempts <= 3 ? '#ff0' : '#f44';
  ctx.font = 'bold 13px Courier New'; ctx.textAlign = 'right';
  ctx.fillText(`попытка ${roundAttempts}`, x, y);
}

function drawPilotBalls() {
  pilotBalls.forEach(ball => {
    if (!ball.active) return;
    if (ball.trail.length>1) {
      ctx.strokeStyle=ball.returning?'rgba(255,160,0,0.2)':'rgba(0,200,255,0.15)';
      ctx.lineWidth=1; ctx.beginPath();
      ball.trail.forEach((pt,i)=>i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y));
      ctx.stroke();
    }
    ctx.fillStyle=ball.returning?'rgba(255,160,0,0.75)':'#00ccff';
    ctx.beginPath(); ctx.arc(ball.x,ball.y,BALL_R,0,Math.PI*2); ctx.fill();
  });
}

function drawSelectionRect() {
  if (!selRect) return;
  ctx.strokeStyle='rgba(0,255,255,0.6)'; ctx.fillStyle='rgba(0,255,255,0.05)';
  ctx.lineWidth=1; ctx.setLineDash([4,3]);
  const x=Math.min(selRect.x1,selRect.x2), y=Math.min(selRect.y1,selRect.y2);
  ctx.fillRect(x,y,Math.abs(selRect.x2-selRect.x1),Math.abs(selRect.y2-selRect.y1));
  ctx.strokeRect(x,y,Math.abs(selRect.x2-selRect.x1),Math.abs(selRect.y2-selRect.y1));
  ctx.setLineDash([]);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  return () => {
    seed|=0; seed=seed+0x6D2B79F5|0;
    let t=Math.imul(seed^seed>>>15,1|seed);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return((t^t>>>14)>>>0)/4294967296;
  };
}
