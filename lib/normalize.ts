// URL and company name normalization, plus cross-event guest dedupe.

import type { Connection, Guest, RawGuestRow } from "./types";

const COMPANY_SUFFIXES = /\b(inc|llc|corp|corporation|labs|ltd|co|company)\b\.?/gi;

export function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = url.trim().toLowerCase();
  u = u.replace(/^https?:\/\//, "");
  u = u.replace(/^www\./, "");
  u = u.split("?")[0].split("#")[0];
  u = u.replace(/\/+$/, "");
  // strip locale prefixes like linkedin.com/in/xx/name or trailing locale segments
  const match = u.match(/^linkedin\.com\/in\/([^/]+)/);
  if (!match) return null;
  const slug = match[1].replace(/-[a-z]{2}$/i, ""); // drop trailing -en, -fr style suffixes
  return `linkedin.com/in/${slug}`;
}

export function normalizeCompany(name: string | null | undefined): string | null {
  if (!name) return null;
  let n = name.trim().toLowerCase();
  n = n.replace(COMPANY_SUFFIXES, "");
  n = n.replace(/[.,]/g, "");
  n = n.replace(/\s+/g, " ").trim();
  return n || null;
}

// Pull a plausible company name out of free text like "building at Acme Inc" or "Acme (Series A)".
export function guessCompanyFromFreeText(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\(.*?\)/g, "").trim();
  const atMatch = cleaned.match(/\bat\s+([A-Z][\w&.,' -]{1,60})/);
  if (atMatch) return normalizeCompany(atMatch[1]);
  if (cleaned.length > 0 && cleaned.length <= 60 && !/\s{2,}/.test(cleaned)) {
    return normalizeCompany(cleaned);
  }
  return null;
}

export function dedupeGuestsAcrossEvents(rawRows: RawGuestRow[]): Guest[] {
  const byKey = new Map<string, Guest>();

  for (const row of rawRows) {
    const normalizedUrl = normalizeLinkedInUrl(row.linkedinUrl);
    const personKey = normalizedUrl ?? (row.email ? row.email.toLowerCase() : `anon:${row.name}:${row.eventId}`);

    const existing = byKey.get(personKey);
    if (existing) {
      if (!existing.eventsAttended.includes(row.eventId)) existing.eventsAttended.push(row.eventId);
      existing.checkedIn = existing.checkedIn || row.checkedIn;
      if (row.sponsorInterest && (!existing.sponsorInterest || row.sponsorInterest === "Yes")) {
        existing.sponsorInterest = row.sponsorInterest;
      }
      continue;
    }

    byKey.set(personKey, {
      ...row,
      personKey,
      eventsAttended: [row.eventId],
      company: null,
      title: null,
      companyMatchConfidence: "unknown",
    });
  }

  return [...byKey.values()];
}
