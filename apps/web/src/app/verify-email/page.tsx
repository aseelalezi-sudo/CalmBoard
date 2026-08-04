import { VerifyEmailScreen } from "@/features/auth/verify-email-screen";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <VerifyEmailScreen token={token} />;
}
