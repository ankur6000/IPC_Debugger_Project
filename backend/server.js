// server.js - Express + WebSocket simulator backend (simplified)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Simulator = require('./simulator');
const path = require('path');
const sqlite3 = require('sqlite3');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// simple DB
const db = new sqlite3.Database(path.join(__dirname, 'db.sqlite'));
db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, type TEXT, payload TEXT)');
});

const sim = new Simulator((evt) => {
  // persist event
  db.run('INSERT INTO events(time,type,payload) VALUES(?,?,?)', [Date.now(), evt.type, JSON.stringify(evt.payload)]);
  // broadcast to all websocket clients
  const msg = JSON.stringify({ kind: 'event', event: evt });
  wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
});

app.use(express.json());

// simple API endpoints for control
app.post('/api/process', (req, res) => {
  const p = sim.createProcess(req.body.name || `P${Date.now()}`);
  res.json({ ok: true, process: p });
});

app.post('/api/channel', (req, res) => {
  const ch = sim.createChannel(req.body);
  res.json({ ok: true, channel: ch });
});

app.post('/api/send', (req, res) => {
  const { from, to, channelId, payload } = req.body;
  sim.sendMessage({ from, to, channelId, payload });
  res.json({ ok: true });
});

app.post('/api/step', (req, res) => {
  sim.step();
  res.json({ ok: true });
});

app.get('/api/events', (req, res) => {
  db.all('SELECT * FROM events ORDER BY id DESC LIMIT 100', (err, rows) => {
    if (err) return res.status(500).json({ err: err.message });
    res.json({ rows });
  });
});

// serve frontend static (optionally built)
app.use('/', express.static(path.join(__dirname, '..', 'frontend', 'dist')));

// ws connections for control UI
wss.on('connection', (ws) => {
  console.log('ui connected');
  ws.send(JSON.stringify({ kind: 'snapshot', state: sim.getState() }));
  ws.on('message', (m) => {
    try {
      const msg = JSON.parse(m);
      // allow simple control messages
      if (msg.kind === 'control') {
        if (msg.action === 'pause') sim.pause();
        if (msg.action === 'resume') sim.resume();
        if (msg.action === 'injectDelay') sim.injectDelay(msg.payload);
      }
    } catch(e){}
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`IPC Debugger backend listening ${PORT}`));
