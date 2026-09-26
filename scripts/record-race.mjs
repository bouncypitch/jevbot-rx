// Records the Brain Race split screen to ~/Downloads.
// Usage: npm run dev (in another terminal), then: node scripts/record-race.mjs [seconds]
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, renameSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const seconds = Number(process.argv[2] || 150);
const url = process.env.RACE_URL || "http://localhost:5173/race.html?seed=42";
const size = { width: 1920, height: 1080 };
const dir = mkdtempSync(join(tmpdir(), "race-video-"));

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: size,
  recordVideo: { dir, size },
});
const page = await context.newPage();
await page.goto(url);
// Let both simulators load their scenery before dispatching.
await page.waitForTimeout(12000);
await page.evaluate(() => window.startRace());
const deadline = Date.now() + seconds * 1000;
let jevDoneAt = null;
while (Date.now() < deadline) {
  const verdict = await page.textContent("#verdict");
  process.stdout.write(`\r${verdict.slice(0, 110).padEnd(110)}`);
  if (/sooner|delivered first|collided.*collided|collided.*delivered|delivered.*collided/.test(verdict)) {
    await page.waitForTimeout(5000);
    break;
  }
  // Stop 45 s after Jev arrives if the LLM robot is still en route.
  if (/Jev delivered/.test(verdict) && !jevDoneAt) jevDoneAt = Date.now();
  if (jevDoneAt && Date.now() - jevDoneAt > 45000) {
    await page.waitForTimeout(5000);
    break;
  }
  await page.waitForTimeout(1000);
}
console.log();
await context.close();
await browser.close();

const webm = readdirSync(dir).find((f) => f.endsWith(".webm"));
const out = join(
  homedir(),
  "Downloads",
  `${process.env.OUT_NAME || "jevbot-rx-brain-race"}.webm`,
);
renameSync(join(dir, webm), out);
console.log(`Saved ${out}`);
try {
  const mp4 = out.replace(/\.webm$/, ".mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", out, "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4]);
  console.log(`Saved ${mp4}`);
} catch {
  console.log("ffmpeg conversion skipped.");
}
