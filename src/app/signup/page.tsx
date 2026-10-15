import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Create account" };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="wrap auth-wrap">
      {error && <div className="notice notice--error" role="alert" style={{ maxWidth: 400, margin: "0 auto 24px" }}><i />{error}</div>}
      <AuthForm mode="signup" next={next} />
    </div>
  );
}
