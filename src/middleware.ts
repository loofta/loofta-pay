import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const pathname = request.nextUrl.pathname;
  
  // Skip API routes, static files, and Next.js internals
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.') // files with extensions
  ) {
    return NextResponse.next();
  }

  // Handle swap.loofta.xyz -> /swap
  if (host === 'swap.loofta.xyz' || host.startsWith('swap.loofta.xyz:')) {
    // If already on /swap path, continue
    if (pathname.startsWith('/swap')) {
      return NextResponse.next();
    }
    // Rewrite root to /swap
    const url = request.nextUrl.clone();
    url.pathname = '/swap' + (pathname === '/' ? '' : pathname);
    return NextResponse.rewrite(url);
  }

  // Handle checkout.loofta.xyz -> /checkout  
  if (host === 'checkout.loofta.xyz' || host.startsWith('checkout.loofta.xyz:')) {
    // If already on /checkout path, continue
    if (pathname.startsWith('/checkout')) {
      return NextResponse.next();
    }
    // Rewrite root to /checkout
    const url = request.nextUrl.clone();
    url.pathname = '/checkout' + (pathname === '/' ? '' : pathname);
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
