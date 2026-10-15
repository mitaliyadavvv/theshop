import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { getSessionUser } from "@/server/auth";

export const metadata = { title: "New password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="wrap auth-wrap"><div className="auth">
        <h1>Link expired</h1>
        <p className="muted">This reset link is no longer valid, or was opened in a different browser.</p>
        <p><Link className="btn" href="/forgot-password">Send a new link</Link></p>
      </div></div>
    );
  }
  return <div className="wrap auth-wrap"><AuthForm mode="reset" /></div>;
}
