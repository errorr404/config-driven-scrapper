import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { State, SeenLink } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STATE_PATH = path.join(ROOT, "state.json");
const BACKUP_DIR = path.join(ROOT, "backups");

const MAX_AGE_DAYS = 365;
const BACKUPS_TO_KEEP = 14;

export function loadState(): State {
  if (!fs.existsSync(STATE_PATH)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    // Forward-compat: convert legacy array-shape state if encountered.
    const out: State = {};
    for (const id in raw) {
      const v = raw[id];
      if (Array.isArray(v)) {
        const links: Record<string, SeenLink> = {};
        for (const link of v as SeenLink[]) links[link.href] = link;
        out[id] = { links, lastCheckedAt: new Date().toISOString() };
      } else {
        out[id] = v;
      }
    }
    return out;
  } catch (e) {
    console.error(`! state.json unreadable, starting fresh: ${(e as Error).message}`);
    return {};
  }
}

export function saveState(state: State) {
  evictOld(state);
  const tmp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_PATH);
}

function evictOld(state: State) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  for (const id in state) {
    const links = state[id].links;
    for (const href in links) {
      if (Date.parse(links[href].firstSeenAt) < cutoff) {
        delete links[href];
      }
    }
  }
}

export function backupStateDaily(state: State) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(BACKUP_DIR, `state-${today}.json`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  }
  const backups = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("state-") && f.endsWith(".json"))
    .sort();
  for (const old of backups.slice(0, -BACKUPS_TO_KEEP)) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
  }
}
