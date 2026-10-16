import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

export type ServiceClient = ReturnType<typeof serviceClient>;

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireSuperAdmin() {
  const server = await createServerClient();
  const { data, error } = await server.auth.getUser();
  if (error || !data.user) return null;
  const admin = serviceClient();
  const { data: profile } = await admin.from("profiles").select("is_super_admin").eq("id", data.user.id).maybeSingle();
  if (!profile?.is_super_admin) return null;
  return { admin, userId: data.user.id };
}

export async function writeAudit(
  admin: ServiceClient,
  actorId: string | null,
  targetUserId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {}
) {
  await admin.from("audit_logs").insert({
    actor_id: actorId,
    target_user_id: targetUserId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
}
