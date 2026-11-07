"use client";

import { animate } from "motion";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentVote, GuardCheck } from "@/lib/types";
import { useLive, type FeedItem } from "./LiveContext";

/* ------------------------------------------------------------------ */
/* Signals: one per guard check, in the order a trade meets them.      */
/* ------------------------------------------------------------------ */

const SIGNALS = [
  { code: "KILL_SWITCH", name: "Kill switch" },
  { code: "ALLOWLIST", name: "Allowlist" },
  { code: "AMOUNT_BOUNDS", name: "Size" },
  { code: "MAX_LOSS", name: "Max loss" },
  { code: "DAILY_CAP", name: "Daily cap" },
  { code: "SLIPPAGE", name: "Slippage" },
  { code: "FEE_AWARE", name: "Fees" },
  { code: "CONSENSUS", name: "Consensus" },
  { code: "DISTINCT_ASSETS", name: "Pair" },
  { code: "HUMAN_APPROVAL_POLICY", name: "Approval" },
] as const;

type LampState = "dark" | "proceed" | "danger" | "unchecked";

type Manifest = {
  fromSymbol: string;
  toSymbol: string;
  amountUsd: number;
  slippageBps?: number;
  stopLossPct?: number;
  votes?: AgentVote[];
  rationale?: string;
};

type Run = {
  id: string;
  source: "live" | "you";
  manifest: Manifest;
  checks: GuardCheck[];
  decision: "PASS" | "BLOCK";
  reason: string;
};

/* ------------------------------------------------------------------ */
/* Track geometry. "A" runs along the line 0..1000, "L" is 0 for the   */
/* main line and 1 for the siding. Two layouts share the same model.   */
/* ------------------------------------------------------------------ */

type Orientation = "h" | "v";
type Pt = { x: number; y: number };

const A_SIGNAL = (i: number) => 112 + i * 74;
const A_PLATFORM_STOP = 935;
const A_ENTRY = 0;

const GEOM = {
  h: {
    viewBox: "0 0 1200 300",
    px: (a: number, l: number): Pt => ({ x: 20 + a * 1.16, y: 112 + l * 130 }),
  },
  v: {
    viewBox: "0 0 360 720",
    px: (a: number, l: number): Pt => ({ x: 176 + l * 140, y: 34 + a * 0.64 }),
  },
} as const;

function buildRoute(o: Orientation, blockAt: number | null): Pt[] {
  const px = GEOM[o].px;
  if (blockAt === null) return [px(A_ENTRY, 0), px(A_PLATFORM_STOP, 0)];
  const a = A_SIGNAL(blockAt);
  return [px(A_ENTRY, 0), px(a + 14, 0), px(a + 64, 1), px(a + 104, 1)];
}

function measure(pts: Pt[]) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return cum;
}

function pointAt(pts: Pt[], cum: number[], d: number) {
  const total = cum[cum.length - 1];
  const dd = Math.max(0, Math.min(total, d));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < dd) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (dd - cum[i - 1]) / seg;
  const a = pts[i - 1];
  const b = pts[i];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}

const toPath = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");

/* ------------------------------------------------------------------ */
/* Trades you can send                                                  */
/* ------------------------------------------------------------------ */

const YES_VOTES: AgentVote[] = [
  { agent: "trend", vote: "yes", reason: "uptrend" },
  { agent: "risk", vote: "yes", reason: "sized" },
];

const PRESETS = [
  {
    id: "safe",
    label: "$5 USDC to NEAR",
    hint: "Within every limit",
    body: {
      fromSymbol: "USDC",
      toSymbol: "NEAR",
      amountUsd: 5,
      slippageBps: 50,
      stopLossPct: 2,
      feeAwareOk: true,
      votes: YES_VOTES,
    },
  },
  {
    id: "overcap",
    label: "$500 USDC to NEAR",
    hint: "Ten times the size cap",
    body: { fromSymbol: "USDC", toSymbol: "NEAR", amountUsd: 500, slippageBps: 50, feeAwareOk: true },
  },
  {
    id: "badtoken",
    label: "$5 USDC to DOGE",
    hint: "Token not on the allowlist",
    body: { fromSymbol: "USDC", toSymbol: "DOGE", amountUsd: 5 },
  },
] as const;

const BUILD_TOKENS = ["USDC", "NEAR", "ETH", "BTC", "WETH", "DOGE", "PEPE"];

/* ------------------------------------------------------------------ */

function useOrientation(): Orientation {
  const [o, setO] = useState<Orientation>("h");
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => setO(mq.matches ? "v" : "h");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return o;
}

function blockIndexFor(run: Run): number | null {
  if (run.decision === "PASS") return null;
  const byCode = new Map(run.checks.map((c) => [c.code, c]));
  const idx = SIGNALS.findIndex((s) => byCode.get(s.code)?.ok === false);
  if (idx >= 0) return idx;
  // Failed on a check that has no signal of its own (e.g. a mainnet-only cap),
  // or the request was rejected outright: hold at the first signal.
  return 0;
}

function runFromFeed(item: FeedItem): Run {
  const p = item.proposal;
  return {
    id: `live-${p.id}-${Date.now()}`,
    source: "live",
    manifest: {
      fromSymbol: p.fromSymbol,
      toSymbol: p.toSymbol,
      amountUsd: p.amountUsd,
      slippageBps: p.slippageBps,
      stopLossPct: p.stopLossPct,
      votes: p.votes,
      rationale: p.rationale,
    },
    checks: item.guard.checks,
    decision: item.guard.decision,
    reason: item.guard.reason,
  };
}

async function runFromGuard(body: Record<string, unknown>): Promise<Run> {
  const manifest: Manifest = {
    fromSymbol: String(body.fromSymbol),
    toSymbol: String(body.toSymbol),
    amountUsd: Number(body.amountUsd),
    slippageBps: body.slippageBps as number | undefined,
    stopLossPct: body.stopLossPct as number | undefined,
    votes: body.votes as AgentVote[] | undefined,
  };
  const id = `you-${Date.now()}`;
  try {
    const res = await fetch("/api/guard/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.decision) {
      return {
        id,
        source: "you",
        manifest,
        checks: [],
        decision: "BLOCK",
        reason: data.error || `Request refused (HTTP ${res.status})`,
      };
    }
    return {
      id,
      source: "you",
      manifest,
      checks: Array.isArray(data.checks) ? data.checks : [],
      decision: data.decision,
      reason: String(data.reason || ""),
    };
  } catch {
    return {
      id,
      source: "you",
      manifest,
      checks: [],
      decision: "BLOCK",
      reason: "Could not reach the seatbelt. Check your connection and send it again.",
    };
  }
}

/* ------------------------------------------------------------------ */

type Phase = "idle" | "running" | "held" | "arrived";

export function SignalBox() {
  const o = useOrientation();
  const reduce = useReducedMotion();
  const { data } = useLive();

  const [run, setRun] = useState<Run | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lamps, setLamps] = useState<LampState[]>(() => SIGNALS.map(() => "dark"));
  const [pointsSet, setPointsSet] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const trainRef = useRef<SVGGElement>(null);
  const routeRef = useRef<SVGPathElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const pendingRef = useRef<Run | null>(null);
  const lastUserRef = useRef(0);
  const cycleRef = useRef(0);
  const visibleRef = useRef(true);
  const stopRef = useRef<() => void>(() => {});

  const route = useMemo(
    () => (run ? buildRoute(o, blockIndexFor(run)) : buildRoute(o, null)),
    [run, o],
  );
  const cum = useMemo(() => measure(route), [route]);
  const total = cum[cum.length - 1];

  const placeTrain = useCallback(
    (d: number) => {
      const p = pointAt(route, cum, d);
      trainRef.current?.setAttribute("transform", `translate(${p.x} ${p.y}) rotate(${p.deg})`);
      if (routeRef.current) routeRef.current.style.strokeDashoffset = String(total - d);
    },
    [route, cum, total],
  );

  // Drive the animation whenever a new run is set.
  useEffect(() => {
    if (!run) return;
    const blockAt = blockIndexFor(run);
    const byCode = new Map(run.checks.map((c) => [c.code, c]));
    const scale = o === "h" ? 1.16 : 0.64;
    const lampFor = (i: number): LampState => {
      const c = byCode.get(SIGNALS[i].code);
      if (!c) return "unchecked";
      return c.ok ? "proceed" : "danger";
    };

    let cancelled = false;
    const controls: { stop: () => void }[] = [];
    stopRef.current = () => {
      cancelled = true;
      controls.forEach((c) => c.stop());
    };

    const revealUpTo = (d: number) => {
      setLamps((prev) => {
        let changed = false;
        const next = prev.map((s, i) => {
          if (s !== "dark") return s;
          if (blockAt !== null && i > blockAt) return s;
          if (d >= (A_SIGNAL(i) - 58) * scale) {
            changed = true;
            return lampFor(i);
          }
          return s;
        });
        return changed ? next : prev;
      });
    };

    const finish = () => {
      if (cancelled) return;
      setPhase(blockAt === null ? "arrived" : "held");
      busyRef.current = false;
      const next = pendingRef.current;
      if (next) {
        pendingRef.current = null;
        window.setTimeout(() => start(next), 900);
      }
    };

    setPhase("running");
    setPointsSet(null);
    placeTrain(0);

    if (reduce) {
      revealUpTo(Infinity);
      if (blockAt !== null) setPointsSet(blockAt);
      placeTrain(total);
      finish();
      return () => stopRef.current();
    }

    const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

    (async () => {
      if (blockAt === null) {
        const c = animate(0, total, {
          duration: total / 430,
          ease: [0.45, 0, 0.15, 1],
          onUpdate: (d) => {
            placeTrain(d);
            revealUpTo(d);
          },
        });
        controls.push(c);
        await c;
        finish();
        return;
      }
      // Approach the red signal, stop short, switch the points, crawl into the siding.
      const stopD = (A_SIGNAL(blockAt) - 26) * scale;
      const c1 = animate(0, stopD, {
        duration: Math.max(0.6, stopD / 420),
        ease: [0.4, 0, 0.25, 1],
        onUpdate: (d) => {
          placeTrain(d);
          revealUpTo(d);
        },
      });
      controls.push(c1);
      await c1;
      if (cancelled) return;
      await sleep(520);
      if (cancelled) return;
      setPointsSet(blockAt);
      await sleep(460);
      if (cancelled) return;
      const c2 = animate(stopD, total, {
        duration: 1.25,
        ease: [0.3, 0, 0.1, 1],
        onUpdate: placeTrain,
      });
      controls.push(c2);
      await c2;
      finish();
    })();

    return () => stopRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, o]);

  const start = useCallback((r: Run) => {
    if (busyRef.current) {
      pendingRef.current = r;
      return;
    }
    busyRef.current = true;
    setLamps(SIGNALS.map(() => "dark"));
    setRun(r);
  }, []);

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      lastUserRef.current = Date.now();
      setSending(true);
      const r = await runFromGuard(body);
      setSending(false);
      start(r);
      boxRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
    },
    [start, reduce],
  );

  // Only run the unattended loop when the box is on screen and the tab is visible.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (visibleRef.current = e.isIntersecting), {
      threshold: 0.2,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // First train: the live agent's latest proposal, as soon as it exists.
  const firstFed = useRef(false);
  useEffect(() => {
    if (firstFed.current || !data?.feed?.length) return;
    firstFed.current = true;
    start(runFromFeed(data.feed[0]));
  }, [data, start]);

  // Unattended loop: alternate live proposals with the three reference trades.
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    const id = window.setInterval(() => {
      if (busyRef.current) return;
      if (!visibleRef.current || document.visibilityState !== "visible") return;
      if (Date.now() - lastUserRef.current < 30_000) return;
      const step = cycleRef.current++ % 4;
      const feed = dataRef.current?.feed;
      if (step % 2 === 0 && feed?.length) {
        start(runFromFeed(feed[0]));
      } else {
        const preset = PRESETS[(Math.floor(step / 2) + cycleRef.current) % PRESETS.length];
        void runFromGuard(preset.body as unknown as Record<string, unknown>).then(start);
      }
    }, 9_000);
    return () => window.clearInterval(id);
  }, [start]);

  const blockAt = run ? blockIndexFor(run) : null;
  const heldSignal = blockAt !== null ? SIGNALS[blockAt] : null;
  const heldCheck = run && heldSignal ? run.checks.find((c) => c.code === heldSignal.code) : null;
  const failures = run ? run.checks.filter((c) => !c.ok) : [];

  const routeColor =
    phase === "held"
      ? "var(--color-danger)"
      : phase === "arrived"
        ? "var(--color-proceed)"
        : "var(--color-ivory)";

  return (
    <div ref={boxRef} className="space-y-6">
      {/* The mimic panel */}
      <div className="relative overflow-hidden rounded-[28px] border border-rule bg-panel-deep shadow-[inset_0_1px_0_rgba(236,230,211,0.06)]">
        <TrackDiagram
          o={o}
          lamps={lamps}
          pointsSet={pointsSet}
          route={route}
          total={total}
          routeColor={routeColor}
          phase={phase}
          trainRef={trainRef}
          routeRef={routeRef}
          heldName={heldSignal?.name}
        />
      </div>

      {/* Readout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr_1.2fr]">
        <ManifestCard run={run} />
        <SignalLog run={run} lamps={lamps} />
        <Outcome
          run={run}
          phase={phase}
          heldName={heldSignal?.name}
          heldDetail={heldCheck?.detail ?? (run?.checks.length === 0 ? run.reason : undefined)}
          otherFailures={failures.filter((f) => f.code !== heldSignal?.code)}
        />
      </div>

      {/* Dispatch */}
      <Dispatch sending={sending} onSend={send} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TrackDiagram({
  o,
  lamps,
  pointsSet,
  route,
  total,
  routeColor,
  phase,
  trainRef,
  routeRef,
  heldName,
}: {
  o: Orientation;
  lamps: LampState[];
  pointsSet: number | null;
  route: Pt[];
  total: number;
  routeColor: string;
  phase: Phase;
  trainRef: React.RefObject<SVGGElement | null>;
  routeRef: React.RefObject<SVGPathElement | null>;
  heldName?: string;
}) {
  const g = GEOM[o];
  const px = g.px;
  const h = o === "h";
  const mainStart = px(A_ENTRY, 0);
  const mainEnd = px(1000, 0);
  const sidingStart = px(A_SIGNAL(0) + 64, 1);
  const sidingEnd = px(A_SIGNAL(9) + 120, 1);
  const platA = px(870, 0);
  const platB = px(1000, 0);
  const buffer = px(A_SIGNAL(9) + 120, 1);

  return (
    <svg
      viewBox={g.viewBox}
      className="block w-full h-auto"
      role="img"
      aria-label="Track diagram: a trade runs past ten guard signals. Green lets it through; red sends it to the siding."
    >
      <defs>
        <filter id="lampGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id="trainGlow" x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* Siding and main line, painted track */}
      <line
        x1={sidingStart.x}
        y1={sidingStart.y}
        x2={sidingEnd.x}
        y2={sidingEnd.y}
        stroke="var(--color-rule)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* Buffer stop at the end of the siding */}
      <line
        x1={buffer.x + (h ? 0 : -14)}
        y1={buffer.y + (h ? -14 : 0)}
        x2={buffer.x + (h ? 0 : 14)}
        y2={buffer.y + (h ? 14 : 0)}
        stroke="var(--color-danger)"
        strokeWidth="5"
        strokeLinecap="round"
        opacity={0.6}
      />
      <text
        x={h ? sidingEnd.x - 4 : sidingEnd.x}
        y={h ? sidingEnd.y + 34 : sidingEnd.y + 34}
        textAnchor={h ? "end" : "middle"}
        className="fill-ivory-dim font-display"
        fontSize={h ? 18 : 17}
        fontWeight={700}
        letterSpacing="0.04em"
      >
        {h ? "Siding: blocked trades" : "Siding"}
      </text>

      {/* Crossovers, one per signal */}
      {SIGNALS.map((s, i) => {
        const a = A_SIGNAL(i);
        const p1 = px(a + 14, 0);
        const p2 = px(a + 64, 1);
        const active = pointsSet === i;
        return (
          <g key={`x-${s.code}`}>
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="var(--color-rule)"
              strokeWidth="4"
              strokeLinecap="round"
              opacity={0.55}
            />
            {active && (
              <motion.line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="var(--color-danger)"
                strokeWidth="6"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              />
            )}
          </g>
        );
      })}

      <line
        x1={mainStart.x}
        y1={mainStart.y}
        x2={mainEnd.x}
        y2={mainEnd.y}
        stroke="var(--color-ivory)"
        strokeOpacity={0.85}
        strokeWidth="6"
        strokeLinecap="round"
      />

      {/* Platform */}
      <rect
        x={h ? platA.x : platA.x + 12}
        y={h ? platA.y + 12 : platA.y}
        width={h ? platB.x - platA.x : 16}
        height={h ? 16 : platB.y - platA.y}
        rx="3"
        fill={phase === "arrived" ? "var(--color-proceed)" : "var(--color-rule)"}
        style={{ transition: "fill 400ms" }}
      />
      <text
        x={h ? (platA.x + platB.x) / 2 : platA.x - 18}
        y={h ? platA.y + 54 : (platA.y + platB.y) / 2}
        textAnchor={h ? "middle" : "end"}
        dominantBaseline={h ? "auto" : "middle"}
        className="font-display"
        fill={phase === "arrived" ? "var(--color-proceed)" : "var(--color-ivory-dim)"}
        fontSize={h ? 20 : 17}
        fontWeight={800}
        letterSpacing="0.04em"
        style={{ transition: "fill 400ms" }}
      >
        {h ? "Your approval" : "Approval"}
      </text>

      {/* Entry */}
      <text
        x={h ? mainStart.x + 2 : mainStart.x - 18}
        y={h ? mainStart.y + 40 : mainStart.y + 6}
        textAnchor={h ? "start" : "end"}
        className="fill-ivory-dim font-display"
        fontSize={h ? 18 : 17}
        fontWeight={700}
        letterSpacing="0.04em"
      >
        Agent
      </text>

      {/* Lit route */}
      <path
        ref={routeRef}
        d={toPath(route)}
        fill="none"
        stroke={routeColor}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: total,
          strokeDashoffset: total,
          transition: "stroke 300ms",
          filter: "drop-shadow(0 0 6px currentColor)",
        }}
        opacity={0.95}
      />

      {/* Signals */}
      {SIGNALS.map((s, i) => {
        const base = px(A_SIGNAL(i), 0);
        const lamp = h ? { x: base.x, y: base.y - 52 } : { x: base.x - 52, y: base.y };
        const state = lamps[i];
        const color =
          state === "proceed"
            ? "var(--color-proceed)"
            : state === "danger"
              ? "var(--color-danger)"
              : "#26393c";
        return (
          <g key={s.code}>
            {/* mast */}
            <line
              x1={h ? lamp.x : lamp.x + 13}
              y1={h ? lamp.y + 13 : lamp.y}
              x2={h ? base.x : base.x - 9}
              y2={h ? base.y - 9 : base.y}
              stroke="var(--color-rule)"
              strokeWidth="3"
            />
            {/* housing */}
            <circle cx={lamp.x} cy={lamp.y} r={14} fill="#0a1415" stroke="var(--color-rule)" strokeWidth="2" />
            {(state === "proceed" || state === "danger") && (
              <circle cx={lamp.x} cy={lamp.y} r={12} fill={color} opacity={0.55} filter="url(#lampGlow)" />
            )}
            <circle
              cx={lamp.x}
              cy={lamp.y}
              r={8}
              fill={color}
              strokeDasharray={state === "unchecked" ? "3 3" : undefined}
              stroke={state === "unchecked" ? "var(--color-ivory-dim)" : "none"}
              style={{ transition: "fill 180ms" }}
            />
            {(state === "proceed" || state === "danger") && (
              <motion.circle
                key={`${s.code}-${state}`}
                cx={lamp.x}
                cy={lamp.y}
                fill="none"
                stroke={color}
                strokeWidth={2}
                initial={{ r: 9, opacity: 0.9 }}
                animate={{ r: 26, opacity: 0 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
              />
            )}
            <text
              x={h ? lamp.x : lamp.x - 22}
              y={h ? lamp.y - 26 : lamp.y}
              textAnchor={h ? "middle" : "end"}
              dominantBaseline={h ? "auto" : "middle"}
              className="font-display"
              fontSize={h ? 17 : 16}
              fontWeight={700}
              letterSpacing="0.03em"
              fill={
                state === "danger"
                  ? "var(--color-danger)"
                  : state === "proceed"
                    ? "var(--color-ivory)"
                    : "var(--color-ivory-dim)"
              }
              style={{ transition: "fill 180ms" }}
            >
              {s.name}
            </text>
          </g>
        );
      })}

      {/* Held marker beside the stopped train */}
      {phase === "held" && heldName && h && (
        <motion.text
          key={`held-${heldName}`}
          x={route[route.length - 1].x + 34}
          y={route[route.length - 1].y + 7}
          className="font-display"
          fontSize={20}
          fontWeight={800}
          fill="var(--color-danger)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          Held at {heldName}
        </motion.text>
      )}

      {/* The train */}
      <g ref={trainRef} transform={`translate(${route[0].x} ${route[0].y})`}>
        <rect x={-30} y={-9} width={46} height={18} rx={9} fill="var(--color-ivory)" opacity={0.5} filter="url(#trainGlow)" />
        <rect x={-30} y={-8} width={46} height={16} rx={8} fill="var(--color-ivory)" />
        <rect x={-24} y={-3} width={8} height={6} rx={1.5} fill="var(--color-panel)" />
        <rect x={-12} y={-3} width={8} height={6} rx={1.5} fill="var(--color-panel)" />
        <circle cx={11} cy={0} r={3} fill="var(--color-caution)" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */

function ManifestCard({ run }: { run: Run | null }) {
  return (
    <section className="space-y-3">
      <h3 className="font-display text-xl font-extrabold tracking-wide text-ivory">On the line</h3>
      {run ? (
          <motion.div
            key={run.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-3"
          >
            <p className="font-display text-4xl font-black leading-none tracking-wide text-ivory">
              {run.manifest.fromSymbol}
              <span className="mx-2 text-ivory-dim">to</span>
              {run.manifest.toSymbol}
            </p>
            <p className="font-mono text-2xl text-ivory">${run.manifest.amountUsd}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-ivory-dim">Sent by</dt>
              <dd className="text-ivory">{run.source === "live" ? "The live agent" : "You"}</dd>
              {run.manifest.slippageBps !== undefined && (
                <>
                  <dt className="text-ivory-dim">Slippage</dt>
                  <dd className="font-mono text-ivory">{run.manifest.slippageBps} bps</dd>
                </>
              )}
              {run.manifest.stopLossPct !== undefined && (
                <>
                  <dt className="text-ivory-dim">Stop loss</dt>
                  <dd className="font-mono text-ivory">{run.manifest.stopLossPct}%</dd>
                </>
              )}
            </dl>
            {run.manifest.votes && run.manifest.votes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {run.manifest.votes.map((v) => (
                  <span
                    key={v.agent}
                    title={v.reason}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      v.vote === "yes"
                        ? "border-proceed/50 text-proceed"
                        : "border-danger/50 text-danger"
                    }`}
                  >
                    {v.agent} agent votes {v.vote}
                  </span>
                ))}
              </div>
            )}
            {run.manifest.rationale && (
              <p className="text-sm leading-relaxed text-ivory-dim">{run.manifest.rationale}</p>
            )}
          </motion.div>
        ) : (
          <p className="text-sm text-ivory-dim">Waiting for the live agent&apos;s first proposal.</p>
        )}
    </section>
  );
}

function SignalLog({ run, lamps }: { run: Run | null; lamps: LampState[] }) {
  const byCode = new Map((run?.checks ?? []).map((c) => [c.code, c]));
  const shown = SIGNALS.map((s, i) => ({ s, i, state: lamps[i] })).filter((x) => x.state !== "dark");
  return (
    <section className="space-y-3">
      <h3 className="font-display text-xl font-extrabold tracking-wide text-ivory">Signal log</h3>
      <ol key={run?.id ?? "none"} className="space-y-1.5" aria-live="polite">
          {shown.map(({ s, state }) => {
            const c = byCode.get(s.code);
            return (
              <motion.li
                key={s.code}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-[14px_96px_1fr] items-baseline gap-3 text-sm"
              >
                <span
                  className={`inline-block h-2.5 w-2.5 translate-y-[1px] rounded-full ${
                    state === "proceed"
                      ? "bg-proceed"
                      : state === "danger"
                        ? "bg-danger"
                        : "border border-dashed border-ivory-dim"
                  }`}
                />
                <span className={state === "danger" ? "font-semibold text-danger" : "text-ivory"}>
                  {s.name}
                </span>
                <span className="text-ivory-dim">{c?.detail ?? "Not checked for this trade"}</span>
              </motion.li>
            );
          })}
      </ol>
      {shown.length === 0 && <p className="text-sm text-ivory-dim">Signals light as the train reaches them.</p>}
    </section>
  );
}

function Outcome({
  run,
  phase,
  heldName,
  heldDetail,
  otherFailures,
}: {
  run: Run | null;
  phase: Phase;
  heldName?: string;
  heldDetail?: string;
  otherFailures: GuardCheck[];
}) {
  const label =
    phase === "arrived"
      ? "Cleared. Waiting for your approval."
      : phase === "held"
        ? `Held at ${heldName ?? "the first signal"}.`
        : phase === "running"
          ? "Running the signals"
          : "Line clear";
  const tone =
    phase === "arrived" ? "text-proceed" : phase === "held" ? "text-danger" : "text-ivory";

  return (
    <section className="space-y-3">
      <h3 className="font-display text-xl font-extrabold tracking-wide text-ivory">Outcome</h3>
      <motion.p
          key={`${run?.id}-${phase}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className={`font-display text-4xl font-black leading-[0.95] tracking-wide ${tone}`}
        >
          {label}
        </motion.p>
      {phase === "held" && heldDetail && <p className="text-base text-ivory">{heldDetail}</p>}
      {phase === "held" && otherFailures.length > 0 && (
        <p className="text-sm text-ivory-dim">
          Also failing: {otherFailures.map((f) => f.detail).join("; ")}
        </p>
      )}
      {phase === "arrived" && (
        <p className="text-sm text-ivory-dim">
          Passing every signal doesn&apos;t move funds. A person still has to sign in their own
          wallet.
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Dispatch({
  sending,
  onSend,
}: {
  sending: boolean;
  onSend: (body: Record<string, unknown>) => void;
}) {
  const [from, setFrom] = useState("USDC");
  const [to, setTo] = useState("NEAR");
  const [amount, setAmount] = useState(5);

  return (
    <section className="rounded-[28px] border border-rule bg-panel-raised p-5 sm:p-7 space-y-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 className="font-display text-3xl font-black tracking-wide text-ivory">Send a trade down the line</h3>
        <p className="text-sm text-ivory-dim">Each one is a real call to the seatbelt API. No wallet needed.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PRESETS.map((p) => (
          <motion.button
            key={p.id}
            type="button"
            disabled={sending}
            whileTap={{ scale: 0.97 }}
            onClick={() => onSend(p.body as unknown as Record<string, unknown>)}
            className="group min-h-16 rounded-2xl border border-rule bg-panel px-4 py-3 text-left transition-colors hover:border-ivory-dim disabled:opacity-50"
          >
            <span className="block font-display text-2xl font-extrabold tracking-wide text-ivory">
              {p.label}
            </span>
            <span className="block text-sm text-ivory-dim">{p.hint}</span>
          </motion.button>
        ))}
      </div>

      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          onSend({
            fromSymbol: from,
            toSymbol: to,
            amountUsd: amount,
            slippageBps: 50,
            stopLossPct: 2,
            feeAwareOk: true,
            votes: YES_VOTES,
          });
        }}
      >
        <label className="text-sm text-ivory-dim">
          From
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-rule px-3 text-ivory"
          >
            {BUILD_TOKENS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ivory-dim">
          To
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-rule px-3 text-ivory"
          >
            {BUILD_TOKENS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ivory-dim">
          <span className="flex justify-between">
            <span>Amount</span>
            <span className="font-mono text-ivory">${amount}</span>
          </span>
          <input
            type="range"
            min={1}
            max={200}
            step={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="mt-3 w-full accent-[var(--color-caution)]"
          />
        </label>
        <motion.button
          type="submit"
          disabled={sending}
          whileTap={{ scale: 0.96 }}
          className="min-h-12 rounded-full bg-caution px-6 font-display text-xl font-black tracking-wide text-panel-deep disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send it"}
        </motion.button>
      </form>
    </section>
  );
}
