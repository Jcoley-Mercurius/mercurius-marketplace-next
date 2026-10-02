import { ForgotPasswordForm } from "./ForgotPasswordForm";

type ForgotPasswordPageProps = {
  searchParams: Promise<{ for?: string | string[] }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;
  return <ForgotPasswordForm audience={params.for === "vendor" ? "vendor" : "homeowner"} />;
}
