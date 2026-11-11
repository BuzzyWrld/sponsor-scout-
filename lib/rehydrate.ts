// No node:fs here on purpose: this needs to run client-side too, so the browser can
// toggle "show IDs only" without a round trip to the server.

import type { IdMapEntry } from "./types";

export function rehydrateText(text: string, idMap: IdMapEntry[]): string {
  const byId = new Map(idMap.map((e) => [e.id, e.name]));
  return text.replace(/\b([GC]-\d{3})\b/g, (match) => byId.get(match) ?? match);
}
