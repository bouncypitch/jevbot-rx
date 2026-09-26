// Records the nurse texting demo to ~/Downloads/jevbot-rx-nurse-texting.mp4
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "text-video-"));
const size = { width: 1600, height: 900 };
const b = await chromium.launch({ args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: size, recordVideo: { dir, size } });
const p = await ctx.newPage();
await p.goto("http://localhost:5173/?world=hospital&seed=42");
await p.waitForTimeout(13000);
const type = async (text, wait) => {
  await p.fill("#msg", "");
  await p.type("#msg", text, { delay: 35 });
  await p.click("#compose button");
  await p.waitForTimeout(wait);
};
await type("Need STAT meds from pharmacy to ICU bed 4 please", 15000);
await type("where are you now?", 12000);
await type("can you take blood to the lab too?", 8000);
await ctx.close();
await b.close();
const webm = join(dir, readdirSync(dir).find((f) => f.endsWith(".webm")));
const out = join(homedir(), "Downloads", "jevbot-rx-nurse-texting.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "12", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
console.log(`Saved ${out}`);
