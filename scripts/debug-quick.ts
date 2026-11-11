process.loadEnvFile(".env.local");
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseLumaGuestCsv, parseLinkedInConnectionsCsv, parseCandidatesCsv } from "../lib/ingest";
import { dedupeGuestsAcrossEvents } from "../lib/normalize";
import { coverageReport, joinGuestsWithConnections, matchCandidates } from "../lib/match";
import { pseudonymize, rehydrateMatches } from "../lib/pseudonymize";
import { computeAudienceProfile } from "../lib/profile";
import { EVENTS } from "../lib/events";
import { buildSystemPrompt, buildUserMessage, OFFER } from "../lib/prompt";
import { runScout } from "../lib/near";

const QUICK_NAMES = ["MongoDB", "Fulton Bank", "Mercury", "Linear", "Athletic Brewing"];

async function main() {
  const rawGuestsAll = EVENTS.flatMap((e) => parseLumaGuestCsv(readFileSync(`data/raw/guests-${e.id}.csv`, "utf8"), e.id).rows);
  const connections = parseLinkedInConnectionsCsv(readFileSync("data/raw/Connections.csv", "utf8"));
  const candidates = parseCandidatesCsv(readFileSync("data/raw/candidates.csv", "utf8"));
  const guestsDeduped = dedupeGuestsAcrossEvents(rawGuestsAll);
  const guestsJoined = joinGuestsWithConnections(guestsDeduped, connections);
  const coverage = coverageReport(guestsJoined);
  const rawMatches = matchCandidates(candidates, guestsJoined, connections);
  const { idMap, safeGuests, safeConnections, guestIdByPersonKey, connectionIdByUrl } = pseudonymize(guestsJoined, connections);
  const matches = rehydrateMatches(rawMatches, guestIdByPersonKey, connectionIdByUrl);
  const profile = computeAudienceProfile(guestsJoined, EVENTS);

  const runCandidates = candidates.filter((c) => QUICK_NAMES.includes(c.name));
  const runMatches = matches.filter((m) => runCandidates.some((c) => c.id === m.candidateId));
  const matchedGuestIds = new Set(runMatches.flatMap((m) => m.viaGuestIds));
  const matchedConnectionIds = new Set(runMatches.flatMap((m) => m.viaConnectionIds));
  const runSafeGuests = safeGuests.filter((g) => matchedGuestIds.has(g.id));
  const runSafeConnections = safeConnections.filter((c) => matchedConnectionIds.has(c.id));

  console.log("quick candidates:", runCandidates.map((c) => c.name));
  console.log("matched guests:", runSafeGuests.length, "matched connections:", runSafeConnections.length);

  const systemPrompt = buildSystemPrompt({
    audienceProfileJson: JSON.stringify(profile),
    eventsJson: JSON.stringify(EVENTS),
    offerJson: JSON.stringify(OFFER),
    candidatesJson: JSON.stringify(runCandidates),
    guestSignalsJson: JSON.stringify(runSafeGuests),
    networkSignalsJson: JSON.stringify(runSafeConnections),
    matchesJson: JSON.stringify(runMatches),
  });
  console.log("system prompt chars:", systemPrompt.length);
  const userMessage = buildUserMessage(new Date().toISOString().slice(0, 10));

  const start = Date.now();
  const result = await runScout(systemPrompt, userMessage);
  console.log("wall clock:", Date.now() - start, "ms");
  if (!result.ok) {
    console.error("FAILED", result.errors);
    process.exit(1);
  }
  console.log("latencyMs:", result.latencyMs, "repaired:", result.repaired);
  console.log("ranked sponsors:", result.output.ranked.map((r) => `${r.sponsor} (${r.score})`));
  console.log("excluded:", result.output.excluded.map((e) => e.sponsor));

  const payload = {
    mappingNotes: ["using existing data/raw/ (fixtures)"],
    perEventMapping: {},
    coverage,
    profile,
    events: EVENTS,
    idMap,
    scoutOutput: result.output,
    latencyMs: result.latencyMs,
    repaired: result.repaired,
    guestCount: guestsJoined.length,
    connectionCount: connections.length,
    candidateCount: candidates.length,
    candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
    ranAt: new Date().toISOString(),
    wasQuickScout: true,
  };
  mkdirSync("data", { recursive: true });
  writeFileSync("data/last-run.json", JSON.stringify(payload, null, 2));
  console.log("wrote data/last-run.json");
}

main().catch((e) => console.error("ERR", e));
