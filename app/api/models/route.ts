import { NextResponse } from "next/server";
import { loadModelChoice } from "@/lib/near";

export async function GET() {
  try {
    const model = loadModelChoice();
    let status: "TEE ATTESTED" | "CATALOG VERIFIED" | "NOT PRIVATE";
    if (model.providerType === "external" || !model.verifiable || !model.attestationSupported) {
      status = "NOT PRIVATE";
    } else {
      // Live attestation report verification is not wired yet (section 7, 20 minute timebox).
      // Honest fallback per section 0: say catalog verified, never claim attested until it is.
      status = "CATALOG VERIFIED";
    }
    return NextResponse.json({ ...model, status });
  } catch {
    return NextResponse.json({ status: "NOT PRIVATE", error: "no model selected, run npm run models" }, { status: 500 });
  }
}
