# ПРОМПТ: Создай игру «Треугольный Квинкункс» (Triangle Quincunx)

> Скопируй этот промпт целиком и передай любому LLM-кодогенератору.
> Промпт содержит всё необходимое для точного воспроизведения игры.

---

## ЗАДАЧА

Создай одностраничную PWA-игру «Треугольный Квинкункс» — браузерную игру на основе доски Гальтона с треугольными поворотными штырьками. Всё в **одном файле `index.html`** плюс `manifest.json`, `sw.js`. Никаких внешних библиотек. Vanilla JS ES6+, HTML5 Canvas.

Игра должна работать в браузере (Chrome, Safari) и устанавливаться как PWA на iOS (Safari → «Добавить на экран "Домой"»).

---

## 1. КОНЦЕПЦИЯ ИГРЫ

**Что это такое:** Доска Гальтона — устройство, демонстрирующее нормальное распределение. Шарики падают через решётку штырьков и скапливаются в нижних секциях. В классической версии штырьки круглые — шарик отскакивает случайно влево/вправо 50/50, и итоговое распределение всегда нормальное (колокол Гаусса).

**Инновация этой игры:** Штырьки треугольные и поворачиваются. Когда треугольник повёрнут, его грань направляет шарик с предсказуемым смещением — больше влево или вправо. Игрок управляет этими поворотами, чтобы направить максимум шариков в случайно выбранную целевую секцию.

**Цель игрока:** Система случайно выбирает одну из N секций (обычно 9) как «цель» (подсвечена). Игрок поворачивает треугольные штырьки, затем нажимает «Пуск». Шарики падают и распределяются. Победа — если в целевой секции шариков **строго больше**, чем в любой другой.

**Интуиция физики:** Чтобы загнать шарики в правую секцию — поворачивай штырьки по часовой стрелке (правый наклон). Для левой — против часовой. Центральная секция легче всего (нейтральное состояние). Крайние секции требуют максимальных поворотов во всей сетке.

---

## 2. СТРУКТУРА ЭКРАНА (сверху вниз)

```
┌─────────────────────────────────────────┐
│  СТАТУСНАЯ ПАНЕЛЬ (flex, 1 строка)       │
│  [▶ Пуск] [↺ Раунд] [⟳ Штырьки]        │
│  Цель: [5] ✓3 ✗1 [Режим:Один] [Захват]  │
├─────────────────────────────────────────┤
│  СТРОКА НАСТРОЕК (flex, компактная)      │
│  Шары:[====] 2000  Угол:[▾15°] Секций:[▾9]│
├─────────────────────────────────────────┤
│                                         │
│  CANVAS — основная игровая область      │
│  ┌─────────────────────────────────┐    │
│  │  ЗОНА ВОРОНКИ (~12% высоты)     │    │
│  │  [2000 шариков] (точки+текст)   │    │
│  │       \    /                    │    │
│  │        \  /   ← воронка         │    │
│  ├─────────────────────────────────┤    │
│  │  ЗОНА ШТЫРЬКОВ (~68% высоты)    │    │
│  │                                 │    │
│  │  ▲        ← ряд 1: 1 штырёк     │    │
│  │  ▲  ▲     ← ряд 2: 2 штырька    │    │
│  │  ▲  ▲  ▲  ← ряд 3: 3 штырька   │    │
│  │  ...до ряда 12 (12 штырьков)    │    │
│  ├─────────────────────────────────┤    │
│  │  ЗОНА СЕКЦИЙ (~20% высоты)      │    │
│  │  |  |  |✦|  |  |  |  |  |     │    │
│  │  12  8  ★31  8 12 15 ...        │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

При победе/поражении — полупрозрачный оверлей поверх canvas с текстом и кнопкой.

---

## 3. ДИЗАЙН И ВИЗУАЛ

### 3.1 Цветовая схема (dark theme, терминальный стиль)

```css
--bg:           #000000   /* фон всего */
--bg-panel:     #0a0a0a   /* статусная панель */
--bg-settings:  #050505   /* строка настроек */
--border:       #222222   /* разделители */
--border-dim:   #1a1a1a   /* тонкие линии */
--text:         #eeeeee   /* основной текст */
--text-muted:   #666666   /* подписи настроек */
--text-dim:     #aaaaaa   /* вторичный текст */
--cyan:         #00ffff   /* акцент: целевая секция, активные кнопки */
--green:        #00ff00   /* победа, кнопка Пуск, счёт побед */
--red:          #ff4444   /* поражение, счёт поражений */
--peg-fill:     #1a3a5c   /* треугольник штырька (тёмно-синий) */
--peg-stroke:   #4a90d9   /* обводка штырька (голубой) */
--peg-dot:      #ffffff   /* точка-индикатор вращения */
--ball-colors:  hsl(200-240, 70%, 60%)  /* шарики — оттенки синего */
--pilot-colors: hsl(30+i*15, 80%, 65%) /* пилотные шарики — яркие */
--funnel-fill:  rgba(74,144,217,0.15)  /* воронка */
--funnel-stroke:#4a90d9                /* обводка воронки */
--bin-stroke:   #222222                /* разделители секций */
--bin-target-stroke: #00ffff           /* рамка целевой секции */
--bin-fill:     rgba(74,144,217,0.4)   /* заполнение секций */
--bin-target-fill: rgba(0,255,255,0.15) /* фон целевой секции */
--bin-win-fill: rgba(0,255,0,0.5)      /* победная секция */
```

### 3.2 Шрифты
- Везде: `'Courier New', monospace` — придаёт терминальный/технический вид
- Размеры: 10–11px в панелях, 14px в оверлее, 28px в заголовке результата

### 3.3 Canvas — DPR (retina)
```javascript
const dpr = window.devicePixelRatio || 1;
canvas.width = container.clientWidth * dpr;
canvas.height = container.clientHeight * dpr;
ctx.scale(dpr, dpr);
// Всегда работаем в CSS-пикселях
```

---

## 4. СЕТКА ШТЫРЬКОВ

### 4.1 Геометрия
- **Рядов:** 12 (настраивается: 6–16)
- **Ряд r** (0-indexed) содержит `r + 1` штырьков
- Итого: 1 + 2 + ... + 12 = **78 штырьков**
- **Форма: треугольная пирамида** — ряд 0 в верху, ряд 11 в низу

### 4.2 Расположение на Canvas
```javascript
function getPegLayout(W, H) {
  const topH = H * 0.12;      // зона воронки
  const pegH = H * 0.68;      // зона штырьков
  const binH = H * 0.20;      // зона секций
  
  const rowSpacing = pegH / (rows + 1);
  const pegSize = Math.min(rowSpacing * 0.55, 18); // радиус описанной окружности
  
  for (let r = 0; r < rows; r++) {
    const cols = r + 1;
    const y = topH + rowSpacing * (r + 1);
    
    // Штырьки равномерно распределены по ширине 80% Canvas
    const totalWidth = W * 0.8;
    const colSpacing = cols > 1 ? totalWidth / cols : 0;
    const startX = W * 0.1 + (cols > 1 ? colSpacing / 2 : totalWidth / 2);
    
    for (let c = 0; c < cols; c++) {
      const x = startX + c * colSpacing;
      // сохраняем: positions[r][c] = { x, y, size: pegSize }
    }
  }
}
```

### 4.3 Отрисовка треугольника
Каждый штырёк — равнобедренный треугольник, острый угол вверх по умолчанию.

```javascript
function drawTriangle(ctx, x, y, size, angleDeg) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleDeg * Math.PI / 180);
  
  const h = size * 1.1;   // высота
  const hw = size * 0.7;  // полуширина основания
  
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.6);         // вершина (острый угол, вверх)
  ctx.lineTo(-hw, h * 0.4);        // левый нижний угол
  ctx.lineTo(hw, h * 0.4);         // правый нижний угол
  ctx.closePath();
  
  ctx.fillStyle = '#1a3a5c';
  ctx.fill();
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  
  // Точка-индикатор у вершины (показывает куда «смотрит» треугольник)
  ctx.beginPath();
  ctx.arc(0, -h * 0.35, 2, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  
  ctx.restore();
}
```

**Важно:** Белая точка вблизи вершины — визуальный индикатор текущего поворота. Игрок видит куда «наклонён» штырёк.

### 4.4 Hit-test (определение клика по штырьку)
```javascript
function pegAtPoint(cx, cy, positions) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < positions[r].length; c++) {
      const p = positions[r][c];
      const dx = cx - p.x;
      const dy = cy - p.y;
      if (Math.sqrt(dx*dx + dy*dy) < p.size * 1.4) {  // увеличенный радиус для удобства тапа
        return { r, c };
      }
    }
  }
  return null;
}
```

---

## 5. ФИЗИКА — МАТРИЦА ПЕРЕХОДОВ

### 5.1 Концепция
Вместо симуляции 2000 отдельных объектов используем **вероятностное распространение** — намного быстрее и даёт точный результат.

Модель: на каждом уровне у нас есть вектор вероятностей `prob[i]` — вероятность, что шарик находится в щели `i` перед рядом `r`.
- Ряд 0: 1 щель (центр воронки), 1 штырёк → 2 выходные щели
- Ряд r: `r+1` входящих щелей, `r+1` штырьков → `r+2` выходных щелей
- Ряд 11: 12 входящих → 13 выходных щелей

### 5.2 Алгоритм
```javascript
function computeDistribution() {
  let prob = [1.0]; // начинаем с воронки — вся масса в центре
  
  for (let r = 0; r < rows; r++) {
    const nextSlots = r + 2;
    const nextProb = new Array(nextSlots).fill(0);
    
    for (let i = 0; i < prob.length; i++) {
      if (prob[i] < 1e-10) continue;
      
      // Штырёк, который встречает поток из щели i
      const pegIdx = Math.min(i, r);
      const angleDeg = pegs[r][pegIdx];
      
      // Смещение от поворота: CCW (отрицательный угол) → bias влево (+)
      // Диапазон bias: [-0.45, +0.45] при maxAngle = 270°
      const bias = -(angleDeg / 180) * 0.45;
      const pL = Math.max(0.05, Math.min(0.95, 0.5 + bias));
      const pR = 1 - pL;
      
      nextProb[i]   += prob[i] * pL;  // шарик уходит влево
      nextProb[i+1] += prob[i] * pR;  // шарик уходит вправо
    }
    
    prob = nextProb;
  }
  
  // prob теперь имеет (rows+1) = 13 элементов для rows=12
  // Масштабируем на bins (9) секций
  const exitSlots = rows + 1;
  const result = new Array(bins).fill(0);
  const scale = (exitSlots - 1) / (bins - 1);
  
  prob.forEach((p, i) => {
    const binIdx = Math.round(i / scale);
    result[Math.min(Math.max(binIdx, 0), bins - 1)] += p;
  });
  
  // Нормализуем и конвертируем в целые числа шариков
  const total = result.reduce((a, b) => a + b, 0);
  distribution = result.map(v => Math.round((v / total) * ballCount));
  
  // Корректируем округление
  const diff = ballCount - distribution.reduce((a, b) => a + b, 0);
  distribution[bins - 1] += diff;
}
```

### 5.3 Знак угла и направление
- `pegs[r][c] = 0` → нейтральный штырёк, 50/50
- `pegs[r][c] > 0` → повёрнут по часовой стрелке (CW), смещает шарики **вправо**
- `pegs[r][c] < 0` → повёрнут против часовой стрелки (CCW), смещает шарики **влево**
- Клик/тап добавляет `+stepAngle` (CW) по умолчанию
- Максимальный суммарный угол: ±270°

### 5.4 Тактика для игрока
- Чтобы попасть в правую секцию: повернуть все штырьки в правую сторону (+большие углы)
- Чтобы попасть в левую: все штырьки в левую сторону (нажимать много раз или использовать пакетный режим)
- Центральная секция достижима при нейтральных штырьках
- Чем дальше целевая секция от центра — тем больше нужно поворотов

---

## 6. АНИМАЦИЯ ПИЛОТНЫХ ШАРИКОВ

После расчёта распределения (мгновенного) запускается визуальная анимация 12 «пилотных» шариков для ощущения физики.

```javascript
function launchPilots() {
  const N = 12;
  pilots = [];
  
  for (let i = 0; i < N; i++) {
    const targetBin = weightedRandom(distribution); // выбираем секцию по вероятности
    pilots.push({
      x: canvasW / 2 + (Math.random() - 0.5) * 20,
      y: topH * 0.9,
      vx: (Math.random() - 0.5) * 1,
      vy: 1.5 + Math.random(),
      hue: 30 + i * 15,
      targetBin,
      done: false
    });
  }
  
  function step() {
    let anyAlive = false;
    pilots.forEach(p => {
      if (p.done) return;
      anyAlive = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // гравитация
      
      // Мягкое притяжение к целевой секции (для реализма)
      const tb = binLayout[p.targetBin];
      const tx = tb.x + tb.w / 2;
      p.vx += (tx - p.x) * 0.008;
      p.vx *= 0.92; // демпфирование
      
      if (p.y > canvasH - 5) p.done = true;
    });
    
    draw(); // перерисовать весь canvas с пилотами
    if (anyAlive) requestAnimationFrame(step);
    else finishRound(); // показать результат
  }
  
  requestAnimationFrame(step);
}

function weightedRandom(dist) {
  const total = dist.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < dist.length; i++) {
    r -= dist[i];
    if (r <= 0) return i;
  }
  return dist.length - 1;
}
```

---

## 7. ОТРИСОВКА СЕКЦИЙ (BIN ZONE)

```javascript
function drawBins(ctx, W, H, binH) {
  const binTop = H - binH;
  const binW = W / bins;
  
  // Горизонтальная разделительная линия
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, binTop);
  ctx.lineTo(W, binTop);
  ctx.stroke();
  
  const maxCount = Math.max(...distribution, 1);
  
  for (let i = 0; i < bins; i++) {
    const x = i * binW;
    const count = distribution[i] || 0;
    const isTarget = i === targetBin;
    const fillH = (count / maxCount) * binH * 0.85;
    
    // Фон целевой секции
    if (isTarget) {
      ctx.fillStyle = 'rgba(0,255,255,0.1)';
      ctx.fillRect(x, binTop, binW, binH);
    }
    
    // Столбик заполнения снизу вверх
    if (count > 0) {
      const isWinnerBin = (phase === 'done') && isTarget &&
        count > Math.max(...distribution.filter((_, j) => j !== i));
      ctx.fillStyle = isWinnerBin
        ? 'rgba(0,255,0,0.5)'
        : isTarget
          ? 'rgba(0,255,255,0.3)'
          : 'rgba(74,144,217,0.4)';
      ctx.fillRect(x + 2, binTop + binH - fillH, binW - 4, fillH);
    }
    
    // Вертикальный разделитель
    ctx.strokeStyle = isTarget ? '#00ffff' : '#222';
    ctx.lineWidth = isTarget ? 2 : 1;
    ctx.strokeRect(x + 0.5, binTop, binW - 1, binH - 1);
    
    // Звёздочка-маркер цели
    if (isTarget) {
      ctx.fillStyle = '#0ff';
      ctx.font = 'bold 12px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('★', x + binW / 2, binTop + 14);
    }
    
    // Число шариков
    if (count > 0) {
      ctx.fillStyle = '#eee';
      ctx.font = `${Math.min(11, binW * 0.32)}px Courier New`;
      ctx.textAlign = 'center';
      ctx.fillText(count, x + binW / 2, binTop + binH - 5);
    }
    
    // Номер секции (1-based)
    ctx.fillStyle = '#444';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(i + 1, x + binW / 2, H - 2);
  }
}
```

---

## 8. ОТРИСОВКА ВОРОНКИ (RESERVOIR)

```javascript
function drawReservoir(ctx, W, topH) {
  const cx = W / 2;
  
  // Трапециевидная воронка
  ctx.beginPath();
  ctx.moveTo(W * 0.2, 2);           // левый верх
  ctx.lineTo(cx - 15, topH * 0.85); // левый низ (горлышко)
  ctx.lineTo(cx + 15, topH * 0.85); // правый низ (горлышко)
  ctx.lineTo(W * 0.8, 2);           // правый верх
  ctx.closePath();
  ctx.fillStyle = 'rgba(74,144,217,0.15)';
  ctx.fill();
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Текст с количеством шариков
  ctx.fillStyle = '#4a90d9';
  ctx.font = `bold ${Math.min(16, W / 28)}px Courier New`;
  ctx.textAlign = 'center';
  ctx.fillText(`${ballCount} шариков`, cx, topH * 0.45);
  
  // Маленькие точки-шарики (статичные, перерисовываются каждый раз)
  // Используем seeded pseudo-random для стабильности:
  let seed = ballCount; // детерминированный по числу шариков
  function pseudoRand() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }
  for (let i = 0; i < Math.min(80, ballCount); i++) {
    const px = W * 0.22 + pseudoRand() * W * 0.56;
    const py = topH * 0.08 + pseudoRand() * topH * 0.55;
    ctx.beginPath();
    ctx.arc(px, py, 2, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${200 + pseudoRand() * 40}, 70%, 65%, 0.7)`;
    ctx.fill();
  }
}
```

**Важно:** Используй псевдослучайные числа с фиксированным сидом при отрисовке воронки — иначе точки будут дрожать при каждом перерисовывании.

---

## 9. ПОЛНАЯ ФУНКЦИЯ DRAW

```javascript
function draw() {
  const W = canvas.clientWidth;   // CSS pixels
  const H = canvas.clientHeight;
  ctx.clearRect(0, 0, W, H);
  
  // 1. Фон
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  
  // 2. Воронка с шариками
  drawReservoir(ctx, W, H * 0.12);
  
  // 3. Разделитель воронки
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.12);
  ctx.lineTo(W, H * 0.12);
  ctx.stroke();
  
  // 4. Штырьки
  const geo = getPegLayout(W, H);
  geo.positions.forEach((row, r) => {
    row.forEach((p, c) => {
      drawTriangle(ctx, p.x, p.y, p.size, pegs[r][c]);
    });
  });
  
  // 5. Секции
  drawBins(ctx, W, H, H * 0.20);
  
  // 6. Пилотные шарики (если анимируются)
  pilots.forEach(p => {
    if (!p.done) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${p.hue}, 80%, 65%)`;
      ctx.fill();
    }
  });
}
```

---

## 10. УПРАВЛЕНИЕ — РЕЖИМЫ И ЖЕСТЫ

### 10.1 Режим «Одиночный» (Single)
- Клик мышью или тап по штырьку → поворот на `+stepAngle` (CW)
- Нет выделений
- По умолчанию активен

### 10.2 Режим «Пакетный» (Batch)
Активируется кнопкой «Режим: Пакет».

**a) Прямоугольное выделение (мышь + 1 палец):**
- MouseDown / TouchStart: запомнить начальную точку `selStart`
- MouseMove / TouchMove: обновлять `selEnd`, рисовать DOM-элемент `#selection-rect` поверх canvas (absolute position, dashed border `2px dashed #0ff`)
- MouseUp / TouchEnd: найти все штырьки в rect, повернуть каждый на `+stepAngle`
- Если rect пустой (просто тап) → повернуть один штырёк под точкой

**b) Свайп двумя пальцами (iOS):**
- TouchStart с 2 касаниями → запомнить позиции обоих пальцев
- TouchMove с 2 касаниями → вычислить среднее горизонтальное смещение `avgDx`
- Если `|avgDx| > 15px` → повернуть ВСЕ штырьки на `+stepAngle` (вправо) или `-stepAngle` (влево)
- Обновить базовые позиции после каждого порогового смещения (не накапливать)

**c) Захват ряда/столбца:**
- Кнопка «Захват: Ряд» переключает `rowColMode` между 'row' и 'col' и включает `captureMode = true`
- В этом режиме тап по любому штырьку → поворачивает **весь ряд** (если 'row') или **весь столбец** (если 'col')
- Повторное нажатие на кнопку выключает captureMode
- Кнопка подсвечивается как активная (`.active` класс, `border-color: #0ff`)

### 10.3 Долгое нажатие (Long Press)
- 600 мс удержания (timer) → `initPegs()` (сброс всех поворотов до 0)
- Показать `toast`-уведомление: "Повороты сброшены"
- Отменять таймер при `mouseup` / `touchend` / `mousemove > 5px`

### 10.4 Toast-уведомление
```javascript
function showToast(msg) {
  // DOM-элемент position:fixed, bottom:60px, centered
  // Появляется с opacity:1, исчезает через 1800ms
  // Фон: rgba(0,0,0,0.8), border-radius: 20px
}
```

### 10.5 DOM-элемент прямоугольника выделения
```html
<div id="selection-rect" style="
  position: absolute;
  border: 2px dashed #00ffff;
  background: rgba(0,255,255,0.08);
  pointer-events: none;
  display: none;
"></div>
```
Позиционируется относительно `#canvas-wrap`. Координаты пересчитываются из canvas-пространства в CSS-пространство через `getBoundingClientRect()` и scale.

---

## 11. ЛОГИКА РАУНДА

```javascript
// Состояния: 'setup' | 'running' | 'done'

function newRound() {
  targetBin = Math.floor(Math.random() * bins); // 0..bins-1
  distribution = new Array(bins).fill(0);
  pilots = [];
  phase = 'setup';
  // keepRotations — настройка: если false, то initPegs()
  if (!keepRotations) initPegs();
  document.getElementById('target-display').textContent = targetBin + 1;
  document.getElementById('result-overlay').classList.remove('show');
  cancelAnimationFrame(animFrame);
  draw();
}

function launch() {
  if (phase !== 'setup') return;
  phase = 'running';
  document.getElementById('btn-launch').disabled = true;
  
  computeDistribution(); // мгновенно
  draw(); // показать секции с числами
  launchPilots(); // запустить анимацию
}

function finishRound() {
  phase = 'done';
  document.getElementById('btn-launch').disabled = false;
  
  const targetCount = distribution[targetBin];
  const otherMax = Math.max(...distribution.filter((_, i) => i !== targetBin));
  const win = targetCount > otherMax;
  
  if (win) wins++; else losses++;
  document.getElementById('wins').textContent = wins;
  document.getElementById('losses').textContent = losses;
  
  const msg = document.getElementById('result-msg');
  msg.className = win ? 'win' : 'lose';
  msg.textContent = win ? '🏆 ПОБЕДА!' : '💔 ПОРАЖЕНИЕ';
  
  document.getElementById('result-sub').textContent = win
    ? `Секция ${targetBin+1} набрала ${targetCount} — больше всех!`
    : `Секция ${targetBin+1}: ${targetCount}, но максимум в другой: ${otherMax}`;
  
  document.getElementById('result-overlay').classList.add('show');
  draw(); // обновить цвет победной секции
}
```

### Условие победы
Секция-цель должна иметь **строго больше** шариков, чем **любая другая** секция.
`distribution[targetBin] > max(distribution[j] for j != targetBin)`

---

## 12. СОСТОЯНИЕ ПРИЛОЖЕНИЯ (полный объект)

```javascript
const state = {
  // Параметры сетки
  rows: 12,
  bins: 9,
  ballCount: 2000,
  stepAngle: 15,      // градусов за клик (CW)
  maxAngle: 270,      // максимальный суммарный угол штырька
  
  // Состояние штырьков: pegs[r][c] = angle in degrees
  pegs: [],           // инициализируется initPegs()
  
  // Игровое состояние
  distribution: [],   // count per bin
  targetBin: 0,       // 0-indexed
  wins: 0,
  losses: 0,
  phase: 'setup',     // 'setup' | 'running' | 'done'
  
  // UI режимы
  mode: 'single',     // 'single' | 'batch'
  rowColMode: 'row',  // 'row' | 'col'
  captureMode: false, // кнопка Захват активна
  keepRotations: false,
  showPilots: true,
  
  // Анимация
  pilots: [],
};

function initPegs() {
  state.pegs = [];
  for (let r = 0; r < state.rows; r++) {
    state.pegs.push(new Float32Array(r + 1)); // или Array(r+1).fill(0)
  }
}

function rotatePeg(r, c, delta) {
  const newAngle = state.pegs[r][c] + delta;
  state.pegs[r][c] = Math.max(-state.maxAngle, Math.min(state.maxAngle, newAngle));
}
```

---

## 13. HTML-РАЗМЕТКА

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0,
        maximum-scale=1.0, user-scalable=no">
  <!-- iOS PWA metатеги -->
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Квинкункс">
  <meta name="theme-color" content="#000000">
  <link rel="manifest" href="manifest.json">
  <link rel="apple-touch-icon" href="icon-192.png">
  <title>Треугольный Квинкункс</title>
  <!-- все стили встроены в <style> -->
</head>
<body>
<div id="app">          <!-- flex column, height:100% -->
  <div id="status-bar"> <!-- кнопки + info -->
    <span>Цель: <span id="target-display">—</span></span>
    <span id="score">✓<span id="wins">0</span> ✗<span id="losses">0</span></span>
    <button id="btn-launch">▶ Пуск</button>
    <button id="btn-new-round">↺ Раунд</button>
    <button id="btn-reset-pegs">⟳ Штырьки</button>
    <button id="btn-mode">Режим: Один</button>
    <button id="btn-row-col">Захват: Ряд</button>
  </div>
  <div id="settings-row"> <!-- слайдер + селекты -->
    <label>Шары:</label>
    <input type="range" id="ball-slider" min="100" max="5000" step="100" value="2000">
    <span id="ball-count-display">2000</span>
    <label>Угол:</label>
    <select id="angle-select">
      <option value="15" selected>15°</option>
      <option value="30">30°</option>
      <option value="45">45°</option>
    </select>
    <label>Секций:</label>
    <select id="sections-select">
      <option value="7">7</option>
      <option value="9" selected>9</option>
      <option value="11">11</option>
    </select>
  </div>
  <div id="canvas-wrap">  <!-- flex:1, relative, overflow:hidden -->
    <canvas id="canvas"></canvas>
    <div id="selection-rect"></div>  <!-- DOM overlay для прямоугольника выделения -->
    <div id="result-overlay">        <!-- оверлей результата -->
      <div id="result-msg"></div>
      <div id="result-sub"></div>
      <button id="btn-next">Новый раунд</button>
    </div>
  </div>
</div>
<!-- весь JS встроен в <script> или подключён как <script src="main.js"> -->
</body>
</html>
```

---

## 14. CSS — КЛЮЧЕВЫЕ ПРАВИЛА

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  width: 100%; height: 100%;
  background: #000;
  color: #fff;
  font-family: 'Courier New', monospace;
  overflow: hidden;          /* запрещаем прокрутку страницы */
  user-select: none;
  -webkit-user-select: none;
}
#app {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 520px;          /* ограничение для десктопа */
  margin: 0 auto;
}
#canvas-wrap {
  flex: 1;                   /* занимает всё оставшееся место */
  position: relative;
  overflow: hidden;
}
#canvas {
  display: block;
  width: 100%;               /* CSS размер */
  height: 100%;
  touch-action: none;        /* КРИТИЧНО для iOS — блокируем default touch */
}
#result-overlay {
  display: none;
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.75);
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16px;
  z-index: 10;
}
#result-overlay.show { display: flex; }
#result-msg.win  { color: #0f0; text-shadow: 0 0 20px #0f0; font-size: 28px; }
#result-msg.lose { color: #f44; text-shadow: 0 0 20px #f44; font-size: 28px; }
button { touch-action: manipulation; } /* убирает задержку 300ms на iOS */
```

### Предотвращение системных жестов iOS
```javascript
// Предотвращаем pull-to-refresh и системный скролл
document.body.addEventListener('touchmove', e => {
  if (e.target === canvas || e.target.closest('#canvas-wrap')) {
    e.preventDefault();
  }
}, { passive: false });

// На самом canvas — все touch-события с preventDefault
canvas.addEventListener('touchstart', handler, { passive: false });
canvas.addEventListener('touchmove', handler, { passive: false });
canvas.addEventListener('touchend', handler, { passive: false });
```

---

## 15. ОБРАБОТКА СОБЫТИЙ — ПОЛНАЯ СХЕМА

```javascript
// Унифицированный обработчик через событийную модель

let pointerDown = false;
let pointerStartPos = null;
let longPressTimer = null;
let twoFingerState = null;
let selectionActive = false;

// === MOUSE ===
canvas.addEventListener('mousedown', e => {
  const pos = canvasPoint(e.clientX, e.clientY);
  pointerDown = true;
  pointerStartPos = pos;
  startLongPress(pos);
  if (state.mode === 'batch' && !state.captureMode) {
    selectionActive = true;
    selStart = pos; selEnd = pos;
  }
});
canvas.addEventListener('mousemove', e => {
  if (!pointerDown) return;
  const pos = canvasPoint(e.clientX, e.clientY);
  if (selectionActive) {
    selEnd = pos;
    updateSelectionRect();
  }
  // Если двинули > 5px — отменяем long press
  if (dist(pos, pointerStartPos) > 5) cancelLongPress();
});
canvas.addEventListener('mouseup', e => {
  cancelLongPress();
  pointerDown = false;
  const pos = canvasPoint(e.clientX, e.clientY);
  if (selectionActive) {
    selectionActive = false;
    hideSelectionRect();
    applySelectionRotation(selStart, pos);
  } else {
    handleSingleTap(pos);
  }
});

// === TOUCH ===
const touches = {}; // id -> {x, y}

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  [...e.changedTouches].forEach(t => touches[t.identifier] = { x: t.clientX, y: t.clientY });
  
  if (e.touches.length === 2) {
    cancelLongPress();
    selectionActive = false;
    hideSelectionRect();
    twoFingerState = {
      x1: e.touches[0].clientX, y1: e.touches[0].clientY,
      x2: e.touches[1].clientX, y2: e.touches[1].clientY,
    };
  } else if (e.touches.length === 1) {
    const t = e.touches[0];
    const pos = canvasPoint(t.clientX, t.clientY);
    pointerStartPos = pos;
    startLongPress(pos);
    if (state.mode === 'batch' && !state.captureMode) {
      selectionActive = true;
      selStart = pos; selEnd = pos;
    }
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 2 && twoFingerState) {
    const avgDx = ((e.touches[0].clientX - twoFingerState.x1) +
                   (e.touches[1].clientX - twoFingerState.x2)) / 2;
    if (Math.abs(avgDx) > 15) {
      const delta = avgDx > 0 ? state.stepAngle : -state.stepAngle;
      for (let r = 0; r < state.rows; r++)
        for (let c = 0; c < state.pegs[r].length; c++)
          rotatePeg(r, c, delta);
      twoFingerState = {
        x1: e.touches[0].clientX, y1: e.touches[0].clientY,
        x2: e.touches[1].clientX, y2: e.touches[1].clientY,
      };
      draw();
    }
    return;
  }
  if (e.touches.length === 1 && selectionActive) {
    const t = e.touches[0];
    selEnd = canvasPoint(t.clientX, t.clientY);
    updateSelectionRect();
    cancelLongPress(); // двинули — отменяем
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  cancelLongPress();
  if (e.touches.length === 0) twoFingerState = null;
  if (e.changedTouches.length === 1 && e.touches.length === 0) {
    const t = e.changedTouches[0];
    const pos = canvasPoint(t.clientX, t.clientY);
    if (selectionActive) {
      selectionActive = false;
      hideSelectionRect();
      applySelectionRotation(selStart, pos);
    } else {
      handleSingleTap(pos);
    }
  }
}, { passive: false });

// Вспомогательные функции
function canvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width / dpr),
    y: (clientY - rect.top) * (canvas.height / rect.height / dpr),
  };
}

function handleSingleTap(pos) {
  const hit = pegAtPoint(pos.x, pos.y);
  if (!hit) return;
  if (state.captureMode) {
    if (state.rowColMode === 'row') rotateRow(hit.r, state.stepAngle);
    else rotateCol(hit.c, state.stepAngle);
  } else {
    rotatePeg(hit.r, hit.c, state.stepAngle);
  }
  draw();
}

function applySelectionRotation(start, end) {
  const selected = pegsInRect(start.x, start.y, end.x, end.y);
  if (selected.length > 0) {
    selected.forEach(({ r, c }) => rotatePeg(r, c, state.stepAngle));
  } else {
    // tap без drag
    const hit = pegAtPoint(end.x, end.y);
    if (hit) rotatePeg(hit.r, hit.c, state.stepAngle);
  }
  draw();
}

function startLongPress(pos) {
  longPressTimer = setTimeout(() => {
    initPegs();
    draw();
    showToast('Повороты сброшены');
  }, 600);
}
function cancelLongPress() { clearTimeout(longPressTimer); }
```

---

## 16. КНОПКИ И НАСТРОЙКИ

```javascript
// Пуск
document.getElementById('btn-launch').onclick = () => {
  if (state.phase === 'setup') launch();
};

// Новый раунд
document.getElementById('btn-new-round').onclick = newRound;
document.getElementById('btn-next').onclick = newRound;

// Сброс штырьков
document.getElementById('btn-reset-pegs').onclick = () => {
  initPegs(); draw(); showToast('Повороты сброшены');
};

// Переключение режима (single / batch)
document.getElementById('btn-mode').onclick = () => {
  state.mode = state.mode === 'single' ? 'batch' : 'single';
  state.captureMode = false; // сброс captureMode при смене режима
  const btn = document.getElementById('btn-mode');
  btn.textContent = state.mode === 'single' ? 'Режим: Один' : 'Режим: Пакет';
  btn.classList.toggle('active', state.mode === 'batch');
};

// Захват ряда/столбца
document.getElementById('btn-row-col').onclick = () => {
  if (state.mode !== 'batch') {
    showToast('Сначала включите пакетный режим');
    return;
  }
  if (!state.captureMode) {
    state.captureMode = true;
    // при каждом нажатии переключаем row/col
    state.rowColMode = state.rowColMode === 'row' ? 'col' : 'row';
  } else {
    state.captureMode = false;
  }
  const btn = document.getElementById('btn-row-col');
  btn.textContent = state.captureMode
    ? `Захват: ${state.rowColMode === 'row' ? 'Ряд' : 'Столб.'}`
    : 'Захват: Ряд';
  btn.classList.toggle('active', state.captureMode);
  if (state.captureMode) showToast(`Тапни штырёк для захвата ${state.rowColMode === 'row' ? 'ряда' : 'столбца'}`);
};

// Слайдер шариков
document.getElementById('ball-slider').oninput = function() {
  state.ballCount = +this.value;
  document.getElementById('ball-count-display').textContent = this.value;
  draw(); // обновить воронку
};

// Угол за клик
document.getElementById('angle-select').onchange = function() {
  state.stepAngle = +this.value;
};

// Количество секций
document.getElementById('sections-select').onchange = function() {
  state.bins = +this.value;
  state.distribution = new Array(state.bins).fill(0);
  state.targetBin = Math.floor(Math.random() * state.bins);
  document.getElementById('target-display').textContent = state.targetBin + 1;
  draw();
};
```

---

## 17. RESIZE

```javascript
function resize() {
  const wrap = document.getElementById('canvas-wrap');
  const dpr = window.devicePixelRatio || 1;
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  
  ctx.scale(dpr, dpr);
  draw();
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 100));
```

---

## 18. PWA — MANIFEST.JSON

```json
{
  "name": "Треугольный Квинкункс",
  "short_name": "Квинкункс",
  "description": "Игра на основе доски Гальтона с треугольными штырьками",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait-primary",
  "theme_color": "#000000",
  "background_color": "#000000",
  "lang": "ru",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

---

## 19. PWA — SERVICE WORKER (sw.js)

```javascript
const CACHE = 'quincunx-v1';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
```

---

## 20. ИКОНКИ

Иконки `icon-192.png` и `icon-512.png` нарисуй программно через Canvas:

```javascript
function generateIcon(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const s = size;
  const cx = s/2, cy = s/2;
  
  // Фон
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s, s);
  
  // Треугольник
  ctx.beginPath();
  ctx.moveTo(cx, cy - s*0.28);
  ctx.lineTo(cx - s*0.22, cy + s*0.18);
  ctx.lineTo(cx + s*0.22, cy + s*0.18);
  ctx.closePath();
  ctx.fillStyle = '#1a3a5c';
  ctx.fill();
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = s * 0.025;
  ctx.stroke();
  
  // Буква
  ctx.fillStyle = '#0ff';
  ctx.font = `bold ${s*0.18}px Courier New`;
  ctx.textAlign = 'center';
  ctx.fillText('Q', cx, cy + s*0.42);
  
  return c.toDataURL('image/png');
}
```

Либо создай `generate-icons.html` с кнопками «Сохранить».

---

## 21. РЕГИСТРАЦИЯ SERVICE WORKER

```javascript
// В начале основного JS (до init())
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}
```

---

## 22. ПАРАМЕТРЫ ПО УМОЛЧАНИЮ

| Параметр | Значение | Диапазон |
|---|---|---|
| Рядов штырьков | 12 | 6–16 |
| Секций внизу | 9 | 7, 9, 11 |
| Шариков | 2000 | 100–5000 |
| Угол за клик | 15° | 15°, 30°, 45° |
| Максимальный угол | ±270° | фиксировано |
| Пилотных шариков | 12 | фиксировано |
| Long press задержка | 600 мс | фиксировано |
| 2-finger порог | 15 CSS px | фиксировано |

---

## 23. КРИТЕРИИ КОРРЕКТНОЙ РАБОТЫ

1. **Нейтральные штырьки** → распределение близко к нормальному (центр набирает больше)
2. **Все штырьки +180°** → большинство шариков в правых секциях
3. **Все штырьки -180°** → большинство шариков в левых секциях
4. **Поворот конкретного столбца** → смещение распределения пропорционально глубине столбца
5. **iOS Safari**: нет pull-to-refresh, нет bounce-scroll, свайп двумя пальцами работает
6. **Offline**: после первого посещения игра работает без интернета
7. **Retina**: на devicePixelRatio=2 Canvas чёткий (нет размытости)
8. **Победа реально достижима**: при максимальных поворотах крайние секции должны набирать >50% шариков

---

## 24. ТИПИЧНЫЕ ОШИБКИ И КАК ИХ ИЗБЕЖАТЬ

| Проблема | Причина | Решение |
|---|---|---|
| Canvas размытый на Retina | Не учтён DPR | `canvas.width = cssW * dpr; ctx.scale(dpr,dpr)` |
| Touch не работает на iOS | `passive: true` по умолчанию | `{ passive: false }` на все touch listeners |
| Pull-to-refresh на iOS | body scrollable | `touch-action: none` на canvas + body overflow: hidden |
| Шарики дрожат при перерисовке | Math.random() в draw() | Seeded PRNG для воронки |
| 300ms задержка клика | iOS click delay | `touch-action: manipulation` на кнопках |
| SW не кэширует | Нет `https://` или `localhost` | SW работает только по HTTPS или localhost |
| Резкое изменение распределения при смене bins | targetBin out of range | `targetBin = Math.min(targetBin, bins-1)` |

---

## 25. СТРУКТУРА ФАЙЛОВ

```
/
├── index.html       # всё приложение (HTML + CSS + JS)
├── manifest.json    # PWA manifest
├── sw.js            # Service Worker
├── icon-192.png     # иконка 192×192
├── icon-512.png     # иконка 512×512
└── generate-icons.html  # вспомогательная страница генерации иконок
```

**Для работы SW необходим HTTP-сервер** (не `file://`):
```bash
npx serve .          # или
python3 -m http.server 8080
```

Для iOS PWA нужен **HTTPS** (GitHub Pages подходит идеально).

---

*Промпт составлен по реальному рабочему коду игры: https://github.com/xelay/galton*
