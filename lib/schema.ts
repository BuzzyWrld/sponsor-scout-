// zod schema mirroring the Sponsor Scout output schema (build spec section 6).
// Used to validate model output before it reaches the UI; one repair retry on failure.

import { z } from "zod";

export const ScoreBreakdownSchema = z.object({
  icp: z.number(),
  warm_path: z.number(),
  precedent: z.number(),
  event_timing: z.number(),
  strategic: z.number(),
});

export const RankedCandidateSchema = z.object({
  candidate_id: z.string(),
  sponsor: z.string(),
  score: z.number(),
  score_breakdown: ScoreBreakdownSchema,
  confidence: z.enum(["high", "medium", "low"]),
  buyer: z.string(),
  fit_reasoning: z.array(z.string()),
  recommended_event: z.object({
    event_id: z.string(),
    why: z.string(),
    tier: z.enum(["drinks_in_kind", "episode", "series"]),
    lead_time_ok: z.boolean(),
  }),
  warm_intro: z.object({
    flag: z.boolean(),
    strength: z.enum(["A", "B", "C", "D"]),
    via: z.array(z.string()),
    path: z.string(),
  }),
  first_line: z.string(),
  risks: z.array(z.string()),
  missing_data: z.array(z.string()),
});

export const ExcludedCandidateSchema = z.object({
  candidate_id: z.string(),
  sponsor: z.string(),
  reason: z.string(),
});

export const PortfolioViewSchema = z.object({
  fastest_cash: z.string(),
  series_anchor: z.string(),
  note: z.string(),
});

export const ScoutOutputSchema = z.object({
  // Normally 5 to 8 per the prompt instruction, but quick scout can send fewer candidates
  // total (e.g. 5), so min(1) avoids a validation-triggered repair retry eating the time
  // budget a quick scout exists to save.
  ranked: z.array(RankedCandidateSchema).min(1).max(8),
  excluded: z.array(ExcludedCandidateSchema),
  portfolio_view: PortfolioViewSchema,
  data_gaps: z.array(z.string()),
});

export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;
export type RankedCandidate = z.infer<typeof RankedCandidateSchema>;
