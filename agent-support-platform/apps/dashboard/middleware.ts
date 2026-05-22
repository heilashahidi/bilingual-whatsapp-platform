import { withAuth } from "next-auth/middleware";

// Redirects unauthenticated requests to /signin. Runs before the page
// renders so server components don't even start fetching.
export default withAuth({
  pages: { signIn: "/signin" },
});

export const config = {
  matcher: [
    // Protect everything except: the sign-in page, the NextAuth API routes,
    // static assets, and the Next.js internals.
    "/((?!signin|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
