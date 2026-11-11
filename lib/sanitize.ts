// Section 7.4: house rule 3 (no em/en dashes anywhere) and the banned word/name list,
// enforced in code, not just hoped for in the prompt. Run over every model output string
// and over UI copy at build time (see sanitize.test.ts).

export const BANNED_WORDS = [
  "networking event",
  "exclusive",
  "vip",
  "synergy",
  "thought leaders",
  "disrupt",
  "unicorn",
  "pitch night",
  "shark tank",
];

export const BANNED_NAMES = ["b.s society", "(bs) society", "intentio", "artifice"];

// Em dash / en dash -> comma or "to" between numbers. Never leaves a raw — or – behind.
export function sanitizeDashes(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2")
    .replace(/[–—]/g, ", ");
}

export function scanBannedTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const w of BANNED_WORDS) if (lower.includes(w)) hits.push(w);
  for (const n of BANNED_NAMES) if (lower.includes(n)) hits.push(n);
  return hits;
}

// Deep-walks any JSON-shaped value, sanitizing dashes in every string leaf.
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === "string") return sanitizeDashes(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeDeep(v);
    return out as T;
  }
  return value;
}

// Collects banned-term hits across every string leaf, tagged with a JSON-path-ish label
// so the UI can attach a warning chip to the right card.
export function collectBannedTermHits(value: unknown, path = "root"): { path: string; term: string }[] {
  const hits: { path: string; term: string }[] = [];
  if (typeof value === "string") {
    for (const term of scanBannedTerms(value)) hits.push({ path, term });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...collectBannedTermHits(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      hits.push(...collectBannedTermHits(v, `${path}.${k}`));
    }
  }
  return hits;
}
