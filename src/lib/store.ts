import { promises as fs } from "fs";
import path from "path";
import type { GuardrailPolicy, TradeProposal } from "./types";
import { getDefaultPolicy } from "./config";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "runtime-state.json");

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
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyState(): RuntimeState {
  return {
    killSwitch: false,
    spendDay: todayUtc(),
    spentUsdToday: 0,
    proposals: {},
    approved: {},
    updatedAt: new Date().toISOString(),
  };
}

let memory: RuntimeState | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function ensureLoaded(): Promise<RuntimeState> {
  if (memory) {
    if (memory.spendDay !== todayUtc()) {
      memory.spendDay = todayUtc();
      memory.spentUsdToday = 0;
    }
    return memory;
  }
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as RuntimeState;
    memory = {
      ...emptyState(),
      ...parsed,
      proposals: parsed.proposals || {},
      approved: parsed.approved || {},
    };
    if (memory.spendDay !== todayUtc()) {
      memory.spendDay = todayUtc();
      memory.spentUsdToday = 0;
    }
    return memory;
  } catch {
    memory = emptyState();
    return memory;
  }
}

function persist(state: RuntimeState): void {
  state.updatedAt = new Date().toISOString();
  writeChain = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(tmp, STATE_FILE);
  });
}

export async function getState(): Promise<RuntimeState> {
  return ensureLoaded();
}

export async function getPolicy(): Promise<GuardrailPolicy> {
  const state = await ensureLoaded();
  const base = getDefaultPolicy();
  return { ...base, killSwitch: state.killSwitch };
}

export async function setKillSwitch(enabled: boolean, reason?: string): Promise<RuntimeState> {
  const state = await ensureLoaded();
  state.killSwitch = enabled;
  state.killReason = enabled ? reason || "manual" : undefined;
  persist(state);
  await writeChain;
  return state;
}

export async function saveProposal(p: TradeProposal): Promise<void> {
  const state = await ensureLoaded();
  state.proposals[p.id] = p;
  // Cap memory: keep last 50
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
  await writeChain;
}

export async function getProposal(id: string): Promise<TradeProposal | null> {
  const state = await ensureLoaded();
  return state.proposals[id] || null;
}

export async function markApproved(proposalId: string): Promise<void> {
  const state = await ensureLoaded();
  state.approved[proposalId] = new Date().toISOString();
  persist(state);
  await writeChain;
}

export async function isApproved(proposalId: string): Promise<boolean> {
  const state = await ensureLoaded();
  return Boolean(state.approved[proposalId]);
}

export async function recordSpend(usd: number): Promise<void> {
  const state = await ensureLoaded();
  if (state.spendDay !== todayUtc()) {
    state.spendDay = todayUtc();
    state.spentUsdToday = 0;
  }
  state.spentUsdToday += Math.max(0, usd);
  persist(state);
  await writeChain;
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
