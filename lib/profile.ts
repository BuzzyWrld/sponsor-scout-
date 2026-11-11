// Section 5.5: audience aggregates, computed in code, never by the model.
// Every percentage is reported with its n. Any segment with n < 10 is flagged "small sample".

import type { EventRecord, Guest } from "./types";

const SMALL_SAMPLE_THRESHOLD = 10;

export type Share = { label: string; n: number; pct: number; smallSample: boolean };

function shares(items: Guest[], keyFn: (g: Guest) => string | null, denom: number): Share[] {
  const counts = new Map<string, number>();
  for (const g of items) {
    const key = keyFn(g);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, n]) => ({
      label,
      n,
      pct: denom === 0 ? 0 : Math.round((n / denom) * 1000) / 10,
      smallSample: n < SMALL_SAMPLE_THRESHOLD,
    }))
    .sort((a, b) => b.n - a.n);
}

const SECTOR_KEYWORDS: Record<string, string[]> = {
  fintech: ["fintech", "banking", "payments", "lending"],
  "crypto/web3": ["crypto", "web3", "blockchain", "defi", "token"],
  "ai/ml": ["ai", "machine learning", "ml", "llm", "agent"],
  "consumer": ["consumer", "d2c", "marketplace", "social"],
  "enterprise/saas": ["saas", "enterprise", "b2b", "devtools"],
  healthcare: ["health", "medtech", "biotech", "clinical"],
  "creative/media": ["media", "creative", "content", "events", "entertainment"],
  "deep tech/hardware": ["hardware", "robotics", "deep tech", "semiconductor"],
};

function tagSector(text: string | null): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const [sector, kws] of Object.entries(SECTOR_KEYWORDS)) {
    if (kws.some((k) => t.includes(k))) return sector;
  }
  return null;
}

function seniorityFromTitle(title: string | null): "C-level/founder" | "VP/director" | "IC" | null {
  if (!title) return null;
  const t = title.toLowerCase();
  if (/(ceo|cto|cfo|coo|chief|founder|co-founder)/.test(t)) return "C-level/founder";
  if (/(vp|vice president|director|head of)/.test(t)) return "VP/director";
  return "IC";
}

export type EventAudienceProfile = {
  eventId: string;
  nApproved: number;
  nCheckedIn: number;
  showRatePct: number;
  applicationsPerSeat: number;
  roleMix: Share[];
  founderStageMix: Share[];
  investorTypeMix: Share[];
  checkSizeMix: Share[];
  whatBringsYouMix: Share[];
  topSectors: Share[];
  seniorityMix: Share[];
  newsletterOptInRate: { n: number; of: number; pct: number };
  sponsorInterestCounts: { yes: number; maybe: number; notRightNow: number; noAnswer: number };
};

function buildEventAudienceProfile(eventId: string, guests: Guest[]): EventAudienceProfile {
  const inEvent = guests.filter((g) => g.eventsAttended.includes(eventId) || g.eventId === eventId);
  const approved = inEvent.filter((g) => g.approvalStatus === "approved" || g.approvalStatus === "checked_in");
  const checkedIn = inEvent.filter((g) => g.checkedIn);
  const nApproved = approved.length;
  const nCheckedIn = checkedIn.length;
  const totalRegistrations = inEvent.length; // demand, includes declined/waitlisted

  const whatBringsYouFlat: Guest[] = [];
  for (const g of approved) {
    for (const tag of g.whatBringsYou) {
      whatBringsYouFlat.push({ ...g, whatBringsYou: [tag] });
    }
  }

  const withNewsletterAnswer = approved.filter((g) => g.newsletterConsent !== null);
  const optedIn = withNewsletterAnswer.filter((g) => g.newsletterConsent === true);

  const sponsorInterestCounts = {
    yes: approved.filter((g) => g.sponsorInterest === "Yes").length,
    maybe: approved.filter((g) => g.sponsorInterest === "Maybe").length,
    notRightNow: approved.filter((g) => g.sponsorInterest === "Not right now").length,
    noAnswer: approved.filter((g) => !g.sponsorInterest).length,
  };

  return {
    eventId,
    nApproved,
    nCheckedIn,
    showRatePct: nApproved === 0 ? 0 : Math.round((nCheckedIn / nApproved) * 1000) / 10,
    applicationsPerSeat: nApproved === 0 ? 0 : Math.round((totalRegistrations / nApproved) * 100) / 100,
    roleMix: shares(approved, (g) => g.role, nApproved),
    founderStageMix: shares(approved, (g) => g.founderStage, nApproved),
    investorTypeMix: shares(approved, (g) => g.investorType, nApproved),
    checkSizeMix: shares(approved, (g) => g.checkSizeBand, nApproved),
    whatBringsYouMix: shares(whatBringsYouFlat, (g) => g.whatBringsYou[0] ?? null, nApproved),
    topSectors: shares(approved, (g) => tagSector(g.whereInvestingTime) ?? tagSector(g.company), nApproved),
    seniorityMix: shares(approved, (g) => seniorityFromTitle(g.title), nApproved),
    newsletterOptInRate: {
      n: optedIn.length,
      of: withNewsletterAnswer.length,
      pct: withNewsletterAnswer.length === 0 ? 0 : Math.round((optedIn.length / withNewsletterAnswer.length) * 1000) / 10,
    },
    sponsorInterestCounts,
  };
}

export type AudienceProfile = {
  overall: EventAudienceProfile;
  perEvent: EventAudienceProfile[];
  repeatAttendeeRate: { n: number; of: number; pct: number };
};

export function computeAudienceProfile(guests: Guest[], events: EventRecord[]): AudienceProfile {
  const perEvent = events.map((e) => buildEventAudienceProfile(e.id, guests));

  const uniqueGuests = guests; // already deduped across events by normalize.dedupeGuestsAcrossEvents
  const repeatCount = uniqueGuests.filter((g) => g.eventsAttended.length > 1).length;

  const overall: EventAudienceProfile = {
    eventId: "overall",
    nApproved: 0,
    nCheckedIn: 0,
    showRatePct: 0,
    applicationsPerSeat: 0,
    roleMix: [],
    founderStageMix: [],
    investorTypeMix: [],
    checkSizeMix: [],
    whatBringsYouMix: [],
    topSectors: [],
    seniorityMix: [],
    newsletterOptInRate: { n: 0, of: 0, pct: 0 },
    sponsorInterestCounts: { yes: 0, maybe: 0, notRightNow: 0, noAnswer: 0 },
  };
  const approvedAll = uniqueGuests.filter((g) => g.approvalStatus === "approved" || g.approvalStatus === "checked_in");
  const checkedInAll = uniqueGuests.filter((g) => g.checkedIn);
  overall.nApproved = approvedAll.length;
  overall.nCheckedIn = checkedInAll.length;
  overall.showRatePct = overall.nApproved === 0 ? 0 : Math.round((overall.nCheckedIn / overall.nApproved) * 1000) / 10;
  overall.applicationsPerSeat = overall.nApproved === 0 ? 0 : Math.round((uniqueGuests.length / overall.nApproved) * 100) / 100;
  overall.roleMix = shares(approvedAll, (g) => g.role, overall.nApproved);
  overall.founderStageMix = shares(approvedAll, (g) => g.founderStage, overall.nApproved);
  overall.investorTypeMix = shares(approvedAll, (g) => g.investorType, overall.nApproved);
  overall.checkSizeMix = shares(approvedAll, (g) => g.checkSizeBand, overall.nApproved);
  const whatBringsYouFlatAll: Guest[] = [];
  for (const g of approvedAll) for (const tag of g.whatBringsYou) whatBringsYouFlatAll.push({ ...g, whatBringsYou: [tag] });
  overall.whatBringsYouMix = shares(whatBringsYouFlatAll, (g) => g.whatBringsYou[0] ?? null, overall.nApproved);
  overall.topSectors = shares(approvedAll, (g) => tagSector(g.whereInvestingTime) ?? tagSector(g.company), overall.nApproved);
  overall.seniorityMix = shares(approvedAll, (g) => seniorityFromTitle(g.title), overall.nApproved);
  const withNewsletterAnswerAll = approvedAll.filter((g) => g.newsletterConsent !== null);
  const optedInAll = withNewsletterAnswerAll.filter((g) => g.newsletterConsent === true);
  overall.newsletterOptInRate = {
    n: optedInAll.length,
    of: withNewsletterAnswerAll.length,
    pct: withNewsletterAnswerAll.length === 0 ? 0 : Math.round((optedInAll.length / withNewsletterAnswerAll.length) * 1000) / 10,
  };
  overall.sponsorInterestCounts = {
    yes: approvedAll.filter((g) => g.sponsorInterest === "Yes").length,
    maybe: approvedAll.filter((g) => g.sponsorInterest === "Maybe").length,
    notRightNow: approvedAll.filter((g) => g.sponsorInterest === "Not right now").length,
    noAnswer: approvedAll.filter((g) => !g.sponsorInterest).length,
  };

  return {
    overall,
    perEvent,
    repeatAttendeeRate: {
      n: repeatCount,
      of: uniqueGuests.length,
      pct: uniqueGuests.length === 0 ? 0 : Math.round((repeatCount / uniqueGuests.length) * 1000) / 10,
    },
  };
}
