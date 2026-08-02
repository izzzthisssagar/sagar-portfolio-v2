import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const isLogin = request.nextUrl.pathname === '/admin/login';
  if (!isLogin && !request.cookies.has('portfolio_access')) {
    const login = new URL('/admin/login', request.url);
    login.searchParams.set('returnTo', request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*'] };
