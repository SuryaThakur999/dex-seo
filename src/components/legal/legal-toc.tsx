'use client';

import { useEffect, useState } from 'react';

// Sticky contents list. The highlight follows the section nearest the top of the screen, so
// readers always know where they are in a long legal text.
export function LegalToc({ items, label }: { items: { id: string; heading: string }[]; label: string }) {
  const [active, setActive] = useState(items[0]?.id ?? '');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    items.forEach((i) => {
      const el = document.getElementById(i.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label={label} className="sticky top-28 hidden max-h-[calc(100dvh-8rem)] overflow-y-auto pr-2 lg:block">
      <p className="dex-label text-[var(--dex-text-tertiary)]">{label}</p>
      <ol className="mt-4 space-y-1 border-l border-[var(--dex-border)]">
        {items.map((i) => {
          const on = i.id === active;
          return (
            <li key={i.id}>
              <a
                href={`#${i.id}`}
                aria-current={on ? 'location' : undefined}
                className={`-ml-px block border-l py-1.5 pl-4 text-[0.875rem] leading-snug transition-colors duration-200 ease-out ${
                  on
                    ? 'border-[var(--dex-accent)] text-[var(--dex-text-primary)]'
                    : 'border-transparent text-[var(--dex-text-tertiary)] hover:text-[var(--dex-text-secondary)]'
                }`}
              >
                {i.heading}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
