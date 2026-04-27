/**
 * Smoke-test Telegram credentials. Run after putting TELEGRAM_BOT_TOKEN and
 * TELEGRAM_CHAT_ID in .env (or exporting them in your shell).
 *
 *   npx tsx test-telegram.ts
 *   npx tsx test-telegram.ts "custom test message"
 */
import "dotenv/config";
import { notifyTelegram } from "./src/notify.js";

const text =
  process.argv[2] ??
  `🧪 <b>GovtGate scraper — smoke test</b>\n\nIf you see this, your Telegram bot is wired up correctly.\n\nSent at ${new Date().toISOString()}`;

const ok = await notifyTelegram(text);
if (!ok) {
  console.error("\n✗ Telegram send did not succeed. Check:");
  console.error("  • TELEGRAM_BOT_TOKEN is set and matches the BotFather token");
  console.error("  • TELEGRAM_CHAT_ID is set");
  console.error("  • You sent at least one message TO the bot first (otherwise it cannot DM you)");
  console.error("  • Visit https://api.telegram.org/bot<TOKEN>/getUpdates to confirm chat id");
  process.exit(1);
}
console.log("✓ Telegram message sent.");
