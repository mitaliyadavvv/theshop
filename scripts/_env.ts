/** Load .env.local / .env for CLI scripts (Next.js does this itself for the app). */
import fs from "node:fs";
for (const f of [".env.local", ".env"]) if (fs.existsSync(f)) process.loadEnvFile(f);
