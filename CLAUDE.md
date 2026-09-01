# Project instructions

## benchmark/

Never run, execute, or invoke anything in `benchmark/` (its CLI, scripts, tests, or any
ad-hoc script that talks to it) unless the user explicitly asks for it in that conversation.
Do not proactively run it as part of validating an unrelated change, "just to check," or as
part of routine testing. Treat it as out of scope by default — skip past it in searches and
task planning unless the user's request is specifically about it.

## Save compatibility

Whenever a change adds or restructures a field on `CareerState` (or anything nested under it —
`Player`, `Club`, `Season`, etc.) that an OLDER saved game won't have, that change is not done
until existing saves keep working with the new feature. Never ship a feature that silently only
works for brand-new careers while old saves either break, get stuck on old behavior forever, or
require the player to abandon their save and start over.

Concretely, when you add such a field:

- Make it optional on the type (`field?: T`) if code elsewhere needs to distinguish "never
  existed on this save" from "exists and is legitimately empty/zero" (e.g. `Club.academySquad`
  uses `undefined` for that signal, not `[]`).
- Add a migration/backfill step in `src/worker/engine.worker.ts`'s `case 'setCareer'` handler —
  this is the single choke point every save (Dexie load, JSON import, cloud load) passes through
  before becoming the active `career`. Follow the existing inline comment block there (one
  `// Saves de antes de X não têm Y — completa com Z.` comment per past migration) and add your
  own alongside it, explaining what old saves lack and what the backfilled value/behavior is.
- Prefer deriving the missing data the same way it's generated for a fresh career (reusing the
  same generator function with the save's existing `seed`/current values) over inventing a
  different, one-off default — see how `academySquad` backfill calls the same
  `generateAcademyIntake` that `world.ts` uses for brand-new careers, just anchored to the save's
  current `season.year` instead of the initial one.
- Run `validateCareerState` mentally (or actually) against the migrated shape — the handler
  already throws if the result is invalid, which is the right backstop, but the migration itself
  should produce a genuinely valid, playable state, not just something that passes validation.
- Verify it by actually loading an old-shaped save (strip the new field from a saved record,
  reload, load that save) rather than only testing brand-new careers — a feature that works on
  `Nova Carreira` but was never checked against a save from before the change is not verified.
