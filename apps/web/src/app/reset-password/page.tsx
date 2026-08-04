import { ResetPasswordScreen } from "@/features/auth/reset-password-screen";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <ResetPasswordScreen token={token} />;
}
