# Review queue: filter by fix type (2026-10-02)

## Why this slice is next

Phase 1 of the Verified AI Marketing Operator directive is closed: 1A, 1B, 1D, 1E and 1F shipped, and 1C has been live since 1dd7efc. The last shipped commit, c021cd1, fixed four live-review bugs. Its design doc (`docs/superpowers/specs/2026-10-01-live-review-ux-fixes-design.md`, "Out of scope") names exactly one follow-up: a filter/group-by-type control for the review queue.

The other candidates were set aside:

- **Phase 2A (journey and IA):** design-only per the directive. It needs explicit authorization before any source edit, so it isn't an engineering slice.
- **Content Studio onto the generation queue:** the Phase 1C ADR calls this a separate future decision because it turns a synchronous spinner into a polling state machine. That is a product call, not something to pick up by default.

The filter is a real customer pain today. Production shows 132 pending review items across six action types, and since c021cd1 the only way to work through one type is scrolling and reading badges. It also leads into Phase 2D ("review by exception", batch over identical work), which will need type grouping anyway.

## Scope

- `/review` accepts `?type=<actionType>`. The server filters the pending list before rendering, so the selected detail pane always comes from the filtered set.
- A chip row above the list shows "All (n)" plus one chip per action type actually present in the pending set, each with its count. Chips are plain links: no client state, they work without JS, and the URL can be shared.
- An unknown or stale `type` (for example, the last item of that type was just approved) falls back to "All" rather than showing an empty queue.
- The chip row only renders when two or more types are pending. With one type the control does nothing useful.
- Selecting a row keeps `type`, because `ReviewQueueList.hrefFor` already preserves existing search params.

## Out of scope

- Batch approve by type. That is Phase 2D/3C and has its own boundary and preview rules.
- Preserving the filter across the approve/reject redirect from the full-page detail route (`/review/[actionId]`). That redirect returns to plain `/review`. It is a small follow-up if users ask for it.
- Filtering the "Ready to apply" section.

## Files

- `src/lib/review-queue-filter.ts` (new): pure helpers `buildTypeFilterOptions` and `resolveTypeFilter`.
- `src/components/review/review-type-filter.tsx` (new): server-renderable chip row.
- `src/app/review/page.tsx`: wire `searchParams.type`.
- Tests next to each new file.
