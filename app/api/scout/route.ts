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

export const maxDuration = 120; // TEE inference can take 20 to 60 seconds, section 3

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
    const contentType = req.headers.get("content-type") ?? "";
    let mappingNotes: string[] = ["using existing data/raw/ (fixtures or a previous upload)"];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
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

    const systemPrompt = buildSystemPrompt({
      audienceProfileJson: JSON.stringify(profile),
      eventsJson: JSON.stringify(EVENTS),
      offerJson: JSON.stringify(OFFER),
      candidatesJson: JSON.stringify(candidates),
      guestSignalsJson: JSON.stringify(safeGuests),
      networkSignalsJson: JSON.stringify(safeConnections),
      matchesJson: JSON.stringify(matches),
    });
    const userMessage = buildUserMessage(new Date().toISOString().slice(0, 10));

    const result = await runScout(systemPrompt, userMessage);

    if (!result.ok) {
      return NextResponse.json(
        { error: "scout call failed validation twice", details: result.errors, raw: result.rawOutputs },
        { status: 502 }
      );
    }

    return NextResponse.json({
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
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
