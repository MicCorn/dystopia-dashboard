import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
// Polyfill for crypto.randomUUID() on non-secure contexts (e.g., http://LAN-IP)
// Many browsers expose window.crypto only on secure contexts (HTTPS/localhost).
(function ensureUUID() {
  const hasCrypto = typeof globalThis.crypto !== 'undefined';
  const hasUUID = hasCrypto && typeof globalThis.crypto.randomUUID === 'function';
  if (hasUUID) return;
  if (!hasCrypto) globalThis.crypto = {};
  globalThis.crypto.randomUUID = function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
})();
// ===== Assessment Mode Query Params =====
const qs = new URLSearchParams(window.location.search);
const ASSESSMENT_SESSION_ID = qs.get("session");
const IS_ASSESSMENT_MODE = (qs.get("mode") || "").toLowerCase() === "assessment" && !!ASSESSMENT_SESSION_ID;
const SESSION_REDIRECT_KEY = "hci-session-redirect";
// --- WebSocket remote alert constants ---
const WS_URL = import.meta.env.VITE_ALERT_WS_URL || "ws://localhost:8787";
const asLevel = (v) => (v || "").toString().toLowerCase();
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  Activity,
  Shield,
  MapPin,
  Camera,
  Siren,
  MonitorCog,
  Zap,
  Waves,
  Megaphone,
  Building2,
  Gauge,
  Radio,
  Volume2,
  VolumeX,
  Award,
  Loader2,
  RefreshCw,
  Sparkles
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip as ShadTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  Tooltip as RechartsTooltip,
} from "recharts";

const CRITICAL_ACTIONS = [
  "Dispatch nearest units",
  "Throttle hit window",
  "Initiate co-op protocol",
];

// --- Utility helpers ---
const fmt = (n) => n.toLocaleString();
const nowStamp = () => new Date().toLocaleString();

function useClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t.toLocaleString();
}

function useIsPortrait() {
  const getPortrait = () => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
    return window.matchMedia("(orientation: portrait)").matches;
  };

  const [isPortrait, setIsPortrait] = React.useState(getPortrait);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(orientation: portrait)");
    const handle = (event) => setIsPortrait(event.matches);
    setIsPortrait(mq.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handle);
      return () => mq.removeEventListener("change", handle);
    }
    if (typeof mq.addListener === "function") {
      mq.addListener(handle);
      return () => mq.removeListener(handle);
    }
    return undefined;
  }, []);

  return isPortrait;
}

// ---- Simple hash routing for dual-screen presentation ----
function getViewFromHash() {
  const h = (window.location.hash || "").toLowerCase();
  if (h.includes("/media")) return "media";     // TV feeds, CCTV, social, PSAs
  if (h.includes("/control")) return "control"; // controller app
  if (h.includes("/leaderboard")) return "leaderboard"; // assessment results
  return "ops"; // default
}

function hashForView(view) {
  switch ((view || "").toLowerCase()) {
    case "media":
      return "#/media";
    case "control":
      return "#/control";
    case "leaderboard":
      return "#/leaderboard";
    default:
      return "#/ops";
  }
}

// Generate synthetic time-series data with real timestamps
function useTimeSeries(points = 24, intervalMs = 5000) {
  points = Number(points) || 24;
  intervalMs = Number(intervalMs) || 5000;
  // seed initial series as a rolling window ending "now"
  const seedNow = Date.now();
  const initial = Array.from({ length: points }, (_, i) => {
    const t = seedNow - (points - i) * intervalMs;
    const base = i;
    return {
      t, // numeric timestamp (ms)
      incidents: Math.max(0, Math.round(5 + 12 * Math.sin(base / 2) + Math.random() * 6)),
      recalibrations: Math.max(0, Math.round(3 + 6 * Math.cos(base / 3) + Math.random() * 4)),
    };
  });

  const [data, setData] = useState(initial);

  useEffect(() => {
    const id = setInterval(() => {
      setData((prev) => {
        const last = prev.at(-1);
        const nextPoint = {
          t: Date.now(),
          incidents: Math.max(0, Math.round((last?.incidents ?? 10) * 0.9 + Math.random() * 8)),
          recalibrations: Math.max(0, Math.round((last?.recalibrations ?? 7) * 0.85 + Math.random() * 5)),
        };
        const out = [...prev, nextPoint];
        // keep only the latest `points` entries
        return out.slice(Math.max(0, out.length - points));
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [points, intervalMs]);

  return data;
}

// Simulated alerts
const ALERT_TYPES = [
  { level: "info", icon: Bell, label: "Calibration Window", tone: "bg-blue-500/20 border-blue-500/50" },
  { level: "elevated", icon: Megaphone, label: "Unrest Chatter", tone: "bg-yellow-500/20 border-yellow-500/50" },
  { level: "high", icon: AlertTriangle, label: "Implant Spike Detected", tone: "bg-orange-500/20 border-orange-500/50" },
  { level: "critical", icon: Siren, label: "Mass Growler Event", tone: "bg-red-500/20 border-red-500/50" },
];

// Weighted likelihood: each level is half as likely as the previous (info > elevated > high > critical)
const ALERT_WEIGHTS = {
  info: 1,
  elevated: 0.5,
  high: 0.25,
  critical: 0.05,
};

const SOCIAL_FEED_ITEMS = [
  "#Growlers spotted near Transit Hub | police scanner ch7",
  "Rumor: paste truck delay @ South Tunnels",
  "Implant ping fail rate +3.2% | region C",
  "Chant recorded: ‘We eat when *we* choose!’",
  "Counter-PSA trending: ‘Satisfaction is a right.’",
  "Crowd density 125% threshold @ Atrium",
  "Unit C-12 en route | 2 min ETA",
];

const RADIO_CHANNELS = [
  { id: 1, name: "Channel 1", detail: "Dispatch Net", txIndex: 1 },
  { id: 2, name: "Channel 2", detail: "Field Ops Loop", txIndex: 2 },
  { id: 3, name: "Channel 3", detail: "Sector Command", txIndex: 3 },
  { id: 4, name: "Channel 4", detail: "Relief Corridor", txIndex: 4 },
  { id: 5, name: "Channel 5", detail: "Logistics Queue", txIndex: 1 },
  { id: 6, name: "Channel 6", detail: "Medical Priority", txIndex: 2 },
];

const CCTV_FEEDS = [
  { id: "c1", label: "Corridor Cam 200", src: "/video/cam-wall.mp4", badgeLabel: "CCTV" },
  { id: "c2", label: "DKUB Broadcast", src: "/video/news.mp4", badgeLabel: "News" },
  { id: "c3", label: "Street Cam 07", src: "/video/cam1.mp4", badgeLabel: "CCTV" },
  { id: "c4", label: "Implant Ops Overlay", src: "/video/implant.mp4", badgeLabel: "Ops" },
];

const CONTROL_IDENTITY_STORAGE_PREFIX = "dystopia-control";

function sanitizeCodename(input) {
  if (typeof input !== "string") return "";
  return input.trim().replace(/\s+/g, " ").slice(0, 32);
}

function getIdentityStorageKey(sessionId) {
  return `${CONTROL_IDENTITY_STORAGE_PREFIX}:${sessionId}`;
}

function loadStoredIdentity(sessionId) {
  if (typeof window === "undefined" || !sessionId) return {};
  try {
    const key = getIdentityStorageKey(sessionId);
    const raw = window.localStorage?.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const { participantId = null, codename = null } = parsed;
      return {
        participantId: participantId || null,
        codename: sanitizeCodename(codename || "") || null,
      };
    }
  } catch (err) {
    console.warn("Failed to load stored identity", err);
  }
  return {};
}

function persistStoredIdentity(sessionId, identity) {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    const key = getIdentityStorageKey(sessionId);
    const participantId = identity?.participantId || null;
    const codename = sanitizeCodename(identity?.codename || "") || null;
    if (!participantId && !codename) {
      window.localStorage?.removeItem(key);
      return;
    }
    window.localStorage?.setItem(key, JSON.stringify({ participantId, codename }));
  } catch (err) {
    console.warn("Failed to persist identity", err);
  }
}

// ===== Algorithm Banner (Assessment Mode) =====
function AlgorithmBanner({ text }) {
  if (!text) return null;
  return (
    <div className="sticky top-[52px] z-[35] w-full px-4 py-2 bg-red-900/30 border-b border-red-500/30 backdrop-blur">
      <div className="max-w-[95rem] mx-auto flex items-center gap-3 text-red-200">
        <Siren className="w-4 h-4" />
        <div className="text-sm font-semibold tracking-wide">THE ALGORITHM:</div>
        <div className="text-sm">{text}</div>
      </div>
    </div>
  );
}

function LeaderboardPane({
  rows,
  status,
  error,
  onRetry,
  assessmentFinal,
  typingIndex,
  algoText,
  sessionId,
  isAssessment,
}) {
  const hasContestants = Array.isArray(rows) && rows.some((row) => !row?.placeholder);
  const directiveMessage = assessmentFinal
    ? "The following members have been selected to join the HCI Taskforce."
    : "Awaiting final clearance from THE ALGORITHM. Maintain observation protocols.";
  const sessionTag = sessionId
    ? `Session ${sessionId}`
    : isAssessment
      ? "Session Link Active"
      : "Live Operations";
  const statusLabel = status === "loading" ? "Compiling" : assessmentFinal ? "Finalized" : "Pending";
  const footnote = assessmentFinal
    ? "Distribute credentials immediately. Monitor for override directives."
    : "Hold transmissions until THE ALGORITHM concludes.";

  const formatScore = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) return "—";
    return value.toLocaleString();
  };

  const rowTone = (row) => {
    if (row?.placeholder) return "border-white/5 bg-black/30 text-white/40";
    if (row.rank === 1) return "border-emerald-400/70 bg-emerald-500/10 text-emerald-50 shadow-[0_0_25px_rgba(34,197,94,0.25)]";
    if (row.rank === 2) return "border-cyan-400/60 bg-cyan-500/10 text-cyan-50";
    if (row.rank === 3) return "border-blue-400/60 bg-blue-500/10 text-blue-50";
    return "border-white/10 bg-white/5 text-white/80";
  };

  const scoreTone = (row, revealed) => {
    if (!revealed) return "text-white/30";
    if (typeof row?.score === "number") {
      return row.score <= 0 ? "text-emerald-300" : "text-rose-300";
    }
    return "text-white/50";
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 overflow-y-auto py-10 md:py-12">
        <div className="max-w-5xl mx-auto px-2 sm:px-4 space-y-8">
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-3 text-[11px] uppercase tracking-[0.5em] text-emerald-300">
              <Sparkles className="w-4 h-4" />
              <span>THE ALGORITHM</span>
              <Sparkles className="w-4 h-4" />
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-white">Selection Ledger // HCI Taskforce</h1>
            <p className="max-w-2xl mx-auto text-sm md:text-base text-white/70">{directiveMessage}</p>
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs uppercase tracking-[0.35em] text-white/40 font-mono">
              <span>{sessionTag}</span>
              <span className="h-3 w-px bg-white/20" aria-hidden="true" />
              <span>Status · {statusLabel}</span>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-neutral-950/90 shadow-[0_0_45px_rgba(34,197,94,0.18)]">
            <div className="absolute inset-0 pointer-events-none border border-emerald-400/20 rounded-3xl" />
            <div className="absolute inset-0 [mask-image:radial-gradient(circle_at_top,rgba(34,197,94,0.28),transparent_75%)] bg-emerald-500/10" />
            <div className="relative p-6 sm:p-8 space-y-6">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between text-xs uppercase tracking-[0.35em] text-white/40 font-mono">
                <span>Clearance Broadcast</span>
                <span>Authority // THE ALGORITHM</span>
              </div>

              {algoText ? (
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-left text-sm text-emerald-100 shadow-[0_0_25px_rgba(34,197,94,0.18)]">
                  <div className="text-[10px] uppercase tracking-[0.6em] text-emerald-200/80 mb-1">Live Decree</div>
                  <div className="leading-relaxed">{algoText}</div>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.4em] text-white/50">
                  Awaiting pronouncement from THE ALGORITHM…
                </div>
              )}

              {status === "loading" ? (
                <div className="py-12 grid place-items-center text-white/70">
                  <Loader2 className="w-9 h-9 animate-spin text-emerald-300" />
                  <div className="mt-4 text-sm text-white/60">Compiling candidate telemetry…</div>
                </div>
              ) : status === "error" ? (
                <div className="py-12 text-center space-y-5">
                  <div className="text-sm text-rose-300">{error || "Unable to retrieve leaderboard."}</div>
                  <Button
                    onClick={onRetry}
                    className="inline-flex items-center gap-2 bg-emerald-500 text-black hover:bg-emerald-400"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retry uplink
                  </Button>
                </div>
              ) : hasContestants ? (
                <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
                  <AnimatePresence initial={false}>
                    {rows.map((row, idx) => {
                      const key = row?.placeholder ? `placeholder-${idx}` : row?.participantId || row?.rank || idx;
                      const rowClass = rowTone(row);
                      const totalLength = (row?.codename || "").length;
                      const revealed = !row?.placeholder && (row?.typedName?.length || 0) >= totalLength && totalLength >= 0;
                      const scoreClass = scoreTone(row, revealed);
                      return (
                        <motion.div
                          key={key}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05, duration: 0.4 }}
                          className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-4 backdrop-blur-sm ${rowClass}`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`relative flex h-12 w-12 items-center justify-center rounded-full border ${row?.placeholder ? 'border-white/15 text-white/35 bg-black/40' : 'border-white/30 text-white bg-black/30'}`}>
                              <span className="font-semibold tracking-wide text-sm">#{String(row?.rank ?? idx + 1).padStart(2, '0')}</span>
                              {!row?.placeholder && row?.rank === 1 && (
                                <Award className="absolute -top-3 right-0 w-4 h-4 text-emerald-300 drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                              )}
                            </div>
                            <div>
                              <div className="text-lg font-semibold text-white tracking-tight">
                                {row?.placeholder ? (
                                  <span className="text-white/30">— — —</span>
                                ) : (
                                  <span className="font-mono">
                                    {row?.typedName || '\u00A0'}
                                    {typingIndex === idx && (
                                      <span className="ml-1 inline-block align-baseline text-emerald-200 animate-pulse">▌</span>
                                    )}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] uppercase tracking-[0.35em] text-white/40 mt-1">
                                {row?.placeholder ? "Awaiting candidate" : row?.participantId}
                              </div>
                              {!row?.placeholder && revealed && row?.rank <= 3 && (
                                <Badge className="mt-2 w-fit bg-emerald-500/20 border-emerald-400/40 text-emerald-200 text-[10px] uppercase tracking-[0.3em]">
                                  Clearance Granted
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] uppercase tracking-[0.5em] text-white/35">Score</div>
                            {row?.placeholder ? (
                              <div className="text-sm text-white/30">—</div>
                            ) : (
                              <div className={`mt-1 text-xl font-semibold font-mono ${scoreClass}`}>
                                {revealed ? formatScore(row?.score) : "⋯"}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-white/60">
                  {assessmentFinal
                    ? "No qualifying participants logged for this session."
                    : "The Algorithm is still vetting participants. Hold for final adjudication."}
                </div>
              )}

              <Separator className="bg-white/10" />
              <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">
                {footnote}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== QR Card (Assessment Mode) =====
function QRCard({ sessionId }) {
  const [dataUrl, setDataUrl] = React.useState(null);
  const [startStatus, setStartStatus] = React.useState("idle");
  const [startMessage, setStartMessage] = React.useState("");
  const controlUrl = `${window.location.origin}/?mode=assessment&session=${encodeURIComponent(sessionId || "")}#/control`;
  const startEndpoint = sessionId ? `http://localhost:8787/api/session/${encodeURIComponent(sessionId)}/start` : null;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import(/* @vite-ignore */ "qrcode").catch(() => null);
        if (!mod || !mod.toDataURL) return;
        const url = await mod.toDataURL(controlUrl, { margin: 1, scale: 6 });
        if (!cancelled) setDataUrl(url);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [controlUrl]);

  const handleStart = React.useCallback(async () => {
    if (!startEndpoint) return;
    setStartStatus("loading");
    setStartMessage("");
    try {
      const res = await fetch(startEndpoint, { method: "POST" });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body?.trim() || `Request failed (${res.status})`);
      }
      setStartStatus("success");
      setStartMessage("Session start triggered.");
    } catch (err) {
      setStartStatus("error");
      setStartMessage(err?.message || "Failed to start session.");
    }
  }, [startEndpoint]);

  return (
    <Card className="bg-neutral-900 border-white/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-white/90 flex items-center gap-2"><Radio className="w-4 h-4"/> HCI Taskforce Assessment — Join</CardTitle>
        <CardDescription className="text-white/50">Scan to open the Controller</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        {dataUrl ? (
          <img src={dataUrl} alt="Join QR" className="w-36 h-36 rounded-lg border border-white/10"/>
        ) : (
          <div className="w-36 h-36 rounded-lg border border-dashed border-white/15 grid place-items-center text-xs text-white/50">QR loading…</div>
        )}
        <div className="text-sm text-white/80 space-y-3">
          <div className="space-y-1">
            <div className="text-white/60">URL:</div>
            <div className="text-white/70 break-all">{controlUrl}</div>
          </div>
          <div className="space-y-2">
            <Button
              onClick={handleStart}
              disabled={!startEndpoint || startStatus === "loading"}
              className="flex items-center gap-2 !bg-emerald-500/90 hover:bg-emerald-400/90 text-black border border-emerald-300/60 disabled:opacity-60"
            >
              {startStatus === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span>{startStatus === "success" ? "Session Started" : "Start Session"}</span>
            </Button>
            {startMessage && (
              <div className={`text-xs ${startStatus === "error" ? "text-red-300" : "text-emerald-300"}`}>
                {startMessage}
              </div>
            )}
            {!startEndpoint && (
              <div className="text-xs text-white/50">Session ID missing; cannot start.</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Bespoke critical scenarios (no randomness in content; we rotate through these)
const CRITICAL_SCENARIOS = [
  {
    title: "Hostage Situation at Distribution Center",
    where: "West District Supply Depot",
    details: "Armed individuals have taken staff and citizens hostage at the depot, demanding access to growler supplies. Situation is volatile and escalating. Immediate threat; rapid response required.",
  },
  {
    title: "Mass Fatality",
    where: "Civic Plaza, Gate 2",
    details: "Multiple individuals have collapsed; suspected fatalities. Rapid Medical Response Required.",
  },
  {
    title: "Riot Flashpoint – Central Concourse Breach",
    where: "Central Rail Concourse",
    details: "Crowd surge has breached security barriers; projectiles reported. Risk of stampede and infrastructure damage increasing by the minute.",
  },
];

let __criticalIdx = 0;
function nextCriticalScenario() {
  const scn = CRITICAL_SCENARIOS[__criticalIdx % CRITICAL_SCENARIOS.length];
  __criticalIdx += 1;
  return scn;
}

// --- Map coordinates for known locations (percent units of map container) ---
const MAP_COORDS = {
  // districts & generic areas
  "North Concourse": { x: 72, y: 18 },
  "Loading Bay C": { x: 12, y: 64 },
  "Food Paste Kiosk 7": { x: 44, y: 58 },
  "Atrium": { x: 58, y: 36 },
  "South Tunnels": { x: 30, y: 82 },
  "Transit Hub": { x: 66, y: 54 },
  // bespoke critical sites
  "West District Supply Depot": { x: 18, y: 42 },
  "Civic Plaza, Gate 2": { x: 52, y: 28 },
  "Central Rail Concourse": { x: 61, y: 21 },
  // other incident seeds
  "South District Distribution Hub – Bay 4": { x: 24, y: 70 },
  "East Market Transit Stop": { x: 78, y: 48 },
  "North End Ration Dispensary": { x: 84, y: 26 },
  "Civic Plaza": { x: 50, y: 30 },
  "West District Supply Depot (Storage)": { x: 16, y: 40 },
  "Midtown Access Tunnel C-17": { x: 40, y: 60 },
};

// Fallback: deterministic pseudo-hash to place unknown labels consistently
function coordsFor(label) {
  if (MAP_COORDS[label]) return MAP_COORDS[label];
  const s = (label || "").toString();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const x = 5 + (h % 90);        // 5..95
  const y = 10 + ((h >>> 8) % 80); // 10..90
  return { x, y };
}

function pickWeighted(items, weightsByLevel) {
  let sum = 0;
  const thresholds = items.map((it) => {
    const w = Number(weightsByLevel[it.level] ?? 1);
    sum += w;
    return sum;
  });
  const r = Math.random() * sum;
  const idx = thresholds.findIndex((t) => r < t);
  return items[idx >= 0 ? idx : items.length - 1];
}

function randomAlert() {
  const base = pickWeighted(ALERT_TYPES, ALERT_WEIGHTS);
  const districts = [
    "North Concourse", 
    "Loading Bay C", 
    "Food Paste Kiosk 7", 
    "Atrium", 
    "South Tunnels", 
    "Transit Hub"
  ];

  let detailsOptions;
  switch (base.level) {
    case "info":
      detailsOptions = [
        "Drone feed interference",
        "Calibration window scheduled",
        "Implant ping delay",
        "Satisfaction stream nominal",
        "Routine diagnostic running",
        "Background chatter recorded",
        "Agitated civilian",
      ];
      break;
    case "elevated":
      detailsOptions = [
        "Unrest chatter detected on social feeds",
        "Crowd forming",
        "Increased implant adjustment requests",
        "Suspicious slogan propagation",
        "Supply ration delay at distribution hub",
        "Implant malfunction cluster",
        "Group Disorder",
        "Unauthorized entry attempt",
        "Individual collapse",
        "Nutrient disruption event",
      ];
      break;
    case "high":
      detailsOptions = [
        "Coordinated riot",
        "Mass agitation",
        "Black-market Paste Distribution Raid",
        "Unauthorized Nutrient Stockpile Seizure",
        "Civilian fatality",
        "Multiple unit dispatches requested",
        "Heightened agitation reported",
        "Coordinated disturbance",
      ];
      break;
    case "critical": {
      // Use bespoke, non-randomized content (rotating list) for critical alerts
      const scn = nextCriticalScenario();
      return {
        id: crypto.randomUUID(),
        level: base.level,
        icon: base.icon,
        label: scn.title,
        where: scn.where,
        ts: nowStamp(),
        details: scn.details,
        tone: ALERT_TYPES.find(t => t.level === 'critical')?.tone,
        ...coordsFor(scn.where),
      };
    }
    default:
      detailsOptions = ["General anomaly detected"];
  }

  const where = districts[Math.floor(Math.random() * districts.length)];
  return {
    id: crypto.randomUUID(),
    ...base,
    where,
    ts: nowStamp(),
    details: detailsOptions[Math.floor(Math.random() * detailsOptions.length)],
    ...coordsFor(where),
  };
}

// HotspotMap: outlined background, renders only passed alerts (with coordinates)
function HotspotMap({ alerts, heightClass = "h-[34rem]" }) {
  return (
    <div className={`relative w-full ${heightClass} rounded-2xl bg-neutral-950 border border-white/10 overflow-hidden`}>
      {/* Background city outline (placeholder wireframe) */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <defs>
          <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)"/>
        {/* Street-like strokes */}
        <g stroke="rgba(255,255,255,0.12)" strokeWidth="0.6">
          <path d="M5 20 L 95 20"/>
          <path d="M10 40 L 90 40"/>
          <path d="M15 60 L 85 60"/>
          <path d="M20 80 L 80 80"/>
          <path d="M15 10 L 15 90"/>
          <path d="M35 5 L 35 95"/>
          <path d="M55 10 L 55 90"/>
          <path d="M75 5 L 75 95"/>
        </g>
      </svg>

      {/* Alert points: 1:1 with alerts provided */}
      {alerts.map((a) => (
        <motion.div
          key={a.id}
          className={`absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ${a.level === 'critical' ? 'bg-red-500 ring-red-300/60' : a.level === 'high' ? 'bg-orange-400 ring-orange-300/60' : a.level === 'elevated' ? 'bg-yellow-400 ring-yellow-300/60' : 'bg-cyan-400 ring-cyan-300/60'}`}
          style={{ left: `${a.x ?? 50}%`, top: `${a.y ?? 50}%` }}
          animate={{ scale: [1, 1.5, 1] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        >
          <div className="absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-white/80 backdrop-blur">
            {a.label}
          </div>
        </motion.div>
      ))}

      <div className="absolute bottom-2 right-3 text-xs text-white/60">Map feed: Security Sector C</div>
    </div>
  );
}

function VideoWall({ soundOn, txIndex = 1 }) {
  const feeds = [
    { id: "c1", type: "video", label: "Corridor Cam 200", src: "/video/cam-wall.mp4", badgeLabel: "CCTV" },
    { id: "c2", type: "video", label: "DKUB", src: "/video/news.mp4", badgeLabel: "News" },
    { id: "a1", type: "audio", label: "Field Unit 7 – Latest Transmission", src: `/audio/last-transmission${txIndex}.mp3` },
    { id: "c4", type: "video", label: "Street Cam 07", src: "/video/cam1.mp4", badgeLabel: "CCTV" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {feeds.map((f) => (
        f.type === 'audio' ? (
          <AudioTile key={f.id} label={f.label} src={f.src} />
        ) : (
          <VideoTile key={f.id} label={f.label} src={f.src} soundOn={soundOn} badgeLabel={f.badgeLabel} />
        )
      ))}
    </div>
  );
}

function VideoTile({ label, src, soundOn, badgeLabel }) {
  const vref = useRef(null);

  const handleEnter = async () => {
    const el = vref.current;
    if (!el) return;
    // If global sound is off, remain muted
    if (!soundOn) return;
    try {
      el.muted = false;
      el.volume = 1.0;
      // Ensure playback continues (some browsers require calling play after unmuting)
      await el.play().catch(() => {});
    } catch {}
  };

  const handleLeave = () => {
    const el = vref.current;
    if (!el) return;
    // Re-mute but keep looping video
    el.muted = true;
  };

  return (
    <Card className="bg-black border-white/10 overflow-hidden">
      <div className="relative group" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
        <video
          ref={vref}
          src={src}
          muted
          loop
          autoPlay
          playsInline
          className="w-full h-56 object-cover contrast-125 saturate-50"
        />
        <div className="absolute top-2 left-2 flex gap-2">
          <Badge variant="secondary" className="bg-white/10 text-white backdrop-blur border border-white/20">
            <Camera className="w-3 h-3 mr-1"/> {badgeLabel ?? 'LIVE'}
          </Badge>
        </div>
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <div className="px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 backdrop-blur flex items-center gap-1 text-[10px]">
            {soundOn ? (
              <Volume2 className="w-3 h-3" />
            ) : (
              <VolumeX className="w-3 h-3" />
            )}
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-sm text-white/80">
          {label}
        </div>
      </div>
    </Card>
  );
}

function AudioTile({ label, src }) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);
  const gainRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    // Preload audio element
    const el = new Audio();
    el.crossOrigin = 'anonymous'; // allow analyser to read data when CORS permits
    el.src = src;
    el.preload = 'auto';
    el.loop = false;
    el.muted = false;
    el.volume = 1.0;
    el.playbackRate = 1.25;
    audioRef.current = el;
    const onCanPlay = () => setReady(true);
    const onEnded = () => setPlaying(false);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('ended', onEnded);
    return () => {
      el.pause();
      setPlaying(false);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('ended', onEnded);
      cancelAnimationFrame(rafRef.current);
      try { sourceRef.current?.disconnect(); } catch {}
      try { analyserRef.current?.disconnect(); } catch {}
      if (ctxRef.current && ctxRef.current.state !== 'closed') ctxRef.current.close();
    };
  }, [src]);

  const ensureAudioGraph = () => {
    if (ctxRef.current) return ctxRef.current;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !audioRef.current) return null;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512; // finer low-frequency resolution
    analyser.smoothingTimeConstant = 0.85;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    const source = ctx.createMediaElementSource(audioRef.current);
    // source -> gain -> analyser -> destination
    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    ctxRef.current = ctx;
    analyserRef.current = analyser;
    sourceRef.current = source;
    gainRef.current = gain;
    return ctx;
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    const c = canvas.getContext('2d');
    // reset transform every frame, then scale to device pixels
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.scale(dpr, dpr);
    c.clearRect(0, 0, rect.width, rect.height);
    // background grid-ish
    c.fillStyle = '#0b0b0b';
    c.fillRect(0, 0, rect.width, rect.height);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Focus on low frequencies only: map 0..cutoffHz across all bars
    const sampleRate = ctxRef.current?.sampleRate || 44100;
    const nyquist = sampleRate / 2; // highest representable frequency
    const cutoffHz = 5000; // << tweak this to taste (e.g., 800–2000)
    const maxBin = Math.max(
      1,
      Math.min(bufferLength, Math.floor((cutoffHz / nyquist) * bufferLength))
    );

    const barCount = 48;
    const gap = 2;
    const barWidth = (rect.width - (barCount - 1) * gap) / barCount;
    for (let i = 0; i < barCount; i++) {
      // Only visualize bins up to maxBin (lower frequencies), stretched across all bars
      const idx = Math.min(maxBin - 1, Math.floor(i * (maxBin / barCount)));
      // simple neighborhood smoothing
      const a = dataArray[Math.max(0, idx - 1)] || 0;
      const b = dataArray[idx] || 0;
      const c3 = dataArray[Math.min(bufferLength - 1, idx + 1)] || 0;
      const val = (a + b + c3) / 3;
      const v = val / 255; // 0..1
      const h = Math.max(2, v * (rect.height - 10));
      const x = i * (barWidth + gap);
      const y = rect.height - h;
      // gradient red-cyan like the charts
      c.fillStyle = `rgba(${Math.floor(239)}, ${Math.floor(68 + v*100)}, ${Math.floor(68)}, ${0.85})`;
      c.fillRect(x, y, barWidth, h);
    }

    rafRef.current = requestAnimationFrame(draw);
  };

  const handleEnter = async () => {
    if (!ready) return;
    const ctx = ensureAudioGraph();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const el = audioRef.current;
      el.currentTime = 0;
      await el.play();
      setPlaying(true);
      cancelAnimationFrame(rafRef.current);
      draw();
    } catch (e) {
      console.warn('Audio play on hover failed', e);
    }
  };

  const handleLeave = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  return (
    <Card className="bg-black border-white/10 overflow-hidden">
      <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
        <canvas ref={canvasRef} className="w-full h-56 block" aria-label="Audio waveform visualizer" />
        {/* Playing indicator */}
        {playing && (
          <div className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
            PLAYING
          </div>
        )}
        <div className="absolute top-2 left-2">
          <Badge variant="secondary" className="bg-white/10 text-white backdrop-blur border border-white/20">
            <Radio className="w-3 h-3 mr-1"/> Dispatch
          </Badge>
        </div>
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-sm text-white/80">
          {label}
        </div>
      </div>
    </Card>
  );
}


function ReportedIncidents({ incidents, onSelect }) {
  return (
    <Card className="bg-neutral-900 border-white/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-white/90 flex items-center gap-2"><Siren className="w-4 h-4"/> Reported Incidents</CardTitle>
        <CardDescription className="text-white/50">Current unresolved events</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-56 pr-2">
          <div className="space-y-2">
            {incidents.length === 0 && (
              <div className="text-sm text-white/50">No incidents yet.</div>
            )}
            {incidents.map((it) => (
              <button
                key={it.id}
                onClick={() => onSelect?.(it)}
                className="w-full text-left p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-white/90 font-medium text-sm">{it.title}</div>
                    <div className="mt-1 text-xs text-white/70 flex items-center gap-2">
                      <MapPin className="w-3 h-3"/> {it.location}
                    </div>
                    <div className="mt-1 text-xs text-white/60">Time Reported: {it.timeReported}</div>
                  </div>
                  <Badge className={it.badgeClass ? it.badgeClass : "bg-white/10 border-white/20 text-white/80"}>{it.status}</Badge>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function SocialTicker() {
  const feed = SOCIAL_FEED_ITEMS;

  return (
    <div className="relative overflow-hidden whitespace-nowrap rounded-2xl border border-white/10 bg-neutral-900">
      <div className="absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-neutral-900 to-transparent pointer-events-none z-10"/>
      <div className="absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-neutral-900 to-transparent pointer-events-none z-10"/>
      <motion.div
        className="py-2 inline-block will-change-transform"
        animate={{ x: [0, -1200] }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
      >
        {feed.concat(feed).map((t, i) => (
          <span key={i} className="mx-6 text-sm text-white/80">{t}</span>
        ))}
      </motion.div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <Card className="bg-neutral-900 border-white/10">
      <CardContent className="p-4">
        <div className="space-y-1.5">
          {/* Title above, full width so the icon can't force a wrap */}
          <div className="text-xs uppercase tracking-widest text-white/50 leading-tight whitespace-normal break-words">{label}</div>

          {/* Value + Icon row */}
          <div className="flex items-start">
            <div className="flex-1 min-w-0">
              <div className="text-xl font-semibold text-white leading-tight whitespace-normal break-words">{value}</div>
              {hint && (
                <div className="text-xs text-white/50 mt-1 leading-snug whitespace-normal break-words">{hint}</div>
              )}
            </div>
            <div className="flex-none w-10 h-10 ml-4 rounded-xl bg-white/5 border border-white/10 grid place-items-center self-start">
              <Icon className="w-5 h-5 text-white/80" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertStack({ items, onClose }) {
  return (
    <div className="fixed top-4 right-4 space-y-3 z-50 w-80">
      <AnimatePresence>
        {items.map((a) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            className={`rounded-xl border ${a.tone} text-white backdrop-blur shadow-lg`}
          >
            <div className="p-3">
              <div className="flex items-center justify-between gap-3">
                {(() => { const Icon = a.icon; return (
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4" />
                    <div className="text-sm font-medium">{a.label}</div>
                  </div>
                ); })()}
                <Badge className="bg-white/10 border-white/20 text-white/80">{a.level.toUpperCase()}</Badge>
              </div>
              <div className="mt-1 text-sm text-white/80">{a.details}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-white/60"><MapPin className="w-3 h-3"/> {a.where} • {a.ts}</div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function AlertsPanel({ items, onClose }) {
  return (
    <Card className="bg-neutral-900 border-white/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-white/90 flex items-center gap-2"><Siren className="w-4 h-4"/> Alerts</CardTitle>
        <CardDescription className="text-white/50">Live feed</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[calc(100vh-260px)] pr-2">
          <div className="space-y-3">
            {items.length === 0 && (
              <div className="text-sm text-white/60">No active alerts.</div>
            )}
            {items.map((a) => (
              <div key={a.id} className={`rounded-xl border ${a.tone} text-white backdrop-blur shadow-md`}>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    {(() => { const Icon = a.icon; return (
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4" />
                        <div className="text-sm font-medium">{a.label}</div>
                      </div>
                    ); })()}
                    <Badge className="bg-white/10 border-white/20 text-white/80">{a.level.toUpperCase()}</Badge>
                  </div>
                  <div className="mt-1 text-sm text-white/80">{a.details}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-white/60"><MapPin className="w-3 h-3"/> {a.where} • {a.ts}</div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ===== CONTROL APP (assessment controller) =====
function ControlPanel() {
  // read session/join from query params
  const qs = new URLSearchParams(window.location.search);
  const sessionId = qs.get("session") || "";
  const storedIdentity = React.useMemo(() => loadStoredIdentity(sessionId), [sessionId]);
  const [participantId, setParticipantId] = React.useState(storedIdentity.participantId || null);
  const [codename, setCodename] = React.useState(storedIdentity.codename || null);
  const [codenameDraft, setCodenameDraft] = React.useState(storedIdentity.codename || "");
  const [codenameLocked, setCodenameLocked] = React.useState(Boolean(storedIdentity.codename));
  const [codenameError, setCodenameError] = React.useState("");

  const participantIdRef = React.useRef(participantId);
  const codenameRef = React.useRef(sanitizeCodename(codename || codenameDraft || ""));
  const codenameLockedRef = React.useRef(Boolean(storedIdentity.codename));

  React.useEffect(() => {
    participantIdRef.current = participantId;
  }, [participantId]);

  React.useEffect(() => {
    codenameRef.current = sanitizeCodename(codename || codenameDraft || "");
  }, [codename, codenameDraft]);

  React.useEffect(() => {
    if (!sessionId) return;
    const saved = loadStoredIdentity(sessionId);
    setParticipantId(saved.participantId || null);
    setCodename(saved.codename || null);
    setCodenameDraft(saved.codename || "");
    const locked = Boolean(saved.codename);
    setCodenameLocked(locked);
    codenameLockedRef.current = locked;
    setCodenameError("");
  }, [sessionId]);

  React.useEffect(() => {
    if (!sessionId) return;
    persistStoredIdentity(sessionId, {
      participantId: participantIdRef.current,
      codename: codenameRef.current,
    });
  }, [sessionId, participantId, codename]);

  React.useEffect(() => {
    codenameLockedRef.current = codenameLocked;
  }, [codenameLocked]);

  // connection
  const wsRef = React.useRef(null);
  const reconnectRef = React.useRef(null);
  const [connected, setConnected] = React.useState(false);
  const eventIdRef = React.useRef(null);

  // UI state
  const [directive, setDirective] = React.useState(""); // THE ALGORITHM line
  const [score, setScore] = React.useState(0);

  // Current event window
  const [eventId, setEventId] = React.useState(null);
  const [actions, setActions] = React.useState([]);
  const [windowMs, setWindowMs] = React.useState(0);
  const [remainingMs, setRemainingMs] = React.useState(0);
  const [sending, setSending] = React.useState(false);
  const [lastSent, setLastSent] = React.useState(null);

  React.useEffect(() => {
    eventIdRef.current = eventId;
  }, [eventId]);

  // derive HTTP base from WS_URL, normalize hostname for mobile clients
  const HTTP_BASE = React.useMemo(() => {
    try {
      const u = new URL(WS_URL);
      const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      const host = isLocal ? window.location.hostname : u.hostname;
      const proto = u.protocol.replace('ws', 'http');
      const port = u.port ? `:${u.port}` : '';
      return `${proto}//${host}${port}`;
    } catch {
      return '';
    }
  }, []);

  // Ring timer
  React.useEffect(() => {
    if (!remainingMs) return;
    const id = setInterval(() => setRemainingMs((ms) => Math.max(0, ms - 100)), 100);
    return () => clearInterval(id);
  }, [eventId, remainingMs]);

  // Connect as controller
  React.useEffect(() => {
    function connect() {
      if (wsRef.current) return;
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          try {
            const hello = { type: "hello", role: "control", sessionId };
            if (participantIdRef.current) hello.participantId = participantIdRef.current;
            if (codenameRef.current) hello.codename = codenameRef.current;
            ws.send(JSON.stringify(hello));
          } catch {}
        };
        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          clearTimeout(reconnectRef.current);
          reconnectRef.current = setTimeout(connect, 2500);
        };
        ws.onerror = () => { /* noop */ };
        ws.onmessage = (ev) => {
          let msg; try { msg = JSON.parse(ev.data); } catch { return; }

          if (msg.type === "welcome") return; // optional ack

          if (msg.type === "hello_ack" && msg.role === "control") {
            if (msg.participantId) {
              participantIdRef.current = msg.participantId;
              setParticipantId(msg.participantId);
            }
            if (msg.codename) {
              const alias = sanitizeCodename(msg.codename);
              codenameRef.current = alias;
              setCodename(alias);
              setCodenameDraft(alias);
              setCodenameError("");
            }
            return;
          }

          if (msg.type === "algo" && typeof msg.text === "string") {
            setDirective(msg.text);
            return;
          }
          if (msg.type === "score" && typeof msg.value === "number") {
            setScore(msg.value);
            return;
          }
          if (msg.type === "feedback") {
            if (typeof msg.total === "number") setScore(msg.total);
            return;
          }
          if (msg.type === "penalty" && typeof msg.delta === "number") {
            setScore((s) => Math.max(0, s + msg.delta));
            return;
          }
          if (msg.type === "event_open" && msg.event) {
            const evn = msg.event;
            eventIdRef.current = evn.id;
            setEventId(evn.id);

            // actions from server or fallback
            const act = Array.isArray(evn.actions) && evn.actions.length ? evn.actions : CRITICAL_ACTIONS;
            setActions(act);

            // server sends seconds, convert to ms
            const winMs = Number(evn.responseWindowSec ?? 15) * 1000;
            setWindowMs(winMs);
            setRemainingMs(winMs);

            setLastSent(null);
            setSending(false);

            if (typeof evn.banner === "string") setDirective(evn.banner);
            if (!codenameLockedRef.current) {
              codenameLockedRef.current = true;
              setCodenameLocked(true);
              setCodenameError("");
            }
            return;
          }
          if (msg.type === "event_close") {
            eventIdRef.current = null;
            setEventId(null);
            setActions([]);
            setWindowMs(0);
            setRemainingMs(0);
            setSending(false);
            setDirective("");
            return;
          }
          if (msg.type === "final") {
            eventIdRef.current = null;
            setEventId(null);
            setDirective("ASSESSMENT COMPLETE");
            return;
          }
        };
      } catch {}
    }
    connect();
    return () => { clearTimeout(reconnectRef.current); try { wsRef.current?.close(); } catch {} wsRef.current = null; };
  }, [sessionId]);

  // submit choice -> POST /api/session/:id/input
  const submitChoice = React.useCallback(async (choice) => {
    const pendingEventId = eventIdRef.current;
    if (!sessionId || !pendingEventId || !choice) return;
    setSending(true);
    setLastSent(choice);
    try {
      const res = await fetch(`${HTTP_BASE}/api/session/${encodeURIComponent(sessionId)}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          participantId: participantIdRef.current || participantId,         // <— important for personal feedback
          codename: codenameRef.current || undefined,              // optional, keeps your alias consistent
          eventId: pendingEventId,               // <— required for server to score the right window
          action: choice,        // server now also accepts `choice`, but send action explicitly
          clientTs: Date.now()
        }),
      });
      if (!res.ok) {
        console.error('POST /input failed', res.status, await res.text());
      }
    } catch (e) {
      console.error('POST /input network error', e);
    }
    // Delay clearing actions until the "Sending…" state has settled.
    const settleDelayMs = 400;
    const clearDelayMs = 150;
    setTimeout(() => {
      setSending(false);
      if (eventIdRef.current === pendingEventId) {
        setTimeout(() => {
          if (eventIdRef.current === pendingEventId) {
            setActions([]);
          }
        }, clearDelayMs);
      }
    }, settleDelayMs);
  }, [HTTP_BASE, sessionId]);

  const isPortrait = useIsPortrait();
  const timerRatio = windowMs > 0 ? Math.max(0, Math.min(1, remainingMs / windowMs)) : 0;
  const secondsRemaining = Math.max(0, Math.ceil(remainingMs / 1000));
  const activeCodename = React.useMemo(() => sanitizeCodename(codename || codenameDraft || ""), [codename, codenameDraft]);
  const codenameLabel = (activeCodename || "Awaiting Codename").toUpperCase();
  const hasDirective = Boolean(directive && directive.trim().length);

  const pushIdentityUpdate = React.useCallback((aliasOverride) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const envelope = { type: "hello", role: "control", sessionId };
    if (participantIdRef.current) envelope.participantId = participantIdRef.current;
    const alias = sanitizeCodename(aliasOverride ?? codenameRef.current ?? "");
    if (alias) envelope.codename = alias;
    ws.send(JSON.stringify(envelope));
  }, [sessionId]);

  const handleCodenameSubmit = React.useCallback((event) => {
    event.preventDefault();
    if (codenameLockedRef.current) return;
    const alias = sanitizeCodename(codenameDraft);
    if (!alias) {
      setCodenameError("Enter a codename to continue.");
      return;
    }
    codenameRef.current = alias;
    setCodename(alias);
    setCodenameDraft(alias);
    setCodenameLocked(true);
    codenameLockedRef.current = true;
    setCodenameError("");
    pushIdentityUpdate(alias);
  }, [codenameDraft, pushIdentityUpdate]);

  const handleCodenameChange = React.useCallback((event) => {
    if (codenameLockedRef.current) return;
    setCodenameDraft(event.target.value);
    setCodenameError("");
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col">
      {!isPortrait ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <div>
            <div className="text-lg font-semibold tracking-[0.3em] uppercase text-white/80">Rotate Device</div>
            <p className="mt-2 text-sm text-white/60">Portrait mode required to operate the controller.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center px-4 py-6">
          <div className="w-full max-w-sm sm:max-w-md flex flex-col flex-1 rounded-[32px] border border-neutral-800 bg-neutral-900/80 backdrop-blur-sm shadow-[0_0_30px_rgba(0,0,0,0.45)] overflow-hidden">
            <header className="px-5 py-4 border-b border-neutral-800 bg-black text-white">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.35em]">
                <span className={`flex-1 ${hasDirective ? 'text-white' : 'text-white/80'}`}>{codenameLabel}</span>
                <span className={`ml-4 ${connected ? 'text-emerald-300' : 'text-white/50'}`}>{connected ? 'LINK' : 'OFFLINE'}</span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-neutral-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ease-linear ${hasDirective ? 'bg-white' : 'bg-cyan-400'}`}
                  style={{ width: `${Math.round(timerRatio * 100)}%` }}
                />
              </div>
              <div className="mt-2 text-right text-[10px] font-mono tracking-[0.3em] text-white/70">
                {windowMs > 0 ? `${secondsRemaining}s` : '—'}
              </div>
            </header>

            <div className="flex-1 flex flex-col gap-4 px-5 py-5">
              <div className={`rounded-2xl border px-4 py-5 min-h-[120px] shadow-inner ${hasDirective ? `border-red-400 bg-red-600/90${eventId ? ' directive-flash' : ''}` : 'border-neutral-800 bg-neutral-950/80'}`}>
                <div className={`text-[10px] uppercase tracking-[0.4em] mb-2 ${hasDirective ? 'text-white/80' : 'text-white/40'}`}>Directive</div>
                <div className={`font-mono text-lg leading-relaxed ${hasDirective ? 'text-white' : 'text-white/40 italic'}`}>
                  {directive || 'Awaiting directive…'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4 shadow-inner text-center">
                  <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">Score</div>
                  <div className="mt-2 text-3xl font-mono">{Math.round(score)}</div>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4 shadow-inner text-center">
                  <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">Session</div>
                  <div className="mt-2 text-xs font-mono truncate">{sessionId || '—'}</div>
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4 shadow-inner">
                <div className="text-[10px] uppercase tracking-[0.4em] text-white/40 mb-1">Status</div>
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className={connected ? 'text-emerald-300' : 'text-white/60'}>{connected ? 'ONLINE' : 'OFFLINE'}</span>
                  <span className="text-white/50">{lastSent ? `LAST · ${lastSent}` : 'WAITING'}</span>
                </div>
              </div>
            </div>

            <div className="mt-auto px-5 pb-6">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/80 px-4 py-4 shadow-inner">
                <div className="text-[10px] uppercase tracking-[0.4em] text-white/40 mb-3">Actions</div>
                {actions.length ? (
                  <div className="grid gap-3">
                    {actions.map((a) => (
                      <Button
                        key={a}
                        disabled={!eventId || sending}
                        onClick={() => submitChoice(a)}
                        variant="ghost"
                        className="w-full rounded-full !border-0 !bg-emerald-500 text-black font-semibold tracking-[0.3em] uppercase py-4 shadow-[0_8px_0_rgba(0,0,0,0.35)] hover:!bg-emerald-400 disabled:!bg-neutral-700 disabled:!text-neutral-400 disabled:shadow-none transition-all"
                      >
                        {sending && lastSent === a ? 'Sending…' : a}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-white/60 font-mono">Waiting for next prompt…</div>
                )}
              </div>

              {import.meta.env.DEV && (
                <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-[11px] text-white/50 space-y-2">
                  <div className="uppercase tracking-[0.35em]">Dev</div>
                  <div className="font-mono leading-relaxed">
                    <div>POST /api/session/{sessionId || '…'}/input</div>
                    <div>Last: {lastSent || '—'}</div>
                    <div>HTTP: {HTTP_BASE || '—'}</div>
                  </div>
                  {!eventId && (
                    <div className="text-amber-300/80">No active event window.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {isPortrait && !codenameLocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-6">
          <form
            onSubmit={handleCodenameSubmit}
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-950/95 p-6 shadow-xl"
          >
            <div className="text-xs font-mono uppercase tracking-[0.4em] text-white/40">Control Alias</div>
            <h2 className="mt-2 text-xl font-semibold text-white">Choose your codename</h2>
            <p className="mt-2 text-sm text-white/60">
              This alias will identify your inputs for the entire scenario and cannot be changed after you lock it in.
            </p>
            <input
              autoFocus
              value={codenameDraft}
              onChange={handleCodenameChange}
              placeholder="Enter codename"
              className="mt-5 w-full rounded-2xl border border-neutral-700 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
            {codenameError && (
              <div className="mt-2 text-sm text-rose-400">{codenameError}</div>
            )}
            <Button
              type="submit"
              className="mt-5 w-full rounded-2xl !bg-emerald-500 text-black font-semibold tracking-[0.2em] uppercase hover:!bg-emerald-400"
            >
              Lock Codename
            </Button>
            <p className="mt-3 text-xs text-white/50">
              If the scenario begins before you submit, the default codename provided by command will be used.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}

function HungerCrisisDashboard() {
  const clock = useClock();
  const assessmentSessionId = ASSESSMENT_SESSION_ID;
  const [view, setView] = useState(getViewFromHash());
  useEffect(() => {
    const onHash = () => setView(getViewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const redirectToSession = useCallback((sessionId, nextView) => {
    if (!sessionId || typeof window === 'undefined') return;
    const targetView = nextView ?? getViewFromHash();
    const nextUrl = `${window.location.origin}/?mode=assessment&session=${encodeURIComponent(sessionId)}${hashForView(targetView)}`;
    if (window.location.href === nextUrl) return;
    window.location.href = nextUrl;
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onStorage = (event) => {
      if (event.storageArea !== window.localStorage) return;
      if (event.key !== SESSION_REDIRECT_KEY || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue);
        if (payload?.sessionId) {
          redirectToSession(payload.sessionId);
        }
      } catch (err) {
        console.error('Invalid session redirect payload', err);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [redirectToSession]);
  const handleStartNewSession = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:8787/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: 'sector-c-ops-01' }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create session (${res.status})`);
      }
      const data = await res.json();
      if (data?.sessionId) {
        try {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(
              SESSION_REDIRECT_KEY,
              JSON.stringify({ sessionId: data.sessionId, ts: Date.now() })
            );
          }
        } catch (storageErr) {
          console.warn('Unable to broadcast session redirect', storageErr);
        }
        redirectToSession(data.sessionId, view);
      } else {
        console.error('No sessionId in response', data);
      }
    } catch (err) {
      console.error('Error creating session', err);
    }
  }, [redirectToSession, view]);
  const audioCtxRef = useRef(null);
  const [soundOn, setSoundOn] = useState(true);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  // Prevent double-mount/StrictMode WebSocket reconnects
  const unmountedRef = useRef(false);
  const isConnectingRef = useRef(false);
  // Ref for the randomized alert timer
  const randomTimerRef = useRef(null);
  const series = useTimeSeries(24, 5000);

  // Push-to-talk state
  const [txStatus, setTxStatus] = useState('idle'); // 'idle' | 'live' | 'sending'
  const [txIndex, setTxIndex] = useState(1); // 1..4 for /audio/last-transmission[1-4].mp3
  const [activeChannel, setActiveChannel] = useState(RADIO_CHANNELS[0]?.id ?? 1);
  const txResetRef = useRef(null);

  // Population counters
  const [sectorCPop, setSectorCPop] = useState(38743); // comparable to a medium US city
  const worldPop = 2_530_000_000; // static world population ~2.53B
  const sectorTimerRef = useRef(null);

  // Sector C population: ± 1–2 every 5–10 minutes
  useEffect(() => {
    let cancelled = false;
    function tick() {
      const delay = Math.floor(5 * 60_000 + Math.random() * 5 * 60_000); // 5..10 min
      sectorTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setSectorCPop((p) => p + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))); // ±1..2
        tick();
      }, delay);
    }
    tick();
    return () => { cancelled = true; clearTimeout(sectorTimerRef.current); };
  }, []);

  // ===== Assessment Mode (server-driven) =====
  const isAssessment = IS_ASSESSMENT_MODE;

  const [serverEvents, setServerEvents] = useState([]); // live events from server (open but not closed)
  const serverEventsRef = useRef(new Map()); // id -> event snapshot
  const [algoText, setAlgoText] = useState("");         // THE ALGORITHM latest line
  const [assessmentFinal, setAssessmentFinal] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState([]);
  const [leaderboardStatus, setLeaderboardStatus] = useState("idle"); // idle | loading | success | error
  const [leaderboardError, setLeaderboardError] = useState(null);
  const [typedNames, setTypedNames] = useState([]);
  const [typingIndex, setTypingIndex] = useState(-1);
  const [showFinalOverlay, setShowFinalOverlay] = useState(false);
  const finalRedirectRef = useRef(false);

  const fetchLeaderboard = useCallback(async () => {
    if (!assessmentSessionId) {
      setLeaderboardEntries([]);
      setLeaderboardStatus("idle");
      setLeaderboardError(null);
      return;
    }

    setLeaderboardStatus("loading");
    setLeaderboardError(null);
    try {
      const res = await fetch(`http://localhost:8787/api/session/${encodeURIComponent(assessmentSessionId)}/leaderboard`);
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      const json = await res.json();
      if (!Array.isArray(json)) {
        throw new Error("Malformed leaderboard response");
      }

      const normalized = json
        .filter((entry) => entry && typeof entry === "object")
        .sort((a, b) => {
          const rankA = Number.isFinite(Number(a?.rank)) ? Number(a.rank) : Number.MAX_SAFE_INTEGER;
          const rankB = Number.isFinite(Number(b?.rank)) ? Number(b.rank) : Number.MAX_SAFE_INTEGER;
          return rankA - rankB;
        })
        .slice(0, 10);

      setLeaderboardEntries(normalized);
      setLeaderboardStatus("success");
    } catch (err) {
      console.error("Failed to fetch leaderboard", err);
      setLeaderboardStatus("error");
      setLeaderboardError(err?.message || "Unable to load leaderboard.");
    }
  }, [assessmentSessionId]);

  useEffect(() => {
    if (!assessmentFinal) return;
    fetchLeaderboard();
  }, [assessmentFinal, fetchLeaderboard]);

  useEffect(() => {
    if (!assessmentFinal) {
      finalRedirectRef.current = false;
      setShowFinalOverlay(false);
    }
  }, [assessmentFinal]);

  useEffect(() => {
    if (!assessmentFinal) return;
    if (view !== 'media') return;
    if (finalRedirectRef.current) {
      setShowFinalOverlay(false);
      return;
    }
    setShowFinalOverlay(true);
    const timeout = setTimeout(() => {
      finalRedirectRef.current = true;
      setShowFinalOverlay(false);
      window.location.hash = '/leaderboard';
    }, 2400);
    return () => {
      clearTimeout(timeout);
      setShowFinalOverlay(false);
    };
  }, [assessmentFinal, view]);

  useEffect(() => {
    if (view !== 'leaderboard') return;
    if (leaderboardStatus !== 'success' || leaderboardEntries.length === 0) {
      setTypedNames([]);
      setTypingIndex(-1);
      return;
    }

    const entries = leaderboardEntries;
    let cancelled = false;
    const timers = [];
    setTypedNames(Array(entries.length).fill(""));
    setTypingIndex(-1);

    const typeEntry = (entryIndex) => {
      if (cancelled) return;
      if (entryIndex >= entries.length) {
        setTypingIndex(-1);
        return;
      }

      const target = entries[entryIndex]?.codename || "";
      if (!target.length) {
        setTypedNames((prev) => {
          const next = [...prev];
          next[entryIndex] = "";
          return next;
        });
        const skip = setTimeout(() => typeEntry(entryIndex + 1), 250);
        timers.push(skip);
        return;
      }

      setTypingIndex(entryIndex);
      let charIndex = 0;
      const typeChar = () => {
        if (cancelled) return;
        charIndex += 1;
        setTypedNames((prev) => {
          const next = [...prev];
          next[entryIndex] = target.slice(0, Math.min(charIndex, target.length));
          return next;
        });

        if (charIndex < target.length) {
          const delay = setTimeout(typeChar, target.length > 18 ? 55 : 70);
          timers.push(delay);
        } else {
          const pause = setTimeout(() => {
            setTypingIndex(-1);
            typeEntry(entryIndex + 1);
          }, 320);
          timers.push(pause);
        }
      };

      const start = setTimeout(typeChar, 90);
      timers.push(start);
    };

    const kickoff = setTimeout(() => typeEntry(0), 350);
    timers.push(kickoff);

    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
      setTypingIndex(-1);
    };
  }, [view, leaderboardEntries, leaderboardStatus]);

  // Helper functions for alert sounds
  function ensureAudioCtx() {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  }

  function playBeep(frequency = 880, durationMs = 150, startOffset = 0, type = "sine") {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durationMs / 1000 + 0.01);
  }

  function playAlertSound(level) {
    // Only play for 'high' and 'critical'
    if (level === "high") {
      // two quick beeps
      playBeep(880, 140, 0.00, "triangle");
      playBeep(880, 140, 0.22, "triangle");
    } else if (level === "critical") {
      // three descending beeps
      playBeep(1000, 160, 0.00, "sawtooth");
      playBeep(700, 160, 0.22, "sawtooth");
      playBeep(500, 200, 0.44, "sawtooth");
    }
  }

  const [alerts, setAlerts] = useState([]);
  // Critical alert modal queue (blocking)
  const [criticalQueue, setCriticalQueue] = useState([]);
  const currentCritical = criticalQueue[0] || null;
  // Track resolved criticals to prevent duplicate execution (e.g. StrictMode)
  const resolvedIdsRef = useRef(new Set());
  // Track which alerts have already been converted to incidents
  const convertedIdsRef = useRef(new Set());
  const acknowledgeCritical = () => {
    if (currentCritical) resolvedIdsRef.current.add(currentCritical.id);
    setCriticalQueue((q) => q.slice(1));
  };

  const [autoSeconds, setAutoSeconds] = useState(30);
  const [autoPlanned, setAutoPlanned] = useState(null);
  // Decision / automation audit log
  const [auditLog, setAuditLog] = useState([]);
  const [incidents, setIncidents] = useState(() => {
    // Seed with one example; you can add more manually
    const preIncidents = [
      {
        id: crypto.randomUUID(),
        title: "Nutrient Disruption Event",
        location: "South District Distribution Hub – Bay 4",
        timeReported: "08:42",
        status: "Contained, units clearing scene",
        badgeClass: "bg-amber-500/20 text-amber-200 border-amber-400/40",
        // minimal content for brief
        _summary: {
          situation: "At 08:42, a disruption occurred at Bay 4 of the South District Distribution Hub when delivery of nutrient paste was delayed. Citizens became agitated, and several began shouting and pushing at the distribution gates before Taskforce units arrived.",
          actions: [
            "Units dispersed crowd and secured Bay 4 access points.",
            "Implant recalibration sweeps performed on detained ‘growlers.’",
            "Distribution resumed under reduced ration protocol.",
            "Surveillance feeds flagged for ongoing anomaly detection.",
          ],
          outlook: "Full clearance expected by 09:30. No further escalation anticipated; distribution hub will return to normal operations by midday.",
          ts: "08:42",
        },
      },
      {
        id: crypto.randomUUID(),
        title: "Agitated Civilian – Implant Noncompliant",
        location: "East Market Transit Stop",
        timeReported: "09:15",
        status: "Response Team En Route",
        badgeClass: "bg-purple-500/20 text-purple-200 border-purple-400/40",
        _summary: {
          situation: "At 09:15, a civilian at the East Market Transit Stop began displaying extreme agitation after refusing implant recalibration. The individual was shouting at commuters and attempted to block station entry.",
          actions: [
            "Dispatched one response unit to secure the transit stop.",
            "Isolated the individual using crowd-control measures.",
            "Alerted local operators to suspend service at the nearest entrance.",
            "Prepared mobile calibration kit in case of forced override."
          ],
          outlook: "Stabilization is expected within 30 minutes once the response team arrives and the implant override is initiated.",
          ts: "09:15"
        }
      },
      {
        id: crypto.randomUUID(),
        title: "Coordinated Disturbance – Crowd Escalation",
        location: "North End Ration Dispensary",
        timeReported: "10:03",
        status: "Active – Additional Units Requested",
        badgeClass: "bg-orange-500/20 text-orange-200 border-orange-400/40",
        _summary: {
          situation: "At 10:03, multiple groups converged on the North End Ration Dispensary and began chanting, blocking entrances, and overturning supply carts. Reports suggest the disturbance was coordinated through social channels, drawing a crowd of over 70 individuals.",
          actions: [
            "Deployed three Taskforce squads to establish a containment perimeter.",
            "Issued dispersal orders via loudspeaker and drone broadcast.",
            "Requested reinforcement from Central Command due to rising numbers.",
            "Monitored social media feeds for further mobilization signals."
          ],
          outlook: "Resolution will depend on reinforcement arrival; stabilization is projected within the next 90 minutes if crowd disperses under pressure.",
          ts: "10:03"
        }
      },
      {
        id: crypto.randomUUID(),
        title: "Individual Collapse – Severe Nutrient Deficit",
        location: "Civic Plaza, Gate 2",
        timeReported: "11:27",
        status: "Medical Extraction Underway",
        badgeClass: "bg-violet-500/20 text-violet-200 border-violet-400/40",
        _summary: {
          situation: "Male, 32 without implant has collapsed at Civic Plaza, Gate 2 due to severe nutrient deficiency. Medical teams are on-site providing emergency care. The individual is currently being stabilized for extraction.",
          actions: [
            "Dispatch medical extraction unit to Civic Plaza, Gate 2.",
            "Broadcast alert to nearby responders for assistance.",
            "Monitor vital signs and provide emergency nutritional support.",
            "Prepare transport to the nearest medical facility equipped for severe nutrient deficit cases."
          ],
          outlook: "The individual is expected to reach Vitalis Hospital within 5 minutes. Full recovery depends on ongoing nutritional and medical support.",
          ts: "11:27"
        }
      },
      {
        id: crypto.randomUUID(),
        title: "Unauthorized Entry Attempt – Distribution Storage",
        location: "West District Supply Depot",
        timeReported: "12:46",
        status: "Subject in custody, investigate in progress",
        badgeClass: "bg-indigo-500/20 text-indigo-200 border-indigo-400/40",
        _summary: {
          situation: "Female, 21 attempted unauthorized entry at the West District Supply Depot. Security personnel contained the situation quickly. The subject is now in custody.",
          actions: [
            "Dispatch security units to reinforce perimeter and monitor the depot.",
            "Broadcast alert to nearby distribution centers to heighten vigilance.",
            "Interview and process the detained individual for intent and risk assessment.",
            "Review security footage and protocols to prevent future breaches."
          ],
          outlook: "The depot remains secure, and no supplies discovered compromised yet. Authorities will investigate the site, estimated until 15:00.",
          ts: "12:46"
        }
      },
      {
        id: crypto.randomUUID(),
        title: "Group Disorder – Delirium Symptoms Observed",
        location: "Midtown Access Tunnel C-17",
        timeReported: "13:58",
        status: "Response Team En Route",
        badgeClass: "bg-sky-500/20 text-sky-200 border-sky-400/40",
        _summary: {
          situation: "Multiple individuals in Midtown Access Tunnel C-17 are exhibiting signs of delirium. The cause of symptoms is under investigation. Response teams are en route to assess and stabilize the group.",
          actions: [
            "Dispatch medical and security response teams to the tunnel.",
            "Establish a secure perimeter to prevent further escalation.",
            "Provide immediate medical assessment and administer emergency care.",
            "Investigate potential sources of contamination or nutritional deficiency."
          ],
          outlook: "Rapid intervention is expected to stabilize affected individuals. To be updated.",
          ts: "13:58"
        }
      }
    ];
    return preIncidents;
  });
  const [selectedIncident, setSelectedIncident] = useState(null);
  // Public broadcast images/ad assets
  const publicImages = useMemo(() => (
    ["ad1","ad2","ad3","ad4","ad5","psa1","psa2","psa3"].map((k, i) => ({ id: i, key: k, src: `/assets/${k}.png`, title: k.toUpperCase() }))
  ), []);
  const [selectedAd, setSelectedAd] = useState(0); // default first selected

  // Push broadcast action for selected public asset
  const pushBroadcast = useCallback(() => {
    const item = publicImages[selectedAd];
    if (!item) return;
    const ts = nowStamp();
    setAuditLog((prev) => [
      { id: crypto.randomUUID(), ts, where: "Public Network", action: `Broadcast asset ${item.title}`, via: "operator" },
      ...prev,
    ].slice(0, 100));
  }, [publicImages, selectedAd]);

  const setSelectedIncidentSafe = useCallback((it) => setSelectedIncident(it), []);

  const addIncidentFromAlert = useCallback((a, meta = {}) => {
    if (!a || !a.id) return;
    // avoid duplicates if the same alert is processed via multiple paths
    if (convertedIdsRef.current.has(a.id)) return;

    const timeOnly = (() => {
      const d = new Date(a.ts);
      if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const m = /\b(\d{1,2}:\d{2})\b/.exec(String(a.ts));
      return m ? m[1] : String(a.ts);
    })();

    const inc = {
      id: crypto.randomUUID(),
      title: a.label,
      location: a.where,
      timeReported: timeOnly,
      status: "Awaiting Response",
      badgeClass: "bg-red-500/20 text-red-200 border-red-400/40",
      _summary: {
        situation: `${a.label} reported at ${timeOnly}. ${a.details} Awaiting response by dispatch.`,
        actions: meta.action ? [`${meta.action} (${meta.via || 'operator'})`] : [],
        outlook: "Generating outlook, please wait.",
        ts: timeOnly,
      },
    };

    convertedIdsRef.current.add(a.id);
    setIncidents((prev) => [inc, ...prev]);
  }, []);

const pushAlert = useCallback((a) => {
  // Route critical alerts to the blocking modal queue
  if (a.level === "critical") {
    setCriticalQueue((q) => [...q, a]);
  } else {
    setAlerts((prev) => {
      const next = [a, ...prev];
      const overflow = next.slice(5); // anything beyond the visible stack
      // Convert any dropped critical alerts into incidents
      overflow.forEach((old) => {
        if (old && old.level === 'critical') {
          addIncidentFromAlert(old);
        }
      });
      return next.slice(0, 5);
    });
  }

  if (soundOn && (a.level === "high" || a.level === "critical")) {
    const ctx = ensureAudioCtx();
    if (ctx && ctx.state === "suspended") ctx.resume();
    playAlertSound(a.level);
  }
}, [soundOn, addIncidentFromAlert]);

  const notifyAction = useCallback((action, via = "automated") => {
    const where = currentCritical?.where || "Sector C";
    const ts = nowStamp();
    // Surface the executed response as a non-blocking alert
    pushAlert({
      id: crypto.randomUUID(),
      level: "elevated",
      icon: Megaphone,
      label: "Response Executed",
      where,
      ts,
      details: `${action} (${via})`,
    });
    // If we are resolving a current critical, capture it as an incident
    if (currentCritical) {
      addIncidentFromAlert(currentCritical, { action, via });
    }
    // Record to audit log (keep most recent first, cap at 100)
    setAuditLog((prev) => [
      { id: crypto.randomUUID(), ts, where, action, via },
      ...prev,
    ].slice(0, 100));
  }, [currentCritical, pushAlert, addIncidentFromAlert]);

  const performAuto = useCallback(() => {
    if (!currentCritical) return;
    // Guard: don't execute twice for the same critical
    if (resolvedIdsRef.current.has(currentCritical.id)) return;
    resolvedIdsRef.current.add(currentCritical.id);
    const action = autoPlanned || CRITICAL_ACTIONS[0];
    notifyAction(action, "automated");
    acknowledgeCritical();
  }, [currentCritical, autoPlanned, notifyAction]);

  useEffect(() => {
    if (!currentCritical) return;
    // Plan an automated action and start countdown whenever a new critical appears
    setAutoPlanned(CRITICAL_ACTIONS[Math.floor(Math.random() * CRITICAL_ACTIONS.length)]);
    setAutoSeconds(30);

    const id = setInterval(() => {
      setAutoSeconds((s) => {
        if (s <= 1) {
          clearInterval(id);
          // fire the automated action when reaching 0
          performAuto();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [currentCritical, performAuto]);

  const handleCriticalAction = useCallback((action) => {
    if (!currentCritical) return;
    // Guard: prevent double handling if auto already fired (or StrictMode reran)
    if (resolvedIdsRef.current.has(currentCritical.id)) return;
    // 30% chance automation overrules the operator
    const overridden = Math.random() < 0.3;
    const executed = overridden ? (autoPlanned || action) : action;
    resolvedIdsRef.current.add(currentCritical.id);
    notifyAction(executed, overridden ? "overridden" : "operator");
    acknowledgeCritical();
  }, [currentCritical, autoPlanned, notifyAction]);

  const dismissAlert = (id) => {
    setAlerts((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target && target.level === 'critical') {
        addIncidentFromAlert(target);
      }
      return prev.filter((x) => x.id !== id);
    });
  };

  // Random alert generator (randomized between 30–60s)
  useEffect(() => {
    if (isAssessment) return; // disable local RNG during assessment
    let cancelled = false;
    function scheduleNext() {
      const delay = Math.floor(30000 + Math.random() * 30000); // 30..60s (your existing value)
      randomTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        pushAlert(randomAlert());
        scheduleNext();
      }, delay);
    }
    scheduleNext();
    return () => {
      cancelled = true;
      if (randomTimerRef.current) clearTimeout(randomTimerRef.current);
    };
  }, [isAssessment, pushAlert]);

  // Helper to create a bespoke critical alert using rotating scenarios
  function createCriticalAlert() {
    const base = ALERT_TYPES.find(t => t.level === 'critical') || ALERT_TYPES[0];
    const scn = nextCriticalScenario();
    return {
      id: crypto.randomUUID(),
      level: 'critical',
      icon: base.icon,
      label: scn.title,
      where: scn.where,
      ts: nowStamp(),
      details: scn.details,
      tone: base.tone,
      ...coordsFor(scn.where),
    };
  }

  // Remote WebSocket: receive alerts from server
  useEffect(() => {
    function connectOPS() {
      if (wsRef.current || isConnectingRef.current) return;
      isConnectingRef.current = true;
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        ws.onopen = () => {
          isConnectingRef.current = false;
          setRemoteConnected(true);
          // In assessment: identify as OPS with sessionId. Otherwise keep legacy hello.
          if (isAssessment && assessmentSessionId) {
            try {
              ws.send(JSON.stringify({ type: "hello", role: "ops", sessionId: assessmentSessionId }));
            } catch {}
          } else {
            try {
              ws.send(JSON.stringify({ type: "hello", role: "dashboard" }));
            } catch {}
          }
        };
        ws.onclose = () => {
          setRemoteConnected(false);
          wsRef.current = null;
          isConnectingRef.current = false;
          if (unmountedRef.current) return;
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(connectOPS, 2500);
        };
        ws.onerror = () => {
          // Intentionally noop. Let `onclose` handle backoff.
          // Closing here before `onopen` can cause noisy "closed before connection is established" logs.
        };
        ws.onmessage = (ev) => {
          let msg; try { msg = JSON.parse(ev.data); } catch { return; }

          // Assessment-mode messages from server
          if (isAssessment) {
            if (msg.type === "event_open" && msg.event) {
              const evn = msg.event;
              const a = {
                id: evn.id,
                level: (evn.level || "elevated"),
                icon: evn.level === "critical" ? Siren : (evn.level === "high" ? AlertTriangle : (evn.level === "elevated" ? Megaphone : Bell)),
                label: evn.title,
                where: evn.location,
                ts: nowStamp(),
                details: evn.details,
                tone: evn.level === "critical" ? "bg-red-500/20 border-red-500/50" : evn.level === "high" ? "bg-orange-500/20 border-orange-500/50" : evn.level === "elevated" ? "bg-yellow-500/20 border-yellow-500/50" : "bg-cyan-500/20 border-cyan-500/50",
                x: evn.map?.x, y: evn.map?.y
              };
              serverEventsRef.current.set(a.id, a);
              setServerEvents(Array.from(serverEventsRef.current.values()));
              // Also surface in the side Alerts panel (non-blocking)
              setAlerts((prev) => [{ ...a, id: crypto.randomUUID() }, ...prev].slice(0, 10));
              return;
            }
            if (msg.type === "event_close") {
              serverEventsRef.current.delete(msg.eventId);
              setServerEvents(Array.from(serverEventsRef.current.values()));
              return;
            }
            if (msg.type === "algo" && msg.text) {
              setAlgoText(msg.text);
              return;
            }
            if (msg.type === "final") {
              setAssessmentFinal(true);
              return;
            }
            if (msg.type === "tick") {
              // could update a clock/countdown if desired
              return;
            }
            // ignore other messages in assessment mode
            return;
          }

          // Legacy remote trigger messages (random/critical) for non-assessment
          const kind = (msg.type || "").toString().toLowerCase();
          if (kind === "random") return pushAlert(randomAlert());
          if (kind === "critical") return pushAlert(createCriticalAlert());
        };
      } catch (e) {
        isConnectingRef.current = false;
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connectOPS, 3000);
      }
    }

    connectOPS();
    return () => {
      unmountedRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
      isConnectingRef.current = false;
    };
  }, [isAssessment, assessmentSessionId, pushAlert]);

  // Map data: all live alerts plus current critical (with coordinates)
  const mapAlerts = useMemo(() => {
    if (isAssessment) {
      return serverEvents.map(a => ({ id: a.id, level: a.level, label: a.label, x: a.x, y: a.y }));
    }
    const live = [...alerts];
    if (currentCritical) live.unshift(currentCritical);
    return live.map(a => ({ id: a.id, level: a.level, label: a.label, x: a.x, y: a.y }));
  }, [isAssessment, serverEvents, alerts, currentCritical]);

  const leaderboardRows = useMemo(() => {
    const rows = leaderboardEntries.map((entry, idx) => ({
      ...entry,
      typedName: typedNames[idx] ?? "",
    }));
    for (let i = rows.length; i < 10; i += 1) {
      rows.push({
        rank: i + 1,
        placeholder: true,
      });
    }
    return rows;
  }, [leaderboardEntries, typedNames]);

  // Derived stats
  const totals = useMemo(() => {
    const inc = series.reduce((s, d) => s + d.incidents, 0);
    const rec = series.reduce((s, d) => s + d.recalibrations, 0);
    return { inc, rec };
  }, [series]);

  const adoptionRate = 86 + Math.round(Math.random() * 2); // playful drift
  const implantOperationalRate = 92 + Math.round(Math.random() * 3);
  const [stockLevel] = useState(42);            // demo value; wire to data if you have it
  const [etaSeconds, setEtaSeconds] = useState(15 * 60); // 15 minutes

  useEffect(() => {
    if (etaSeconds <= 0) return;               // stop at 0
    const id = setInterval(() => {
      setEtaSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [etaSeconds]);

  useEffect(() => {
    return () => {
      if (txResetRef.current) clearTimeout(txResetRef.current);
    };
  }, []);

  function fmtEta(secs) {
    const m = Math.floor(Math.max(0, secs) / 60);
    const s = Math.max(0, secs) % 60; 
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }

  function priorityFor(pct) {
    if (pct < 10) return { label: "Critical", bar: "bg-red-500", text: "text-red-300" };
    if (pct < 30) return { label: "Elevated", bar: "bg-amber-500", text: "text-amber-300" };
    if (pct < 70) return { label: "Normal", bar: "bg-cyan-400", text: "text-cyan-300" };
    return { label: "Low", bar: "bg-emerald-500", text: "text-emerald-300" };
  }

  const incidentHighlights = useMemo(() => incidents.slice(0, 4), [incidents]);
  const recentDecisions = useMemo(() => auditLog.slice(0, 4), [auditLog]);
  const alertHighlights = useMemo(() => alerts.slice(0, 5), [alerts]);
  const socialTweetImages = useMemo(
    () => Array.from({ length: 7 }, (_, idx) => `/assets/tweets/tweet${idx + 1}.jpg`),
    []
  );
  const activeChannelMeta = RADIO_CHANNELS.find((c) => c.id === activeChannel);
  const handlePushToTalk = useCallback(() => {
    if (txResetRef.current) clearTimeout(txResetRef.current);
    setTxStatus('sending');
    if (activeChannelMeta?.txIndex) {
      setTxIndex(activeChannelMeta.txIndex);
    }
    txResetRef.current = setTimeout(() => setTxStatus('idle'), 1200);
  }, [activeChannelMeta]);

  if (view === 'control') {
    return <ControlPanel />;
  }

  return (
    <TooltipProvider>
      <div className="h-screen w-full bg-neutral-950 text-white flex flex-col overflow-hidden" aria-hidden={!!currentCritical}>
        <header className="flex-none border-b border-white/10 bg-neutral-950/80 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-emerald-400" />
              <div className="font-semibold tracking-wide">HCI – Mission Control</div>
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-400/30">SECTOR C</Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-white/70">
              <div className="flex items-center gap-2"><MonitorCog className="w-4 h-4" /> System nominal</div>
              <Separator orientation="vertical" className="h-4 bg-white/20" />
              <div className="font-mono">{clock}</div>
              <Separator orientation="vertical" className="h-4 bg-white/20" />
              <div className={`flex items-center gap-2 text-sm ${remoteConnected ? 'text-emerald-400' : 'text-white/50'}`}>
                <Radio className="w-4 h-4" />
                {remoteConnected ? 'Remote: Connected' : 'Remote: Offline'}
              </div>
              <Separator orientation="vertical" className="h-4 bg-white/20" />
              <div className="flex items-center gap-2 text-xs">
                <a href="#/ops" className={`px-2 py-0.5 rounded border ${view === 'ops' ? 'bg-white/10 border-white/30 text-white' : 'border-white/10 text-white/60 hover:text-white/80'}`}>OPS</a>
                <a href="#/media" className={`px-2 py-0.5 rounded border ${view === 'media' ? 'bg-white/10 border-white/30 text-white' : 'border-white/10 text-white/60 hover:text-white/80'}`}>MEDIA</a>
              </div>
              <button
                onClick={handleStartNewSession}
                className="px-3 py-2 ml-3 rounded-md bg-blue-700 hover:bg-blue-600 text-white text-sm"
              >
                Start New Session
              </button>
            </div>
          </div>
        </header>
        {isAssessment && (
          <div className="flex-none">
            <AlgorithmBanner text={algoText} />
          </div>
        )}

        <main className="flex-1 overflow-hidden">
          <div className="h-full w-full max-w-[95rem] mx-auto px-4 py-4">
            {view === 'media' ? (
              <div className="grid h-full min-h-0 grid-cols-[1.5fr_1.2fr_0.9fr] grid-rows-[1fr_1fr] gap-4">
                <Card className="col-[1/2] row-[1/2] flex flex-col bg-neutral-900/90 border-white/10 overflow-hidden">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-white/90 text-lg">Social Media Feed</CardTitle>
                    <CardDescription className="text-white/50">Monitored social feeds</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 overflow-hidden">
                    <ScrollArea className="h-full max-h-[32rem] pr-2">
                      <div className="flex flex-col gap-3">
                        {socialTweetImages.map((src, idx) => (
                          <div
                            key={src}
                            className="rounded-xl border border-white/10 bg-black/40 px-3 pt-3 pb-2"
                          >
                            <div className="text-[11px] uppercase tracking-wide text-white/40 mb-2">
                              Signal {idx + 1}
                            </div>
                            <div className="overflow-hidden rounded-lg border border-white/10 bg-black">
                              <img
                                src={src}
                                alt={`Captured tweet ${idx + 1}`}
                                className="w-full h-auto object-cover"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card className="col-[1/2] row-[2/3] flex flex-col bg-neutral-900/90 border-white/10">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-white/90 text-lg">Reported Incidents</CardTitle>
                    <CardDescription className="text-white/50">Active queue</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 flex flex-col gap-3">
                    {incidentHighlights.length === 0 && (
                      <div className="rounded-xl border border-dashed border-white/10 bg-black/40 px-3 py-4 text-sm text-white/60">
                        No incidents reported.
                      </div>
                    )}
                    {incidentHighlights.map((it) => (
                      <button
                        key={it.id}
                        onClick={() => setSelectedIncident(it)}
                        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-left transition hover:border-white/30 hover:bg-white/10"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white/90">{it.title}</div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-white/60">
                              <MapPin className="w-3 h-3" /> {it.location}
                            </div>
                            <div className="mt-1 text-xs text-white/50">Reported {it.timeReported}</div>
                          </div>
                          <Badge className={it.badgeClass ? `${it.badgeClass} whitespace-nowrap` : "bg-white/10 border-white/20 text-white/80 whitespace-nowrap"}>
                            {it.status}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>

                <Card className="col-[2/3] row-[1/2] flex flex-col bg-neutral-900/90 border-white/10">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-white/90 text-lg">CCTV</CardTitle>
                    <CardDescription className="text-white/50">Live quadrants</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0">
                    <div className="grid h-full grid-cols-2 grid-rows-2 gap-3">
                      {CCTV_FEEDS.map((feed) => (
                        <div key={feed.id} className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
                          <video
                            src={feed.src}
                            muted
                            loop
                            autoPlay
                            playsInline
                            className="h-full w-full object-cover contrast-125 saturate-50"
                          />
                          <div className="absolute top-2 left-2">
                            <Badge className="bg-white/10 text-white border-white/20 backdrop-blur">{feed.badgeLabel}</Badge>
                          </div>
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-xs text-white/80">
                            {feed.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="col-[2/3] row-[2/3] flex flex-col bg-neutral-900/90 border-white/10">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-white/90 text-lg">Reference Library</CardTitle>
                    <CardDescription className="text-white/50">PSAs and past incidents</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 flex flex-col">
                    <Tabs defaultValue="psa" className="flex h-full flex-col">
                      <TabsList className="bg-white/5 border border-white/10 w-fit rounded-lg">
                        <TabsTrigger value="psa" className="px-3 py-1 text-xs data-[state=active]:bg-white/15 data-[state=active]:text-white">PSA Library</TabsTrigger>
                        <TabsTrigger value="incidents" className="px-3 py-1 text-xs data-[state=active]:bg-white/15 data-[state=active]:text-white">Past Incidents</TabsTrigger>
                      </TabsList>
                      <TabsContent value="psa" className="flex-1 min-h-0 focus-visible:outline-none">
                        <div className="mt-3 grid h-full grid-cols-3 gap-3">
                          {publicImages.slice(0, 6).map((item) => (
                            <button
                              key={item.id}
                              onClick={() => setSelectedAd(item.id)}
                              className={`group relative overflow-hidden rounded-xl border ${selectedAd === item.id ? 'border-blue-400 shadow-lg shadow-blue-500/20' : 'border-white/10'} bg-black/40`}
                            >
                              <img src={item.src} alt={item.title} className="h-full w-full object-cover opacity-90 group-hover:opacity-100 transition" draggable={false} />
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1 text-[11px] text-white/80">
                                {item.title}
                              </div>
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 flex items-center justify-between text-xs text-white/60">
                          <div>Selected: {publicImages[selectedAd]?.title ?? "—"}</div>
                          <Button
                            onClick={pushBroadcast}
                            size="sm"
                            className="h-7 bg-blue-600 px-3 py-1 text-xs hover:bg-blue-500"
                          >
                            Push Broadcast
                          </Button>
                        </div>
                      </TabsContent>
                      <TabsContent value="incidents" className="flex-1 min-h-0 focus-visible:outline-none">
                        <div className="mt-3 space-y-3 text-sm">
                          {incidentHighlights.length === 0 && <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-white/60">No archived incidents.</div>}
                          {incidentHighlights.map((it) => (
                            <div key={it.id} className="rounded-xl border border-white/10 bg-black/40 px-3 py-3">
                              <div className="text-sm font-semibold text-white/80">{it.title}</div>
                              <div className="mt-1 text-xs text-white/60">{it._summary?.situation}</div>
                            </div>
                          ))}
                        </div>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>

                <Card className="col-[3/4] row-[1/2] flex flex-col bg-neutral-900/90 border-white/10">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-white/90 text-lg flex items-center gap-2"><Radio className="w-4 h-4" /> Radio Control</CardTitle>
                    <CardDescription className="text-white/50">Channel routing</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 min-h-0 flex flex-col justify-between gap-4">
                    <div className="space-y-2">
                      {RADIO_CHANNELS.map((ch) => (
                        <button
                          key={ch.id}
                          onClick={() => {
                            setActiveChannel(ch.id);
                            if (ch.txIndex) setTxIndex(ch.txIndex);
                          }}
                          className={`w-full rounded-md border px-3 py-2 text-left transition ${activeChannel === ch.id ? 'bg-white/10 border-white/30 text-white' : 'bg-black/40 border-white/10 text-white/70 hover:text-white/90'}`}
                        >
                          <div className="text-sm font-medium">{ch.name}</div>
                          <div className="text-xs text-white/50">{ch.detail}</div>
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex gap-3">
                        <button
                          onClick={handlePushToTalk}
                          className={`flex h-12 w-12 items-center justify-center rounded-full border-4 transition ${txStatus === 'sending' ? 'border-red-500 bg-red-600' : 'border-red-400/60 bg-red-700/70 hover:border-red-400 hover:bg-red-600/90'}`}
                          aria-label="Push to talk"
                        >
                          <Siren className="h-5 w-5 text-white" />
                        </button>
                        <button
                          onClick={() => setSoundOn((prev) => !prev)}
                          className={`flex h-12 w-12 items-center justify-center rounded-full border-4 transition ${soundOn ? 'border-emerald-400 bg-emerald-600/80' : 'border-white/20 bg-neutral-800 hover:border-white/40'}`}
                          aria-label={soundOn ? "Mute all feeds" : "Enable audio"}
                        >
                          {soundOn ? <Volume2 className="h-5 w-5 text-white" /> : <VolumeX className="h-5 w-5 text-white/80" />}
                        </button>
                      </div>
                      <div className="text-right text-xs text-white/60">
                        <div>{activeChannelMeta?.name ?? "Channel"}</div>
                        <div className="font-mono text-white/70 uppercase">{txStatus === 'sending' ? 'TX LIVE' : 'IDLE'}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="col-[3/4] row-[2/3] grid h-full grid-rows-[0.45fr_0.55fr] gap-4">
                  <div className="min-h-0">
                    {isAssessment ? (
                      <QRCard sessionId={assessmentSessionId} />
                    ) : (
                      <Card className="flex h-full flex-col bg-neutral-900/90 border-white/10">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-white/90 text-base flex items-center gap-2"><MonitorCog className="w-4 h-4" /> Automation Window</CardTitle>
                          <CardDescription className="text-white/50">Override readiness</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 flex flex-col justify-center gap-2 text-sm text-white/70">
                          <div>Auto-plan: {autoPlanned ?? 'Manual authority'}</div>
                          <div>Executes in: {autoPlanned ? `${autoSeconds}s` : '—'}</div>
                          <div>Session: {assessmentSessionId ?? 'Local Ops'}</div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                  <Card className="flex flex-col bg-neutral-900/90 border-white/10">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-white/90 text-base flex items-center gap-2"><Activity className="w-4 h-4" /> Decision Log</CardTitle>
                      <CardDescription className="text-white/50">Latest directives</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 min-h-0 space-y-2 text-sm">
                      {recentDecisions.length === 0 && <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-white/60">No decisions logged.</div>}
                      {recentDecisions.map((entry) => (
                        <div key={entry.id} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-white/80">{entry.action}</div>
                            <Badge className={`bg-white/10 border-white/20 ${entry.via === 'automated' ? 'text-emerald-300' : entry.via === 'operator' ? 'text-blue-200' : 'text-white/80'}`}>
                              {entry.via}
                            </Badge>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/50">
                            <MapPin className="h-3 w-3" /> {entry.where} • {entry.ts}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : view === 'leaderboard' ? (
              <LeaderboardPane
                rows={leaderboardRows}
                status={leaderboardStatus}
                error={leaderboardError}
                onRetry={fetchLeaderboard}
                assessmentFinal={assessmentFinal}
                typingIndex={typingIndex}
                algoText={algoText}
                sessionId={assessmentSessionId}
                isAssessment={isAssessment}
              />
            ) : view === 'ops' ? (
              <div className="flex h-full min-h-0 flex-col gap-4">
                <div className="rounded-2xl border border-white/10 bg-neutral-900/90 px-4 py-2">
                  <SocialTicker />
                </div>

                <div className="flex flex-1 min-h-0 flex-col gap-4">
                  <div className="grid flex-1 min-h-0 grid-cols-[2.5fr_1fr] gap-4">
                    <Card className="flex flex-col bg-neutral-900/90 border-white/10">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-white/90 text-lg"><MapPin className="w-4 h-4" /> Live Incident Map</CardTitle>
                        <CardDescription className="text-white/50">Sector C overview</CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1 min-h-0">
                        <HotspotMap alerts={mapAlerts} heightClass="h-full" />
                      </CardContent>
                    </Card>
                    <Card className="flex flex-col bg-neutral-900/90 border-white/10">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-white/90 text-lg"><Siren className="w-4 h-4" /> Alerts</CardTitle>
                        <CardDescription className="text-white/50">Latest notifications</CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1 min-h-0 space-y-3 overflow-hidden">
                        {alertHighlights.length === 0 && (
                          <div className="rounded-xl border border-dashed border-white/10 bg-black/40 px-3 py-4 text-sm text-white/60">
                            No active alerts.
                          </div>
                        )}
                        {alertHighlights.map((entry) => {
                          const AlertIcon = entry.icon ?? Siren;
                          return (
                            <div key={entry.id} className="rounded-xl border border-white/10 bg-black/40 px-3 py-3">
                              <div className="flex items-center justify-between gap-2 text-sm text-white/80">
                                <div className="flex items-center gap-2">
                                  <AlertIcon className="h-4 w-4" />
                                  <span>{entry.label}</span>
                                </div>
                                <Badge className="bg-white/10 border-white/20 text-white/70">{entry.level?.toUpperCase?.() ?? 'ALERT'}</Badge>
                              </div>
                              <div className="mt-1 text-xs text-white/60">{entry.details}</div>
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 xl:flex-nowrap">
                  <div className="order-1 flex flex-1 flex-col gap-4 sm:min-w-[280px] sm:max-w-[320px]">
                    <div className="grid grid-cols-2 gap-3">
                      <Card className="bg-neutral-900/90 border-white/10">
                        <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                          <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">World Pop</div>
                          <div className="text-3xl font-semibold text-white">2.53B</div>
                          <div className="text-xs text-white/60">Total population</div>
                        </CardContent>
                      </Card>
                      <Card className="bg-neutral-900/90 border-white/10">
                        <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                          <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">Sector C</div>
                          <div className="text-3xl font-semibold text-white">{fmt(sectorCPop)}</div>
                          <div className="text-xs text-white/60">Total population</div>
                        </CardContent>
                      </Card>
                    </div>
                    <Card className="bg-neutral-900/90 border-white/10">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-white/90 text-sm">Caloric Stockpile</CardTitle>
                        <CardDescription className="text-white/50 text-xs">Distribution-ready reserves</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2 px-4 pb-4 pt-0">
                        {(() => {
                          const pri = priorityFor(stockLevel);
                          return (
                            <div className="space-y-2">
                              <div className="h-1.5 w-full rounded-full bg-white/10">
                                <div className={`h-full rounded-full ${pri.bar}`} style={{ width: `${Math.max(0, Math.min(100, stockLevel))}%` }} />
                              </div>
                              <div className="text-xs text-white/60">Level: <span className={pri.text}>{pri.label}</span></div>
                              <div className="text-xs text-white/60">ETA resupply: {fmtEta(etaSeconds)}</div>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>
                  </div>

                  <div className="order-2 flex flex-1 flex-col gap-4 sm:min-w-[220px] lg:w-60">
                    <Card className="bg-neutral-900/90 border-white/10">
                      <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                        <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">Incident Total</div>
                        <div className="text-3xl font-semibold text-white">{fmt(totals.inc)}</div>
                        <div className="text-xs text-white/60">This week</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-neutral-900/90 border-white/10">
                      <CardContent className="flex w-full flex-col items-center gap-3 p-4 text-center">
                        <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">Implant Adoption</div>
                        <div className="text-3xl font-semibold text-white">{adoptionRate}%</div>
                        <div className="h-1.5 w-full rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-cyan-400" style={{ width: `${adoptionRate}%` }} />
                        </div>
                        <div className="text-xs text-white/60">Operational coverage</div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="order-3 flex flex-1 flex-col gap-4 sm:min-w-[220px] lg:w-60">
                    <Card className="bg-neutral-900/90 border-white/10">
                      <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                        <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">Recalibration Total</div>
                        <div className="text-3xl font-semibold text-white">{fmt(totals.rec)}</div>
                        <div className="text-xs text-white/60">This week</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-neutral-900/90 border-white/10">
                      <CardContent className="flex w-full flex-col items-center gap-3 p-4 text-center">
                        <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">Implant Operation</div>
                        <div className="text-3xl font-semibold text-white">{implantOperationalRate}%</div>
                        <div className="h-1.5 w-full rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.max(0, Math.min(100, implantOperationalRate))}%` }} />
                        </div>
                        <div className="text-xs text-white/60">Systems online</div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="order-4 flex min-h-[260px] flex-1 flex-col border-white/10 bg-neutral-900/90">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-white/90"><Activity className="w-4 h-4" /> Incident Response Trend</CardTitle>
                      <CardDescription className="text-white/50">Past 24 time slices</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="mediaInc" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.6} />
                              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="mediaRec" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.6} />
                              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                          <XAxis dataKey="t" stroke="#888" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
                          <YAxis stroke="#888" />
                          <RechartsTooltip labelFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} contentStyle={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }} />
                          <Area type="monotone" dataKey="incidents" stroke="#ef4444" fill="url(#mediaInc)" name="Incidents" />
                          <Area type="monotone" dataKey="recalibrations" stroke="#22d3ee" fill="url(#mediaRec)" name="Recalibrations" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : view === 'unused' ? (
              <div className="flex h-full min-h-0 flex-col gap-4">
                <div className="rounded-2xl border border-white/10 bg-neutral-900/90 px-4 py-2">
                  <SocialTicker />
                </div>

                <div className="flex flex-1 min-h-0 flex-col gap-4">
                  <div className="grid flex-1 min-h-0 grid-cols-[2.5fr_1fr] gap-4">
                    <Card className="flex flex-col bg-neutral-900/90 border-white/10">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-white/90 text-lg"><MapPin className="w-4 h-4" /> Live Incident Map</CardTitle>
                        <CardDescription className="text-white/50">Sector C overview</CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1 min-h-0">
                        <HotspotMap alerts={mapAlerts} heightClass="h-full" />
                      </CardContent>
                    </Card>
                    <Card className="flex flex-col bg-neutral-900/90 border-white/10">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-white/90 text-lg"><Siren className="w-4 h-4" /> Alerts</CardTitle>
                        <CardDescription className="text-white/50">Latest notifications</CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1 min-h-0 space-y-3 overflow-hidden">
                        {alertHighlights.length === 0 && (
                          <div className="rounded-xl border border-dashed border-white/10 bg-black/40 px-3 py-4 text-sm text-white/60">
                            No active alerts.
                          </div>
                        )}
                        {alertHighlights.map((entry) => {
                          const AlertIcon = entry.icon ?? Siren;
                          return (
                            <div key={entry.id} className="rounded-xl border border-white/10 bg-black/40 px-3 py-3">
                              <div className="flex items-center justify-between gap-2 text-sm text-white/80">
                                <div className="flex items-center gap-2">
                                  <AlertIcon className="h-4 w-4" />
                                  <span>{entry.label}</span>
                                </div>
                                <Badge className="bg-white/10 border-white/20 text-white/70">{entry.level?.toUpperCase?.() ?? 'ALERT'}</Badge>
                              </div>
                              <div className="mt-1 text-xs text-white/60">{entry.details}</div>
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4">
                  <Card className="bg-neutral-900/90 border-white/10">
                    <CardContent className="p-4">
                      <div className="text-xs uppercase tracking-widest text-white/50 leading-tight">World</div>
                      <div className="mt-2 text-2xl font-semibold text-white">2.53B</div>
                      <div className="text-xs text-white/60 mt-2">Total Population</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-neutral-900/90 border-white/10">
                    <CardContent className="p-4">
                      <div className="text-xs uppercase tracking-widest text-white/50 leading-tight">Sector C Pop</div>
                      <div className="mt-2 text-2xl font-semibold text-white">{fmt(sectorCPop)}</div>
                      <div className="text-xs text-white/60 mt-2">Residents in scope</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-neutral-900/90 border-white/10">
                    <CardContent className="p-4">
                      <div className="text-xs uppercase tracking-widest text-white/50 leading-tight">Incident Total</div>
                      <div className="mt-2 text-2xl font-semibold text-white">{fmt(totals.inc)}</div>
                      <div className="text-xs text-white/60 mt-2">This week</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-neutral-900/90 border-white/10">
                    <CardContent className="p-4">
                      <div className="text-xs uppercase tracking-widest text-white/50 leading-tight">Recalibration Total</div>
                      <div className="mt-2 text-2xl font-semibold text-white">{fmt(totals.rec)}</div>
                      <div className="text-xs text-white/60 mt-2">This week</div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : null}
          </div>
        </main>

        <div className="xl:hidden">
          <AlertStack items={alerts} onClose={dismissAlert} />
        </div>
        {currentCritical && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[100] flex items-center justify-center"
          >
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <div className="red-strobe-border" />
            <div className="relative max-w-3xl w-[92vw] rounded-2xl border border-red-500/40 bg-neutral-950 shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-red-500/30 bg-gradient-to-r from-red-900/40 to-transparent">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-red-300">
                    <Siren className="w-6 h-6" />
                    <div className="text-xl font-semibold tracking-wide">CRITICAL INCIDENT</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-red-500/20 text-red-200 border-red-400/40">LEVEL: CRITICAL</Badge>
                    {autoPlanned && (
                      <Badge className="bg-white/10 text-white/90 border-white/20">
                        AUTO IN {String(autoSeconds).padStart(2, "0")}s · {autoPlanned}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="p-6 grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-3">
                  <div className="text-2xl font-semibold text-white">{currentCritical.label}</div>
                  <div className="text-white/80">{currentCritical.details}</div>
                  <div className="flex items-center gap-2 text-white/60 text-sm">
                    <MapPin className="w-4 h-4" /> {currentCritical.where}
                    <span className="mx-2">•</span>
                    <span>{currentCritical.ts}</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-sm text-white/60">Immediate Actions</div>
                  <div className="grid gap-2">
                    <Button className="bg-red-600 hover:bg-red-700" onClick={() => handleCriticalAction("Dispatch nearest units")}>Dispatch nearest units</Button>
                    <Button className="bg-orange-600 hover:bg-orange-700" onClick={() => handleCriticalAction("Throttle hit window")}>Throttle hit window</Button>
                    <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => handleCriticalAction("Initiate co-op protocol")}>Initiate co-op protocol</Button>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/10 bg-neutral-900 flex items-center justify-between">
                <div className="text-xs text-white/60">This is an urgent alert. Choose the best course of action. Automated audit active, may override user decisions.</div>
              </div>
            </div>
          </div>
        )}
      </div>
      {showFinalOverlay && view === 'media' && (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur grid place-items-center">
          <div className="text-center space-y-3">
            <div className="text-3xl font-semibold text-white">Assessment Complete</div>
            <div className="text-white/70">Awaiting results…</div>
          </div>
        </div>
      )}
    </TooltipProvider>
  );
}

export default function App() { return <HungerCrisisDashboard/> }
