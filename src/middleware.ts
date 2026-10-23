import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(/.*)?',
  '/studio(.*)',
  '/review(.*)',
  '/settings(.*)',
  '/api/gsc(.*)',
  '/api/scan',
  '/api/actions(.*)',
  '/api/settings(.*)',
  '/api/command-bar',
  '/api/content-studio(.*)',
]);

export default clerkMiddleware((auth, req) => {
  if (isProtectedRoute(req)) auth().protect();
});

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
