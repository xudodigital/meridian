import { useEffect, useRef, useState } from 'react';
import { Empty, Tabs } from '@/components';
import type { GraphMode } from '@/store/slices/research';
import { useStore } from '@/store/store';
import type { SiteLinksWire } from '@/store/types';
import { GTYPE, buildGraph, buildSiteGraph, nodeInfo, usedTypes } from './graph';
import { startGraph, type GraphControl } from './graphEngine';

const MODES: { id: GraphMode; label: string }[] = [{ id: 'link', label: 'Internal links' }, { id: 'agent', label: 'Agents' }];

/**
 * The Internal link engine below its lede: mode tabs and legend, the list of nodes beside the force-directed canvas,
 * the info panel and the note. The graph is built once from a store snapshot when this component mounts; the parent
 * remounts it (with a new key) when the graph has to be built again, which also clears the selection, as initGraph() did.
 */
export function LinkGraph({ mode, real }: { mode: GraphMode; /** The site's real links from the server (outside demo mode): drawn instead of the sample. */ real?: SiteLinksWire | null }) {
  const setGmode = useStore(s => s.setGmode);
  const theme = useStore(s => s.theme);
  const sample = useStore(s => s.sample);
  const [g] = useState(() => mode === 'link' && real ? buildSiteGraph(real) : buildGraph(useStore.getState(), mode));
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<GraphControl | null>(null);

  useEffect(() => {
    const cv = canvas.current; if (!cv) return;
    const ctl = startGraph(cv, g, mode, { select: setSel, hover: setHover });
    engine.current = ctl;
    return () => { ctl.stop(); engine.current = null; };
  }, [g, mode]);
  useEffect(() => { engine.current?.focus(sel); }, [sel]);
  /* The colours come from custom properties, so the canvas is drawn again when the theme changes. */
  useEffect(() => { engine.current?.redraw(); }, [theme]);

  const shown = sel ?? hover, n = shown == null ? undefined : g.nodes[shown];
  /* Outside demo mode a graph with nothing in it is replaced by its note; no empty canvas is drawn. */
  const blank = !sample && !g.nodes.length;
  return (
    <>
      <div className="sh">
        <Tabs value={mode} onChange={setGmode} items={MODES} />
        <span className="grow"></span>
        <div className="legend" id="legend">
          {usedTypes(g).map(t => <span key={t}><i style={{ background: `var(${GTYPE[t][0]})` }}></i>{GTYPE[t][3]}</span>)}
        </div>
      </div>
      {blank ? <Empty icon="hub" title={mode === 'link' ? 'No link map yet' : undefined}>{g.note}</Empty> : (
        <>
          <div className="gwrap">
            <div className="tree" id="tree">
              {g.groups.length ? g.groups.map((gr, i) => (
                <details key={gr.label + i} open={i < 2 || gr.items.length < 5}>
                  <summary>{gr.label} ({gr.items.length})</summary>
                  {gr.items.map(id => (
                    <button key={id} type="button" data-node={id} className={sel === id ? 'on' : undefined} onClick={() => setSel(id)}>{g.nodes[id].label}</button>
                  ))}
                </details>
              )) : <p className="note" style={{ padding: 12 }}>No pages yet.</p>}
            </div>
            <div className="gcanvas">
              <canvas ref={canvas} id="graph" aria-label="Network graph"></canvas>
              <div className="ginfo" id="ginfo">{n ? <><b>{n.label}</b>{nodeInfo(n)}</> : 'Hover a node, or pick a page from the list.'}</div>
            </div>
          </div>
          <p className="note" id="gnote">{g.note}</p>
        </>
      )}
    </>
  );
}
