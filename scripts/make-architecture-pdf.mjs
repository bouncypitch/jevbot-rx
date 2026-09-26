// Renders docs/architecture.html to ~/Downloads/jevbot-rx-architecture.pdf
import { chromium } from "@playwright/test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("file://" + resolve("docs/architecture.html"));
const out = join(homedir(), "Downloads", "jevbot-rx-architecture.pdf");
await p.pdf({ path: out, width: "11in", height: "8.5in", printBackground: true });
await b.close();
console.log(`Saved ${out}`);
