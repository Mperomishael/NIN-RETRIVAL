import type { ServiceClient } from "@/lib/server/admin";

const asyncServices = ["nin-validation", "ipe-clearance", "nin-modification"];

export type StuckSummary = { completed: number; refunded: number; failed: number };

export async function resolveStuckRequests(admin: ServiceClient, olderThanMinutes = 10): Promise<StuckSummary> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60000).toISOString();
  const { data, error } = await admin.from("identity_requests")
    .select("id,provider_reference,result_payload")
    .eq("status", "processing")
    .lt("created_at", cutoff)
    .not("service_id", "in", `(${asyncServices.join(",")})`)
    .limit(100);
  if (error) throw new Error("Unable to load stuck requests.");

  const summary: StuckSummary = { completed: 0, refunded: 0, failed: 0 };
  for (const row of data ?? []) {
    const accepted = Boolean(row.provider_reference);
    const { error: rpcError } = await admin.rpc("topverify_finalize_request", {
      p_request_id: row.id,
      p_status: accepted ? "completed" : "failed",
      p_provider_reference: row.provider_reference ?? "",
      p_result_summary: accepted ? (row.result_payload ?? {}) : {},
      p_error_code: accepted ? null : "STALE_NO_PROVIDER_RESPONSE",
    });
    if (rpcError) summary.failed++;
    else if (accepted) summary.completed++;
    else summary.refunded++;
  }
  return summary;
}
