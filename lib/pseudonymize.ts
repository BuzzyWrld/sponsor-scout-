// Defense in depth on top of the TEE: real names, emails and LinkedIn URLs never get sent
// to the model. Every person becomes a stable G-xxx / C-xxx id. The id map is the only place
// the mapping lives, and it never leaves data/private/ (gitignored).

import { mkdirSync, writeFileSync } from "node:fs";
import type { CandidateMatch, Connection, Guest, IdMapEntry } from "./types";

export type SafeGuest = {
  id: string;
  role: Guest["role"];
  company: string | null;
  title: string | null;
  founderStage: string | null;
  investorType: string | null;
  checkSizeBand: string | null;
  eventsAttended: string[];
  sponsorInterest: Guest["sponsorInterest"];
  checkedIn: boolean;
  companyMatchConfidence: Guest["companyMatchConfidence"];
};

export type SafeConnection = {
  id: string;
  company: string | null;
  title: string | null;
};

export type PseudonymizationResult = {
  idMap: IdMapEntry[];
  safeGuests: SafeGuest[];
  safeConnections: SafeConnection[];
  guestIdByPersonKey: Map<string, string>;
  connectionIdByUrl: Map<string, string>;
};

export function pseudonymize(guests: Guest[], connections: Connection[]): PseudonymizationResult {
  const idMap: IdMapEntry[] = [];
  const guestIdByPersonKey = new Map<string, string>();
  const connectionIdByUrl = new Map<string, string>();

  const safeGuests: SafeGuest[] = guests.map((g, i) => {
    const id = `G-${String(i + 1).padStart(3, "0")}`;
    guestIdByPersonKey.set(g.personKey, id);
    idMap.push({ id, kind: "guest", name: g.name, email: g.email, linkedinUrl: g.linkedinUrl });
    return {
      id,
      role: g.role,
      company: g.company,
      title: g.title,
      founderStage: g.founderStage,
      investorType: g.investorType,
      checkSizeBand: g.checkSizeBand,
      eventsAttended: g.eventsAttended,
      sponsorInterest: g.sponsorInterest,
      checkedIn: g.checkedIn,
      companyMatchConfidence: g.companyMatchConfidence,
    };
  });

  const safeConnections: SafeConnection[] = connections.map((c, i) => {
    const id = `C-${String(i + 1).padStart(3, "0")}`;
    connectionIdByUrl.set(c.linkedinUrl, id);
    idMap.push({
      id,
      kind: "connection",
      name: `${c.firstName} ${c.lastName}`.trim(),
      email: null,
      linkedinUrl: c.linkedinUrl,
    });
    return { id, company: c.company, title: c.title };
  });

  return { idMap, safeGuests, safeConnections, guestIdByPersonKey, connectionIdByUrl };
}

export function rehydrateMatches(
  matches: CandidateMatch[],
  guestIdByPersonKey: Map<string, string>,
  connectionIdByUrl: Map<string, string>
): CandidateMatch[] {
  return matches.map((m) => ({
    ...m,
    viaGuestIds: m.viaGuestIds.map((key) => guestIdByPersonKey.get(key)).filter((x): x is string => Boolean(x)),
    viaConnectionIds: m.viaConnectionIds
      .map((url) => connectionIdByUrl.get(url))
      .filter((x): x is string => Boolean(x)),
  }));
}

export { rehydrateText } from "./rehydrate";

export function persistIdMap(idMap: IdMapEntry[]): void {
  mkdirSync("data/private", { recursive: true });
  writeFileSync("data/private/idmap.json", JSON.stringify(idMap, null, 2));
}
