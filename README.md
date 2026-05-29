# Triangle Quincunx PWA

A Galton board game with triangular pegs, playable in the browser and installable as a PWA on iOS/Android.

## Play

Open `index.html` in a browser, or serve the files from any static host.

## How to Play

1. A **target section** is highlighted in green at the bottom.
2. **Rotate pegs** to redirect balls toward the target:
   - **Single mode**: tap/click a peg to rotate it 15° CCW.
   - **Batch mode**: drag a selection rectangle to rotate all pegs inside it.
   - **Row/Col capture**: in Batch mode, tap a peg to rotate its entire row or column.
   - **2-finger swipe**: swipe horizontally with two fingers to rotate pegs in the swept columns.
   - **Long press**: hold 600ms anywhere to reset all pegs.
3. Press **▶ Пуск** to drop the balls.
4. Win if the target section has **strictly more balls** than any other section.

## Physics

Balls are distributed using a **probability transition matrix**. Each peg deflects the probability flow left/right based on its CCW rotation angle. The final distribution is computed instantly and displayed as a histogram. A set of animated pilot balls gives visual feedback of the falling process.

## PWA Setup

1. Generate icons using `generate-icons.html` → save as `icon-192.png` and `icon-512.png`.
2. Serve files over HTTPS (required for Service Worker).
3. On iOS Safari: Share → Add to Home Screen.

## Files

| File | Description |
|------|-------------|
| `index.html` | App shell, UI, meta tags |
| `main.js` | Game logic, physics, rendering |
| `manifest.json` | PWA manifest |
| `sw.js` | Service Worker (offline cache) |
| `generate-icons.html` | Helper to generate app icons |
