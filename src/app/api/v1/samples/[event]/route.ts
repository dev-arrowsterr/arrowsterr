import { apiAuth } from "@/lib/integrations";
import { SAMPLES, type EventName } from "@/lib/integrationTypes";

// A sample of an event, so Zapier can show fields while a Zap is being built.
export async function GET(request: Request, { params }: { params: Promise<{ event: string }> }) {
  const a = await apiAuth(request);
  if ("denied" in a) return a.denied;
  const { event } = await params;
  const sample = SAMPLES[event as EventName];
  if (!sample) return Response.json({ error: "Unknown event." }, { status: 404 });
  return Response.json([sample]);
}
