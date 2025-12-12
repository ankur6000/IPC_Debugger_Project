// backend/server.js
res.json({ ok: true, channel: ch });
});


app.post('/api/send', (req, res) => {
const { from, to, channelId, payload } = req.body;
try {
sim.sendMessage({ from, to, channelId, payload });
res.json({ ok: true });
} catch (e) {
res.status(400).json({ ok: false, error: e.message });
}
});


app.post('/api/step', (req, res) => {
sim.step();
res.json({ ok: true });
});


app.post('/api/control', (req, res) => {
const { action, payload } = req.body;
if (action === 'pause') sim.pause();
if (action === 'resume') sim.resume();
if (action === 'injectDelay') sim.injectDelay(payload);
res.json({ ok: true });
});


app.get('/api/events', (req, res) => {
db.all('SELECT * FROM events ORDER BY id DESC LIMIT 200', (err, rows) => {
if (err) return res.status(500).json({ error: err.message });
res.json({ rows });
});
});


app.get('/api/state', (req, res) => {
res.json(sim.getState());
});


// Serve static frontend build if exists
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use('/', express.static(frontendDist));


// WebSocket handling
wss.on('connection', (ws) => {
console.log('ws client connected');
// send initial snapshot
ws.send(JSON.stringify({ kind: 'snapshot', state: sim.getState() }));
ws.on('message', (m) => {
try {
const msg = JSON.parse(m);
if (msg.kind === 'control') {
if (msg.action === 'pause') sim.pause();
if (msg.action === 'resume') sim.resume();
if (msg.action === 'step') sim.step();
}
} catch (e) { /* ignore */ }
});
});


const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`IPC Debugger backend listening on ${PORT}`));
