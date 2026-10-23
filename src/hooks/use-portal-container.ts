'use client';

import { useEffect, useState } from 'react';

// Radix portals default to document.body, which sits outside .dex-app — the element
// that actually carries the resolved theme's CSS custom properties. Without this, a
// tooltip/select dropdown always renders with :root's base tokens regardless of which
// theme the app is actually in. Returns undefined outside .dex-app (marketing/sign-in
// pages), which Radix treats as "use the default (body)" — those pages are unaffected.
export function usePortalContainer(): HTMLElement | undefined {
  const [container, setContainer] = useState<HTMLElement | undefined>(undefined);
  useEffect(() => {
    setContainer(document.getElementById('dex-app-root') ?? undefined);
  }, []);
  return container;
}
