import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Load .env.local into process.env for the eval run (vitest doesn't do this for
 * arbitrary keys). No-op if ANTHROPIC_API_KEY is already set in the environment.
 */
if (!process.env.ANTHROPIC_API_KEY) {
  const path = join(process.cwd(), ".env.local");
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
