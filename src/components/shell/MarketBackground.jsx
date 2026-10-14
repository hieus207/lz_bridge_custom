import { useEffect, useRef } from 'react';

// Animated "halftone market" background: the page's dot grid, where dot size follows
// a price curve scrolling right-to-left. Dots shrink toward the centre column so the
// content area stays calm; the curve itself is drawn in the brand lime.
//
// Cheap by design: one canvas, ~30 fps, paused while the tab is hidden, and a single
// static frame when the user prefers reduced motion.

const GRID = 22;          // px between dots (same as the old CSS dot grid)
const FPS = 30;
const SCROLL_PX = 0.18;   // horizontal drift per frame
const VOL = 2.2;          // random-walk volatility of the curve (in rows)

const walk = (n, prev = 0) => {
  const a = [prev];
  for (let i = 1; i < n; i++) a.push(a[i - 1] + (Math.random() - 0.5) * VOL);
  return a;
};

export default function MarketBackground() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, cols = 0, rows = 0, series = [], off = 0, t = 0;
    let raf = 0, last = 0;

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const nextCols = Math.ceil(w / GRID) + 2;
      rows = Math.ceil(h / GRID) + 1;
      series = series.length >= nextCols ? series.slice(-nextCols) : walk(nextCols, series.at(-1) ?? 0);
      cols = nextCols;
    }

    function draw() {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      const ink = dark ? '237,237,234' : '17,17,17';
      const lime = dark ? '#5f8410' : '#9bc21a'; // dark: muted olive, matches the dark accent
      ctx.clearRect(0, 0, w, h);
      const mean = series.reduce((a, b) => a + b, 0) / series.length;
      for (let c = 0; c < cols; c++) {
        const x = c * GRID - off;
        // curve sits in the lower part of the screen
        const curveRow = rows * 0.62 - (series[c] - mean) * 1.3;
        const nx = Math.abs(x / w - 0.5) * 2;            // 0 at centre → 1 at edges
        const edge = Math.min(1, Math.max(0, (nx - 0.25) / 0.55)); // calm centre column
        for (let r = 0; r < rows; r++) {
          const y = r * GRID;
          const d = r - curveRow;
          const under = d > 0 ? Math.exp(-d / 7) : 0;     // filled area under the curve
          const onLine = Math.exp(-(d * d) / 1.2);
          const wave = 0.5 + 0.5 * Math.sin(c * 0.16 + r * 0.1 + t);
          const size = 0.9 + (under * 2.2 + onLine * 2.2) * edge + wave * 0.25;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          if (onLine > 0.6 && edge > 0.5) {
            ctx.fillStyle = lime;
          } else {
            ctx.fillStyle = `rgba(${ink},${(dark ? 0.08 : 0.11) + (dark ? 0.12 : 0.17) * edge * Math.max(under, onLine, 0.15)})`;
          }
          ctx.fill();
        }
      }
    }

    function step(now) {
      raf = requestAnimationFrame(step);
      if (now - last < 1000 / FPS) return;
      last = now;
      t += 0.03;
      off += SCROLL_PX * GRID / 4;
      if (off >= GRID) {
        off -= GRID;
        series.shift();
        series.push(series[series.length - 1] + (Math.random() - 0.5) * VOL);
      }
      draw();
    }

    function onVisibility() {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) raf = requestAnimationFrame(step);
    }

    resize();
    draw();
    if (!reduce) raf = requestAnimationFrame(step);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    // redraw immediately when the theme flips (matters when motion is reduced)
    const themeObs = new MutationObserver(draw);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      themeObs.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="fixed inset-0 -z-10 pointer-events-none" />;
}
