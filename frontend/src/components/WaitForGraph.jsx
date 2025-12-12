import React, { useEffect, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph';

export default function WaitForGraph({ onSelectCycle }) {
  const fgRef = useRef();
  const [graph, setGraph] = useState({ nodes: [], links: [] });
  const [cycles, setCycles] = useState([]);

  async function loadGraph() {
    const res = await fetch('/api/waitfor');
    const j = await res.json();
    if (!j.ok) return;
    const nodes = j.graph.nodes.map(n => ({ id: n }));
    const links = j.graph.edges.map(e => ({ source: e.from, target: e.to, reason: e.reason }));
    setGraph({ nodes, links });

    const eventsRes = await fetch('/api/events');
    const ev = await eventsRes.json();
    const deadlocks = ev.rows.filter(r => r.type === 'deadlock.detected');
    if (deadlocks.length) {
      const latest = JSON.parse(deadlocks[0].payload || '{}');
      if (latest.cycles) setCycles(latest.cycles);
      else setCycles([]);
    } else setCycles([]);
  }

  useEffect(() => {
    loadGraph();
    const t = setInterval(loadGraph, 2000);
    return () => clearInterval(t);
  }, []);

  const nodePaint = (node, ctx, globalScale) => {
    const label = node.id;
    const fontSize = 12 / globalScale;
    ctx.font = `${fontSize}px Sans-Serif`;
    const inCycle = cycles.some(c => c.nodes.includes(node.id));
    ctx.fillStyle = inCycle ? '#ff4d4f' : '#111';
    ctx.beginPath(); ctx.arc(node.x, node.y, inCycle ? 7 : 6, 0, 2 * Math.PI, false); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillText(label, node.x + 8, node.y + 4);
  };

  return (
    <div>
      <div style={{ height: 420 }}>
        <ForceGraph2D
          ref={fgRef}
          graphData={graph}
          nodeLabel="id"
          linkDirectionalArrowLength={6}
          linkDirectionalArrowRelPos={1}
          onNodeClick={node => alert(`Node ${node.id}`)}
          nodeCanvasObject={nodePaint}
          linkWidth={1}
        />
      </div>

      <div style={{ marginTop: 8 }}>
        {cycles.length === 0 && <div className="small">No deadlocks detected.</div>}
        {cycles.map((c, i) => (
          <div key={i} style={{ border: '1px solid #ffd6d6', padding: 8, marginTop: 6, background: '#fff7f7' }}>
            <div><strong>Cycle {i + 1}</strong>: {c.nodes.join(' → ')}</div>
            <div className="small">Edges: {c.edges.map(e => e.reason).join(', ')}</div>
            <div style={{ marginTop: 6 }}>
              <button className="btn" onClick={() => onSelectCycle?.({ type: 'killLowest', cycle: c })}>Kill lowest-priority</button>
              <button className="btn" onClick={() => onSelectCycle?.({ type: 'forceRelease', cycle: c })} style={{ marginLeft: 8 }}>Force release lock</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
