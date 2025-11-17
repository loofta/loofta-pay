import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// List of allowed routes
const allowedRoutes = [
  '/',
  '/login',
  '/giveaways',
  '/giveaways/create',
  '/giveaways/history',
  '/boost',
  '/creators',
  '/campaigns',
  '/settings',
  '/settings/troubleshoot',
  '/settings/join',
  '/terms',
  '/privacy',
  '/unauthorized',
  '/onboarding/profile',
  '/interests',
  '/dashboard',
  '/dashboard/giveaways',
  '/dashboard/boost',
  '/dashboard/creators',
  '/dashboard/campaigns',
  '/dashboard/settings'
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow all static files and images
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/images') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.gif') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.woff') ||
    pathname.endsWith('.woff2') ||
    pathname.endsWith('.ttf') ||
    pathname.endsWith('.eot') ||
    pathname.endsWith('.otf')
  ) {
    return NextResponse.next();
  }

  // Check if the path is allowed
  if (!allowedRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.redirect(new URL('/unauthorized', request.url));
  }

  // Only check authentication for non-public routes
  const publicRoutes = ['/', '/login', '/terms', '/privacy', '/unauthorized'];
  if (!publicRoutes.includes(pathname)) {
    // Check for any Privy-related cookie
    const hasPrivyCookie = request.cookies.getAll().some(cookie => 
      cookie.name.includes('privy') || 
      cookie.name.includes('next-auth')
    );

    if (!hasPrivyCookie) {
      console.log('No Privy cookie found, redirecting to login');
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

// Only run middleware on non-static routes
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
}; 