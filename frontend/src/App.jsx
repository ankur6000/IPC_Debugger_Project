import React, { useEffect, useState, useRef } from 'react';
import ProcessNode from './components/ProcessNode';
import ChannelPanel from './components/ChannelPanel';
import Timeline from './components/Timeline';
import Controls from './components/Controls';
import WaitForGraph from './components/WaitForGraph';

export default function App() {
  const [state, setState] = useState({ processes: {}, channels: {} });
  const [events, setEvents] = useState([]);
  const wsRef = useRef(null);

  useEffect(() => {
    fetch('/api/state').then(r => r.json()).then(s => setState(s)).catch(() => { });
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    wsRef.current = ws;
    ws.onmessage = (m) => {
      const data = JSON.parse(m.data);
      if (data.kind === 'snapshot') setState(data.state);
      if (data.kind === 'event') {
        setEvents(e => [data.event, ...e].slice(0, 200));
        if (['process.created', 'process.killed', 'lock.granted', 'lock.released', 'deadlock.detected', 'channel.created'].includes(data.event.type)) {
          fetch('/api/state').then(r => r.json()).then(s => setState(s));
        }
      }
    };
    ws.onclose = () => console.log('ws closed');
    return () => ws.close();
  }, []);

  async function createProcess() {
    await fetch('/api/process', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'proc-' + Date.now() }) });
    const s = await (await fetch('/api/state')).json(); setState(s);
  }

  async function createChannel(type) {
    await fetch('/api/channel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, bufferSize: 5 }) });
    const s = await (await fetch('/api/state')).json(); setState(s);
  }

  async function send() {
    const pids = Object.keys(state.processes);
    const cids = Object.keys(state.channels);
    if (pids.length < 2 || cids.length < 1) return alert('Create at least 2 processes and 1 channel');
    await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: pids[0], to: pids[1], channelId: cids[0], payload: { text: 'hi', key: 'x', value: Math.random() } }) });
  }

  // Select-cycle handler (from WaitForGraph)
  async function onSelectCycle(action) {
    if (action.type === 'killLowest') {
      const pids = action.cycle.nodes;
      let lowest = null; let lowPri = Infinity;
      for (const pid of pids) {
        const pr = state.processes[pid];
        if (pr && pr.priority < lowPri) { lowPri = pr.priority; lowest = pid; }
      }
      if (lowest) {
        await fetch('/api/kill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: lowest }) });
        const s = await (await fetch('/api/state')).json(); setState(s);
      }
    } else if (action.type === 'forceRelease') {
      const edges = action.cycle.edges;
      if (edges.length === 0) return alert('No lock edges found to release');
      const edge = edges.find(e => e.reason && e.reason.includes('lock')) || edges[0];
      const match = edge.reason.match(/lock\s+(C\d+:?[^\s]*)/);
      let lockFull = null;
      if (match) lockFull = match[1];
      const ownerPid = edge.to;
      await fetch('/api/releaseLock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerPid, lockFullName: lockFull }) });
      const s = await (await fetch('/api/state')).json(); setState(s);
    }
  }

  return (
    <div className="app">
      <div className="header">
        <h1>IPC Debugger — Wait-For Graph</h1>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn" onClick={createProcess}>Create Process</button>
          <button className="btn" onClick={() => createChannel('shared')}>Create SharedMem</button>
          <button className="btn" onClick={() => createChannel('mq')}>Create MQ</button>
          <button className="btn" onClick={send}>Send</button>
          <button className="btn" onClick={() => fetch('/api/step', { method: 'POST' })}>Step</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 480px', gap: 16, marginTop: 16 }}>
        <div>
          <div className="box">
            <h3>Processes</h3>
            {Object.values(state.processes).map(p => <div key={p.pid} className="process-block"><ProcessNode p={p} /></div>)}
          </div>

          <div className="box" style={{ marginTop: 12 }}>
            <h3>Channels</h3>
            {Object.values(state.channels).map(c => <div key={c.cid} className="channel-block"><ChannelPanel c={c} /></div>)}
          </div>

          <div className="box" style={{ marginTop: 12 }}>
            <h3>Timeline</h3>
            <Timeline events={events.slice(0, 50)} />
          </div>
        </div>

        <div>
          <div className="box">
            <h3>Wait-For Graph</h3>
            <WaitForGraph onSelectCycle={onSelectCycle} />
          </div>

          <div className="box" style={{ marginTop: 12 }}>
            <h3>Event Log</h3>
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {events.map((e, i) => <div key={i} className="log-item">[{new Date().toLocaleTimeString()}] {e.type} — {JSON.stringify(e.payload).slice(0, 120)}</div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
