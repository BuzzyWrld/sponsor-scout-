import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { parseLumaGuestCsv, parseLinkedInConnectionsCsv, parseCandidatesCsv } from "@/lib/ingest";
import { dedupeGuestsAcrossEvents } from "@/lib/normalize";
import { coverageReport, joinGuestsWithConnections, matchCandidates } from "@/lib/match";
import { pseudonymize, rehydrateMatches } from "@/lib/pseudonymize";
import { computeAudienceProfile } from "@/lib/profile";
import { EVENTS } from "@/lib/events";
import { buildSystemPrompt, buildUserMessage, OFFER } from "@/lib/prompt";
import { runScout } from "@/lib/near";

export const maxDuration = 600; // a full 20-candidate ranking call can take several minutes on this model

async function writeUploadedFiles(form: FormData) {
  mkdirSync("data/raw", { recursive: true });
  const mappingNotes: string[] = [];

  const connections = form.get("connections");
  if (connections instanceof File) {
    writeFileSync("data/raw/Connections.csv", Buffer.from(await connections.arrayBuffer()));
    mappingNotes.push("connections: using uploaded Connections.csv");
  }

  const candidates = form.get("candidates");
  if (candidates instanceof File) {
    writeFileSync("data/raw/candidates.csv", Buffer.from(await candidates.arrayBuffer()));
    mappingNotes.push("candidates: using uploaded candidates.csv");
  }

  for (const event of EVENTS) {
    const file = form.get(`guest_${event.id}`);
    if (file instanceof File) {
      writeFileSync(`data/raw/guests-${event.id}.csv`, Buffer.from(await file.arrayBuffer()));
      mappingNotes.push(`${event.id}: using uploaded ${file.name}`);
    }
  }
  return mappingNotes;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const mode = (form.get("mode") as string) === "run" ? "run" : "profile";
    let mappingNotes: string[] = ["using existing data/raw/ (fixtures or a previous upload)"];

    const hasFiles = [...form.keys()].some((k) => form.get(k) instanceof File);
    if (hasFiles) {
      mappingNotes = await writeUploadedFiles(form);
    }

    const perEventMapping: Record<string, unknown> = {};
    const rawGuestsAll = EVENTS.flatMap((e) => {
      let csv: string;
      try {
        csv = readFileSync(`data/raw/guests-${e.id}.csv`, "utf8");
      } catch {
        return [];
      }
      const { rows, mapping, totalRows } = parseLumaGuestCsv(csv, e.id);
      perEventMapping[e.id] = { mapping, totalRows };
      return rows;
    });

    let connections: ReturnType<typeof parseLinkedInConnectionsCsv> = [];
    try {
      connections = parseLinkedInConnectionsCsv(readFileSync("data/raw/Connections.csv", "utf8"));
    } catch {
      /* no connections file yet */
    }

    let candidates: ReturnType<typeof parseCandidatesCsv> = [];
    try {
      candidates = parseCandidatesCsv(readFileSync("data/raw/candidates.csv", "utf8"));
    } catch {
      /* no candidates file yet */
    }

    if (rawGuestsAll.length === 0 || candidates.length === 0) {
      return NextResponse.json(
        { error: "missing data: need at least one guest CSV and candidates.csv in data/raw/" },
        { status: 400 }
      );
    }

    const guestsDeduped = dedupeGuestsAcrossEvents(rawGuestsAll);
    const guestsJoined = joinGuestsWithConnections(guestsDeduped, connections);
    const coverage = coverageReport(guestsJoined);

    const rawMatches = matchCandidates(candidates, guestsJoined, connections);
    const { idMap, safeGuests, safeConnections, guestIdByPersonKey, connectionIdByUrl } = pseudonymize(
      guestsJoined,
      connections
    );
    const matches = rehydrateMatches(rawMatches, guestIdByPersonKey, connectionIdByUrl);
    const profile = computeAudienceProfile(guestsJoined, EVENTS);

    if (mode === "profile") {
      return NextResponse.json({
        mappingNotes,
        perEventMapping,
        coverage,
        profile,
        events: EVENTS,
        guestCount: guestsJoined.length,
        connectionCount: connections.length,
        candidateCount: candidates.length,
        candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
      });
    }

    // Quick scout: a hand-picked subset of candidates to keep the live ranking call short
    // enough for a 2 minute demo. Trimming the candidate list alone barely moves latency,
    // since guest_signals (120 people) and network_signals (300 connections) dominate the
    // prompt regardless of candidate count. So for quick scout, also drop every guest and
    // connection record that isn't a warm path match for one of the selected candidates.
    // audience_profile (the aggregate stats) is unaffected: it's computed in code and still
    // reflects the full real audience either way.
    const candidateIdsRaw = form.get("candidateIds") as string | null;
    const runCandidates = candidateIdsRaw
      ? candidates.filter((c) => candidateIdsRaw.split(",").includes(c.id))
      : candidates;
    const runMatches = candidateIdsRaw ? matches.filter((m) => runCandidates.some((c) => c.id === m.candidateId)) : matches;

    const matchedGuestIds = new Set(runMatches.flatMap((m) => m.viaGuestIds));
    const matchedConnectionIds = new Set(runMatches.flatMap((m) => m.viaConnectionIds));
    const runSafeGuests = candidateIdsRaw ? safeGuests.filter((g) => matchedGuestIds.has(g.id)) : safeGuests;
    const runSafeConnections = candidateIdsRaw
      ? safeConnections.filter((c) => matchedConnectionIds.has(c.id))
      : safeConnections;

    const systemPrompt = buildSystemPrompt({
      audienceProfileJson: JSON.stringify(profile),
      eventsJson: JSON.stringify(EVENTS),
      offerJson: JSON.stringify(OFFER),
      candidatesJson: JSON.stringify(runCandidates),
      guestSignalsJson: JSON.stringify(runSafeGuests),
      networkSignalsJson: JSON.stringify(runSafeConnections),
      matchesJson: JSON.stringify(runMatches),
    });
    const userMessage = buildUserMessage(new Date().toISOString().slice(0, 10));

    const result = await runScout(systemPrompt, userMessage);

    if (!result.ok) {
      return NextResponse.json(
        { error: "scout call failed validation twice", details: result.errors, raw: result.rawOutputs },
        { status: 502 }
      );
    }

    const payload = {
      mappingNotes,
      perEventMapping,
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
      wasQuickScout: Boolean(candidateIdsRaw),
    };

    // A real run is expensive and slow right now (observed up to ~17 minutes on shared
    // NEAR AI Cloud capacity during the hackathon). Persist it so a page reload, or a
    // fresh demo run, never loses a real completed result.
    mkdirSync("data", { recursive: true });
    writeFileSync("data/last-run.json", JSON.stringify(payload, null, 2));

    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const raw = readFileSync("data/last-run.json", "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "no cached run yet" }, { status: 404 });
  }
}
