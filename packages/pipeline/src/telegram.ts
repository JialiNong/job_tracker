/**
 * Telegram Bot API sendMessage (port of src/tg/client.py). Destination:
 * TELEGRAM_CHAT_ID (+ optional TELEGRAM_MESSAGE_THREAD_ID), falling back to
 * TELEGRAM_ALLOWED_USER_ID. Failures are logged and return false: the
 * pipeline keeps going without Telegram.
 */
const intOrNull = (raw: string | undefined) => {
  const n = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
};

export interface SendOptions {
  parseMode?: "HTML";
  disableWebPagePreview?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendTelegramMessage(text: string, opts: SendOptions = {}): Promise<boolean> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? console.log;
  const doFetch = opts.fetchImpl ?? fetch;
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = intOrNull(env.TELEGRAM_CHAT_ID) ?? intOrNull(env.TELEGRAM_ALLOWED_USER_ID);
  if (!token || chatId === null) {
    log("⚠ Telegram notify skipped: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (or TELEGRAM_ALLOWED_USER_ID) missing");
    return false;
  }
  const threadId = intOrNull(env.TELEGRAM_MESSAGE_THREAD_ID);
  const payload = {
    chat_id: chatId, ...(threadId !== null ? { message_thread_id: threadId } : {}),
    text, disable_web_page_preview: opts.disableWebPagePreview ?? true,
    ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
  };
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; parameters?: { retry_after?: number } };
      if (res.ok && body.ok) return true;
      lastError = res.ok ? JSON.stringify(body) : `HTTP ${res.status}`;
      const retryAfter = body.parameters?.retry_after;
      if (attempt < 3 && (retryAfter !== undefined || res.status === 429)) {
        const wait = retryAfter !== undefined ? (retryAfter + 1) * 1000 : 6000 * attempt;
        log(`⚠ Telegram flood wait ${Math.round(wait / 1000)}s (attempt ${attempt}/3)`);
        await sleep(wait);
        continue;
      }
      log(`⚠ Telegram notify failed: ${lastError}`);
      return false;
    } catch (err) {
      lastError = (err as Error).message;
      if (attempt < 3) {
        await sleep(2000 * attempt);
        continue;
      }
    }
  }
  log(`⚠ Telegram notify failed: ${lastError}`);
  return false;
}
