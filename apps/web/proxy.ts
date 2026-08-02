import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccessToken } from './lib/admin-auth.server';

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/admin/login') return NextResponse.next();
  const claims = await verifyAdminAccessToken(request.cookies.get('portfolio_access')?.value);
  if (!claims) {
    const login = new URL('/admin/login', request.url);
    login.searchParams.set('returnTo', request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*'] };
