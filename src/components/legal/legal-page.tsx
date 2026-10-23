import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { SiteNav } from '@/components/marketing/site-nav';
import { SiteFooter } from '@/components/marketing/site-footer';
import { LEGAL_COMPLETE, LEGAL_UPDATED } from '@/lib/legal/operator';
import { OPERATOR } from '@/lib/legal/operator';
import type { Lang, LegalBlock, LegalDocPair } from '@/lib/legal/types';
import { LegalToc } from './legal-toc';
import { LegalReveal } from './legal-reveal';

export function legalMetadata(title: string, path: string, opts: { neverIndex?: boolean } = {}): Metadata {
  return {
    title: `${title} | Dex`,
    alternates: { canonical: path },
    // Unfinished legal pages stay out of search results. The Impressum never goes in: the law
    // requires it to be reachable from every page, not findable by searching the owner's name.
    robots: LEGAL_COMPLETE && !opts.neverIndex ? undefined : { index: false, follow: true },
  };
}

const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** ?lang=de|en wins; otherwise the browser's language; English for everyone else. */
export function resolveLang(param: string | string[] | undefined): Lang {
  const p = Array.isArray(param) ? param[0] : param;
  if (p === 'de' || p === 'en') return p;
  const accept = headers().get('accept-language') ?? '';
  return accept.toLowerCase().startsWith('de') ? 'de' : 'en';
}

// Placeholders like "[contact email]" render highlighted so a missing detail is never hidden.
function Text({ value }: { value: string }) {
  const parts = value.split(/(\[[^\]]+\])/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('[') && part.endsWith(']') ? (
          <mark key={i} className="rounded bg-[#ffb020]/20 px-1 text-[#ffb020]">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === 'string') {
    return (
      <p className="dex-body mt-4 max-w-[68ch]">
        <Text value={block} />
      </p>
    );
  }
  if ('link' in block) {
    return (
      <a
        href={block.link.href}
        className="dex-press mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--dex-border)] px-4 py-2 text-[0.9375rem] text-[var(--dex-text-primary)] transition-colors hover:border-[var(--dex-border-accent)]"
      >
        {block.link.label} <span aria-hidden="true">&rarr;</span>
      </a>
    );
  }
  if ('list' in block) {
    return (
      <ul className="dex-body mt-4 max-w-[68ch] list-disc space-y-2 pl-5 marker:text-[var(--dex-text-tertiary)]">
        {block.list.map((item) => (
          <li key={item}>
            <Text value={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--dex-border)]">
      <table className="w-full min-w-[34rem] text-left text-[0.9375rem]">
        <thead className="bg-[var(--dex-bg-elevated)] text-[var(--dex-text-primary)]">
          <tr>
            {block.table.head.map((h) => (
              <th key={h} className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-[var(--dex-text-secondary)]">
          {block.table.rows.map((row) => (
            <tr key={row.join('|')} className="border-t border-[var(--dex-border)]">
              {row.map((cell, i) => (
                <td key={i} className="px-4 py-3 align-top">
                  <Text value={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LegalPage({ doc, lang, path }: { doc: LegalDocPair; lang: Lang; path: string }) {
  const d = doc[lang];
  const de = lang === 'de';
  const toc = d.sections.map((sec) => ({ id: slug(sec.heading), heading: sec.heading }));
  return (
    <div className="dex-marketing dark min-h-screen bg-[#0B0B0F]">
      <SiteNav />
      <main lang={lang} className="mx-auto max-w-6xl px-4 pb-28 pt-36 sm:px-6">
        <LegalReveal>
          <header className="max-w-3xl">
            <p className="dex-label text-[var(--dex-accent)]">{de ? 'Rechtliches' : 'Legal'}</p>
            <h1 className="dex-h2 mt-4 hyphens-auto [overflow-wrap:anywhere]">{d.title}</h1>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
              {/* Language switch: two links styled as one segmented control. */}
              <div role="group" aria-label={de ? 'Sprache' : 'Language'} className="inline-flex rounded-full border border-[var(--dex-border)] p-1">
                {(['de', 'en'] as const).map((l) => (
                  <a
                    key={l}
                    href={`${path}?lang=${l}`}
                    hrefLang={l}
                    aria-current={l === lang ? 'page' : undefined}
                    className={`dex-press rounded-full px-4 py-1.5 text-[0.875rem] transition-colors duration-200 ${
                      l === lang ? 'bg-[var(--dex-bg-elevated-2)] text-white' : 'text-[var(--dex-text-tertiary)] hover:text-white'
                    }`}
                  >
                    {l === 'de' ? 'Deutsch' : 'English'}
                  </a>
                ))}
              </div>
              <span className="text-[0.875rem] text-[var(--dex-text-tertiary)]">
                {de ? `Stand: ${LEGAL_UPDATED.de}` : `Last updated: ${LEGAL_UPDATED.en}`}
              </span>
            </div>
            {!de && (
              <p className="mt-3 text-[0.875rem] text-[var(--dex-text-tertiary)]">
                The German version is legally binding. This English version is provided for convenience.
              </p>
            )}
            {!LEGAL_COMPLETE && (
              <p className="mt-6 rounded-2xl border border-[#ffb020]/40 bg-[#ffb020]/10 px-4 py-3 text-[0.9375rem] text-[#ffb020]">
                {de ? 'Hinweis: Einzelne Angaben (markiert) werden gerade ergänzt.' : 'Note: a few details (highlighted) are still being added.'}
              </p>
            )}
            {d.intro && (
              <p className="dex-lead mt-8">
                <Text value={d.intro} />
              </p>
            )}
          </header>
        </LegalReveal>

        <div className="mt-16 grid gap-12 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
          <LegalToc items={toc} label={de ? 'Inhalt' : 'Contents'} />
          <div className="min-w-0 max-w-3xl">
            {d.sections.map((sec, i) => (
              <section key={sec.heading} id={toc[i].id} className="scroll-mt-28 border-t border-[var(--dex-border)] py-10 first:border-t-0 first:pt-0">
                <LegalReveal>
                  <h2 className="dex-h3 hyphens-auto">{sec.heading}</h2>
                  {sec.blocks.map((b, j) => (
                    <Block key={j} block={b} />
                  ))}
                </LegalReveal>
              </section>
            ))}

            <LegalReveal>
              <aside className="mt-6 rounded-3xl border border-[var(--dex-border)] bg-[var(--dex-bg-elevated)] p-6 md:p-8">
                <p className="dex-h3">{de ? 'Fragen zu diesem Text?' : 'Questions about this page?'}</p>
                <p className="dex-body mt-2">
                  {de ? 'Schreiben Sie uns, wir antworten persönlich: ' : 'Write to us and a person will reply: '}
                  {OPERATOR.email.startsWith('[') ? (
                    <Text value={OPERATOR.email} />
                  ) : (
                    <a href={`mailto:${OPERATOR.email}`} className="text-[var(--dex-text-primary)] underline underline-offset-4 hover:text-[var(--dex-accent)]">
                      {OPERATOR.email}
                    </a>
                  )}
                </p>
              </aside>
            </LegalReveal>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
