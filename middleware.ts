import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(req: NextRequest) {
  // This app currently uses Supabase browser session persistence (localStorage),
  // so auth tokens are not available to Next middleware cookies reliably.
  // Route protection is handled client-side by ProtectedRoute/RoleGuard.
  void req
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
