import { z } from "zod";
import { HARD_CAPS } from "./config";
import { isAllowlistedSymbol } from "./tokens";

const symbolSchema = z
  .string()
  .trim()
  .min(2)
  .max(12)
  .regex(/^[A-Za-z0-9]+$/)
  .refine((s) => isAllowlistedSymbol(s), { message: "Token not allowlisted" });

export const proposeBodySchema = z.object({
  fromSymbol: symbolSchema.default("USDC"),
  toSymbol: symbolSchema.default("NEAR"),
  amountUsd: z
    .number()
    .finite()
    .min(HARD_CAPS.minTradeUsd)
    .max(HARD_CAPS.maxTradeUsd),
  demo: z.boolean().optional().default(false),
});

export const quoteBodySchema = z.object({
  proposalId: z.string().uuid(),
  /** Must match a previously proposed & PASSed proposal; never free-form amounts */
  dry: z.literal(true).default(true),
});

export const killSwitchBodySchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().max(200).optional(),
});

export const approveBodySchema = z.object({
  proposalId: z.string().uuid(),
  approved: z.literal(true),
});

export type ProposeBody = z.infer<typeof proposeBodySchema>;

/** Loose proposal shape for POST /api/guard/check (external agents + bad-trade demos). */
export const guardCheckBodySchema = z.object({
  id: z.string().max(80).optional(),
  fromSymbol: z.string().trim().min(1).max(16),
  toSymbol: z.string().trim().min(1).max(16),
  amountUsd: z.number().finite(),
  amountIn: z.string().max(80).optional(),
  estimatedOut: z.string().max(80).optional(),
  estimatedFeeUsd: z.number().finite().optional(),
  slippageBps: z.number().finite().min(0).max(10_000).optional(),
  stopLossPct: z.number().finite().min(0).max(100).optional(),
  side: z.enum(["buy", "sell"]).optional(),
  trend: z.enum(["up", "down", "flat"]).optional(),
  rationale: z.string().max(500).optional(),
  feeAwareOk: z.boolean().optional(),
  network: z.enum(["testnet", "mainnet"]).optional(),
  demo: z.boolean().optional(),
  votes: z
    .array(
      z.object({
        agent: z.enum(["trend", "risk"]),
        vote: z.enum(["yes", "no"]),
        reason: z.string().max(300),
      }),
    )
    .optional(),
  swarmAgreed: z.boolean().optional(),
});

export const executePrepareBodySchema = z.object({
  proposalId: z.string().uuid().optional(),
  /** Full proposal accepted for serverless (re-checked fail-closed). */
  proposal: z
    .object({
      id: z.string().min(1).max(80),
      createdAt: z.string().max(40).optional(),
      side: z.enum(["buy", "sell"]),
      fromSymbol: symbolSchema,
      toSymbol: symbolSchema,
      amountUsd: z.number().finite().min(HARD_CAPS.minTradeUsd).max(HARD_CAPS.maxMainnetSwapUsd),
      amountIn: z.string().regex(/^\d+$/).max(80),
      estimatedOut: z.string().max(80),
      estimatedFeeUsd: z.number().finite(),
      slippageBps: z.number().finite().min(0).max(HARD_CAPS.maxSlippageBps),
      stopLossPct: z.number().finite().min(0).max(100),
      trend: z.enum(["up", "down", "flat"]),
      rationale: z.string().max(800),
      feeAwareOk: z.boolean(),
      network: z.enum(["testnet", "mainnet"]).optional(),
      demo: z.boolean().optional(),
      votes: z
        .array(
          z.object({
            agent: z.enum(["trend", "risk"]),
            vote: z.enum(["yes", "no"]),
            reason: z.string().max(300),
          }),
        )
        .min(2),
      swarmAgreed: z.literal(true),
      riskInputs: z
        .object({
          volatilityPct: z.number(),
          drawdownPct: z.number(),
          positionUsd: z.number(),
        })
        .optional(),
    })
    .optional(),
  accountId: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9._-]+$/),
  liveMode: z.literal(true),
  network: z.literal("mainnet"),
  riskAcknowledged: z.literal(true),
  confirmExecute: z.literal(true),
  confirmMainnetCap: z.literal(true),
}).refine((b) => Boolean(b.proposalId || b.proposal), {
  message: "proposalId or proposal required",
});
