import type { Metadata } from "next";
import Link from "next/link";
import { AuthSessionProvider } from "./_components/session-provider";
import { RealtimeIndicator } from "./_components/realtime-indicator";
import { ToastContainer } from "./_components/toast-container";
import { UserMenu } from "./_components/user-menu";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Support",
  description: "Bilingual WhatsApp support dashboard",
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
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-6">
                <Link href="/" className="text-lg font-semibold tracking-tight">
                  Agent Support
                </Link>
                <nav className="flex gap-6 text-sm text-slate-600">
                  <Link href="/tickets" className="hover:text-slate-900">
                    Tickets
                  </Link>
                  <Link href="/incidents" className="hover:text-slate-900">
                    Incidents
                  </Link>
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
          <main className="px-6 py-6">{children}</main>
          <ToastContainer />
        </AuthSessionProvider>
      </body>
    </html>
  );
}
