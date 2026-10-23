'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Navbar,
  NavBody,
  NavItems,
  NavbarButton,
  MobileNav,
  MobileNavHeader,
  MobileNavMenu,
  MobileNavToggle,
} from '@/components/ui/resizable-navbar';

const NAV_ITEMS = [
  { name: 'Results', link: '/#results' },
  { name: 'How it works', link: '/#how' },
  { name: 'What you get', link: '/#what' },
];

export function SiteNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <Navbar className="top-4">
      <NavBody className="rounded-full border border-[#232329] bg-[#0B0B0F]/90 dark:bg-[#0B0B0F]/90">
        <a href="/" className="relative z-20 mr-4 flex items-center px-2 py-1">
          <Image src="/brand/dex-logo-nav.png" alt="Dex" width={65} height={60} className="h-9 w-auto" priority />
        </a>
        <NavItems items={NAV_ITEMS} className="text-[0.875rem] text-[#c4c4cc]" />
        <div className="relative z-20 flex items-center gap-1">
          <a
            href="/sign-in"
            className="rounded-full px-4 py-2 text-[0.875rem] font-medium text-[#c4c4cc] transition-colors duration-150 hover:text-white"
          >
            Sign in
          </a>
          <NavbarButton
            href="/sign-up"
            className="dex-press rounded-full border border-[#FF4D2E] bg-[#FF4D2E] text-[0.875rem] font-bold text-white shadow-none hover:bg-[#FF6E4D]"
          >
            Start my audit
          </NavbarButton>
        </div>
      </NavBody>

      <MobileNav>
        <MobileNavHeader className="border border-[#232329] bg-[#0B0B0F]/95 px-4 py-3">
          <a href="/" className="flex items-center">
            <Image src="/brand/dex-logo-nav.png" alt="Dex" width={65} height={60} className="h-8 w-auto" priority />
          </a>
          <MobileNavToggle isOpen={mobileOpen} onClick={() => setMobileOpen((v) => !v)} />
        </MobileNavHeader>
        <MobileNavMenu isOpen={mobileOpen} onClose={() => setMobileOpen(false)} className="rounded-2xl border border-[#232329] bg-[#0B0B0F]">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.link}
              href={item.link}
              onClick={() => setMobileOpen(false)}
              className="w-full rounded-lg px-3 py-3 text-[0.9375rem] text-[#c4c4cc] transition-colors hover:bg-[#1d1d24] hover:text-[#FF4D2E]"
            >
              {item.name}
            </a>
          ))}
          <a
            href="/sign-in"
            onClick={() => setMobileOpen(false)}
            className="w-full rounded-lg px-3 py-3 text-[0.9375rem] text-[#c4c4cc] transition-colors hover:bg-[#1d1d24] hover:text-[#FF4D2E]"
          >
            Sign in
          </a>
          <NavbarButton
            href="/sign-up"
            onClick={() => setMobileOpen(false)}
            className="dex-press w-full rounded-full border border-[#FF4D2E] bg-[#FF4D2E] text-center text-[0.9375rem] font-bold text-white"
          >
            Start my audit
          </NavbarButton>
        </MobileNavMenu>
      </MobileNav>
    </Navbar>
  );
}
