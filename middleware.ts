import { NextRequest, NextResponse } from 'next/server';
import { ROLES, rolePermissions } from './src/utils/permissions';

export function middleware(request: NextRequest) {
  const session = request.cookies.get('sb:token');
  const pathname = request.nextUrl.pathname;

  if (!session && pathname !== '/auth/login') {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  // Example: get role from session (replace with real logic)
  const role = request.cookies.get('sb:role')?.value;

  if (!role || !rolePermissions[role]) {
    return NextResponse.redirect(new URL('/unauthorized', request.url));
  }

  if (!rolePermissions[role].includes(pathname)) {
    return NextResponse.redirect(new URL('/unauthorized', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard',
    '/restaurants',
    '/users',
    '/shifts',
    '/reports',
    '/supplies',
    '/incidents',
    '/history',
  ],
};
