// Replays captured Jev decision requests through Jev and several LLMs on GMI.
// Usage: node --env-file=.env scripts/brain-benchmark.mjs requests.jsonl [n]
import { readFileSync, writeFileSync } from "node:fs";
import { askLLM } from "../server/llm.js";

const lines = readFileSync(process.argv[2], "utf8").trim().split("\n");
const n = Number(process.argv[3] || 20);
const sample = Array.from({ length: n }, (_, i) =>
  JSON.parse(lines[Math.floor((i * lines.length) / n)]),
);
const env = process.env;
const models = [
  { name: "Jev (TypeSafe)", jev: true, inP: 0.042, outP: 0 },
  { name: "GPT-6 astra", id: "openai/gpt-6-astra", inP: 10, outP: 50 },
  { name: "GPT-6 sol", id: "openai/gpt-6-sol", inP: 2, outP: 10 },
  { name: "GPT-6 luna", id: "openai/gpt-6-luna", inP: 0.1, outP: 0.5 },
  { name: "DeepSeek-V4-Flash", id: "deepseek-ai/DeepSeek-V4-Flash", inP: 0.14, outP: 0.28 },
  ...(env.ANTHROPIC_API_KEY
    ? [{
        name: "Claude Opus 5.5",
        id: "anthropic/claude-opus-5-5",
        // Set CLAUDE_INPUT_PRICE / CLAUDE_OUTPUT_PRICE (USD per 1M tokens) for cost.
        inP: Number(env.CLAUDE_INPUT_PRICE || NaN),
        outP: Number(env.CLAUDE_OUTPUT_PRICE || NaN),
      }]
    : []),
];

async function jev(request) {
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function run(model) {
  const rows = [];
  for (const request of sample) {
    const t = performance.now();
    try {
      const data = model.jev ? await jev(request) : await askLLM(request, { ...env, GMI_MODEL: model.id });
      const ms = performance.now() - t;
      const valid = Object.entries(request.questions).every(([id, q]) =>
        Object.hasOwn(q.criteria, data.answers?.[id]?.choice));
      const cost = (data.usage.input_tokens * model.inP + data.usage.output_tokens * model.outP) / 1e6;
      rows.push({ ms, valid, cost, answers: Object.fromEntries(Object.entries(data.answers || {}).map(([k, v]) => [k, v.choice])) });
    } catch (e) {
      rows.push({ ms: performance.now() - t, valid: false, cost: 0, error: e.message });
    }
  }
  return rows;
}

const results = await Promise.all(models.map(run));
const jevAnswers = results[0];
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))]; };
const table = models.map((m, i) => {
  const r = results[i];
  const agree = r.filter((row, k) => row.answers && jevAnswers[k].answers &&
    Object.keys(jevAnswers[k].answers).every((q) => row.answers[q] === jevAnswers[k].answers[q])).length;
  return {
    model: m.name,
    p50_ms: Math.round(pct(r.map((x) => x.ms), 0.5)),
    p95_ms: Math.round(pct(r.map((x) => x.ms), 0.95)),
    valid: `${r.filter((x) => x.valid).length}/${r.length}`,
    same_choice_as_jev: i === 0 ? "—" : `${agree}/${r.length}`,
    cost_per_decision: "$" + (r.reduce((a, x) => a + x.cost, 0) / r.length).toFixed(6),
    errors: r.filter((x) => x.error).map((x) => x.error)[0] || "",
  };
});
console.table(table);
writeFileSync("docs/brain-benchmark.json", JSON.stringify({ decisions: n, table }, null, 2));
