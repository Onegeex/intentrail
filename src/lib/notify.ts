/**
 * Tell the owner when the vault needs a person: a trade held above the
 * autonomy limit. Generic webhook (POST JSON) and/or Telegram.
 *   NOTIFY_WEBHOOK_URL
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 */
export async function notifyOwner(event: { title: string; detail: string; vault: string; txUrl?: string }) {
  const jobs: Promise<unknown>[] = [];
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (url) {
    jobs.push(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "intentrail", ...event }),
        signal: AbortSignal.timeout(5_000),
      }),
    );
  }
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (bot && chat) {
    const text = `IntentRail: ${event.title}\n${event.detail}\nVault: ${event.vault}${event.txUrl ? `\n${event.txUrl}` : ""}`;
    jobs.push(
      fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(5_000),
      }),
    );
  }
  await Promise.allSettled(jobs);
}

export function notificationsConfigured() {
  return Boolean(process.env.NOTIFY_WEBHOOK_URL || (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID));
}
