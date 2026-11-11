// Section "Sourcing loop" from the real Sponsor Outreach Playbook (Notion):
// search NYC events in relevant categories, read titles/descriptions for sponsor mentions
// ("thank you to", "presented by", "sponsored by", "in partnership with", "x", "ft."),
// every name found is a proven buyer for a comparable audience.
//
// Luma has no public keyword-search API (confirmed), so this step is Claude-assisted for
// now: searches are run through a connected Luma integration and the raw results saved as
// JSON under data/raw/sourcing/. This module only does the extraction and scoring, which
// is independent of how the raw signals were collected, so it's a straight upgrade path to
// a fully automated source later without changing this logic.

import { readdirSync, readFileSync } from "node:fs";
import type { Candidate } from "./types";

export type LumaEventSignal = {
  name: string; // event title, often carries co-brand/sponsor mentions directly
  calendar: string; // organizing calendar/community name, not itself a sponsor signal
  hosts: string[]; // host display names, mix of people and organizations
  url: string;
  start_at: string;
};

export type SourcingFile = {
  category: string;
  searchedAt: string;
  entries: LumaEventSignal[];
};

type RawMention = {
  company: string;
  evidence: string;
  sourceUrl: string;
  category: string;
  confidence: "title_mention" | "host_listed";
};

// Separators that introduce a co-brand or sponsor mention inside an event title.
const TITLE_PATTERNS: RegExp[] = [
  /\bpresented by\s+([^,·|]+)/i,
  /\bsponsored by\s+([^,·|]+)/i,
  /\bin partnership with\s+([^,·|]+)/i,
  /\bft\.?\s+([^,·|]+)/i,
  /\bfeaturing\s+([^,·|]+)/i,
  /\bby\s+([A-Z][\w.]*(?:\s+[A-Z][\w.]*){0,3})\s*$/, // trailing "... by Niural AI" at end of title
];

// Deliberately excludes generic short words like "co" or "group" that collide with real
// person names (e.g. "Lance Co Ting Keh" is a person, not a company called "Co").
const ORG_SUFFIX = /\b(inc|llc|llp|corp|labs|capital|bank|partners|ventures|club|network|collective|events|fund|ai|technologies|technology|ltd)\b/i;

function looksLikeOrganization(name: string): boolean {
  const cleaned = name.trim();
  if (!cleaned) return false;
  if (ORG_SUFFIX.test(cleaned)) return true;
  // All-caps acronym
  if (/^[A-Z0-9&.]{2,8}$/.test(cleaned)) return true;
  return false;
}

function looksLikePersonName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (ORG_SUFFIX.test(name)) return false;
  // "Firstname Lastname" or longer multi-part names (some are 3-4 tokens, e.g. "Lance Co Ting
  // Keh"): if every token is capitalized, lowercase-initial, and short, treat it as a person
  // name rather than relying on word count, which false-positives on organizations too easily.
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Z][a-z'.-]*$/.test(w));
}

// Splits a captured mention string on "x", "×" and "+" into individual candidate names,
// e.g. "Rain + Monk + JP Morgan" -> ["Rain", "Monk", "JP Morgan"].
function splitMultiMention(text: string): string[] {
  return text
    .split(/\s[x+×]\s/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 60);
}

// Hosts are often "Person Name" or "Person Name, Company" or "Person Name (Company)". Only
// the company part is a sponsor signal; extract it and drop the rest.
function extractOrgFromHost(host: string): string | null {
  const parenMatch = host.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const inner = parenMatch[1].trim();
    return looksLikeOrganization(inner) || !looksLikePersonName(inner) ? inner : null;
  }
  if (host.includes(",")) {
    const last = host.split(",").pop()!.trim();
    return looksLikeOrganization(last) ? last : null;
  }
  if (looksLikePersonName(host)) return null;
  return looksLikeOrganization(host) ? host : null;
}

function splitCoBrandedTitle(title: string): string[] {
  // "First Citizens Innovation Banking x Withum x Valli Ventures: ..." style titles.
  const beforeColon = title.split(/[:·]/)[0];
  if (!/\sx\s/i.test(beforeColon)) return [];
  return beforeColon
    .split(/\sx\s/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 60);
}

function extractFromSignal(signal: LumaEventSignal, category: string): RawMention[] {
  const mentions: RawMention[] = [];

  for (const piece of splitCoBrandedTitle(signal.name)) {
    mentions.push({
      company: piece,
      evidence: `Co-branded on a comparable ${category} event: "${signal.name}"`,
      sourceUrl: signal.url,
      category,
      confidence: "title_mention",
    });
  }

  for (const pattern of TITLE_PATTERNS) {
    const match = signal.name.match(pattern);
    if (match?.[1]) {
      for (const piece of splitMultiMention(match[1].trim())) {
        mentions.push({
          company: piece,
          evidence: `Named in a comparable ${category} event title: "${signal.name}"`,
          sourceUrl: signal.url,
          category,
          confidence: "title_mention",
        });
      }
    }
  }

  for (const host of signal.hosts) {
    if (host === signal.calendar) continue; // the organizer, not a sponsor
    const org = extractOrgFromHost(host);
    if (!org) continue;
    mentions.push({
      company: org,
      evidence: `Listed as a host/partner of a comparable ${category} event: "${signal.name}"`,
      sourceUrl: signal.url,
      category,
      confidence: "host_listed",
    });
  }

  return mentions;
}

export function loadSourcingFiles(dir = "data/raw/sourcing"): SourcingFile[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files.map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as SourcingFile);
}

export function sourceCandidates(files: SourcingFile[]): Candidate[] {
  const byCompany = new Map<string, RawMention[]>();

  for (const file of files) {
    for (const signal of file.entries) {
      for (const mention of extractFromSignal(signal, file.category)) {
        const key = mention.company.toLowerCase().trim();
        if (!byCompany.has(key)) byCompany.set(key, []);
        byCompany.get(key)!.push(mention);
      }
    }
  }

  let i = 0;
  const candidates: Candidate[] = [];
  for (const [, mentions] of byCompany) {
    i += 1;
    const displayName = mentions[0].company;
    const categories = [...new Set(mentions.map((m) => m.category))];
    candidates.push({
      id: `SRC-${String(i).padStart(3, "0")}`,
      name: displayName,
      website: null,
      category: categories.join(", "),
      // Deliberately honest: we only know this company from a sponsor/co-brand mention at
      // a comparable event, not what they actually sell. The model is told to use general
      // knowledge for ICP reasoning and to flag this as unverified where it can't.
      whatTheySell: "unverified, sourced from event sponsorship signal only",
      whoTheySellTo: `attendees of ${categories.join("/")} events in NYC (inferred from source event, not confirmed)`,
      evidenceOfSponsoring: mentions.map((m) => m.evidence).join(" | "),
      knownContact: null,
      notes: `Sourced ${mentions.length === 1 ? "once" : `${mentions.length} times`} via the Luma sourcing loop. Source: ${mentions[0].sourceUrl}`,
    });
  }

  return candidates;
}
