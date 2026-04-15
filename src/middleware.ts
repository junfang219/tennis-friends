import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = ["/login", "/register", "/onboarding"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) return NextResponse.next();

  const onboardingComplete = Boolean((token as { onboardingComplete?: boolean }).onboardingComplete);
  if (onboardingComplete) return NextResponse.next();

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/onboarding";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!api/auth|api/onboarding|_next/static|_next/image|favicon.ico|icons|manifest|robots.txt|.*\\..*).*)",
  ],
};
