// OpenAI-compatible client pointed at NEAR AI Cloud. The model id comes from
// data/model-choice.json (written by scripts/models.ts), never hardcoded here, so a
// re-run of the model check is the only place model choice changes.

import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { ScoutOutputSchema, type ScoutOutput } from "./schema";
import { sanitizeDeep } from "./sanitize";

const BASE_URL = "https://cloud-api.near.ai/v1";

type ModelChoice = {
  modelId: string;
  verifiable: boolean;
  attestationSupported: boolean;
  providerType: string;
  supportedFeatures: string[];
};

export function loadModelChoice(): ModelChoice {
  const raw = readFileSync("data/model-choice.json", "utf8");
  return JSON.parse(raw) as ModelChoice;
}

function getClient(): OpenAI {
  const apiKey = process.env.NEARAI_API_KEY;
  if (!apiKey) throw new Error("NEARAI_API_KEY is not set");
  return new OpenAI({ apiKey, baseURL: BASE_URL });
}

export type ScoutRunResult =
  | { ok: true; output: ScoutOutput; raw: string; repaired: boolean; latencyMs: number }
  | { ok: false; rawOutputs: string[]; errors: string[]; latencyMs: number };

export async function runScout(systemPrompt: string, userMessage: string): Promise<ScoutRunResult> {
  const model = loadModelChoice();
  if (!model.verifiable || !model.attestationSupported) {
    throw new Error(
      `Selected model ${model.modelId} is not verifiable+attestation-supported. Refusing to run: this would break the privacy pitch.`
    );
  }

  const client = getClient();
  const supportsJsonMode = model.supportedFeatures.includes("json_mode") || model.supportedFeatures.includes("structured_outputs");

  const start = Date.now();
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const rawOutputs: string[] = [];
  const errors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await client.chat.completions.create({
      model: model.modelId,
      messages,
      temperature: 0.2,
      max_tokens: 12000, // this model spends tokens on reasoning_content before the JSON answer
      ...(supportsJsonMode ? { response_format: { type: "json_object" as const } } : {}),
    });

    const text = completion.choices[0]?.message?.content ?? "";
    rawOutputs.push(text);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripMarkdownFences(text));
    } catch (e) {
      errors.push(`attempt ${attempt + 1}: not valid JSON (${(e as Error).message})`);
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: `Your last output failed validation: not valid JSON. Return corrected JSON only.`,
      });
      continue;
    }

    const result = ScoutOutputSchema.safeParse(parsed);
    if (result.success) {
      const sanitized = sanitizeDeep(result.data);
      return { ok: true, output: sanitized, raw: text, repaired: attempt > 0, latencyMs: Date.now() - start };
    }

    errors.push(`attempt ${attempt + 1}: ${result.error.message}`);
    messages.push({ role: "assistant", content: text });
    messages.push({
      role: "user",
      content: `Your last output failed validation: ${result.error.message}. Return corrected JSON only.`,
    });
  }

  return { ok: false, rawOutputs, errors, latencyMs: Date.now() - start };
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}
