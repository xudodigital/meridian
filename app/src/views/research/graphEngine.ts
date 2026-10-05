/* The canvas side of the Internal link engine: the prototype's initGraph(), step(), kick() and draw(), lines 1745-1785.
   startGraph() animates a mutable copy of a built graph on a canvas, handles hover, drag and selection with the pointer,
   fits the canvas to its box on resize and redraws on request (theme changes). stop() releases everything. */
import type { GraphMode } from '@/store/slices/research';
import { GTYPE, type Graph, type NodeType } from './graph';

interface SimNode { id: number; label: string; type: NodeType; deg: number; x: number; y: number; vx: number; vy: number }
interface SimEdge { a: SimNode; b: SimNode; len: number }

export interface GraphHandlers {
  /** A node was pressed (its id), or empty canvas (null). */
  select: (id: number | null) => void;
  /** The pointer moved onto another node, or off every node. */
  hover: (id: number | null) => void;
}
export interface GraphControl {
  /** The selected node (from the list or the canvas); it and its neighbours are highlighted. */
  focus: (id: number | null) => void;
  redraw: () => void;
  stop: () => void;
}

export function startGraph(cv: HTMLCanvasElement, g: Graph, mode: GraphMode, on: GraphHandlers): GraphControl {
  const ctx = cv.getContext('2d');
  const nodes: SimNode[] = g.nodes.map(n => ({ id: n.id, label: n.label, type: n.type, deg: n.deg, x: n.x, y: n.y, vx: 0, vy: 0 }));
  const edges: SimEdge[] = g.edges.map(e => ({ a: nodes[e.a], b: nodes[e.b], len: e.len }));
  const rep = mode === 'agent' ? 3200 : 700, cut = mode === 'agent' ? 160000 : 40000;
  let alpha = 1, w = 0, h = 0, dpr = 1, k = 1, raf = 0, stopped = false;
  let hover: SimNode | null = null, drag: SimNode | null = null, sel: SimNode | null = null;

  function step() {
    const a = alpha;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j]; let dx = p.x - q.x, dy = p.y - q.y; const d2 = dx * dx + dy * dy + 1; if (d2 > cut) continue;
        const f = Math.min(rep / d2, 6) * a, d = Math.sqrt(d2); dx = dx / d * f; dy = dy / d * f; p.vx += dx; p.vy += dy; q.vx -= dx; q.vy -= dy;
      }
    }
    for (const e of edges) {
      let dx = e.b.x - e.a.x, dy = e.b.y - e.a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - e.len) * .03 * a;
      dx = dx / d * f; dy = dy / d * f; e.a.vx += dx; e.a.vy += dy; e.b.vx -= dx; e.b.vy -= dy;
    }
    for (const n of nodes) {
      const gk = (n.deg ? .004 : .02) * a; n.vx -= n.x * gk; n.vy -= n.y * gk;
      if (n === drag) continue;
      n.vx *= .82; n.vy *= .82; n.x += n.vx; n.y += n.vy;
    }
    alpha *= .988;
  }

  function draw() {
    if (!ctx || !w) return;
    const cs = getComputedStyle(document.documentElement), c = (v: string) => cs.getPropertyValue(v).trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.translate(w / 2, h / 2); ctx.scale(k, k);
    const focus = sel ?? hover, near = new Set<SimNode>();
    if (focus) { near.add(focus); edges.forEach(e => { if (e.a === focus) near.add(e.b); if (e.b === focus) near.add(e.a); }); }
    ctx.lineWidth = 1 / k;
    for (const e of edges) {
      const lit = !!focus && (e.a === focus || e.b === focus);
      ctx.globalAlpha = focus ? (lit ? .95 : .07) : .3; ctx.strokeStyle = lit ? c('--graph-a') : c('--graph-b');
      ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
    }
    for (const n of nodes) {
      const [color, radius, glow] = GTYPE[n.type], col = c(color), r = radius + Math.min(n.deg, 12) * .25;
      ctx.globalAlpha = focus && !near.has(n) ? .22 : 1;
      ctx.shadowColor = col; ctx.shadowBlur = (glow ? 22 : 8) * dpr; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0;
      if (glow) { ctx.fillStyle = c('--graph-bg'); ctx.beginPath(); ctx.arc(n.x, n.y, r * .42, 0, 6.2832); ctx.fill(); }
      if (glow || n === focus || n === hover) {
        ctx.fillStyle = c('--graph-text'); ctx.font = `500 ${11 / k}px ${c('--font-data')}`; ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y - r - 6 / k);
      }
    }
    ctx.globalAlpha = 1;
  }

  function kick() {
    if (raf || stopped) return;
    const loop = () => {
      raf = 0; if (stopped) return;
      if (alpha > .02) { step(); draw(); raf = requestAnimationFrame(loop); } else draw();
    };
    raf = requestAnimationFrame(loop);
  }

  function fit() {
    const r = cv.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr; w = r.width; h = r.height;
    k = Math.min(r.width, r.height) / (mode === 'agent' ? 760 : 600); draw();
  }

  const world = (e: PointerEvent): [number, number] => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - w / 2) / k, (e.clientY - r.top - h / 2) / k]; };
  const hit = (e: PointerEvent): SimNode | null => {
    const [x, y] = world(e); let best: SimNode | null = null, bd = 1e9;
    for (const n of nodes) { const dd = (n.x - x) ** 2 + (n.y - y) ** 2, rr = GTYPE[n.type][1] + 8; if (dd < rr * rr && dd < bd) { bd = dd; best = n; } }
    return best;
  };
  const onDown = (e: PointerEvent) => {
    const n = hit(e);
    if (n) { drag = n; cv.setPointerCapture(e.pointerId); }
    sel = n; draw(); on.select(n ? n.id : null);
  };
  const onMove = (e: PointerEvent) => {
    if (drag) { const [x, y] = world(e); drag.x = x; drag.y = y; drag.vx = drag.vy = 0; alpha = Math.max(alpha, .3); kick(); return; }
    const n = hit(e);
    if (n !== hover) { hover = n; cv.style.cursor = n ? 'pointer' : 'grab'; draw(); on.hover(n ? n.id : null); }
  };
  const onUp = () => { drag = null; };

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  if (ro) ro.observe(cv); else window.addEventListener('resize', fit);
  const scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  scheme?.addEventListener('change', draw);
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) { for (let i = 0; i < 320; i++) step(); alpha = 0; }
  fit();
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  kick();

  return {
    focus: id => { sel = id == null ? null : nodes[id] ?? null; draw(); },
    redraw: draw,
    stop: () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', fit);
      scheme?.removeEventListener('change', draw);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
    },
  };
}
