'use client';

import { motion, useReducedMotion } from 'motion/react';

function LinkedInIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.114 20.452H3.56V9h3.554v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const LEGAL_LINKS = [
  { href: '/impressum', label: 'Impressum' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/dpa', label: 'DPA' },
  { href: '/security', label: 'Security' },
  { href: '/cookies', label: 'Cookies' },
];

const FOOTER_LINK_CLASS =
  'relative w-fit text-[#c4c4cc] transition-colors after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-0 after:bg-[#FF4D2E] after:transition-all after:duration-200 hover:text-[#FF4D2E] after:hover:w-full';

export function SiteFooter() {
  const reduce = useReducedMotion();

  return (
    <motion.footer
      className="w-full border-t border-[#232329] bg-[#0B0B0F] px-4 py-16"
      initial={reduce ? false : { opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-10 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2 text-[0.9375rem] text-[#f4f4f6]">
            <span className="inline-block h-2 w-2 bg-[#FF4D2E]" aria-hidden="true" />
            DEX_
          </div>
          <p className="mt-3 max-w-xs text-[0.9375rem] leading-relaxed text-[#9a9aa5]">
            A marketing team you stay in charge of, in a world where AI decides who gets found.
          </p>
        </div>

        <div className="flex flex-col gap-6 md:flex-row md:items-center md:gap-10">
          <nav className="flex flex-col gap-3 text-[0.9375rem] md:flex-row md:gap-6">
            <a href="/#why" className={FOOTER_LINK_CLASS}>
              Why
            </a>
            <a href="/#how" className={FOOTER_LINK_CLASS}>
              How it works
            </a>
            <a href="/#what" className={FOOTER_LINK_CLASS}>
              What you get
            </a>
            <a href="/sign-in" className={FOOTER_LINK_CLASS}>
              Sign in
            </a>
          </nav>

          <div className="flex items-center gap-4">
            <a
              href="https://linkedin.com"
              aria-label="Dex on LinkedIn"
              className="text-[#9a9aa5] transition-transform duration-200 hover:-translate-y-0.5 hover:scale-110 hover:text-[#FF4D2E]"
            >
              <LinkedInIcon />
            </a>
            <a
              href="https://x.com"
              aria-label="Dex on X"
              className="text-[#9a9aa5] transition-transform duration-200 hover:-translate-y-0.5 hover:scale-110 hover:text-[#FF4D2E]"
            >
              <XIcon />
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-12 max-w-6xl border-t border-[#232329] pt-6 text-[0.8125rem] text-[#9a9aa5]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <span>© 2026 Dex. Your data is stored in Frankfurt, Germany.</span>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_LINKS.map((l) => (
              <a key={l.href} href={l.href} className={FOOTER_LINK_CLASS}>
                {l.label}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </motion.footer>
  );
}
