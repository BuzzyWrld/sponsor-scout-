// Shared types for the Sponsor Scout pipeline: ingest -> normalize -> match -> pseudonymize -> profile.

export type EventFormat =
  | "The Weekly"
  | "Founders x Investors"
  | "Career night"
  | "Mixer, themed"
  | "Industry Night"
  | "The Table";

export type EventRecord = {
  id: string; // E1..E5
  title: string;
  date: string; // ISO date
  daysOut: number | "past";
  internalFormat: EventFormat;
  visibility: "public" | "private";
  venue: string;
};

export type ApprovalStatus = "approved" | "checked_in" | "declined" | "waitlisted";
export type SponsorInterestAnswer = "Yes" | "Maybe" | "Not right now" | null;
export type Role =
  | "Founder"
  | "Engineer"
  | "Designer"
  | "PM"
  | "Operator"
  | "Investor"
  | "Student"
  | "Other";

// A single raw Luma guest row, after fuzzy header mapping, before dedupe across events.
export type RawGuestRow = {
  eventId: string;
  name: string;
  email: string | null;
  linkedinUrl: string | null;
  approvalStatus: ApprovalStatus;
  checkedIn: boolean;
  role: Role | null;
  founderStage: string | null; // e.g. "Pre-seed", "Seed", "Series A"
  investorType: string | null; // e.g. "Angel", "Fund"
  checkSizeBand: string | null; // e.g. "$10k-50k"
  whatBringsYou: string[]; // multi-select
  whereInvestingTime: string | null; // free text, may contain a company name
  sponsorInterest: SponsorInterestAnswer;
  newsletterConsent: boolean | null;
  directCompany: string | null; // some forms ask company directly, skip the LinkedIn join
  directTitle: string | null;
};

// A guest deduped across events, pre-pseudonymization.
export type Guest = RawGuestRow & {
  personKey: string; // normalized linkedin url, or email fallback
  eventsAttended: string[]; // event IDs
  company: string | null; // joined from LinkedIn connections, or parsed from whereInvestingTime
  title: string | null;
  companyMatchConfidence: "known" | "possible" | "unknown";
};

export type Connection = {
  id?: string; // assigned at pseudonymization
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  company: string | null;
  title: string | null;
  connectedOn: string | null;
};

export type Candidate = {
  id: string;
  name: string;
  website: string | null;
  category: string | null;
  whatTheySell: string;
  whoTheySellTo: string;
  evidenceOfSponsoring: string | null;
  knownContact: string | null;
  notes: string | null;
};

export type WarmPathStrength = "A" | "B" | "C" | "D";

export type CandidateMatch = {
  candidateId: string;
  strength: WarmPathStrength;
  viaGuestIds: string[]; // pseudonymized G-xxx, filled in after pseudonymize step
  viaConnectionIds: string[]; // pseudonymized C-xxx
  reason: string;
};

export type IdMapEntry = {
  id: string; // G-001 or C-001
  kind: "guest" | "connection";
  name: string;
  email: string | null;
  linkedinUrl: string | null;
};
