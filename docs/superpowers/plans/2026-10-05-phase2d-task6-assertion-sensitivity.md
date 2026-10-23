# Phase 2D Task 6 assertion-sensitivity check

Task 6 requires two independent assertion inversions in scratch. This note names the targets; it does not record an acceptance run.

| Target | Invert only this assertion | Expected failing signal |
| --- | --- | --- |
| Scope: `src/lib/decision-inbox.test.ts`, `rejects a foreign website without loading any rows` | Change the expected rejection status from `404` to `200`. | The focused test fails because the foreign website is rejected with `404`. |
| Replay: `src/lib/action-batch.test.ts`, `writes one receipt per item and a batch event, then replays without provider or callbacks` | Change the first `expect(listPagePerformance).toHaveBeenCalledTimes(1)` after the replay to expect `2`. | The focused test fails because replay makes no second provider call. |

Run each inversion separately in a disposable scratch copy of the reviewed commit. Record the commit and file hash before mutation, the exact command and failing assertion, then restore the single edited assertion and rerun the focused test. Compare the restored file hash with the original and confirm a clean diff against the reviewed commit. Do not run either inversion in a dirty implementation worktree or treat these mocked tests as database race evidence.

Suggested focused commands after each mutation and restore:

```sh
npx vitest run src/lib/decision-inbox.test.ts -t 'rejects a foreign website without loading any rows'
npx vitest run src/lib/action-batch.test.ts -t 'writes one receipt per item and a batch event, then replays without provider or callbacks'
```

Task 6 remains open after this check. It still needs the full suite, typecheck, authorized production build, approved disposable PostgreSQL races and rollback, authenticated browser/device acceptance, independent review, and Release Observatory sign-off under the approved plan.
