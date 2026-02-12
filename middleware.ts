import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { hasAccess, isRole } from "@/utils/permissions"

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname

  // Cookies estándar de Supabase
  const accessToken =
    req.cookies.get("sb-access-token")?.value ||
    req.cookies.get("supabase-auth-token")?.value

  const roleCookie = req.cookies.get("sb-role")?.value

  // 🔐 No autenticado
  if (!accessToken && !pathname.startsWith("/auth")) {
    return NextResponse.redirect(new URL("/auth/login", req.url))
  }

  // Auth pages no requieren rol
  if (!accessToken) {
    return NextResponse.next()
  }

  // 🚫 Rol inexistente o inválido
  if (!roleCookie || !isRole(roleCookie)) {
    return NextResponse.redirect(new URL("/unauthorized", req.url))
  }

  // 🚫 Sin permiso
  if (!hasAccess(roleCookie, pathname)) {
    return NextResponse.redirect(new URL("/unauthorized", req.url))
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