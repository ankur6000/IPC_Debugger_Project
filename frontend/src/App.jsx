import React, { useEffect, useState, useRef } from 'react';
ws.onclose = ()=> console.log('ws closed');
return ()=> ws.close();
},[]);


async function createProcess(){
await fetch('/api/process', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name: 'proc-'+Date.now() }) });
const s = await (await fetch('/api/state')).json(); setState(s);
}


async function createChannel(type){
await fetch('/api/channel', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ type, bufferSize: 5 }) });
const s = await (await fetch('/api/state')).json(); setState(s);
}


async function send(){
const pids = Object.keys(state.processes);
const cids = Object.keys(state.channels);
if (pids.length<2 || cids.length<1) return alert('Create at least 2 processes and 1 channel');
await fetch('/api/send', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ from: pids[0], to: pids[1], channelId: cids[0], payload: { text: 'hi', key: 'x', value: Math.random() } }) });
}


return (
<div className="app">
<div className="header">
<h1>IPC Debugger</h1>
<div style={{marginLeft: 'auto'}}>
<button className="btn" onClick={createProcess}>Create Process</button>
<button className="btn" onClick={()=>createChannel('pipe')}>Create Pipe</button>
<button className="btn" onClick={()=>createChannel('mq')}>Create MQ</button>
<button className="btn" onClick={()=>createChannel('shared')}>Create SHM</button>
<button className="btn" onClick={send}>Send</button>
<button className="btn" onClick={()=>fetch('/api/step', {method:'POST'})}>Step</button>
</div>
</div>


<div style={{display:'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginTop: 16}}>
<div>
<div className="box">
<h3>Processes</h3>
{Object.values(state.processes).length === 0 && <div className="small">No processes yet</div>}
{Object.values(state.processes).map(p => <div key={p.pid} className="process-block"><ProcessNode p={p} /></div>)}
</div>


<div className="box" style={{marginTop:12}}>
<h3>Channels</h3>
{Object.values(state.channels).map(c => <div key={c.cid} className="channel-block"><ChannelPanel c={c} /></div>)}
</div>


<div className="box" style={{marginTop:12}}>
<h3>Timeline</h3>
<Timeline events={events.slice(0,50)} />
</div>
</div>


<div>
<div className="box">
<h3>Controls</h3>
<Controls ws={wsRef.current} />
</div>


<div className="box" style={{marginTop:12}}>
<h3>Event Log</h3>
<div style={{maxHeight:300, overflow:'auto'}}>
{events.map((e,i)=> <div key={i} className="log-item">[{new Date().toLocaleTimeString()}] {e.type} — {JSON.stringify(e.payload).slice(0,120)}</div>)}
</div>
</div>
</div>
</div>
</div>
);
}
