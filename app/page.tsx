"use client";

import { useEffect, useRef, useState } from "react";
import { rehydrateText } from "@/lib/rehydrate";
import type { IdMapEntry } from "@/lib/types";
import type { AudienceProfile, Share } from "@/lib/profile";
import type { RankedCandidate, ScoutOutput } from "@/lib/schema";

type ModelStatus = {
  modelId?: string;
  status: "TEE ATTESTED" | "CATALOG VERIFIED" | "NOT PRIVATE";
  error?: string;
};

type ProfileResponse = {
  mappingNotes: string[];
  coverage: { known: number; total: number; pct: number };
  profile: AudienceProfile;
  guestCount: number;
  connectionCount: number;
  candidateCount: number;
  candidates: { id: string; name: string }[];
};

const QUICK_SCOUT_DEFAULT_NAMES = ["MongoDB", "Fulton Bank", "Mercury", "Linear", "Athletic Brewing"];

type RunResponse = ProfileResponse & {
  idMap: IdMapEntry[];
  scoutOutput: ScoutOutput;
  latencyMs: number;
  repaired: boolean;
  ranAt?: string;
  wasQuickScout?: boolean;
};

const EVENT_IDS = ["E1", "E2", "E3", "E4", "E5", "E6", "E7"] as const;
const EVENT_LABELS: Record<string, string> = {
  E1: "Beyond Small Talk (Nov 3)",
  E2: "Private Capital Mixer (Nov 19)",
  E3: "Beyond Small Talk (Nov 19)",
  E4: "Beyond Gaming (Nov 23)",
  E5: "Beyond the Interview (Jan 4)",
  E6: "DeepTech DeepDive w/ ØDX",
  E7: "Financial Intelligence Forum",
};

function pct(share: Share) {
  return `${share.label} ${share.pct}%${share.smallSample ? " (small n)" : ""} n=${share.n}`;
}

export default function Home() {
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [usingFixtures, setUsingFixtures] = useState(false);
  const [connectionsFile, setConnectionsFile] = useState<File | null>(null);
  const [candidatesFile, setCandidatesFile] = useState<File | null>(null);
  const [guestFiles, setGuestFiles] = useState<Record<string, File | null>>({});
  const [processing, setProcessing] = useState(false);
  const [profileResp, setProfileResp] = useState<ProfileResponse | null>(null);
  const [running, setRunning] = useState<"full" | "quick" | null>(null);
  const [runResp, setRunResp] = useState<RunResponse | null>(null);
  const [quickIds, setQuickIds] = useState<string[]>([]);
  const [showIdsOnly, setShowIdsOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then(setModelStatus)
      .catch(() => setModelStatus({ status: "NOT PRIVATE", error: "could not reach /api/models" }));

    // A real run can take many minutes right now, so always try to load the last
    // completed real result on page load instead of starting from a blank slate.
    fetch("/api/scout")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: RunResponse | null) => {
        if (!json) return;
        setProfileResp(json);
        setRunResp(json);
        setUsingFixtures(true);
        const defaults = json.candidates.filter((c) => QUICK_SCOUT_DEFAULT_NAMES.includes(c.name)).map((c) => c.id);
        setQuickIds(defaults.length > 0 ? defaults : json.candidates.slice(0, 5).map((c) => c.id));
      })
      .catch(() => {});
  }, []);

  async function processData(mode: "profile" | "run", extraFiles = true, candidateIds?: string[]) {
    const form = new FormData();
    form.set("mode", mode);
    if (candidateIds && candidateIds.length > 0) form.set("candidateIds", candidateIds.join(","));
    if (extraFiles) {
      if (connectionsFile) form.set("connections", connectionsFile);
      if (candidatesFile) form.set("candidates", candidatesFile);
      for (const id of EVENT_IDS) {
        const f = guestFiles[id];
        if (f) form.set(`guest_${id}`, f);
      }
    }
    const res = await fetch("/api/scout", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "request failed");
    return json;
  }

  function applyProfileResponse(json: ProfileResponse) {
    setProfileResp(json);
    const defaults = json.candidates.filter((c) => QUICK_SCOUT_DEFAULT_NAMES.includes(c.name)).map((c) => c.id);
    setQuickIds(defaults.length > 0 ? defaults : json.candidates.slice(0, 5).map((c) => c.id));
  }

  async function handleUseFixtures() {
    setError(null);
    setUsingFixtures(true);
    setProcessing(true);
    setRunResp(null);
    try {
      const json = await processData("profile", false);
      applyProfileResponse(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleProcessUpload() {
    setError(null);
    setUsingFixtures(false);
    setProcessing(true);
    setRunResp(null);
    try {
      const json = await processData("profile", true);
      applyProfileResponse(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleRunFull() {
    setError(null);
    setRunning("full");
    try {
      const json = await processData("run", false);
      setRunResp(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(null);
    }
  }

  async function handleQuickScout() {
    setError(null);
    setRunning("quick");
    try {
      const json = await processData("run", false, quickIds);
      setRunResp(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(null);
    }
  }

  function toggleQuickId(id: string) {
    setQuickIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleDrop(setter: (f: File) => void) {
    return (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCounter.current = 0;
      const f = e.dataTransfer.files?.[0];
      if (f) setter(f);
    };
  }

  const overall = profileResp?.profile.overall;
  const notPrivate = modelStatus?.status === "NOT PRIVATE";

  return (
    <>
      <div className="topbar">
        <div>
          <div className="headline">sponsor scout</div>
          <div className="mono">beyond strangers · private by design</div>
        </div>
        <div className={`badge ${notPrivate ? "warn" : "ok"}`}>
          {modelStatus ? `${modelStatus.status} · ${modelStatus.modelId ?? "no model"}` : "checking model..."}
        </div>
      </div>

      <div className="page">
        {error && <div className="badge warn">{error}</div>}

        {/* Step 1: Data */}
        <section>
          <span className="section-label">step 1 · data</span>
          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
            <button className="run-button" onClick={handleUseFixtures} disabled={processing}>
              use fixture data
            </button>
            {usingFixtures && <span className="fixture-chip">fixture data</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
            <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop(setConnectionsFile)}>
              <label className="mono">connections.csv</label>
              <input type="file" accept=".csv" onChange={(e) => setConnectionsFile(e.target.files?.[0] ?? null)} />
              <span>{connectionsFile?.name ?? "drop or click"}</span>
            </div>
            <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop(setCandidatesFile)}>
              <label className="mono">candidates.csv</label>
              <input type="file" accept=".csv" onChange={(e) => setCandidatesFile(e.target.files?.[0] ?? null)} />
              <span>{candidatesFile?.name ?? "drop or click"}</span>
            </div>
            {EVENT_IDS.map((id) => (
              <div
                key={id}
                className="dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop((f) => setGuestFiles((prev) => ({ ...prev, [id]: f })))}
              >
                <label className="mono">{id} guests</label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setGuestFiles((prev) => ({ ...prev, [id]: e.target.files?.[0] ?? null }))}
                />
                <span>{guestFiles[id]?.name ?? EVENT_LABELS[id]}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "0.75rem" }}>
            <button className="export-btn" onClick={handleProcessUpload} disabled={processing}>
              process uploaded files
            </button>
          </div>

          {profileResp && (
            <div className="coverage-line" style={{ marginTop: "1rem" }}>
              employer known for {profileResp.coverage.known} of {profileResp.coverage.total} guests (
              {profileResp.coverage.pct}%). {profileResp.guestCount} unique guests, {profileResp.connectionCount}{" "}
              connections, {profileResp.candidateCount} candidates.
            </div>
          )}
        </section>

        {/* Step 2: Audience */}
        {overall && (
          <section>
            <span className="section-label">step 2 · audience</span>
            <div className="stat-strip">
              <div className="stat-cell">
                <span className="value">{overall.nApproved}</span>
                <span className="label">n approved</span>
              </div>
              <div className="stat-cell">
                <span className="value">{overall.showRatePct}%</span>
                <span className="label">show rate</span>
              </div>
              <div className="stat-cell">
                <span className="value">{overall.roleMix.find((r) => r.label === "Founder")?.pct ?? 0}%</span>
                <span className="label">founders</span>
              </div>
              <div className="stat-cell">
                <span className="value">{overall.roleMix.find((r) => r.label === "Investor")?.pct ?? 0}%</span>
                <span className="label">investors</span>
              </div>
              <div className="stat-cell">
                <span className="value">{overall.founderStageMix[0]?.label ?? "n/a"}</span>
                <span className="label">top stage</span>
              </div>
              <div className="stat-cell">
                <span className="value">{overall.applicationsPerSeat}x</span>
                <span className="label">apps per seat</span>
              </div>
            </div>

            <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {profileResp?.profile.perEvent.map((ev) => (
                <div key={ev.eventId} className="coverage-line">
                  <strong>{EVENT_LABELS[ev.eventId] ?? ev.eventId}</strong>: n={ev.nApproved}, show {ev.showRatePct}%,
                  apps/seat {ev.applicationsPerSeat}x, top roles{" "}
                  {ev.roleMix.slice(0, 3).map(pct).join(" · ") || "no data"}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Step 3: Run */}
        {profileResp && (
          <section>
            <span className="section-label">step 3 · run</span>

            <div style={{ marginBottom: "1rem" }}>
              <span className="mono">quick scout candidates ({quickIds.length} selected)</span>
              <div className="chip-row" style={{ marginTop: "0.5rem" }}>
                {profileResp.candidates.map((c) => (
                  <label key={c.id} className="chip" style={{ cursor: "pointer", borderColor: quickIds.includes(c.id) ? "var(--bs-black)" : undefined }}>
                    <input
                      type="checkbox"
                      checked={quickIds.includes(c.id)}
                      onChange={() => toggleQuickId(c.id)}
                      style={{ marginRight: "0.3rem" }}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button className="run-button" onClick={handleQuickScout} disabled={running !== null || notPrivate || quickIds.length === 0}>
                {running === "quick" ? "running quick scout..." : `quick scout (${quickIds.length})`}
              </button>
              <button className="export-btn" onClick={handleRunFull} disabled={running !== null || notPrivate}>
                {running === "full" ? "running full scout..." : `run full scout (${profileResp.candidateCount})`}
              </button>
            </div>

            {running === "quick" && (
              <p className="run-status">
                sending {profileResp.guestCount} pseudonymized profiles plus {quickIds.length} candidates to{" "}
                {modelStatus?.modelId} inside a TEE. usually under a minute.
              </p>
            )}
            {running === "full" && (
              <p className="run-status">
                sending {profileResp.guestCount} pseudonymized profiles plus all {profileResp.candidateCount} candidates
                to {modelStatus?.modelId} inside a TEE. this model can take several minutes on the full set.
              </p>
            )}
            {notPrivate && <p className="run-status">model is not private. fix the model choice before running.</p>}
          </section>
        )}

        {/* Step 4: Results */}
        {runResp && (
          <section>
            <span className="section-label">
              step 4 · results ({(runResp.latencyMs / 1000).toFixed(1)}s{runResp.repaired ? ", repaired once" : ""}
              {runResp.wasQuickScout ? ", quick scout" : ", full scout"}
              {runResp.ranAt ? ` · ran ${new Date(runResp.ranAt).toLocaleTimeString()}` : ""})
            </span>
            <div className="toggle-row" style={{ marginBottom: "1rem" }}>
              <input type="checkbox" checked={showIdsOnly} onChange={(e) => setShowIdsOnly(e.target.checked)} />
              <label>show ids only (screen share safe)</label>
            </div>

            <div className="portfolio-view" style={{ marginBottom: "1.5rem" }}>
              <div>
                <span className="mono">fastest cash</span>
                <div>{findSponsor(runResp.scoutOutput, runResp.scoutOutput.portfolio_view.fastest_cash)}</div>
              </div>
              <div>
                <span className="mono">series anchor</span>
                <div>{findSponsor(runResp.scoutOutput, runResp.scoutOutput.portfolio_view.series_anchor)}</div>
              </div>
              <div style={{ flex: 1 }}>
                <span className="mono">note</span>
                <div>{runResp.scoutOutput.portfolio_view.note}</div>
              </div>
            </div>

            <div className="card-grid">
              {runResp.scoutOutput.ranked.map((r, i) => (
                <ResultCard key={r.candidate_id} rank={i + 1} card={r} idMap={runResp.idMap} showIdsOnly={showIdsOnly} />
              ))}
            </div>

            {runResp.scoutOutput.excluded.length > 0 && (
              <div className="excluded-list" style={{ marginTop: "1.5rem" }}>
                <span className="section-label">excluded</span>
                {runResp.scoutOutput.excluded.map((ex) => (
                  <div key={ex.candidate_id}>
                    <strong>{ex.sponsor}</strong>: {ex.reason}
                  </div>
                ))}
              </div>
            )}

            {runResp.scoutOutput.data_gaps.length > 0 && (
              <div className="data-gaps" style={{ marginTop: "1rem" }}>
                <span className="section-label">data gaps</span>
                {runResp.scoutOutput.data_gaps.map((g, i) => (
                  <div key={i}>{g}</div>
                ))}
              </div>
            )}

            <div className="export-row" style={{ marginTop: "1.5rem" }}>
              <button className="export-btn" onClick={() => copyMarkdown(runResp.scoutOutput)}>
                copy as markdown
              </button>
              <button className="export-btn" onClick={() => downloadCsv(runResp.scoutOutput)}>
                download csv
              </button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function findSponsor(output: ScoutOutput, candidateId: string): string {
  return output.ranked.find((r) => r.candidate_id === candidateId)?.sponsor ?? candidateId;
}

function ResultCard({
  rank,
  card,
  idMap,
  showIdsOnly,
}: {
  rank: number;
  card: RankedCandidate;
  idMap: IdMapEntry[];
  showIdsOnly: boolean;
}) {
  const path = showIdsOnly ? card.warm_intro.path : rehydrateText(card.warm_intro.path, idMap);
  const via = showIdsOnly ? card.warm_intro.via : card.warm_intro.via.map((id) => rehydrateText(id, idMap));

  return (
    <div className="card">
      <div className="card-top">
        <span className="card-rank">
          #{String(rank).padStart(2, "0")} · {card.score}/100 · {card.confidence.toUpperCase()}
        </span>
      </div>
      <div className="card-sponsor headline">{card.sponsor}</div>
      <div className="buyer-line">{card.buyer}</div>
      <ul className="fit-bullets">
        {card.fit_reasoning.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
      <span className="event-pill">
        {card.recommended_event.event_id} · {card.recommended_event.tier.replace("_", " ")} ·{" "}
        {card.recommended_event.lead_time_ok ? "lead time ok" : "lead time tight"}
      </span>
      <div className="warm-block">
        <span className="warm-strength">{card.warm_intro.strength}</span>
        <span>{path}</span>
        {via.length > 0 && <span className="coverage-line">via {via.join(", ")}</span>}
      </div>
      <div className="first-line-row">
        <span>{card.first_line}</span>
        <button className="copy-btn" onClick={() => navigator.clipboard.writeText(card.first_line)}>
          copy
        </button>
      </div>
      {(card.risks.length > 0 || card.missing_data.length > 0) && (
        <div className="chip-row">
          {card.risks.map((r, i) => (
            <span key={`risk-${i}`} className="chip risk">
              {r}
            </span>
          ))}
          {card.missing_data.map((m, i) => (
            <span key={`missing-${i}`} className="chip">
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function copyMarkdown(output: ScoutOutput) {
  const lines = output.ranked.map(
    (r, i) =>
      `### ${i + 1}. ${r.sponsor} (${r.score}/100, ${r.confidence})\n- buyer: ${r.buyer}\n- event: ${r.recommended_event.event_id} (${r.recommended_event.tier})\n- warm intro: ${r.warm_intro.strength}, ${r.warm_intro.path}\n- first line: ${r.first_line}\n`
  );
  navigator.clipboard.writeText(lines.join("\n"));
}

function downloadCsv(output: ScoutOutput) {
  const header = ["Sponsor", "Tier", "Offer", "Target Event", "Warm Intro Via", "Intro Strength", "Fit Score", "First Line"];
  const rows = output.ranked.map((r) => [
    r.sponsor,
    "",
    r.recommended_event.tier,
    r.recommended_event.event_id,
    r.warm_intro.via.join("; "),
    r.warm_intro.strength,
    String(r.score),
    r.first_line,
  ]);
  const csv = [header, ...rows].map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sponsor-scout-picks.csv";
  a.click();
  URL.revokeObjectURL(url);
}

