import type { Metadata } from "next";
import Link from "next/link";
import { AuthSessionProvider } from "./_components/session-provider";
import { IncidentsNavLink } from "./_components/incidents-nav-link";
import { KeyboardShortcuts } from "./_components/keyboard-shortcuts";
import { RealtimeIndicator } from "./_components/realtime-indicator";
import { TicketsNavLink } from "./_components/tickets-nav-link";
import { ToastContainer } from "./_components/toast-container";
import { UserMenu } from "./_components/user-menu";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nclusion",
  description: "Bilingual WhatsApp support inbox",
  // Deploy marker — used as a sanity check that Railway is actually
  // rebuilding the dashboard on push. Bump if you suspect the deploy
  // is stuck on a stale image.
  other: { "x-app-build": "2026-05-23-nclusion-rebrand" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthSessionProvider>
          <header className="border-b border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
              <div className="flex items-center gap-6">
                <Link href="/" className="text-lg font-semibold tracking-tight">
                  Nclusion
                </Link>
                <nav className="flex gap-6 text-sm text-slate-600">
                  <TicketsNavLink />
                  <IncidentsNavLink />
                  <Link href="/knowledge" className="hover:text-slate-900">
                    Knowledge
                  </Link>
                </nav>
              </div>
              <div className="flex items-center gap-3">
                <RealtimeIndicator />
                <UserMenu />
              </div>
            </div>
          </header>
          {/* No global max-width — pages handle their own container width.
              The inbox view fills the whole viewport; tickets/[id] and
              /knowledge constrain themselves so long-form text stays
              readable. */}
          <main className="px-4 py-4 sm:px-6 sm:py-6">{children}</main>
          <ToastContainer />
          <KeyboardShortcuts />
        </AuthSessionProvider>
      </body>
    </html>
  );
}
