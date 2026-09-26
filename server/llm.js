// Off-the-shelf LLM brain for the Brain Race. It receives the exact Jev request
// (same state tables, same candidate paths, same questions) and must answer in
// Jev's shape, so the only difference between the two robots is the model.

export const llmModel = (env) =>
  env.GMI_MODEL || "deepseek-ai/DeepSeek-V4-Flash";

function oneHot(criteria, choice) {
  return Object.fromEntries(
    Object.keys(criteria).map((id) => [id, id === choice ? 1 : 0]),
  );
}

async function askClaude(request, env, signal, prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || "claude-opus-5-5",
      max_tokens: 200,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    }),
    signal: signal || AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const error = new Error(`Anthropic API returned HTTP ${res.status}.`);
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  return {
    text: data.content?.find((c) => c.type === "text")?.text || "{}",
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    },
    model: data.model,
  };
}

export async function askLLM(request, env, signal) {
  const questions = request.questions;
  const schema = Object.fromEntries(
    Object.entries(questions).map(([id, q]) => [
      id,
      `one of ${Object.keys(q.criteria).join(" | ")}`,
    ]),
  );
  const prompt = {
    system:
      'You control a hospital delivery robot. Answer every question by picking exactly one option id. Reply with JSON only, e.g. {"motion":"drive","vector":"v3"}.',
    user: JSON.stringify({
      state: request.state,
      questions: Object.fromEntries(
        Object.entries(questions).map(([id, q]) => [
          id,
          { instructions: q.instructions, options: Object.keys(q.criteria) },
        ]),
      ),
      answer_format: schema,
    }),
  };
  const model = llmModel(env);
  let reply;
  if (model.startsWith("anthropic/")) {
    reply = await askClaude(request, { ...env, CLAUDE_MODEL: model.slice(10) }, signal, prompt);
  } else {
    const openai = model.startsWith("openai/");
    const res = await fetch(
      `${env.GMI_BASE_URL || "https://api.gmi-serving.com/v1"}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GMI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          ...(openai ? {} : { temperature: 0 }),
          // Each model's fastest setting: GPT-6 offers "none", others
          // "minimal". The cap leaves room for mandatory thinking tokens.
          reasoning_effort: openai
            ? model.includes("astra") ? "low" : "none"
            : "minimal",
          ...(openai ? { max_completion_tokens: 600 } : { max_tokens: 600 }),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        }),
        signal: signal || AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) {
      const error = new Error(`GMI LLM returned HTTP ${res.status}.`);
      error.status = res.status;
      throw error;
    }
    const data = await res.json();
    reply = {
      text: data.choices?.[0]?.message?.content || "{}",
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
  let parsed = {};
  try {
    const text = reply.text;
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("LLM returned unparseable JSON.");
  }
  const answers = {};
  for (const [id, q] of Object.entries(questions)) {
    let choice = String(parsed[id] ?? "").trim();
    // Accept "3" or "V3" for candidate "v3"; only the model's formatting differs.
    if (!Object.hasOwn(q.criteria, choice)) {
      const match = Object.keys(q.criteria).find(
        (k) => k.toLowerCase() === choice.toLowerCase() || k === `v${choice}`,
      );
      if (match) choice = match;
    }
    if (!Object.hasOwn(q.criteria, choice)) {
      console.warn(`[llm] invalid ${id}: ${JSON.stringify(parsed[id])} not in ${Object.keys(q.criteria).join(",")}`);
      throw new Error(`LLM returned an invalid ${id} choice.`);
    }
    answers[id] = {
      type: "choice",
      choice,
      probabilities: oneHot(q.criteria, choice),
      confidence: 1,
    };
  }
  return {
    model: llmModel(env),
    answers,
    usage: reply.usage,
  };
}
