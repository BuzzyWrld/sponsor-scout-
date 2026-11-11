// Runs the sourcing extraction over whatever Luma search JSON files are saved under
// data/raw/sourcing/, prints the result, and writes data/raw/candidates-sourced.csv.

import { writeFileSync } from "node:fs";
import Papa from "papaparse";
import { loadSourcingFiles, sourceCandidates } from "../lib/sourcing";

const files = loadSourcingFiles();
console.log(`loaded ${files.length} sourcing file(s): ${files.map((f) => f.category).join(", ")}`);

const candidates = sourceCandidates(files);
console.log(`\nsourced ${candidates.length} candidates:\n`);
for (const c of candidates) {
  console.log(`- ${c.name} [${c.category}]`);
  console.log(`  evidence: ${c.evidenceOfSponsoring}`);
}

const rows = candidates.map((c) => ({
  name: c.name,
  website: c.website ?? "",
  category: c.category ?? "",
  what_they_sell: c.whatTheySell,
  who_they_sell_to: c.whoTheySellTo,
  evidence_of_sponsoring: c.evidenceOfSponsoring ?? "",
  known_contact: c.knownContact ?? "",
  notes: c.notes ?? "",
}));
writeFileSync("data/raw/candidates-sourced.csv", Papa.unparse(rows));
console.log(`\nwrote data/raw/candidates-sourced.csv`);
