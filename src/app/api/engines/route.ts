import { availableEngines } from "@/lib/engines";

// Which engines have keys set, so the page knows what to run.
export function GET() {
  return Response.json({ engines: availableEngines() });
}
