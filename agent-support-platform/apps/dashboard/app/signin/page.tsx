"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function SignInContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  const error = params.get("error");
  const callbackUrl = params.get("callbackUrl") || "/tickets";

  // If we're already signed in (e.g., user manually navigated to /signin
  // or NextAuth redirected here after sign-in), bounce to the callback.
  useEffect(() => {
    if (status === "authenticated" && session) {
      router.replace(callbackUrl);
    }
  }, [status, session, router, callbackUrl]);

  if (status === "loading" || status === "authenticated") {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="text-sm text-slate-500">Signing you in…</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Agent Support</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in with your work Google account
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error === "AccessDenied"
              ? "Your email isn't on the allowlist for this dashboard. Contact an admin to be added."
              : "Sign-in failed. Please try again."}
          </div>
        )}

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          className="flex w-full items-center justify-center gap-3 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <p className="text-center text-xs text-slate-500">
          Only allowlisted team members can sign in.
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}
