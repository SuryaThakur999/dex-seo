'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import {
  ShieldCheck,
  Brain,
  PenNib,
  ClipboardText,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react/dist/ssr';
import { WhatGraphic, type WhatKind } from '@/components/marketing/what-graphic';

const EASE = [0.22, 1, 0.36, 1] as const;

const ITEMS = [
  {
    key: 'prooflayer',
    featured: true,
    icon: ShieldCheck,
    title: 'ProofLayer',
    graphic: 'checks' as WhatKind,
    plain: 'Catch mistakes before anyone else sees them',
    body: 'Every draft passes five checks first: an AI label, claims it can back up, no clash with your current copy, sensible length and no duplicate content. If one fails, the draft is held, not approved.',
  },
  {
    key: 'growth-brain',
    featured: false,
    icon: Brain,
    title: 'Growth Brain',
    graphic: 'search' as WhatKind,
    plain: 'Fix what keeps Google and ChatGPT from finding you',
    body: 'Finds the search problems on every page, including the pages your traffic reports never show.',
  },
  {
    key: 'creation-engine',
    featured: false,
    icon: PenNib,
    title: 'Creation Engine',
    graphic: 'voice' as WhatKind,
    plain: 'Sounds like you, not like a robot',
    body: 'Each fix is drafted from your own page and the brand voice you set. Never a generic template.',
  },
  {
    key: 'audit-log',
    featured: false,
    icon: ClipboardText,
    title: 'Audit log',
    graphic: 'log' as WhatKind,
    plain: 'Always know who changed what, and why',
    body: 'Every edit and approval is logged with who did it. When someone asks, you have the answer in seconds.',
  },
];

const trackVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

// Entrance used to slide cards in from the right (x: 64/40) inside a track that also
// scrolls horizontally -- the reveal motion and the scroll motion read as the same
// gesture, so a card looked like it was still sliding whenever you touched the track.
// A vertical fade keeps the reveal visually distinct from horizontal scrolling.
const cardVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: EASE },
  },
};

const featuredCardVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: EASE },
  },
};

export function WhatSection() {
  const reduce = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | undefined>(undefined);

  const [activeIndex, setActiveIndex] = useState(0);
  // Which card's preview is playing: the hovered one, or on touch screens every card seen so far.
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);
  const [coarse, setCoarse] = useState(false);
  const [seenCards, setSeenCards] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    setCoarse(window.matchMedia('(hover: none)').matches);
  }, []);
  const [edges, setEdges] = useState({ start: true, end: false });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ active: false, startX: 0, startScrollLeft: 0, moved: false });

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pct = max > 0 ? (el.scrollLeft / max) * 100 : 0;
    if (progressRef.current) {
      progressRef.current.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }
    setEdges({ start: pct <= 1, end: pct >= 99 });

    // The active card is whichever one currently sits closest to the container's
    // left edge -- the same edge every card snaps to (snap-start) and the same
    // edge arrow/dot navigation aligns to. This is derived straight from live
    // scroll position rather than IntersectionObserver threshold-crossing
    // batches: with a single 0.6 threshold, a card that's already above 0.6
    // visible doesn't fire again just because its ratio keeps climbing, so on
    // a scroll where the wide featured card lets two neighbors cross 0.6 in
    // the same step, the truly-most-visible one can silently drop out of the
    // batch and the wrong card gets marked active.
    const containerLeft = el.getBoundingClientRect().left;
    let closestIdx = 0;
    let closestDistance = Infinity;
    cardRefs.current.forEach((card, i) => {
      if (!card) return;
      const distance = Math.abs(card.getBoundingClientRect().left - containerLeft);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIdx = i;
      }
    });
    setActiveIndex(closestIdx);
  }, []);

  const handleScroll = useCallback(() => {
    if (rafRef.current !== undefined) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = undefined;
      updateScrollState();
    });
  }, [updateScrollState]);

  useEffect(() => {
    updateScrollState();
  }, [updateScrollState]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const target = cardRefs.current[Math.max(0, Math.min(ITEMS.length - 1, index))];
      target?.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        inline: 'start',
        block: 'nearest',
      });
    },
    [reduce],
  );

  const goPrev = () => scrollToIndex(activeIndex - 1);
  const goNext = () => scrollToIndex(activeIndex + 1);

  // Cards only responded to the native scrollbar or a two-finger trackpad swipe --
  // hovering and dragging a card with the mouse did nothing, which read as the scroll
  // being unresponsive. This wires up click-and-drag panning like the rest of the site's
  // horizontal scroll surfaces expect.
  const onPointerDown = (e: ReactPointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { active: true, startX: e.clientX, startScrollLeft: el.scrollLeft, moved: false };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const el = scrollRef.current;
    const drag = dragRef.current;
    if (!drag.active || !el) return;
    const delta = e.clientX - drag.startX;
    if (Math.abs(delta) > 3) drag.moved = true;
    el.scrollLeft = drag.startScrollLeft - delta;
    if (drag.moved) setIsDragging(true);
  };

  const endDrag = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    scrollRef.current?.releasePointerCapture(e.pointerId);
    drag.active = false;
    // Swallow the click that fires right after a real drag, so releasing on top of a
    // card doesn't also trigger its link/press state.
    if (drag.moved) requestAnimationFrame(() => setIsDragging(false));
  };

  return (
    <section id="what" className="dex-section w-full bg-[var(--dex-bg)]">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="dex-label text-[var(--dex-accent)]">What you get</p>
            <h2 className="dex-h2 mt-4 max-w-3xl">Big-brand marketing. Without the big-brand team.</h2>
            <p className="dex-lead mt-6">
              Big companies pay whole teams to check every page, fix what search engines trip over and sign off every
              word. Dex does that work for you, and you keep the final say.
            </p>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={goPrev}
              disabled={edges.start}
              aria-label="Previous card"
              className="flex size-10 items-center justify-center rounded-full border border-[var(--dex-border)] text-[var(--dex-text-secondary)] transition-colors duration-200 hover:border-[var(--dex-border-accent)] hover:text-[var(--dex-text-primary)] disabled:pointer-events-none disabled:opacity-30"
            >
              <CaretLeft size={16} weight="bold" />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={edges.end}
              aria-label="Next card"
              className="flex size-10 items-center justify-center rounded-full border border-[var(--dex-border)] text-[var(--dex-text-secondary)] transition-colors duration-200 hover:border-[var(--dex-border-accent)] hover:text-[var(--dex-text-primary)] disabled:pointer-events-none disabled:opacity-30"
            >
              <CaretRight size={16} weight="bold" />
            </button>
          </div>
        </div>

        <motion.div
          ref={scrollRef}
          onScroll={handleScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onClickCapture={(e) => {
            if (isDragging) e.stopPropagation();
          }}
          initial={reduce ? undefined : 'hidden'}
          whileInView={reduce ? undefined : 'visible'}
          viewport={{ once: true, amount: 0.2 }}
          variants={reduce ? undefined : trackVariants}
          role="region"
          aria-roledescription="carousel"
          aria-label="What you get with Dex"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') goNext();
            if (e.key === 'ArrowLeft') goPrev();
          }}
          className={`mt-12 flex cursor-grab gap-4 overflow-x-auto overscroll-x-contain pb-2 pr-4 pt-1 active:cursor-grabbing [-ms-overflow-style:none] [scrollbar-width:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dex-accent)]/50 [&::-webkit-scrollbar]:hidden ${
            isDragging ? '' : 'snap-x snap-mandatory'
          } ${reduce || isDragging ? '' : 'scroll-smooth'}`}
        >
          {ITEMS.map((item, i) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.key}
                ref={(el) => {
                  cardRefs.current[i] = el;
                }}
                variants={reduce ? undefined : item.featured ? featuredCardVariants : cardVariants}
                onHoverStart={() => setHoveredCard(i)}
                onHoverEnd={() => setHoveredCard((c) => (c === i ? null : c))}
                onViewportEnter={() => {
                  if (coarse) setSeenCards((prev) => new Set(prev).add(i));
                }}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${ITEMS.length}: ${item.title}`}
                className={`group flex-none snap-start flex min-h-[30rem] flex-col rounded-3xl p-8 transition-[transform,border-color,box-shadow] md:p-10 duration-300 hover:-translate-y-1 ${
                  item.featured
                    ? 'w-[300px] border border-[rgba(255,176,32,0.4)] bg-[#1d1811] hover:border-[rgba(255,176,32,0.7)] hover:shadow-[0_0_0_1px_rgba(255,176,32,0.15),0_20px_40px_-20px_rgba(255,176,32,0.35)] sm:w-[440px] md:w-[540px]'
                    : 'w-[280px] border border-[var(--dex-border)] bg-[var(--dex-bg-elevated)] hover:border-[var(--dex-border-accent)] hover:shadow-[0_20px_40px_-24px_rgba(255,77,46,0.35)] sm:w-[340px] md:w-[380px]'
                }`}
              >
                <Icon
                  size={item.featured ? 36 : 32}
                  weight="light"
                  className={`transition-transform duration-300 group-hover:scale-110 ${
                    item.featured ? 'text-[var(--dex-accent-secondary)]' : 'text-[var(--dex-accent)]'
                  }`}
                />
                <div className="mt-6">
                  <WhatGraphic kind={item.graphic} active={hoveredCard === i || seenCards.has(i)} />
                </div>
                <h3 className="dex-h3 dex-h3-lg mt-6">
                  {item.plain}
                </h3>
                {item.plain !== item.title && (
                  <p className="dex-label mt-2 text-[var(--dex-text-tertiary)]">{item.title}</p>
                )}
                <p className="dex-body mt-3">{item.body}</p>
              </motion.div>
            );
          })}
        </motion.div>

        <div className="mt-6 flex items-center justify-end gap-6">

          <div className="flex items-center gap-2" role="tablist" aria-label="Carousel slides">
            {ITEMS.map((item, i) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={activeIndex === i}
                aria-current={activeIndex === i}
                aria-label={`Go to ${item.title}`}
                onClick={() => scrollToIndex(i)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  activeIndex === i
                    ? 'w-6 bg-[var(--dex-accent)]'
                    : 'w-2 bg-[var(--dex-border)] hover:bg-[var(--dex-text-tertiary)]'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
