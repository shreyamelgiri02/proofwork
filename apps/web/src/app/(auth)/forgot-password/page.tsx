import { ForgotPasswordForm } from "@/features/auth/password-forms";

export const metadata = { title: "Reset password" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <ForgotPasswordForm expired={params.expired === "1"} />;
}
