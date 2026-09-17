import { z } from "zod";
import { AppError, passwordSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { mapAuthError } from "@/lib/auth-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const bodySchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export const POST = route(async (req, { correlationId }) => {
  const input = await parseBody(req, bodySchema, 2048);
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    throw new AppError("AUTH_REQUIRED", "This reset link has expired or was already used. Request a new link.");
  }
  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) throw mapAuthError(error, "update");
  // Revoke other sessions after a password change; keep this one.
  await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
  return json({ status: "updated", redirect: "/app/tasks" }, correlationId);
});
