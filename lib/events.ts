// Section 4: the real Beyond Strangers events, pulled live from Luma on Nov 11 2026.
// Shared by fixtures, the scout pipeline, and the UI so there is exactly one source of truth.

import type { EventRecord } from "./types";

export const EVENTS: EventRecord[] = [
  { id: "E1", title: "Beyond Small Talk: Tech Mixer", date: "2026-11-03", daysOut: "past", internalFormat: "The Weekly", visibility: "public", venue: "The Rose, Chelsea" },
  { id: "E2", title: "Beyond the Room · Private Capital Mixer & Panel", date: "2026-11-19", daysOut: 8, internalFormat: "Founders x Investors", visibility: "public", venue: "Fushimi Times Square" },
  { id: "E3", title: "Beyond Small Talk: Tech Mixer", date: "2026-11-19", daysOut: 8, internalFormat: "The Weekly", visibility: "public", venue: "The Rose, Chelsea" },
  { id: "E4", title: "Beyond Gaming: Techgiving", date: "2026-11-23", daysOut: 12, internalFormat: "Mixer, themed", visibility: "private", venue: "Long Island City" },
  { id: "E5", title: "Beyond the Interview: No More Ghosting", date: "2027-01-04", daysOut: 54, internalFormat: "Career night", visibility: "private", venue: "TBD" },
  // Real RSVP exports (2026-11-11). Dates are inferred from registration cutoffs, not confirmed on Luma: fix if wrong.
  { id: "E6", title: "DeepTech DeepDive With ØDX", date: "2026-11-06", daysOut: "past", internalFormat: "Industry Night", visibility: "public", venue: "TBD" },
  { id: "E7", title: "Financial Intelligence & Infrastructure Forum", date: "2026-10-22", daysOut: "past", internalFormat: "Industry Night", visibility: "private", venue: "TBD" },
];
