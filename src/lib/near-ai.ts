import { isNearAiEnabled } from "./config";

/**
 * Optional NEAR AI Cloud inference (roadmap / opt-in).
 * Requires NEAR_AI_ENABLED=true and NEAR_AI_API_KEY — no paid signup attempted here.
 * Returns null when disabled so callers use deterministic swarm reasons.
 */
export async function optionalNearAiReason(prompt: string): Promise<string | null> {
  if (!isNearAiEnabled()) return null;
  const key = process.env.NEAR_AI_API_KEY!;
  const base =
    process.env.NEAR_AI_API_BASE?.replace(/\/$/, "") ||
    "https://cloud.near.ai/v1";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.NEAR_AI_MODEL || "near-ai",
        messages: [
          {
            role: "system",
            content:
              "You are IntentRail's risk/trend co-pilot. Reply in one short sentence.",
          },
          { role: "user", content: prompt.slice(0, 500) },
        ],
        max_tokens: 80,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.error("[intentrail] NEAR AI status", res.status);
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    console.error(
      "[intentrail] NEAR AI error:",
      err instanceof Error ? err.message : "error",
    );
    return null;
  }
}
