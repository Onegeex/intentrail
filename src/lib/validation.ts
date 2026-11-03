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
