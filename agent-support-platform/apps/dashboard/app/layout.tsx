import type { Metadata } from "next";
import Link from "next/link";
import { AuthSessionProvider } from "./_components/session-provider";
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
            <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
              <div className="flex items-center gap-6">
                <Link href="/" className="text-lg font-semibold tracking-tight">
                  Agent Support
                </Link>
                <nav className="flex gap-6 text-sm text-slate-600">
                  <Link href="/tickets" className="hover:text-slate-900">
                    Tickets
                  </Link>
                </nav>
              </div>
              <UserMenu />
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
          <ToastContainer />
        </AuthSessionProvider>
      </body>
    </html>
  );
}
