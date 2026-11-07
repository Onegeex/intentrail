"use client";

import { useEffect, useRef } from "react";

/*
 * Full-bleed hero: a track running toward the viewer under a gantry of
 * signal lamps, one per on-chain GuardVault check. Trades arrive from the horizon. Cleared
 * trades rush past the camera; blocked ones brake under a red lamp and are
 * switched into a siding. Outcomes use the server's real allowlist and size
 * limits when available; the scene itself is an illustration.
 */

export type HeroEvent = {
  cleared: boolean;
  label: string;
  detail: string;
};

type Policy = { allowlist: string[]; min: number; max: number };

/** The GuardVault contract's on-chain checks, in the order it runs them. */
const CHECK_NAMES = [
  "Kill switch",
  "Signature",
  "Fresh quote",
  "Allowlist",
  "Venue",
  "Size cap",
  "Fee cap",
  "Daily cap",
  "Approval",
];
const ALLOWLIST_AT = 3;
const SIZE_AT = 5;

const COLORS = {
  ivory: "236,230,211",
  proceed: "75,227,141",
  danger: "255,77,63",
  caution: "246,185,63",
  points: "121,184,217",
};

const UNLISTED = ["DOGE", "PEPE", "SHIB", "WIF"];

type Trade = {
  from: string;
  to: string;
  amount: number;
  blockAt: number | null;
  detail: string;
};

type Train = {
  trade: Trade;
  phase: "approach" | "check" | "pass" | "divert" | "gone";
  t: number;
  z: number;
  x: number;
  side: 1 | -1;
  alpha: number;
};

type Spark = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number };

const GANTRY_Z = 14;
const LAMP_Y = 5.2;
const CAM_Y = 2.2;
const RAIL = 0.72;
const FAR = 170;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function makeTrade(policy: Policy, n: number): Trade {
  const listed = policy.allowlist.length ? policy.allowlist : ["NEAR", "USDC", "ETH", "BTC"];
  const roll = n === 0 ? 0.9 : Math.random();
  let from = pick(listed);
  let to = pick(listed.filter((s) => s !== from));
  let amount = Math.round(rand(Math.max(1, policy.min), Math.min(policy.max, 40)));
  if (roll < 0.22) {
    amount = Math.round(rand(policy.max * 1.6, policy.max * 18) / 10) * 10;
  } else if (roll < 0.42) {
    if (Math.random() < 0.5) to = pick(UNLISTED);
    else from = pick(UNLISTED);
  }
  const listedOk = listed.includes(from) && listed.includes(to);
  const sizeOk = amount >= policy.min && amount <= policy.max;
  let blockAt: number | null = null;
  let detail = "Passed every check. The agent trades without asking anyone.";
  if (!listedOk) {
    blockAt = ALLOWLIST_AT;
    const bad = listed.includes(from) ? to : from;
    detail = `${bad} isn't on the allowlist.`;
  } else if (!sizeOk) {
    blockAt = SIZE_AT;
    detail = `$${amount} is over the $${policy.max} limit per trade.`;
  }
  return { from, to, amount, blockAt, detail };
}

export function HeroScene({
  policy,
  onEvent,
}: {
  policy: Policy;
  onEvent?: (e: HeroEvent) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const policyRef = useRef(policy);
  policyRef.current = policy;
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let f = 600;
    let hy = 300;
    let cx = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      f = Math.min(H * 0.95, W * 1.15);
      hy = H * (W < 640 ? 0.36 : 0.4);
      // On wide screens the line runs to the right of the headline.
      cx = W >= 1024 ? W * 0.66 : W / 2;
      if (W >= 1024) f = Math.min(f, W * 0.62);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Camera parallax
    let camX = 0;
    let camTarget = 0;
    let camLift = 0;
    let liftTarget = 0;
    const onMove = (e: PointerEvent) => {
      camTarget = ((e.clientX / window.innerWidth) * 2 - 1) * 1.1;
      liftTarget = ((e.clientY / window.innerHeight) * 2 - 1) * -0.35;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const P = (x: number, y: number, z: number) => {
      const zz = Math.max(0.25, z);
      return {
        x: cx + ((x - camX) * f) / zz,
        y: hy + ((CAM_Y + camLift - y) * f) / zz,
        s: f / zz,
      };
    };

    // State
    let n = 0;
    let train: Train = {
      trade: makeTrade(policyRef.current, n++),
      phase: "approach",
      t: 0,
      z: FAR,
      x: 0,
      side: 1,
      alpha: 0,
    };
    let lamps: { state: 0 | 1 | 2; glow: number }[] = CHECK_NAMES.map(() => ({ state: 0, glow: 0 }));
    let flash = 0;
    let flashColor = COLORS.proceed;
    let sparks: Spark[] = [];
    let gap = 0;
    const motes = Array.from({ length: 70 }, () => ({
      x: rand(-14, 14),
      y: rand(0.3, 9),
      z: rand(3, 90),
      v: rand(0.15, 0.5),
    }));

    const sidingPath = (side: number, s: number) => ({
      z: GANTRY_Z + 3 - 10.5 * s,
      x: side * 7.8 * smooth(s),
    });

    function emit(e: HeroEvent) {
      eventRef.current?.(e);
    }

    function step(dt: number) {
      camX += (camTarget - camX) * Math.min(1, dt * 2.2);
      camLift += (liftTarget - camLift) * Math.min(1, dt * 2.2);

      const tr = train;
      tr.t += dt;
      if (tr.phase === "approach") {
        tr.alpha = Math.min(1, tr.alpha + dt * 1.5);
        const v = 48 + (tr.z / FAR) * 40;
        tr.z -= v * dt;
        if (tr.z <= GANTRY_Z + 8) {
          tr.phase = "check";
          tr.t = 0;
        }
      } else if (tr.phase === "check") {
        const d = clamp(tr.t / 0.8, 0, 1);
        tr.z = GANTRY_Z + 8 - 5 * (1 - (1 - d) * (1 - d));
        const stopAt = tr.trade.blockAt;
        CHECK_NAMES.forEach((_, i) => {
          if (stopAt !== null && i > stopAt) return;
          if (tr.t >= i * 0.065 && lamps[i].state === 0) {
            lamps[i] = { state: stopAt === i ? 2 : 1, glow: 1.6 };
          }
        });
        if (tr.t > (stopAt === null ? 0.85 : 1.05)) {
          tr.t = 0;
          if (stopAt === null) {
            tr.phase = "pass";
          } else {
            tr.phase = "divert";
            tr.side = Math.random() < 0.5 ? -1 : 1;
            flash = 0.5;
            flashColor = COLORS.danger;
            emit({
              cleared: false,
              label: `${tr.trade.from} to ${tr.trade.to}, $${tr.trade.amount}`,
              detail: `Refused at ${CHECK_NAMES[stopAt]}. ${tr.trade.detail}`,
            });
          }
        }
      } else if (tr.phase === "pass") {
        const v = 20 + tr.t * tr.t * 260;
        tr.z -= v * dt;
        if (tr.z < 1.4) {
          tr.phase = "gone";
          tr.t = 0;
          flash = 0.55;
          flashColor = COLORS.proceed;
          emit({
            cleared: true,
            label: `${tr.trade.from} to ${tr.trade.to}, $${tr.trade.amount}`,
            detail: tr.trade.detail,
          });
        }
      } else if (tr.phase === "divert") {
        const s = clamp(tr.t / 1.6, 0, 1);
        const p = sidingPath(tr.side, smooth(s));
        tr.z = p.z;
        tr.x = p.x;
        tr.alpha = 1 - Math.pow(s, 3);
        if (s < 0.8) {
          for (let k = 0; k < 3; k++) {
            sparks.push({
              x: tr.x + rand(-0.6, 0.6),
              y: 0.1,
              z: tr.z + rand(-0.3, 0.6),
              vx: rand(-2, 2) - tr.side * 1.5,
              vy: rand(1.5, 4.5),
              vz: rand(-1, 3),
              life: rand(0.4, 0.9),
            });
          }
        }
        if (s >= 1) {
          tr.phase = "gone";
          tr.t = 0;
        }
      } else if (tr.phase === "gone") {
        gap += dt;
        if (gap > 0.9) {
          gap = 0;
          lamps = lamps.map((l) => ({ ...l, state: 0 }));
          train = {
            trade: makeTrade(policyRef.current, n++),
            phase: "approach",
            t: 0,
            z: FAR,
            x: 0,
            side: 1,
            alpha: 0,
          };
        }
      }

      lamps.forEach((l) => {
        l.glow += ((l.state ? 1 : 0) - l.glow) * Math.min(1, dt * 5);
      });
      flash = Math.max(0, flash - dt * 1.3);
      sparks = sparks.filter((sp) => {
        sp.life -= dt;
        sp.vy -= 9 * dt;
        sp.x += sp.vx * dt;
        sp.y = Math.max(0, sp.y + sp.vy * dt);
        sp.z += sp.vz * dt;
        return sp.life > 0;
      });
      motes.forEach((m) => {
        m.z -= m.v * dt;
        if (m.z < 2) m.z = 90;
      });
    }

    function draw(time: number) {
      // Sky and ground
      const sky = ctx!.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, "#08121a");
      sky.addColorStop(0.75, "#0f2128");
      sky.addColorStop(1, "#1d3134");
      ctx!.fillStyle = sky;
      ctx!.fillRect(0, 0, W, hy + 1);
      const ground = ctx!.createLinearGradient(0, hy, 0, H);
      ground.addColorStop(0, "#14262a");
      ground.addColorStop(1, "#070e10");
      ctx!.fillStyle = ground;
      ctx!.fillRect(0, hy, W, H - hy);

      // Horizon glow
      const hg = ctx!.createRadialGradient(cx, hy, 0, cx, hy, W * 0.6);
      hg.addColorStop(0, `rgba(${COLORS.caution},0.16)`);
      hg.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = hg;
      ctx!.fillRect(0, 0, W, H);

      // Distant beacons
      for (let i = 0; i < 9; i++) {
        const bx = W * (0.08 + i * 0.105) + Math.sin(i * 7.3) * 30 - camX * 6;
        const blink = 0.4 + 0.6 * Math.max(0, Math.sin(time / 900 + i * 1.7));
        ctx!.fillStyle = `rgba(${i % 3 === 0 ? COLORS.danger : COLORS.ivory},${0.25 * blink})`;
        ctx!.beginPath();
        ctx!.arc(bx, hy - 3 - (i % 2) * 4, 1.4, 0, Math.PI * 2);
        ctx!.fill();
      }

      // Ballast bed
      const b1 = P(-1.7, 0, FAR);
      const b2 = P(1.7, 0, FAR);
      const b3 = P(1.7, 0, 1.2);
      const b4 = P(-1.7, 0, 1.2);
      ctx!.fillStyle = "rgba(0,0,0,0.28)";
      ctx!.beginPath();
      ctx!.moveTo(b1.x, b1.y);
      ctx!.lineTo(b2.x, b2.y);
      ctx!.lineTo(b3.x, b3.y);
      ctx!.lineTo(b4.x, b4.y);
      ctx!.fill();

      // Sleepers
      for (let z = 1.6; z < 110; z += 1.7) {
        const a = P(-1.15, 0, z);
        const c = P(1.15, 0, z);
        const fade = clamp(1 - z / 110, 0, 1);
        ctx!.strokeStyle = `rgba(38,56,60,${0.9 * fade})`;
        ctx!.lineWidth = Math.max(0.6, 0.22 * a.s);
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(c.x, c.y);
        ctx!.stroke();
      }

      // Train light on the rails
      const tr = train;
      const lit = (z: number) => {
        if (tr.phase === "gone" || tr.alpha <= 0) return 0;
        const d = Math.abs(z - tr.z);
        return Math.max(0, 1 - d / 14) * tr.alpha * (Math.abs(tr.x) < 1 ? 1 : 0.2);
      };

      // Rails, drawn in segments so the approaching light can brighten them
      for (const side of [-1, 1]) {
        for (let z = 1.2; z < FAR; z += z < 30 ? 1 : 4) {
          const z2 = z + (z < 30 ? 1 : 4);
          const a = P(side * RAIL, 0, z);
          const c = P(side * RAIL, 0, z2);
          const fade = clamp(1 - z / FAR, 0, 1);
          const l = lit(z);
          ctx!.strokeStyle = `rgba(${COLORS.ivory},${0.18 + 0.55 * fade + l * 0.5})`;
          ctx!.lineWidth = Math.max(0.7, 0.07 * a.s);
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(c.x, c.y);
          ctx!.stroke();
        }
      }

      // Sidings
      for (const side of [-1, 1]) {
        const activeSiding = tr.phase === "divert" && tr.side === side;
        for (const off of [-RAIL, RAIL]) {
          ctx!.beginPath();
          for (let i = 0; i <= 30; i++) {
            const p = sidingPath(side, i / 30);
            const q = P(p.x + off, 0, p.z);
            if (i === 0) ctx!.moveTo(q.x, q.y);
            else ctx!.lineTo(q.x, q.y);
          }
          ctx!.strokeStyle = activeSiding ? `rgba(${COLORS.danger},0.85)` : `rgba(${COLORS.ivory},0.14)`;
          ctx!.lineWidth = activeSiding ? 2.4 : 1.2;
          ctx!.stroke();
        }
      }

      // Dust motes
      motes.forEach((m) => {
        const q = P(m.x, m.y, m.z);
        const a = clamp(1 - m.z / 90, 0, 1) * 0.35;
        ctx!.fillStyle = `rgba(${COLORS.ivory},${a})`;
        ctx!.fillRect(q.x, q.y, Math.max(1, q.s * 0.025), Math.max(1, q.s * 0.025));
      });

      // Gantry
      const postL = P(-6.2, 0, GANTRY_Z);
      const postLt = P(-6.2, LAMP_Y + 0.9, GANTRY_Z);
      const postR = P(6.2, 0, GANTRY_Z);
      const postRt = P(6.2, LAMP_Y + 0.9, GANTRY_Z);
      ctx!.strokeStyle = "#2b3f43";
      ctx!.lineWidth = Math.max(2, 0.28 * postL.s);
      ctx!.beginPath();
      ctx!.moveTo(postL.x, postL.y);
      ctx!.lineTo(postLt.x, postLt.y);
      ctx!.moveTo(postR.x, postR.y);
      ctx!.lineTo(postRt.x, postRt.y);
      ctx!.stroke();
      const beamH = Math.max(6, 0.75 * postL.s);
      ctx!.fillStyle = "#1b2e32";
      ctx!.fillRect(postLt.x, postLt.y - beamH * 0.15, postRt.x - postLt.x, beamH * 1.15);
      ctx!.strokeStyle = "#3d5357";
      ctx!.lineWidth = 1;
      ctx!.strokeRect(postLt.x, postLt.y - beamH * 0.15, postRt.x - postLt.x, beamH * 1.15);

      // Lamps
      const font = `"Big Shoulders Display", "Overpass Variable", sans-serif`;
      CHECK_NAMES.forEach((name, i) => {
        const lx = -4 + i;
        const q = P(lx, LAMP_Y, GANTRY_Z);
        const r = Math.max(4, 0.3 * q.s);
        const l = lamps[i];
        const col = l.state === 2 ? COLORS.danger : COLORS.proceed;
        // housing
        ctx!.fillStyle = "#050b0c";
        ctx!.beginPath();
        ctx!.arc(q.x, q.y, r * 1.35, 0, Math.PI * 2);
        ctx!.fill();
        // lens
        const g = l.glow;
        ctx!.fillStyle = g > 0.02 ? `rgba(${col},${0.25 + 0.75 * Math.min(1, g)})` : "#1d2d30";
        ctx!.beginPath();
        ctx!.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx!.fill();
        if (g > 0.02) {
          ctx!.save();
          ctx!.globalCompositeOperation = "lighter";
          const halo = ctx!.createRadialGradient(q.x, q.y, 0, q.x, q.y, r * (5 + g * 3));
          halo.addColorStop(0, `rgba(${col},${0.55 * Math.min(1.2, g)})`);
          halo.addColorStop(1, "rgba(0,0,0,0)");
          ctx!.fillStyle = halo;
          ctx!.beginPath();
          ctx!.arc(q.x, q.y, r * (5 + g * 3), 0, Math.PI * 2);
          ctx!.fill();
          // light cone down onto the track
          if (l.state === 2) {
            const g2 = P(lx, 0, GANTRY_Z);
            const cone = ctx!.createLinearGradient(q.x, q.y, g2.x, g2.y);
            cone.addColorStop(0, `rgba(${col},${0.22 * g})`);
            cone.addColorStop(1, "rgba(0,0,0,0)");
            ctx!.fillStyle = cone;
            ctx!.beginPath();
            ctx!.moveTo(q.x - r, q.y);
            ctx!.lineTo(q.x + r, q.y);
            ctx!.lineTo(g2.x + r * 6, g2.y);
            ctx!.lineTo(g2.x - r * 6, g2.y);
            ctx!.fill();
          }
          ctx!.restore();
        }
        // name plate
        const fs = clamp(0.2 * q.s, 9, 15);
        if (fs >= 9 && W > 420) {
          ctx!.font = `700 ${fs}px ${font}`;
          ctx!.textAlign = "center";
          ctx!.fillStyle =
            l.state === 2 ? `rgba(${COLORS.danger},1)` : `rgba(${COLORS.ivory},${0.45 + 0.5 * Math.min(1, g)})`;
          ctx!.fillText(name, q.x, q.y + r * 2.6 + fs * 0.4);
        }
      });

      // Train
      if (tr.phase !== "gone" && tr.alpha > 0.01) {
        const head = P(tr.x, 0.9, tr.z);
        const s = head.s;
        ctx!.save();
        ctx!.globalAlpha = tr.alpha;
        // body: a lit block
        const bw = 2.2 * s;
        const bh = 1.6 * s;
        const top = P(tr.x, 2.3, tr.z);
        ctx!.fillStyle = "rgba(10,20,22,0.92)";
        ctx!.strokeStyle = `rgba(${COLORS.ivory},0.55)`;
        ctx!.lineWidth = Math.max(1, s * 0.04);
        const rx = head.x - bw / 2;
        const ry = top.y;
        ctx!.beginPath();
        ctx!.roundRect(rx, ry, bw, bh + (head.y - top.y) * 0.25, Math.max(2, s * 0.25));
        ctx!.fill();
        ctx!.stroke();
        // windscreen strip
        ctx!.fillStyle = `rgba(${COLORS.points},0.35)`;
        ctx!.fillRect(rx + bw * 0.12, ry + bh * 0.15, bw * 0.76, bh * 0.22);
        // headlamps
        ctx!.globalCompositeOperation = "lighter";
        for (const dx of [-0.65, 0.65]) {
          const hl = P(tr.x + dx, 0.75, tr.z);
          const rr = Math.max(2, 0.16 * hl.s);
          const glow = ctx!.createRadialGradient(hl.x, hl.y, 0, hl.x, hl.y, rr * 9);
          glow.addColorStop(0, `rgba(${COLORS.ivory},0.95)`);
          glow.addColorStop(0.2, `rgba(${COLORS.caution},0.35)`);
          glow.addColorStop(1, "rgba(0,0,0,0)");
          ctx!.fillStyle = glow;
          ctx!.beginPath();
          ctx!.arc(hl.x, hl.y, rr * 9, 0, Math.PI * 2);
          ctx!.fill();
        }
        // ground pool
        const gp = P(tr.x, 0, tr.z - 2);
        const pool = ctx!.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, s * 3.5);
        pool.addColorStop(0, `rgba(${COLORS.caution},0.18)`);
        pool.addColorStop(1, "rgba(0,0,0,0)");
        ctx!.fillStyle = pool;
        ctx!.beginPath();
        ctx!.ellipse(gp.x, gp.y, s * 3.5, s * 0.9, 0, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.globalCompositeOperation = "source-over";
        // destination board
        const fs = clamp(0.62 * s, 10, 34);
        if (tr.z < 120) {
          ctx!.font = `800 ${fs}px ${font}`;
          ctx!.textAlign = "center";
          const label = `${tr.trade.from} → ${tr.trade.to}  $${tr.trade.amount}`;
          ctx!.fillStyle =
            tr.phase === "divert" ? `rgba(${COLORS.danger},1)` : `rgba(${COLORS.caution},1)`;
          ctx!.fillText(label, head.x, ry - fs * 0.45);
        }
        ctx!.restore();
      }

      // Sparks
      if (sparks.length) {
        ctx!.save();
        ctx!.globalCompositeOperation = "lighter";
        sparks.forEach((sp) => {
          const q = P(sp.x, sp.y, sp.z);
          const a = clamp(sp.life * 1.5, 0, 1);
          ctx!.strokeStyle = `rgba(${COLORS.caution},${a})`;
          ctx!.lineWidth = Math.max(1, q.s * 0.03);
          const q2 = P(sp.x - sp.vx * 0.03, sp.y - sp.vy * 0.03, sp.z - sp.vz * 0.03);
          ctx!.beginPath();
          ctx!.moveTo(q.x, q.y);
          ctx!.lineTo(q2.x, q2.y);
          ctx!.stroke();
        });
        ctx!.restore();
      }

      // Outcome flash
      if (flash > 0) {
        const fl = ctx!.createRadialGradient(cx, H * 0.6, 0, cx, H * 0.6, Math.max(W, H));
        fl.addColorStop(0, `rgba(${flashColor},${flash * 0.18})`);
        fl.addColorStop(1, `rgba(${flashColor},${flash * 0.05})`);
        ctx!.fillStyle = fl;
        ctx!.fillRect(0, 0, W, H);
      }

      // Vignette
      const vg = ctx!.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.max(W, H) * 0.8);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx!.fillStyle = vg;
      ctx!.fillRect(0, 0, W, H);
    }

    let raf = 0;
    let last = performance.now();
    let running = true;
    let onScreen = true;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (running && onScreen && document.visibilityState === "visible") {
        step(dt);
        draw(now);
      }
      raf = requestAnimationFrame(loop);
    };

    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      last = performance.now();
    });
    io.observe(canvas);

    if (reduce) {
      // One still frame: a trade held under a red lamp.
      train.trade = { from: "USDC", to: "DOGE", amount: 5, blockAt: ALLOWLIST_AT, detail: "DOGE isn't on the allowlist." };
      train.phase = "divert";
      train.alpha = 1;
      train.t = 0.55;
      lamps = lamps.map((_, i) => ({ state: i < ALLOWLIST_AT ? 1 : i === ALLOWLIST_AT ? 2 : 0, glow: i <= ALLOWLIST_AT ? 1 : 0 }));
      const p = sidingPath(1, smooth(0.35));
      train.z = p.z;
      train.x = p.x;
      document.fonts?.ready.then(() => draw(0));
      draw(0);
      emit({ cleared: false, label: "USDC to DOGE, $5", detail: "Refused at Allowlist. DOGE isn't on the allowlist." });
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
