import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import url from "node:url";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/** Config */
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const TICK_MS = 500;

/** In-memory store (ok for exhibitions; swap to Redis/Postgres later) */
const sessions = new Map();

const MAX_SESSION_LOGS = 400;
/*
  session = {
    id, scenarioId,
    scenario,                    // JSON
    createdAt, startedAt|null,   // ms epoch
    timer: {intervalId|null, t:0}, // t = seconds since start, server-authoritative
    sockets: { ops:Set<ws>, control:Set<ws> },
    participants: Map<participantId, { id, codename, score:number }>,
    inputs: Map<eventId, Map<participantId, inputObj>>,
    scoreAgg: { mean:0, max:0, activeCount:0 }
  }
*/

/** Load scenario helper */
function loadScenario(scenarioId) {
  const p = path.join(__dirname, "scenarios", `${scenarioId}.json`);
  const text = fs.readFileSync(p, "utf8");
  return JSON.parse(text);
}

/** Scoring (Kahoot-style) */
function computeScore({ event, action, nowSec }) {
  const window = event.responseWindowSec;
  const start = event.t;
  const end = start + window;
  const pointsPossible = event.pointsPossible ?? 100;
  const penalties = { wrong: -100, late: -50, noResponse: -50, ...(event.penalties || {}) };

  // late
  if (nowSec > end) {
    return { delta: penalties.late, reason: "late" };
  }

  // before event window
  if (nowSec < start) {
    return { delta: 0, reason: "too_early" };
  }

  // wrong action inside window
  if (action !== event.correctAction) {
    return { delta: penalties.wrong, reason: "wrong" };
  }

  // correct inside window: Kahoot-like decay
  const responseTime = Math.max(0, nowSec - start); // seconds
  const factor = 1 - ((responseTime / window) / 2); // 1..0.5
  const pts = Math.round(Math.max(0, factor) * pointsPossible);
  return { delta: pts, reason: "correct", responseTime };
}

/** Broadcast helpers */
function bcast(set, msg) {
  const data = JSON.stringify(msg);
  for (const ws of set) {
    try { ws.readyState === ws.OPEN && ws.send(data); } catch {}
  }
}

function sessionLog(session, tag, message, level = "info", meta) {
  if (!session) return;
  if (!Array.isArray(session.logs)) session.logs = [];
  const entry = {
    id: nanoid(8),
    ts: Date.now(),
    tag,
    message,
    level,
    sessionId: session.id,
  };
  if (meta && typeof meta === "object" && Object.keys(meta).length) {
    entry.meta = meta;
  }
  session.logs.push(entry);
  if (session.logs.length > MAX_SESSION_LOGS) {
    session.logs.splice(0, session.logs.length - MAX_SESSION_LOGS);
  }
  const tagLabel = tag ? `[${tag}]` : "[LOG]";
  console.log(`[${session.id}] ${tagLabel} ${message}`);
  try {
    bcast(session.sockets.ops, { type: "log", entry });
  } catch {
    // noop
  }
  return entry;
}

/** Aggregate score calc */
function recomputeAgg(session) {
  const vals = [...session.participants.values()].map(p => p.score || 0);
  const mean = vals.length ? (vals.reduce((a,b)=>a+b,0) / vals.length) : 0;
  const max = vals.length ? Math.max(...vals) : 0;
  session.scoreAgg = { mean, max, activeCount: vals.length };
}

/** event open/close helpers */
function openEventsIfNeeded(session, tSec) {
  for (const ev of session.scenario.events) {
    if (ev._opened || tSec < ev.t) continue;
    ev._opened = true;
    sessionLog(
      session,
      "EVENT OPEN",
      `${ev.id} '${ev.title || ev.correctAction}' @t=${ev.t}s window=${ev.responseWindowSec}s loc='${ev.location || ""}'`,
      "event"
    );
    // announce opening
    bcast(session.sockets.ops, { type: "event_open", event: ev });
    bcast(session.sockets.control, { type: "event_open", event: publicEvent(ev) });

    // schedule algo copy ticks (per tOffset)
    if (Array.isArray(ev.algoCopy)) {
      for (const hint of ev.algoCopy) {
        setTimeout(() => {
          // if still within window, emit
          const nowT = getSessionT(session);
          if (nowT <= ev.t + ev.responseWindowSec) {
            bcast(session.sockets.control, { type: "algo", eventId: ev.id, text: hint.text });
            bcast(session.sockets.ops,      { type: "algo", eventId: ev.id, text: hint.text });
          }
        }, Math.max(0, (ev.t + hint.tOffset - tSec) * 1000));
      }
    } else {
      // default "abrasive" tone prompt
      const text = `EXECUTE: ${ev.correctAction.toUpperCase()} at ${ev.location}.`;
      bcast(session.sockets.control, { type: "algo", eventId: ev.id, text });
      bcast(session.sockets.ops,      { type: "algo", eventId: ev.id, text });
    }

    // schedule auto-close
    setTimeout(() => closeEvent(session, ev.id), Math.max(0, (ev.t + ev.responseWindowSec - tSec) * 1000));
  }
}

function closeEvent(session, eventId) {
  const ev = session.scenario.events.find(e => e.id === eventId);
  if (!ev || ev._closed) return;
  ev._closed = true;
  sessionLog(session, "EVENT CLOSE", `${eventId} window closed`, "event");

  // penalize noResponse for participants without an input
  const perEvent = session.inputs.get(eventId) || new Map();
  for (const [pid, p] of session.participants) {
    if (!perEvent.has(pid)) {
      const delta = ev.penalties?.noResponse ?? -50;
      p.score = (p.score || 0) + delta;
      // personal feedback
      const socket = [...session.sockets.control].find(ws => ws._pid === pid);
      if (socket) {
        socket.send(JSON.stringify({ type: "feedback", eventId, delta, total: p.score, reason: "no_response" }));
      }
    }
  }
  recomputeAgg(session);

  bcast(session.sockets.ops, { type: "event_close", eventId });
  bcast(session.sockets.control, { type: "event_close", eventId });

  // if last event closed, schedule finale
  const allClosed = session.scenario.events.every(e => e._closed);
  if (allClosed) {
    const endDelay = (session.scenario.meta?.endBufferSec ?? 8) * 1000;
    setTimeout(() => finalizeSession(session), endDelay);
  }
}

function finalizeSession(session) {
  if (session._finalized) return;
  session._finalized = true;
  sessionLog(session, "SESSION", "Finalized. Leaderboard dispatched.", "system");

  // leaderboard
  const leaderboard = [...session.participants.values()]
    .map(p => ({ participantId: p.id, codename: p.codename, score: p.score || 0 }))
    .sort((a,b) => b.score - a.score)
    .map((r, idx) => ({ ...r, rank: idx + 1 }));

  bcast(session.sockets.ops, { type: "final", leaderboard });
  // personal finals
  for (const ws of session.sockets.control) {
    const pid = ws._pid;
    const me = session.participants.get(pid);
    const personalTotal = me ? (me.score || 0) : 0;
    ws.send(JSON.stringify({ type: "final", personalTotal }));
  }

  // stop clock
  if (session.timer.intervalId) {
    clearInterval(session.timer.intervalId);
    session.timer.intervalId = null;
  }
}

/** Session helpers */
function getSessionT(session) {
  if (!session.startedAt) return 0;
  const ms = Date.now() - session.startedAt;
  return Math.max(0, Math.floor(ms / 1000));
}

function publicEvent(ev) {
  // control clients don’t need internal flags
  const { _opened, _closed, ...rest } = ev;
  if ((!Array.isArray(rest.actions) || rest.actions.length === 0) &&
      Array.isArray(rest.allowedActions) && rest.allowedActions.length) {
    rest.actions = rest.allowedActions.slice();
  }
  return rest;
}

/** Express + WS setup */
const app = express();
app.use(cors());
app.use(express.json());

/** Create session */
app.post("/api/session", (req, res) => {
  const scenarioId = (req.body?.scenarioId || "sector-c-ops-01").toString();
  let scenario;
  try { scenario = loadScenario(scenarioId); }
  catch {
    return res.status(400).json({ error: "SCENARIO_NOT_FOUND" });
  }

  const id = nanoid(6).toUpperCase();
  const session = {
    id,
    scenarioId,
    scenario,
    createdAt: Date.now(),
    startedAt: null,
    timer: { intervalId: null },
    sockets: { ops: new Set(), control: new Set() },
    participants: new Map(),
    inputs: new Map(),
    scoreAgg: { mean: 0, max: 0, activeCount: 0 },
    logs: [],
  };
  sessions.set(id, session);
  sessionLog(session, "SESSION", `Created for scenario '${scenarioId}'`, "system");
  sessionLog(session, "SESSION", `OPS URL: http://localhost:5173/?mode=assessment&session=${id}#/ops`, "system");
  res.json({ sessionId: id });
});

/** Start session clock */
app.post("/api/session/:id/start", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "SESSION_NOT_FOUND" });
  if (session.startedAt) return res.json({ ok: true, t: getSessionT(session) });

  session.startedAt = Date.now();
  // clear prev flags in case of reuse
  for (const ev of session.scenario.events) {
    delete ev._opened;
    delete ev._closed;
  }

  session.timer.intervalId = setInterval(() => {
    const tSec = getSessionT(session);
    // broadcast tick
    bcast(session.sockets.ops, { type: "tick", t: tSec, score_agg: session.scoreAgg });
    bcast(session.sockets.control, { type: "tick", t: tSec });
    // open events as we pass them
    openEventsIfNeeded(session, tSec);
  }, TICK_MS);
  sessionLog(
    session,
    "SESSION",
    `Started at ${new Date(session.startedAt).toLocaleTimeString()} (${session.scenarioId})`,
    "system"
  );
  res.json({ ok: true, startedAt: session.startedAt });
});

/** Get scenario (for client preloading hints/labels) */
app.get("/api/session/:id/scenario", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "SESSION_NOT_FOUND" });
  res.json(s.scenario);
});

/** Participant input (scored server-side) */
app.post("/api/session/:id/input", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "SESSION_NOT_FOUND" });

  const participantId = (req.body?.participantId || "").toString() || nanoid(10);
  const codename = (req.body?.codename || `Unit ${String(Math.floor(Math.random()*10000)).padStart(4,"0")}`).toString();
  const eventId = (req.body?.eventId || "").toString();
  const action = (req.body?.action ?? req.body?.choice ?? "").toString();

  // upsert participant
  const p = s.participants.get(participantId) || { id: participantId, codename, score: 0 };
  p.codename = codename || p.codename;
  s.participants.set(participantId, p);

  // event validity
  const ev = s.scenario.events.find(e => e.id === eventId);
  if (!ev) return res.status(400).json({ error: "EVENT_NOT_FOUND" });

  const nowSec = getSessionT(s);
  if (nowSec < ev.t) return res.status(409).json({ error: "TOO_EARLY" });

  // ignore if window closed
  if (nowSec > ev.t + ev.responseWindowSec) {
    const delta = ev.penalties?.late ?? -50;
    p.score += delta;
    recomputeAgg(s);
    // personal feedback
    bcastPersonal(s, participantId, { type:"feedback", eventId, delta, total:p.score, reason:"late" });
    sessionLog(
      s,
      "INPUT",
      `${p.codename} late for ${eventId} (Δ ${delta}) total=${p.score}`,
      "warn",
      { participantId, eventId, reason: "late" }
    );
    return res.json({ ok: true, accepted: false, reason: "late" });
  }

  // first input only per participant/event
  const perEvent = s.inputs.get(eventId) || new Map();
  if (perEvent.has(participantId)) {
    sessionLog(
      s,
      "INPUT",
      `${p.codename} duplicate on ${eventId}`,
      "warn",
      { participantId, eventId, reason: "duplicate" }
    );
    return res.json({ ok: true, accepted: false, reason: "duplicate" });
  }

  const { delta, reason, responseTime } = computeScore({ event: ev, action, nowSec });
  perEvent.set(participantId, { participantId, eventId, action, t: nowSec, delta, reason });
  s.inputs.set(eventId, perEvent);

  p.score += delta;
  recomputeAgg(s);

  // personal feedback to just this participant
  bcastPersonal(s, participantId, { type: "feedback", eventId, delta, total: p.score, reason, responseTime });

  // OPS aggregate trend
  bcast(s.sockets.ops, { type: "score_agg", ...s.scoreAgg });

  sessionLog(
    s,
    "INPUT",
    `${p.codename} → ${action} on ${eventId} :: ${reason} (Δ ${delta}) total=${p.score}`,
    "info",
    { participantId, eventId, action, reason, delta }
  );
  res.json({ ok: true, accepted: true });
});

function bcastPersonal(session, participantId, msg) {
  for (const ws of session.sockets.control) {
    if (ws._pid === participantId && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
      break;
    }
  }
}

/** Leaderboard (for finale, or mid-run if you want an admin view) */
app.get("/api/session/:id/leaderboard", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "SESSION_NOT_FOUND" });
  const rows = [...s.participants.values()]
    .map(p => ({ participantId: p.id, codename: p.codename, score: p.score || 0 }))
    .sort((a,b)=>b.score-a.score)
    .map((r,i)=>({ ...r, rank: i+1 }));
  res.json(rows);
});

/** Dev: open a synthetic event immediately (for testing controller -> /input) */
app.post("/api/session/:id/dev/open", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "SESSION_NOT_FOUND" });
  if (!s.startedAt) return res.status(409).json({ error: "SESSION_NOT_STARTED" });

  const nowT = getSessionT(s);
  const windowSec = Number(req.body?.windowSec ?? 15);
  const correctAction = (req.body?.correctAction || "TEST_ACTION").toString();
  const actions = Array.isArray(req.body?.actions) && req.body.actions.length
    ? req.body.actions.map(String)
    : ["TEST_ACTION","ACK_DIRECTIVE","HOLD POSITION","REQUEST BACKUP"];
  const location = (req.body?.location || "Dev Injection").toString();

  const ev = {
    id: nanoid(6).toUpperCase(),
    t: nowT,
    responseWindowSec: windowSec,
    correctAction,
    actions,
    location,
    pointsPossible: 100,
    penalties: { late: -50, wrong: -100, noResponse: -50 },
    banner: `DEV: ${correctAction} at ${location}`,
    algoCopy: [{ tOffset: 0, text: `EXECUTE: ${correctAction} at ${location}.` }]
  };

  // add to scenario and trigger open on next pass
  s.scenario.events.push(ev);
  // Open immediately using current t
  openEventsIfNeeded(s, nowT);

  sessionLog(
    s,
    "DEV",
    `Opened synthetic event ${ev.id} (${correctAction}) at t=${nowT}s`,
    "debug",
    { eventId: ev.id }
  );
  return res.json({ ok: true, eventId: ev.id });
});

/** Dev: push an Algorithm line immediately */
app.post("/api/session/:id/dev/algo", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "SESSION_NOT_FOUND" });
  const text = (req.body?.text || "EXECUTE: Maintain order.").toString();
  bcast(s.sockets.control, { type: "algo", text });
  bcast(s.sockets.ops,      { type: "algo", text });
  sessionLog(s, "DEV", `Algo push: ${text}`, "debug");
  return res.json({ ok: true });
});

/** HTTP server + WebSocket upgrade */
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  // Each client must send a hello:
  // { type:"hello", role:"ops"|"control", sessionId:"...", participantId?:"...", codename?:"..." }
  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    // DEV visibility: log hello envelopes
    if (msg && msg.type === 'hello') {
      const role = (msg.role || '').toString();
      const sid = (msg.sessionId || '').toString();
      console.log(`[WS] hello role=${role} sessionId=${sid}`);
    }

    if (msg.type === "hello") {
      const role = (msg.role || "").toString().toLowerCase();
      const session = sessions.get((msg.sessionId || "").toString());
      if (!session) {
        try { ws.send(JSON.stringify({ type:"error", error:"SESSION_NOT_FOUND" })); } catch {}
        ws.close(); return;
      }

      // Confirm resolved session
      // console.log(`[WS] bound to session ${session.id}`);

      if (role === "ops") {
        ws._role = "ops";
        ws._sid = session.id;
        session.sockets.ops.add(ws);
        // greet with current state
        ws.send(JSON.stringify({ type:"hello_ack", role:"ops", sessionId:session.id }));
        // if started, send tick + any open events
        const t = getSessionT(session);
        ws.send(JSON.stringify({ type:"tick", t, score_agg: session.scoreAgg }));
        for (const ev of session.scenario.events) {
          if (ev._opened && !ev._closed) {
            ws.send(JSON.stringify({ type:"event_open", event: ev }));
          }
        }
        const history = Array.isArray(session.logs) ? session.logs.slice(-200) : [];
        if (history.length) {
          ws.send(JSON.stringify({ type: "log_snapshot", entries: history }));
        }
        sessionLog(session, "OPS", `Dashboard connected (active OPS sockets: ${session.sockets.ops.size})`, "system");
        return;
      }

      if (role === "control") {
        // check join
        ws._role = "control";
        ws._sid = session.id;

        // upsert participant on hello (codename may be default)
        const participantId = (msg.participantId || nanoid(10)).toString();
        const codename = (msg.codename || `Unit ${String(Math.floor(Math.random()*10000)).padStart(4,"0")}`).toString();
        ws._pid = participantId;

        const wasExisting = session.participants.has(participantId);
        const p = session.participants.get(participantId) || { id: participantId, codename, score: 0 };
        p.codename = codename || p.codename;
        session.participants.set(participantId, p);

        session.sockets.control.add(ws);

        ws.send(JSON.stringify({ type:"hello_ack", role:"control", sessionId:session.id, participantId, codename }));

        sessionLog(
          session,
          wasExisting ? "REJOIN" : "JOIN",
          `${p.codename} ${wasExisting ? "reconnected" : "joined"} (participants: ${session.participants.size})`,
          "info",
          { participantId }
        );

        // sync with clock + current open events
        const t = getSessionT(session);
        ws.send(JSON.stringify({ type:"tick", t }));
        for (const ev of session.scenario.events) {
          if (ev._opened && !ev._closed) {
            ws.send(JSON.stringify({ type:"event_open", event: publicEvent(ev) }));
          }
        }
        return;
      }

      // backwards-compat if your existing OPS sends "dashboard"
      if (msg.role === "dashboard") {
        ws._role = "ops";
        const session = [...sessions.values()][0]; // attach to first session if unspecified
        if (!session) return;
        ws._sid = session.id;
        session.sockets.ops.add(ws);
        ws.send(JSON.stringify({ type:"hello_ack", role:"ops", sessionId:session.id }));
        ws.send(JSON.stringify({ type:"tick", t:getSessionT(session), score_agg: session.scoreAgg }));
      }
    }
  });

  ws.on("close", () => {
    const role = ws._role, sid = ws._sid;
    if (!role || !sid) return;
    const s = sessions.get(sid);
    if (!s) return;
    if (role === "ops") {
      s.sockets.ops.delete(ws);
      sessionLog(s, "OPS", `Dashboard disconnected (active OPS sockets: ${s.sockets.ops.size})`, "system");
    }
    if (role === "control") {
      s.sockets.control.delete(ws);
      const pid = ws._pid;
      const participant = pid ? s.participants.get(pid) : null;
      const label = participant?.codename || pid || "Unknown Participant";
      sessionLog(
        s,
        "LEAVE",
        `${label} disconnected (control sockets: ${s.sockets.control.size})`,
        "info",
        pid ? { participantId: pid } : undefined
      );
    }
  });
});

server.listen(PORT, () => {
  console.log(`HCI server on http://0.0.0.0:${PORT}`);
});
