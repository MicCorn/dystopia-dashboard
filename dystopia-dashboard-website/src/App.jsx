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
  VolumeX
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

// ---- Simple hash routing for dual-screen presentation ----
function getViewFromHash() {
  const h = (window.location.hash || "").toLowerCase();
  if (h.includes("/media")) return "media";     // TV feeds, CCTV, social, PSAs
  if (h.includes("/control")) return "control"; // controller app
  return "ops"; // default
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

// ===== QR Card (Assessment Mode) =====
function QRCard({ sessionId }) {
  const [dataUrl, setDataUrl] = React.useState(null);
  const controlUrl = `${window.location.origin}/?mode=assessment&session=${encodeURIComponent(sessionId || "")}#/control`;

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
        <div className="text-sm text-white/80 space-y-1">
          <div><span className="text-white/60">Session:</span> {sessionId || "—"}</div>
          <div className="text-white/60">URL:<div className="text-white/70 break-all">{controlUrl}</div></div>
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
function HotspotMap({ alerts }) {
  return (
    <div className="relative w-full h-[34rem] rounded-2xl bg-neutral-950 border border-white/10 overflow-hidden">
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
  const feed = useMemo(() => (
    [
      "#Growlers spotted near Transit Hub | police scanner ch7",
      "Rumor: paste truck delay @ South Tunnels",
      "Implant ping fail rate +3.2% | region C",
      "Chant recorded: ‘We eat when *we* choose!’",
      "Counter-PSA trending: ‘Satisfaction is a right.’",
      "Crowd density 125% threshold @ Atrium",
      "Unit C-12 en route | 2 min ETA",
    ]
  ), []);

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
  const [participantId, setParticipantId] = React.useState(null);
  const [codename, setCodename] = React.useState(null);

  // connection
  const wsRef = React.useRef(null);
  const reconnectRef = React.useRef(null);
  const [connected, setConnected] = React.useState(false);

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
            ws.send(JSON.stringify({ type: "hello", role: "control", sessionId }));
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
          console.log('[control WS]', msg.type, msg); // <-- remove later @TODO remove

          if (msg.type === "welcome") return; // optional ack

          if (msg.type === "hello_ack" && msg.role === "control") {
            if (msg.participantId) setParticipantId(msg.participantId);
            if (msg.codename) setCodename(msg.codename);
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
          if (msg.type === "penalty" && typeof msg.delta === "number") {
            setScore((s) => Math.max(0, s + msg.delta));
            return;
          }
          if (msg.type === "event_open" && msg.event) {
            const evn = msg.event;
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
            return;
          }
          if (msg.type === "event_close") {
            setEventId(null);
            setActions([]);
            setWindowMs(0);
            setRemainingMs(0);
            setSending(false);
            return;
          }
          if (msg.type === "final") {
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
    if (!sessionId || !eventId || !choice) return;
    setSending(true);
    setLastSent(choice);
    try {
      const res = await fetch(`${HTTP_BASE}/api/session/${encodeURIComponent(sessionId)}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          participantId,         // <— important for personal feedback
          codename,              // optional, keeps your alias consistent
          eventId,               // <— required for server to score the right window
          action: choice,        // server now also accepts `choice`, but send action explicitly
          clientTs: Date.now()
        }),
      });
      if (!res.ok) {
        console.error('POST /input failed', res.status, await res.text());
      } else {
        console.log('POST /input ok');
      }
    } catch (e) {
      console.error('POST /input network error', e);
    }
    setTimeout(() => setSending(false), 400);
  }, [HTTP_BASE, sessionId, eventId, participantId, codename]);

  // timer ring metrics
  const pct = windowMs > 0 ? Math.max(0, Math.min(1, remainingMs / windowMs)) : 0;
  const radius = 52, circ = 2 * Math.PI * radius, dash = circ * pct;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-white/80 font-semibold tracking-wide">HCI Controller</div>
        <div className={`text-xs px-2 py-1 rounded border ${connected ? 'border-emerald-400/40 text-emerald-300 bg-emerald-500/10' : 'border-white/10 text-white/60'}`}>
          {connected ? 'Connected' : 'Offline'}
        </div>
      </div>

      {/* Session + Join */}
      <div className="text-xs text-white/60 mb-4">
        Session: <span className="text-white/80">{sessionId || '—'}</span>
      </div>

      {/* THE ALGORITHM directive */}
      <Card className="bg-neutral-900 border-white/10 mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-white/90 text-sm flex items-center gap-2">
            <Siren className="w-4 h-4"/> THE ALGORITHM
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-white/80 text-base">{directive || 'Awaiting directive…'}</div>
        </CardContent>
      </Card>

      {/* Score + Timer */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card className="bg-neutral-900 border-white/10 col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-white/90 text-sm">Score</CardTitle></CardHeader>
          <CardContent>
            <div className="h-3 rounded bg-white/10 overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
            </div>
            <div className="mt-1 text-xs text-white/60">{Math.round(score)} pts</div>
          </CardContent>
        </Card>
        <Card className="bg-neutral-900 border-white/10">
          <CardHeader className="pb-1"><CardTitle className="text-white/90 text-sm">Timer</CardTitle></CardHeader>
          <CardContent className="grid place-items-center">
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r={radius} stroke="rgba(255,255,255,0.15)" strokeWidth="10" fill="none" />
              <circle cx="60" cy="60" r={radius} stroke="#22d3ee" strokeWidth="10" fill="none"
                      strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                      transform="rotate(-90 60 60)" />
              <text x="60" y="64" textAnchor="middle" fill="#fff" fontSize="14">
                {Math.ceil(remainingMs/1000)}s
              </text>
            </svg>
          </CardContent>
        </Card>
      </div>

      {/* Action buttons */}
      <Card className="bg-neutral-900 border-white/10">
        <CardHeader className="pb-2"><CardTitle className="text-white/90 text-sm">Select Action</CardTitle></CardHeader>
        <CardContent>
          {actions.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {actions.map((a) => (
                <Button key={a} disabled={!eventId || sending} onClick={() => submitChoice(a)} className="justify-start">
                  {sending && lastSent === a ? 'Sending…' : a}
                </Button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-white/60">Waiting for next prompt…</div>
          )}
        </CardContent>
      </Card>

      {/* Dev/Test Controls — lets us verify POST /input wiring without a live event */}
      {import.meta.env.DEV && (
        <Card className="bg-neutral-900 border-white/10 mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-white/90 text-sm">Developer Test</CardTitle>
            <CardDescription className="text-white/50">Quick checks to ensure controller → backend is wired</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button disabled={!connected || !sessionId || !eventId || sending} onClick={() => submitChoice('TEST_ACTION')}>Send Test Action</Button>
              <Button disabled={!connected || !sessionId || !eventId || sending} onClick={() => submitChoice('ACK_DIRECTIVE')}>Acknowledge Directive</Button>
            </div>
            <div className="text-xs text-white/50 mt-2 space-y-1">
              <div>POST → /api/session/{sessionId || '…'}/input · last sent: {lastSent || '—'}</div>
              <div>HTTP_BASE: {HTTP_BASE || '—'}</div>
            </div>
            {!eventId && (
              <div className="text-[11px] text-amber-300/80 mt-1">No active event window — the backend must send `event_open` before inputs are accepted.</div>
            )}
          </CardContent>
        </Card>
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
      const overflow = next.slice(4); // anything beyond the visible stack
      // Convert any dropped critical alerts into incidents
      overflow.forEach((old) => {
        if (old && old.level === 'critical') {
          addIncidentFromAlert(old);
        }
      });
      return next.slice(0, 4);
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

  // Derived stats
  const totals = useMemo(() => {
    const inc = series.reduce((s, d) => s + d.incidents, 0);
    const rec = series.reduce((s, d) => s + d.recalibrations, 0);
    return { inc, rec };
  }, [series]);

  const adoptionRate = 86 + Math.round(Math.random() * 2); // playful drift
  const [stockLevel] = useState(42);            // demo value; wire to data if you have it
  const [etaSeconds, setEtaSeconds] = useState(15 * 60); // 15 minutes

  useEffect(() => {
    if (etaSeconds <= 0) return;               // stop at 0
    const id = setInterval(() => {
      setEtaSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [etaSeconds]);

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

  return (
    <TooltipProvider>
      <div className="min-h-screen w-full bg-neutral-950 text-white" aria-hidden={!!currentCritical}>
        {/* Top bar */}
        <header className="sticky top-0 z-40 border-b border-white/10 bg-neutral-950/80 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-emerald-400"/>
              <div className="font-semibold tracking-wide">Hunger Crisis Intervention – Ops Dashboard</div>
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-400/30">SECTOR C</Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-white/70">
              <div className="flex items-center gap-2"><MonitorCog className="w-4 h-4"/> System nominal</div>
              <Separator orientation="vertical" className="h-4 bg-white/20"/>
              <div className="font-mono">{clock}</div>
              <Separator orientation="vertical" className="h-4 bg-white/20"/>
              <div className={`flex items-center gap-2 text-sm ${remoteConnected ? 'text-emerald-400' : 'text-white/50'}`}>
                <Radio className="w-4 h-4"/>
                {remoteConnected ? 'Remote: Connected' : 'Remote: Offline'}
              </div>
              <Separator orientation="vertical" className="h-4 bg-white/20"/>
              <div className="flex items-center gap-2 text-xs">
                <a href="#/ops" className={`px-2 py-0.5 rounded border ${view==='ops' ? 'bg-white/10 border-white/30 text-white' : 'border-white/10 text-white/60 hover:text-white/80'}`}>OPS</a>
                <a href="#/media" className={`px-2 py-0.5 rounded border ${view==='media' ? 'bg-white/10 border-white/30 text-white' : 'border-white/10 text-white/60 hover:text-white/80'}`}>MEDIA</a>
              </div>
              {/* Start New Session button */}
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('http://localhost:8787/api/session', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ scenarioId: 'sector-c-ops-01' }),
                    });
                    const data = await res.json();
                    console.log('Session created:', data);
                    if (data.sessionId) {
                      window.location.href = `${window.location.origin}/?mode=assessment&session=${encodeURIComponent(data.sessionId)}#/ops`;
                    } else {
                      console.error('No sessionId in response', data);
                    }
                  } catch (err) {
                    console.error('Error creating session', err);
                  }
                }}
                className="px-3 py-2 ml-3 rounded-md bg-blue-700 hover:bg-blue-600 text-white text-sm"
              >
                Start New Session
              </button>
            </div>
          </div>
        </header>
        {isAssessment && <AlgorithmBanner text={algoText} />}

        <main className="max-w-[95rem] mx-auto px-2 py-4">
          {view === 'ops' ? (
            // ===== OPS SCREEN: Big map + alerts + statistics =====
            <div className="grid grid-cols-12 xl:grid-cols-16 gap-4">
              {/* Prominent Map */}
              <section className="col-span-12 xl:col-span-12">
                <Card className="bg-neutral-900 border-white/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-white/90"><MapPin className="w-4 h-4"/> Live Incident Map</CardTitle>
                    <CardDescription className="text-white/50">All active alerts are geolocated. Resolved alerts disappear from the map.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <HotspotMap alerts={mapAlerts}/>
                  </CardContent>
                </Card>
              </section>

              {/* Metrics & Gauges */}
              <section className="col-span-12 lg:col-span-9 xl:col-span-9 space-y-4">
                {isAssessment && (
                  <QRCard sessionId={assessmentSessionId} />
                )}
                <Card className="bg-neutral-900 border-white/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-white/90"><Activity className="w-4 h-4"/> Incident & Response Trend</CardTitle>
                    <CardDescription className="text-white/50">Past 24 time slices</CardDescription>
                  </CardHeader>
                  <CardContent className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorInc" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.6}/>
                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorRec" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.6}/>
                            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                        <XAxis dataKey="t" stroke="#888" type="number" domain={['dataMin','dataMax']} tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })}/>
                        <YAxis stroke="#888"/>
                        <RechartsTooltip labelFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })} contentStyle={{ background:'#0a0a0a', border:'1px solid rgba(255,255,255,0.1)', color:'white' }}/>
                        <Area type="monotone" dataKey="incidents" stroke="#ef4444" fill="url(#colorInc)" name="Incidents" />
                        <Area type="monotone" dataKey="recalibrations" stroke="#22d3ee" fill="url(#colorRec)" name="Recalibrations" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-2 gap-3">
                  <Stat icon={Siren} label="Incidents (sum)" value={fmt(totals.inc)} />
                  <Stat icon={Zap} label="Recalibrations (sum)" value={fmt(totals.rec)} />
                  <Card className="bg-neutral-900 border-white/10">
                    <CardContent className="p-4 text-center">
                      <div className="text-xs uppercase tracking-widest text-white/50 leading-tight mb-1">Sector C Population</div>
                      <div className="text-2xl font-semibold text-white leading-tight">{fmt(sectorCPop)}</div>
                      <div className="text-xs text-white/50 mt-1">people in response area.</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-neutral-900 border-white/10">
                    <CardContent className="p-4 text-center">
                      <div className="text-xs uppercase tracking-widest text-white/50 leading-tight mb-1">World Population</div>
                      <div className="text-2xl font-semibold text-white leading-tight">2.53B</div>
                      <div className="text-xs text-white/50 mt-1">Total as of 7/10/2025</div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-neutral-900 border-white/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-white/90 flex items-center gap-2"><Building2 className="w-4 h-4"/> Caloric Stockpiles & Implant Adoption</CardTitle>
                    <CardDescription className="text-white/50">Distribution-ready reserves</CardDescription>
                  </CardHeader>
                  {/* reuse existing dual-vertical-bar CardContent */}
                  <CardContent>
                    {(() => {
                      const pri = priorityFor(stockLevel);
                      return (
                        <div className="flex items-end gap-6">
                          <div className="flex items-end gap-4">
                            <div className="relative w-8 h-48 rounded-lg bg-white/10 border border-white/10 overflow-hidden">
                              <div className={`absolute bottom-0 left-0 right-0 ${pri.bar}`} style={{ height: `${Math.max(0, Math.min(100, stockLevel))}%` }} />
                            </div>
                            <div className="relative w-8 h-48 rounded-lg bg-white/10 border border-white/10 overflow-hidden">
                              <div className="absolute bottom-0 left-0 right-0 bg-cyan-400" style={{ height: `${Math.max(0, Math.min(100, adoptionRate))}%` }} />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between text-sm text-white/70"><span>Sector C Stock</span><span>{stockLevel}%</span></div>
                            <div className="text-xs text-white/50">ETA resupply: {fmtEta(etaSeconds)} · Priority: <span className={pri.text}>{pri.label}</span></div>
                            <Separator className="my-3 bg-white/10" />
                            <div className="flex items-center justify-between text-sm text-white/70"><span>Implant Adoption</span><span>{adoptionRate}%</span></div>
                            <div className="text-xs text-white/50">Sector C registered</div>
                          </div>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>

                <Card className="bg-neutral-900 border-white/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-white/90 flex items-center gap-2"><MonitorCog className="w-4 h-4"/> Decision Log</CardTitle>
                    <CardDescription className="text-white/50">Automated & overridden actions</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {/* reuse existing audit log block */}
                    <ScrollArea className="h-40 pr-2">
                      <div className="space-y-2 text-sm">
                        {auditLog.length === 0 && (<div className="text-white/50">No decisions yet.</div>)}
                        {auditLog.map((e) => (
                          <div key={e.id} className="p-2 rounded-lg bg-white/5 border border-white/10">
                            <div className="flex items-center justify-between">
                              <div className="text-white/80">{e.action}</div>
                              <Badge className={`bg-white/10 border-white/20 ${e.via === 'automated' ? 'text-emerald-300' : (e.via === 'overridden' || (typeof e.via === 'string' && e.via.toLowerCase().includes('override'))) ? 'text-red-300' : 'text-white/80'}`}>{e.via}</Badge>
                            </div>
                            <div className="text-xs text-white/60 mt-1 flex items-center gap-2"><MapPin className="w-3 h-3"/> {e.where} • {e.ts}</div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </section>

              {/* Alerts column on xl+ */}
              <section className="hidden xl:block xl:col-span-3 space-y-4">
                <AlertsPanel items={alerts} onClose={dismissAlert} />
              </section>
            </div>
          ) : view === 'media' ? (
            // ===== MEDIA SCREEN: TV feeds, incidents, social, PSAs =====
            <div className="grid grid-cols-12 xl:grid-cols-12 gap-4">
              <section className="col-span-12 lg:col-span-7 space-y-4">
                <VideoWall soundOn={soundOn} txIndex={txIndex} />
                <ReportedIncidents incidents={incidents} onSelect={setSelectedIncident} />
              </section>
              <section className="col-span-12 lg:col-span-5 space-y-4">
                <SocialTicker/>
                <Card className="bg-neutral-900 border-white/10">
                  <CardHeader className="pb-2"><CardTitle className="text-white/90">Incident Brief</CardTitle></CardHeader>
                  <CardContent>
                    {/* reuse selected incident brief UI from Tabs 'brief' */}
                    {selectedIncident ? (
                      <div className="grid md:grid-cols-3 gap-6 text-sm">
                        <div className="space-y-2"><div className="font-semibold text-white/80">Situation</div><p className="text-white/70">{selectedIncident._summary?.situation}</p></div>
                        <div className="space-y-2"><div className="font-semibold text-white/80">Actions</div>{selectedIncident._summary?.actions?.length ? (<ul className="list-disc list-inside text-white/70 space-y-1">{selectedIncident._summary.actions.map((a,i)=>(<li key={i}>{a}</li>))}</ul>) : (<div className="text-white/60">No actions taken</div>)}</div>
                        <div className="space-y-2"><div className="font-semibold text-white/80">Outlook</div><p className="text-white/70">{selectedIncident._summary?.outlook}</p></div>
                      </div>
                    ) : (
                      <div className="text-sm text-white/60">Select an incident from the left to view details.</div>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-neutral-900 border-white/10">
                  <CardHeader className="pb-2"><CardTitle className="text-white/90">Public Broadcast Assets</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {publicImages.map((item) => (
                        <div key={item.id} className="relative aspect-square rounded-2xl overflow-hidden border border-white/10">
                          <img src={item.src} alt={`${item.title} poster`} className="w-full h-full object-cover" draggable={false} />
                          <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent text-xs text-white/80">{item.title}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-neutral-900 border-white/10">
                  <CardHeader className="pb-2"><CardTitle className="text-white/90">Social Media Feed</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {Array.from({ length: 7 }, (_, i) => `/assets/tweets/tweet${i + 1}.jpg`).map((src, i) => (
                        <img key={src} src={src} alt={`Tweet ${i + 1}`} className="max-w-md mx-auto w-full h-auto block rounded-xl bg-white/5 border border-white/10" draggable={false} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </section>
            </div>
          ) : (
            // ===== CONTROL PANEL: operate the dashboard =====
            <ControlPanel />
          )}
        </main>

        {/* Floating Alerts (hidden on xl+, where we show the right-side panel) */}
        <div className="xl:hidden">
          <AlertStack items={alerts} onClose={dismissAlert} />
        </div>
        {/* Blocking Critical Alert Modal */}
        {currentCritical && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[100] flex items-center justify-center"
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            {/* Strobe border */}
            <div className="red-strobe-border" />
            {/* Modal content */}
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
      {assessmentFinal && (
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