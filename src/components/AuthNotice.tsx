"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** One-time banner after an email confirmation link (?auth=confirmed). */
export function AuthNotice({ signedIn }: { signedIn: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (params.get("auth") !== "confirmed") return;
    setShow(true);
    const rest = new URLSearchParams(params);
    rest.delete("auth");
    router.replace(`${path}${rest.size ? `?${rest}` : ""}`, { scroll: false });   // clean the URL
  }, [params, path, router]);

  if (!show) return null;
  return (
    <div className="wrap" style={{ marginTop: 16 }}>
      <div className="notice" role="status">
        <i style={{ background: "#8fc93a" }} />
        <span style={{ flex: 1 }}>
          {signedIn ? "Your email is confirmed and you’re signed in. Welcome to the shop." : "Your email is confirmed. Please sign in to continue."}
        </span>
        <button className="link" onClick={() => setShow(false)} aria-label="Dismiss">Dismiss</button>
      </div>
    </div>
  );
}
