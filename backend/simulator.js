// backend/simulator.js
// Simulator with locks, wait-for graph and Tarjan SCC for deadlock detection
class Simulator {
  constructor(onEvent) {
    this.emit = onEvent || (() => {});
    this.processes = {}; // pid -> { pid, name, state, heldLocks: Set, waitingFor: { type:'lock'|'channel', channelId, lockName } | null, priority }
    this.channels = {}; // cid -> { cid, type, buffer, bufferSize, memory, locks: { lockName -> { owner, waiters: [] } } }
    this.nextPid = 1;
    this.nextCid = 1;
    this.running = true;
  }

  createProcess(name, priority = 1) {
    const pid = `P${this.nextPid++}`;
    const p = { pid, name, state: 'ready', heldLocks: new Set(), waitingFor: null, priority };
    this.processes[pid] = p;
    this.emit({ type: 'process.created', payload: { ...p, heldLocks: Array.from(p.heldLocks) } });
    return p;
  }

  killProcess(pid) {
    const p = this.processes[pid];
    if (!p) return false;
    // release all locks (force)
    for (const lockFull of Array.from(p.heldLocks)) {
      // lockFull format: "C<id>:lockName"
      this.forceReleaseLock(pid, lockFull);
    }
    delete this.processes[pid];
    this.emit({ type: 'process.killed', payload: { pid } });
    return true;
  }

  createChannel({ type = 'pipe', bufferSize = 5, name } = {}) {
    const cid = `C${this.nextCid++}`;
    const ch = { cid, type, name: name || `${type}-${cid}`, buffer: [], bufferSize, locks: {} };
    if (type === 'shared') ch.memory = {};
    this.channels[cid] = ch;
    this.emit({ type: 'channel.created', payload: ch });
    return ch;
  }

  // Acquire lock; returns true if immediately acquired, false if blocked (queued)
  acquireLock(pid, channelId, lockName) {
    const ch = this.channels[channelId];
    const p = this.processes[pid];
    if (!ch || !p) return false;
    if (!ch.locks[lockName]) ch.locks[lockName] = { owner: null, waiters: [] };
    const L = ch.locks[lockName];
    if (L.owner === null) {
      L.owner = pid;
      p.heldLocks.add(`${channelId}:${lockName}`);
      this.emit({ type: 'lock.acquired', payload: { pid, channelId, lockName } });
      return true;
    } else {
      // enqueue waiter
      if (!L.waiters.includes(pid)) L.waiters.push(pid);
      p.state = 'blocked';
      p.waitingFor = { type: 'lock', channelId, lockName };
      this.emit({ type: 'lock.waiting', payload: { pid, channelId, lockName, owner: L.owner } });
      return false;
    }
  }

  // Normal release (owner calls release)
  releaseLock(pid, channelId, lockName) {
    const ch = this.channels[channelId];
    if (!ch || !ch.locks[lockName]) return false;
    const L = ch.locks[lockName];
    if (L.owner !== pid) return false;
    L.owner = null;
    this.processes[pid]?.heldLocks.delete(`${channelId}:${lockName}`);
    if (L.waiters.length > 0) {
      const next = L.waiters.shift();
      L.owner = next;
      const pNext = this.processes[next];
      if (pNext) { pNext.heldLocks.add(`${channelId}:${lockName}`); pNext.state = 'ready'; pNext.waitingFor = null; }
      this.emit({ type: 'lock.granted', payload: { pid: next, channelId, lockName } });
    }
    this.emit({ type: 'lock.released', payload: { pid, channelId, lockName } });
    return true;
  }

  // Force-release lock owned by ownerPid. lockNameOrFull may be "C1:lockA" or just a lock name to search.
  forceReleaseLock(ownerPid, lockNameOrFull) {
    let channelId, lockName;
    if (typeof lockNameOrFull === 'string' && lockNameOrFull.includes(':')) {
      [channelId, lockName] = lockNameOrFull.split(':');
    } else {
      for (const ch of Object.values(this.channels)) {
        for (const ln of Object.keys(ch.locks)) {
          const L = ch.locks[ln];
          if (L.owner === ownerPid) { channelId = ch.cid; lockName = ln; break; }
        }
        if (channelId) break;
      }
    }
    if (!channelId || !lockName) return false;
    const ch = this.channels[channelId];
    const L = ch?.locks[lockName];
    if (!L) return false;
    const prevOwner = L.owner;
    L.owner = null;
    this.processes[prevOwner]?.heldLocks.delete(`${channelId}:${lockName}`);
    if (L.waiters.length > 0) {
      const next = L.waiters.shift();
      L.owner = next;
      const pNext = this.processes[next];
      if (pNext) { pNext.heldLocks.add(`${channelId}:${lockName}`); pNext.state = 'ready'; pNext.waitingFor = null; }
      this.emit({ type: 'lock.force_released_and_granted', payload: { prevOwner, newOwner: next, channelId, lockName } });
    } else {
      this.emit({ type: 'lock.force_released', payload: { prevOwner, channelId, lockName } });
    }
    return true;
  }

  sendMessage({ from, to, channelId, payload }) {
    const ch = this.channels[channelId];
    if (!ch) throw new Error('channel not found');
    if (ch.type === 'pipe' || ch.type === 'mq') {
      if (ch.buffer.length >= ch.bufferSize) {
        if (this.processes[from]) {
          this.processes[from].state = 'blocked';
          this.processes[from].waitingFor = { type: 'channel', channelId };
        }
        this.emit({ type: 'channel.full', payload: { channelId: ch.cid, from } });
        return;
      }
      const msg = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, from, to, payload, ts: Date.now() };
      ch.buffer.push(msg);
      this.emit({ type: 'message.enqueued', payload: { channelId: ch.cid, message: msg } });
    } else if (ch.type === 'shared') {
      const { key, value } = payload || {};
      ch.memory[key] = { value, by: from, ts: Date.now() };
      this.emit({ type: 'shm.write', payload: { channelId: ch.cid, key, value, by: from } });
    }
  }

  step() {
    for (const ch of Object.values(this.channels)) {
      if ((ch.type === 'pipe' || ch.type === 'mq') && ch.buffer.length > 0) {
        const msg = ch.buffer.shift();
        this.emit({ type: 'message.delivered', payload: { channelId: ch.cid, message: msg } });
        const dest = this.processes[msg.to];
        if (dest) dest.state = 'running';
        // try to unblock a sender waiting on this channel
        for (const p of Object.values(this.processes)) {
          if (p.state === 'blocked' && p.waitingFor && p.waitingFor.type === 'channel' && p.waitingFor.channelId === ch.cid) {
            p.state = 'ready'; p.waitingFor = null; this.emit({ type: 'process.unblocked', payload: { pid: p.pid } }); break;
          }
        }
      }
    }
    this.detectDeadlocks();
  }

  // Build wait-for graph (simplified): edges p -> q if p waiting for a lock owned by q; or waiting for a channel and q wrote to it.
  buildWaitForGraph() {
    const nodes = Object.keys(this.processes);
    const edges = [];
    for (const p of Object.values(this.processes)) {
      if (!p.waitingFor) continue;
      if (p.waitingFor.type === 'lock') {
        const { channelId, lockName } = p.waitingFor;
        const ch = this.channels[channelId];
        const L = ch?.locks[lockName];
        if (L && L.owner) edges.push({ from: p.pid, to: L.owner, reason: `waiting on lock ${channelId}:${lockName}` });
      } else if (p.waitingFor.type === 'channel') {
        const ch = this.channels[p.waitingFor.channelId];
        if (ch) {
          const writers = new Set();
          for (const m of ch.buffer) writers.add(m.from);
          writers.forEach(w => edges.push({ from: p.pid, to: w, reason: `waiting on channel ${ch.cid}` }));
        }
      }
    }
    return { nodes, edges };
  }

  detectDeadlocks() {
    const g = this.buildWaitForGraph();
    const adj = {};
    for (const n of g.nodes) adj[n] = [];
    for (const e of g.edges) if (adj[e.from]) adj[e.from].push(e.to);

    // Tarjan
    let index = 0; const indices = {}; const lowlink = {}; const stack = []; const onstack = {};
    const sccs = [];
    const self = this;

    function strong(v) {
      indices[v] = index; lowlink[v] = index; index++; stack.push(v); onstack[v] = true;
      (adj[v] || []).forEach(w => {
        if (indices[w] === undefined) { strong(w); lowlink[v] = Math.min(lowlink[v], lowlink[w]); }
        else if (onstack[w]) lowlink[v] = Math.min(lowlink[v], indices[w]);
      });
      if (lowlink[v] === indices[v]) {
        const comp = [];
        let w;
        do { w = stack.pop(); onstack[w] = false; comp.push(w); } while (w !== v);
        sccs.push(comp);
      }
    }

    for (const v of g.nodes) if (indices[v] === undefined) strong(v);

    const cycles = sccs.filter(c => c.length > 1 || (c.length === 1 && (adj[c[0]] || []).includes(c[0])));
    if (cycles.length > 0) {
      const cycleDetails = cycles.map(cycle => {
        const edgesInCycle = [];
        for (const a of cycle) {
          for (const e of g.edges) if (e.from === a && cycle.includes(e.to)) edgesInCycle.push(e);
        }
        return { nodes: cycle, edges: edgesInCycle };
      });
      this.emit({ type: 'deadlock.detected', payload: { cycles: cycleDetails, timestamp: Date.now() } });
    }
  }

  getState() {
    const procs = {};
    for (const [k,p] of Object.entries(this.processes)) {
      procs[k] = { ...p, heldLocks: Array.from(p.heldLocks) };
    }
    return { processes: procs, channels: this.channels };
  }

  pause() { this.running = false; this.emit({ type: 'sim.paused' }); }
  resume() { this.running = true; this.emit({ type: 'sim.resumed' }); }
}

module.exports = Simulator;
