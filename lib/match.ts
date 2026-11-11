// Section 5.3: the warm intro engine. Joins guests to LinkedIn connections for employer data,
// then matches sponsor candidates against guests and the network to find a warm path in.

import type { Candidate, CandidateMatch, Connection, Guest, WarmPathStrength } from "./types";
import { guessCompanyFromFreeText, normalizeCompany, normalizeLinkedInUrl } from "./normalize";

export function joinGuestsWithConnections(guests: Guest[], connections: Connection[]): Guest[] {
  const connByUrl = new Map<string, Connection>();
  for (const c of connections) {
    const key = normalizeLinkedInUrl(c.linkedinUrl);
    if (key) connByUrl.set(key, c);
  }

  return guests.map((g) => {
    const conn = connByUrl.get(g.personKey);
    if (conn && conn.company) {
      return { ...g, company: normalizeCompany(conn.company), title: conn.title, companyMatchConfidence: "known" as const };
    }
    const guessed = guessCompanyFromFreeText(g.whereInvestingTime);
    if (guessed) {
      return { ...g, company: guessed, companyMatchConfidence: "possible" as const };
    }
    return g;
  });
}

export function coverageReport(guests: Guest[]): { known: number; total: number; pct: number } {
  const known = guests.filter((g) => g.companyMatchConfidence === "known" || g.companyMatchConfidence === "possible").length;
  const total = guests.length;
  return { known, total, pct: total === 0 ? 0 : Math.round((known / total) * 1000) / 10 };
}

function candidateCompanyKey(candidate: Candidate): string | null {
  // Candidates are named companies in candidates.csv, so the name itself is the company key.
  return normalizeCompany(candidate.name);
}

export function matchCandidates(
  candidates: Candidate[],
  guests: Guest[],
  connections: Connection[]
): CandidateMatch[] {
  const connByCompany = new Map<string, Connection[]>();
  for (const c of connections) {
    const key = normalizeCompany(c.company);
    if (!key) continue;
    if (!connByCompany.has(key)) connByCompany.set(key, []);
    connByCompany.get(key)!.push(c);
  }

  const guestsByCompany = new Map<string, Guest[]>();
  for (const g of guests) {
    const key = normalizeCompany(g.company);
    if (!key) continue;
    if (!guestsByCompany.has(key)) guestsByCompany.set(key, []);
    guestsByCompany.get(key)!.push(g);
  }

  return candidates.map((candidate) => {
    const key = candidateCompanyKey(candidate);
    const matchedGuests = key ? guestsByCompany.get(key) ?? [] : [];
    const matchedConnections = key ? connByCompany.get(key) ?? [] : [];

    const inboundInterest = guests.filter(
      (g) => g.sponsorInterest === "Yes" || g.sponsorInterest === "Maybe"
    );
    const inboundAtCandidate = key ? inboundInterest.filter((g) => normalizeCompany(g.company) === key) : [];

    let strength: WarmPathStrength = "D";
    let reason = "No known tie. Cold outreach.";

    const strongGuest = matchedGuests.find((g) => g.checkedIn || g.sponsorInterest === "Yes" || g.sponsorInterest === "Maybe");
    if (strongGuest) {
      strength = "A";
      reason = `An attendee works at ${candidate.name} and ${strongGuest.checkedIn ? "checked in" : "answered " + strongGuest.sponsorInterest + " to sponsoring"}.`;
    } else if (matchedGuests.length > 0 || inboundAtCandidate.length > 0) {
      strength = "B";
      reason = `An attendee works at ${candidate.name}, or an attendee who answered Yes to sponsoring works there.`;
    } else if (matchedConnections.length > 0) {
      strength = "C";
      reason = `A 1st degree connection works at ${candidate.name}, no attendee tie yet.`;
    } else if (candidate.knownContact) {
      strength = "C";
      reason = `Known contact on file: ${candidate.knownContact}.`;
    }

    return {
      candidateId: candidate.id,
      strength,
      viaGuestIds: matchedGuests.map((g) => g.personKey), // rehydrated to G-xxx after pseudonymize
      viaConnectionIds: matchedConnections.map((c) => c.linkedinUrl), // rehydrated to C-xxx after pseudonymize
      reason,
    };
  });
}
