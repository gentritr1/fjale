# Product roadmap

FJALË wins by being the most trustworthy and polished Albanian daily word
ritual. The order is correctness, editorial trust, launch quality,
discoverability, private sharing, then deeper learning.

## Completed — V1 polish round

- The post-game result is now first at every breakpoint and realigns below the
  sticky header after live completion or restored scroll.
- Evaluated keys now carry persistent non-color status marks.
- Rating focus, report wording, and singular/plural announcements are corrected.
- Canonical/social metadata, structured data, a 1200×630 share image, production
  security headers, and coherent lexicon revalidation are in place.
- Completion bookkeeping is a pure tested transition, capped at 4,000 puzzle
  IDs, and the full 138-word legacy challenge order is hash-locked.
- The lexicon, daily, challenge, streak, and release contracts live in this file
  and `LEXICON.md`.

## Now — release the polished V1 beta

- Complete the native-speaker skim of the 76 appended answers and metadata.
  Corrections may edit metadata, but answer removal or reordering waits for
  immutable IDs.
- Run the remaining physical-device gate: iPhone Safari, Android Chrome/Firefox,
  and one WhatsApp share paste.
- Commit and deploy the verified round, then check the canonical origin, social
  card, cache behavior, and security headers on the live URL.
- Begin collecting missing-word emails manually; do not infer aggregate demand
  from device-local ratings.

This is a scope freeze. Do not add modes, accounts, multiplayer, pronunciation,
or a backend to the V1 polish round.

## Next — establish the market wedge

### Dictionary breadth

- Vendor and checksum the matching `sq_AL.aff`.
- Deterministically expand Hunspell-declared forms and add a reviewed probe set,
  including `shokun` and `gjyshja`.
- Keep manual standard overrides and reviewed regional guess-only forms in
  separate layers.
- Add corpus versioning and a reviewed maximum-diff guard.
- Do not call this work “full paradigms”; gaps require additional reviewed
  sources.

### Editorial runway and stable identity

- Keep the complete 138-word challenge hash green while legacy codes exist.
- Assign immutable answer IDs and preserve legacy challenge links.
- Implement append-only daily epochs before expanding the 62-word daily pool.
- Grow to at least 365 two-reviewer daily answers with a maintained 90-day
  unpublished buffer.
- Keep accepted guesses broad and daily answers common, fair, and
  human-reviewed.

### Feedback and portability

- Add a privacy-respecting submission endpoint and a branded report address.
- Publish a small reviewed “words added” changelog.
- Add an optional recovery/transfer code before requiring any account.

## Later — deepen retention after evidence

- Turn the solved row into “Fjala pas fjalës”: reviewed definition, example,
  syllables, highlighted digraph, and optional translation.
- Add native-reviewed pronunciation and a saved-word collection.
- Add invite-only family/friend circles with spoiler protection and no forced
  account.
- Add restrained signature motion for digraph formation, new Passport letters,
  and earned Besa wins, with reduced-motion equivalents.
- Consider clearly labeled regional answer packs, classroom groups, and one
  Albanian-native semantic puzzle only after the daily game retains users.
- Build native apps or real-time multiplayer only after PWA and private-circle
  demand demonstrate the need.

Not planned: coins, gems, ads, purchasable hints, streak freezes, public global
leaderboards, forced accounts, unreviewed AI language content, or a collection
of generic Wordle modes.

## V1 streak decision

The V1 streak is strict and daily-only:

- a daily win on consecutive Tirana dates extends it;
- a loss or missed Tirana day resets it;
- Archive, Practice, and Challenge never change it; and
- there are no freezes, grace days, currencies, or restoration purchases.

Revisit this only if retention data shows missed-day churn. The first experiment
would be one automatic, non-purchasable grace day, never a game currency.

## Current feedback limitations

Word ratings and clicked missing-word reports are stored in local browser data.
They are not aggregated. A report reaches the team only when the player sends
the pre-filled email opened by the report link. Consequently, the current build
cannot support claims about overall fairness, missing-word frequency, or rating
distribution.

Before broad marketing, any collection endpoint must document purpose, fields,
retention, and deletion behavior, collect only what is needed, and degrade
cleanly when blocked or offline.

## Release gate

Every production round must satisfy the relevant checks below. A report from an
agent is not a substitute for observing the flow.

### Correctness and persistence

- `npm run check` passes on Node 24 and the supported minimum Node version.
- Old profiles migrate without losing legacy totals or preferences.
- A puzzle result cannot count twice across reloads or concurrent tabs.
- Daily, Archive, Practice, and Challenge update only their intended state.
- Archive never changes the streak; daily epochs never rewrite history.
- Challenge links retain the original answer across catalog releases.

### Browser and accessibility

- No horizontal overflow at 320px or 390px, including dialogs and calendar.
- Tirana countdown is observed crossing midnight on a fake clock.
- iPhone Safari, Android Chrome/Firefox, and an in-app browser complete a game.
- A WhatsApp paste test preserves branding and spoiler-safe output.
- Physical keyboard, visible focus, screen-reader announcements, high contrast,
  dark mode, reduced motion, safe areas, and offline PWA behavior work.
- The browser console is clean through daily, archive, practice, challenge, and
  migration flows.

### Content and publication

- Every answer and guess satisfies `LEXICON.md`.
- Native review and provenance are recorded; no unreviewed word is scheduled.
- The full catalog, published daily mappings, and first/last date of each epoch
  are covered by regression tests.
- Canonical URL, social preview, sitemap/structured metadata, cache behavior,
  and production security headers are verified on the deployed origin.
