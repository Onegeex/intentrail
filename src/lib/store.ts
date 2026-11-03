import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { GuardrailPolicy, TradeProposal } from "./types";
import { getDefaultPolicy } from "./config";

/**
 * Runtime state for kill switch, spend, and proposals.
 * - Local/dev: ./data/runtime-state.json
 * - Vercel/serverless: os.tmpdir()/intentrail/ (writable /tmp), with in-memory fallback
 * Never writes into the Next.js project dir on Vercel (read-only).
 * Persist is best-effort: memory is always authoritative for the current isolate.
 */

function isServerlessFs(): boolean {
  return (
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true" ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    process.env.INTENTRAIL_STATE_TMP === "1"
  );
}

function resolvePaths(): { dataDir: string; stateFile: string } {
  if (isServerlessFs()) {
    const dataDir = path.join(os.tmpdir(), "intentrail");
    return { dataDir, stateFile: path.join(dataDir, "runtime-state.json") };
  }
  const dataDir = path.join(process.cwd(), "data");
  return { dataDir, stateFile: path.join(dataDir, "runtime-state.json") };
}

export interface RuntimeState {
  killSwitch: boolean;
  killReason?: string;
  /** YYYY-MM-DD UTC */
  spendDay: string;
  spentUsdToday: number;
  proposals: Record<string, TradeProposal>;
  /** proposalIds that a human approved (still must re-check guardrails before sign) */
  approved: Record<string, string>;
  updatedAt: string;
  /** True when disk persistence is unavailable; memory-only for this isolate */
  memoryOnly?: boolean;
  /** True when loaded state was untrusted/corrupt — fail closed */
  untrusted?: boolean;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyState(opts?: { killSwitch?: boolean; untrusted?: boolean }): RuntimeState {
  return {
    killSwitch: opts?.killSwitch ?? false,
    spendDay: todayUtc(),
    spentUsdToday: 0,
    proposals: {},
    approved: {},
    updatedAt: new Date().toISOString(),
    untrusted: opts?.untrusted,
  };
}

let memory: RuntimeState | null = null;
let writeChain: Promise<void> = Promise.resolve();
let diskDisabled = false;

function rollDay(state: RuntimeState): void {
  if (state.spendDay !== todayUtc()) {
    state.spendDay = todayUtc();
    state.spentUsdToday = 0;
  }
}

async function ensureLoaded(): Promise<RuntimeState> {
  if (memory) {
    rollDay(memory);
    return memory;
  }

  const { stateFile } = resolvePaths();

  try {
    const raw = await fs.readFile(stateFile, "utf8");
    let parsed: RuntimeState;
    try {
      parsed = JSON.parse(raw) as RuntimeState;
    } catch {
      // Corrupt on disk → fail closed (kill on) until human clears it
      memory = emptyState({ killSwitch: true, untrusted: true });
      memory.killReason = "corrupt_state";
      memory.memoryOnly = true;
      diskDisabled = true;
      return memory;
    }

    memory = {
      ...emptyState(),
      ...parsed,
      proposals: parsed.proposals && typeof parsed.proposals === "object" ? parsed.proposals : {},
      approved: parsed.approved && typeof parsed.approved === "object" ? parsed.approved : {},
      killSwitch: Boolean(parsed.killSwitch),
    };
    rollDay(memory);
    return memory;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      memory = emptyState();
      return memory;
    }
    // Unreadable (permissions, etc.) → fail closed
    memory = emptyState({ killSwitch: true, untrusted: true });
    memory.killReason = "state_unreadable";
    memory.memoryOnly = true;
    diskDisabled = true;
    return memory;
  }
}

function persist(state: RuntimeState): void {
  state.updatedAt = new Date().toISOString();
  if (diskDisabled) {
    state.memoryOnly = true;
    return;
  }

  const { dataDir, stateFile } = resolvePaths();

  writeChain = writeChain
    .then(async () => {
      try {
        await fs.mkdir(dataDir, { recursive: true });
        const tmp = path.join(
          dataDir,
          `runtime-state.${process.pid}.${Date.now()}.tmp`,
        );
        await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
        await fs.rename(tmp, stateFile);
        state.memoryOnly = false;
      } catch {
        // Best-effort only — never throw to request handlers
        diskDisabled = true;
        state.memoryOnly = true;
        try {
          // Clean stray tmp if rename failed mid-way (ignore errors)
          const entries = await fs.readdir(dataDir).catch(() => [] as string[]);
          await Promise.all(
            entries
              .filter((n) => n.startsWith("runtime-state.") && n.endsWith(".tmp"))
              .map((n) => fs.unlink(path.join(dataDir, n)).catch(() => undefined)),
          );
        } catch {
          /* ignore */
        }
      }
    })
    .catch(() => {
      diskDisabled = true;
      state.memoryOnly = true;
    });
}

async function flushPersist(): Promise<void> {
  try {
    await writeChain;
  } catch {
    /* never surface */
  }
}

export async function getState(): Promise<RuntimeState> {
  return ensureLoaded();
}

export async function getPolicy(): Promise<GuardrailPolicy> {
  const state = await ensureLoaded();
  const base = getDefaultPolicy();
  // Untrusted / unreadable state keeps kill switch ON (fail closed)
  const killSwitch = state.killSwitch || Boolean(state.untrusted);
  return { ...base, killSwitch };
}

export async function setKillSwitch(enabled: boolean, reason?: string): Promise<RuntimeState> {
  const state = await ensureLoaded();
  state.killSwitch = enabled;
  if (enabled) {
    state.killReason = reason || "manual";
  } else {
    // Clearing kill also clears untrusted latch only when explicitly turned off
    state.killReason = undefined;
    state.untrusted = false;
  }
  persist(state);
  await flushPersist();
  return state;
}

export async function saveProposal(p: TradeProposal): Promise<void> {
  const state = await ensureLoaded();
  state.proposals[p.id] = p;
  const ids = Object.keys(state.proposals);
  if (ids.length > 50) {
    ids
      .sort(
        (a, b) =>
          Date.parse(state.proposals[a].createdAt) -
          Date.parse(state.proposals[b].createdAt),
      )
      .slice(0, ids.length - 50)
      .forEach((id) => delete state.proposals[id]);
  }
  persist(state);
  await flushPersist();
}

export async function getProposal(id: string): Promise<TradeProposal | null> {
  const state = await ensureLoaded();
  return state.proposals[id] || null;
}

export async function markApproved(proposalId: string): Promise<void> {
  const state = await ensureLoaded();
  state.approved[proposalId] = new Date().toISOString();
  persist(state);
  await flushPersist();
}

export async function isApproved(proposalId: string): Promise<boolean> {
  const state = await ensureLoaded();
  return Boolean(state.approved[proposalId]);
}

export async function recordSpend(usd: number): Promise<void> {
  const state = await ensureLoaded();
  rollDay(state);
  state.spentUsdToday += Math.max(0, usd);
  persist(state);
  await flushPersist();
}

export async function getSpentToday(): Promise<number> {
  const state = await ensureLoaded();
  if (state.spendDay !== todayUtc()) return 0;
  return state.spentUsdToday;
}

export async function listRecentProposals(limit = 12): Promise<TradeProposal[]> {
  const state = await ensureLoaded();
  return Object.values(state.proposals)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(1, Math.min(50, limit)));
}
