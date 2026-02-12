import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname

  const accessToken =
    req.cookies.get("sb-access-token")?.value ||
    req.cookies.get("supabase-auth-token")?.value

  if (!accessToken && !pathname.startsWith("/auth")) {
    return NextResponse.redirect(new URL("/auth/login", req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/restaurants/:path*",
    "/users/:path*",
    "/shifts/:path*",
    "/supplies/:path*",
    "/reports/:path*",
  ],
}
