// Task 3A: pick a verifiable, attestation-backed TEE model from NEAR AI Cloud's catalog.
// Never hand-pick a proxied model (anthropic/, openai/) for the ranking call: those are
// NOT private, and the whole product pitch depends on real inference happening inside a TEE.

import { writeFileSync, mkdirSync } from "node:fs";
import OpenAI from "openai";

process.loadEnvFile(".env.local");

const BASE_URL = "https://cloud-api.near.ai/v1";
const API_KEY = process.env.NEARAI_API_KEY;

if (!API_KEY) {
  console.error("NEARAI_API_KEY is not set in .env.local");
  process.exit(1);
}

type ModelMeta = {
  verifiable: boolean;
  attestationSupported: boolean;
  contextLength: number;
  modelDisplayName: string;
  ownedBy: string;
  providerType: string;
  supportedFeatures?: string[];
};

type ModelEntry = {
  modelId: string;
  inputCostPerToken: { amount: number; scale: number };
  outputCostPerToken: { amount: number; scale: number };
  metadata: ModelMeta;
};

function perMillion(cost: { amount: number; scale: number }): number {
  return (cost.amount / 10 ** cost.scale) * 1_000_000;
}

async function main() {
  const res = await fetch(`${BASE_URL}/model/list`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) {
    console.error(`model/list failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const body = (await res.json()) as { models: ModelEntry[] };
  const all = body.models;

  const rows = all.map((m) => ({
    id: m.modelId,
    ctx: m.metadata.contextLength,
    verifiable: m.metadata.verifiable,
    attested: m.metadata.attestationSupported,
    provider: m.metadata.providerType,
    inUsdPerM: Number(perMillion(m.inputCostPerToken).toFixed(3)),
    outUsdPerM: Number(perMillion(m.outputCostPerToken).toFixed(3)),
    features: (m.metadata.supportedFeatures ?? []).join(","),
  }));

  console.log(`\nFetched ${all.length} models from NEAR AI Cloud.\n`);
  console.table(rows);

  const qualified = all.filter(
    (m) =>
      m.metadata.verifiable === true &&
      m.metadata.attestationSupported === true &&
      m.metadata.contextLength >= 32768
  );

  if (qualified.length === 0) {
    console.error(
      "No model is both verifiable and attestation-supported with >=32k context. " +
        "Every strong candidate is proxied (anthropic/, openai/) and therefore NOT private. STOPPING."
    );
    process.exit(1);
  }

  const onlyProxiedStrong = qualified.every((m) => m.metadata.providerType === "external");
  if (onlyProxiedStrong) {
    console.error(
      "Only proxied external models qualify. Those are not TEE-private. STOPPING: tell Buzzy."
    );
    process.exit(1);
  }

  // Preference order per the build spec: largest GLM > DeepSeek > Qwen class model,
  // skip abliterated (safety-stripped) variants, prefer the full/non-flash model within a family,
  // then prefer native json_mode/structured_outputs support, then largest context.
  const family = (id: string): number => {
    const s = id.toLowerCase();
    if (s.includes("abliterated")) return 99;
    if (s.includes("z-ai/glm") || s.includes("glm-")) return 0;
    if (s.includes("deepseek")) return 1;
    if (s.includes("qwen")) return 2;
    return 10;
  };
  const isFlash = (id: string) => id.toLowerCase().includes("flash");
  const supportsStructured = (m: ModelEntry) => {
    const f = m.metadata.supportedFeatures ?? [];
    return f.includes("structured_outputs") || f.includes("json_mode");
  };

  const ranked = [...qualified].sort((a, b) => {
    const fa = family(a.modelId);
    const fb = family(b.modelId);
    if (fa !== fb) return fa - fb;
    // Prefer native json_mode/structured_outputs first: empirically, this prompt's
    // 20-candidate, 8-step scoring method sends non-structured-output "full" reasoning
    // models into tens of thousands of reasoning tokens before they ever emit JSON
    // (measured: z-ai/glm-5.3 hit a 30000 token ceiling on reasoning alone, finish_reason
    // "length", zero content). A flash/distilled model with native structured output
    // is more reliable here than a larger model that reasons indefinitely.
    const structA = supportsStructured(a) ? 0 : 1;
    const structB = supportsStructured(b) ? 0 : 1;
    if (structA !== structB) return structA - structB;
    const flashA = isFlash(a.modelId) ? 1 : 0;
    const flashB = isFlash(b.modelId) ? 1 : 0;
    if (flashA !== flashB) return flashA - flashB; // prefer non-flash when structured support ties
    return b.metadata.contextLength - a.metadata.contextLength;
  });

  const choice = ranked[0];
  console.log("\nSelected model:", choice.modelId);
  console.log("Reason: verifiable + attestation-supported, GLM/DeepSeek/Qwen family preference,");
  console.log("        full (non-flash) variant preferred, native structured-output support preferred.\n");

  mkdirSync("data", { recursive: true });
  writeFileSync(
    "data/model-choice.json",
    JSON.stringify(
      {
        modelId: choice.modelId,
        contextLength: choice.metadata.contextLength,
        providerType: choice.metadata.providerType,
        verifiable: choice.metadata.verifiable,
        attestationSupported: choice.metadata.attestationSupported,
        supportedFeatures: choice.metadata.supportedFeatures ?? [],
        inUsdPerMillionTokens: Number(perMillion(choice.inputCostPerToken).toFixed(3)),
        outUsdPerMillionTokens: Number(perMillion(choice.outputCostPerToken).toFixed(3)),
        selectedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log("Wrote data/model-choice.json\n");

  // Smoke test
  const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
  const start = Date.now();
  const completion = await client.chat.completions.create({
    model: choice.modelId,
    messages: [{ role: "user", content: "Reply with exactly one word: ok" }],
    max_tokens: 300, // reasoning token spend is non-deterministic on this model, leave margin
  });
  const latencyMs = Date.now() - start;
  console.log("Smoke test reply:", completion.choices[0]?.message?.content);
  console.log(`Latency: ${latencyMs}ms\n`);
}

main().catch((err) => {
  console.error("models.ts failed:", err);
  process.exit(1);
});
