"use client";

import { signOut, useSession } from "next-auth/react";

export function UserMenu() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <div className="text-xs text-slate-400">…</div>;
  }
  if (!session?.user) return null;

  const role = (session.user as { role?: string }).role;
  const name = session.user.name || session.user.email;

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="text-right leading-tight">
        <div className="font-medium text-slate-900">{name}</div>
        {role && (
          <div className="text-xs text-slate-500">{role}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/signin" })}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
      >
        Sign out
      </button>
    </div>
  );
}
