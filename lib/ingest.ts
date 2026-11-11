// Parses raw CSV exports into typed rows. Headers vary per Luma event because the
// registration questions vary, so we fuzzy-match headers instead of assuming fixed columns.
// Never console.log a raw row here: callers of these functions receive real guest data.

import Papa from "papaparse";
import type { ApprovalStatus, Candidate, Connection, RawGuestRow, Role, SponsorInterestAnswer } from "./types";

function fuzzyFind(headers: string[], candidates: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normHeaders = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const c of candidates) {
    const nc = norm(c);
    const hit = normHeaders.find((h) => h.n === nc || h.n.includes(nc) || nc.includes(h.n));
    if (hit) return hit.raw;
  }
  return null;
}

function parseBool(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return ["yes", "true", "checked in", "checked_in", "1"].includes(v.trim().toLowerCase());
}

function parseApprovalStatus(v: unknown): ApprovalStatus {
  const s = String(v ?? "").trim().toLowerCase();
  if (s.includes("check")) return "checked_in";
  if (s.includes("declin")) return "declined";
  if (s.includes("wait")) return "waitlisted";
  return "approved";
}

function parseRole(v: unknown): Role | null {
  const s = String(v ?? "").trim();
  const known: Role[] = ["Founder", "Engineer", "Designer", "PM", "Operator", "Investor", "Student", "Other"];
  const hit = known.find((k) => k.toLowerCase() === s.toLowerCase());
  return hit ?? null;
}

function parseSponsorInterest(v: unknown): SponsorInterestAnswer {
  const s = String(v ?? "").trim().toLowerCase();
  if (s.startsWith("yes")) return "Yes";
  if (s.startsWith("maybe")) return "Maybe";
  if (s.startsWith("not")) return "Not right now";
  return null;
}

function splitMulti(v: unknown): string[] {
  const s = String(v ?? "").trim();
  if (!s) return [];
  return s.split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
}

export type HeaderMapping = Record<string, string | null>;

const GUEST_FIELD_CANDIDATES: Record<string, string[]> = {
  name: ["name", "guest name", "full name"],
  email: ["email", "email address"],
  approvalStatus: ["approval status", "status", "ticket status"],
  checkedInAt: ["checked in at", "check in time", "checked in"],
  linkedinUrl: ["linkedin", "linkedin url", "linkedin profile"],
  role: ["role", "which best describes you", "what best describes you"],
  founderStage: ["founder stage", "stage", "company stage"],
  investorType: ["investor type", "type of investor"],
  checkSizeBand: ["check size", "typical check size", "investment size"],
  whatBringsYou: ["what brings you", "what brings you here", "why are you coming"],
  whereInvestingTime: ["where are you investing your time", "where do you work", "current focus"],
  sponsorInterest: ["would you or your company be interested in sponsoring", "sponsor interest", "sponsoring a future event"],
  newsletterConsent: ["newsletter", "newsletter consent", "subscribe"],
};

export function mapGuestHeaders(headers: string[]): HeaderMapping {
  const mapping: HeaderMapping = {};
  for (const [field, candidates] of Object.entries(GUEST_FIELD_CANDIDATES)) {
    mapping[field] = fuzzyFind(headers, candidates);
  }
  return mapping;
}

export function parseLumaGuestCsv(
  csvText: string,
  eventId: string
): { rows: RawGuestRow[]; mapping: HeaderMapping; totalRows: number } {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];
  const mapping = mapGuestHeaders(headers);

  const rows: RawGuestRow[] = parsed.data.map((raw) => {
    const get = (field: string) => (mapping[field] ? raw[mapping[field] as string] : undefined);
    return {
      eventId,
      name: get("name") ?? "",
      email: get("email") || null,
      linkedinUrl: get("linkedinUrl") || null,
      approvalStatus: parseApprovalStatus(get("approvalStatus")),
      checkedIn: Boolean(get("checkedInAt")?.trim()) || parseApprovalStatus(get("approvalStatus")) === "checked_in",
      role: parseRole(get("role")),
      founderStage: get("founderStage") || null,
      investorType: get("investorType") || null,
      checkSizeBand: get("checkSizeBand") || null,
      whatBringsYou: splitMulti(get("whatBringsYou")),
      whereInvestingTime: get("whereInvestingTime") || null,
      sponsorInterest: parseSponsorInterest(get("sponsorInterest")),
      newsletterConsent: get("newsletterConsent") ? parseBool(get("newsletterConsent")) : null,
    };
  });

  return { rows, mapping, totalRows: parsed.data.length };
}

// LinkedIn's Connections.csv starts with a few "Notes:" lines before the real header row.
export function parseLinkedInConnectionsCsv(csvText: string): Connection[] {
  const lines = csvText.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /first name/i.test(l) && /last name/i.test(l));
  const body = lines.slice(headerIdx).join("\n");
  const parsed = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });

  return parsed.data
    .filter((row) => row["URL"])
    .map((row) => ({
      linkedinUrl: row["URL"],
      firstName: row["First Name"] ?? "",
      lastName: row["Last Name"] ?? "",
      company: row["Company"] || null,
      title: row["Position"] || null,
      connectedOn: row["Connected On"] || null,
    }));
}

export function parseCandidatesCsv(csvText: string): Candidate[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  return parsed.data.map((row, i) => ({
    id: `CAND-${String(i + 1).padStart(3, "0")}`,
    name: row["name"] ?? "",
    website: row["website"] || null,
    category: row["category"] || null,
    whatTheySell: row["what_they_sell"] ?? "",
    whoTheySellTo: row["who_they_sell_to"] ?? "",
    evidenceOfSponsoring: row["evidence_of_sponsoring"] || null,
    knownContact: row["known_contact"] || null,
    notes: row["notes"] || null,
  }));
}
