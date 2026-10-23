// Dashboard IA rebuild (2026-10-16 spec, commit 7c16a5e): this is the one place that decides
// Overview's block count and order. page.tsx maps over this array to render Overview, so a
// test on this constant is a real enforcement of "at most 5 blocks, in this order" — not a
// decorative aside that could silently drift from what the page actually renders.
export const OVERVIEW_BLOCKS = ['today', 'fixes-for-your-site', 'competitors-and-ideas', 'ask-dex'] as const;
export type OverviewBlockId = (typeof OVERVIEW_BLOCKS)[number];
