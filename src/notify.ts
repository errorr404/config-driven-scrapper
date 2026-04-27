import type { CheckResult } from "./types.js";

const TELEGRAM_MAX_LEN = 4000; // safety margin under 4096 char limit

export async function notifyTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("\n! TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — would have sent:");
    console.log(text);
    return false;
  }
  const chunks = chunkText(text, TELEGRAM_MAX_LEN);
  for (const chunk of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error(`Telegram send failed: ${res.status} ${await res.text()}`);
      return false;
    }
  }
  return true;
}

function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  const lines = text.split("\n");
  let buf = "";
  for (const line of lines) {
    if ((buf + "\n" + line).length > max) {
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function formatMessage(results: CheckResult[]): string {
  const blocks: string[] = [];
  for (const r of results) {
    if (r.added.length === 0) continue;
    const items = r.added
      .slice(0, 8)
      .map((l) => {
        const title = escapeHtml(l.text.slice(0, 140));
        return `• <a href="${escapeHtml(l.href)}">${title}</a>`;
      })
      .join("\n");
    const more = r.added.length > 8 ? `\n  …and ${r.added.length - 8} more` : "";
    blocks.push(`<b>${escapeHtml(r.source.name)}</b> (${r.added.length} new)\n${items}${more}`);
  }
  return `🆕 <b>New vacancies</b>\n\n${blocks.join("\n\n")}`;
}
