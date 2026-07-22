# Product roadmap

FJALË wins by being the most trustworthy and polished Albanian daily word
ritual. The order is correctness, editorial trust, launch quality,
discoverability, private sharing, then deeper learning.

## Priority index

Extend this list by appending; never renumber shipped tiers.

- **P0 — Ship V1 to production.** Native-speaker skim, physical-device pass,
  deploy, verify the live origin. See "Now".
- **P1 — Launch surface.** Live privacy-page verification,
  store packaging decision. See "Launch surface — store, privacy, and
  monetization".
  Discoverability baseline (2026-07-18): not indexed, ranks for nothing.
  The custom domain is live at `fjalë.com`; the repository now uses its `www`
  IDNA host as the canonical origin. Next moves: Google Search Console
  submission + sitemap, listing on the Wordles-of-the-World index, and
  backlinks from the Albanian communities that already rank (forum-al.com,
  r/Albania, Facebook groups).
- **P2 — Market wedge.** Hunspell-declared dictionary expansion, immutable
  answer IDs, daily epochs, editorial runway. See "Next".
- **P3 — Feedback loop.** Privacy-respecting report endpoint, branded address,
  changelog, recovery code. See "Feedback and portability".
- **P4 — Retention.** Only after P0–P3 evidence. See "Later".

## Completed — V1 polish round

- The post-game result is now first at every breakpoint and realigns below the
  sticky header after live completion or restored scroll.
- Evaluated keys now carry persistent non-color status marks.
- Rating focus, report wording, and singular/plural announcements are corrected.
- Canonical/social metadata, structured data, a 1200×630 share image, production
  security headers, and coherent lexicon revalidation are in place.
- Completion bookkeeping is a pure tested transition, capped at 4,000 puzzle
  IDs, and the full 138-word legacy challenge order is hash-locked.
- Immutable answer IDs and append-only daily epochs are implemented: every
  answer carries an immutable `id`, challenge codes and the daily/archive
  resolver work by ID (legacy `SQ-*` links and all historical daily words are
  byte-stable), and `DAILY_POOL_SIZE` derives from the active epoch. Growing the
  daily pool is now an append-only editorial act (add a later-dated epoch), never
  a resize. The first expansion uses that path from 2026-07-23.
- The lexicon, daily, challenge, streak, and release contracts live in this file
  and `LEXICON.md`.

## Completed in repository — launch-hygiene round (2026-07-20)

- The privacy page (`/privatesia.html`) is implemented: localStorage-only
  storage, no cookies/analytics/third-party resources, voluntary email reports,
  erase via clear-site-data. It is linked from the page footer and settings,
  and wired through every repository serving layer (dev server, Vercel,
  service worker, sitemap). It is not considered live until the next deployment
  is verified.
- Internal planning documents (ROADMAP, LEXICON, LESSONS, DESIGN, PRODUCT,
  README, editorial worksheets) are excluded from deployment via `.vercelignore`
  and guarded by a test.
- The production metadata now names `www.fjalë.com` (machine-readable IDNA
  form), and the versioned social card shows the human-readable `fjalë.com`.
- GitHub Actions CI runs `npm run check` on Node 20 and 24 for every push/PR.
- The complete published daily schedule 2026-07-16..2030-12-31 is locked by a
  golden fixture (`tests/fixtures/daily-schedule.json`); regeneration is only
  legitimate when appending an epoch, and any drift in an already-published
  date fails the suite.
- `scripts/validate-lexicon.mjs` gates `npm run check`: id/metadata/syllable
  integrity are hard errors; part-of-speech imbalance and clue stem leaks are
  standing warnings for the editorial pass.
- Invalid `?sfida=` challenge links now show a visible warning while falling
  back to the daily word, instead of failing silently.
- The report address lives in one place (`src/config.js`); switching to a
  branded address is a one-line change pending the custom-domain decision.
- The Hunspell-declared dictionary expansion from "Next" shipped earlier as
  corpus version `2-hunspell-declared-2026-07-18` (21,481 accepted guesses);
  the deterministic build lives in `scripts/build-accepted-words.mjs`. Manual
  standard overrides and regional guess-only layers remain open.
- The post-game learning row from "Later" largely shipped: the solved row shows
  the reviewed definition, example, part-of-speech/syllable metadata, and the
  digraph-aware result card. Pronunciation and translations remain open.

## Completed in repository — local editorial runway (2026-07-20)

- A production-excluded local studio now runs at `/admin`: reviewer identity,
  76-word queue, progress/attention filters, keyboard and touch shortcuts,
  metadata correction, four explicit outcomes, reasons, notes, undo, and JSON
  export. Word and answer ID remain immutable.
- Valid drafts and decisions autosave atomically to separate reviewer files;
  browser backups survive a missing disk file, and an invalid local draft does
  not block later valid saves. Revision tokens prevent stale tabs from erasing
  newer work, and reviewer-session guards keep in-flight saves isolated. The
  server is loopback-only with a fixed file allowlist, strict schema/hash
  checks, and no production route.
- Two complete independent reviews reconcile into a hash-pinned decisions file.
  Agreements can promote an answer; metadata disagreements, revision requests,
  and conflicting outcomes stop automatic promotion. The browser sees only
  aggregate coverage; per-word verdicts remain private until the CLI step.
- Future daily epochs use explicit frozen `answerIds`. The proposal command
  emits the approved/excluded IDs, a 90-day preview, and a fixture-backed proof;
  it refuses starts on or before the already-published Tirana date. It never
  edits `src/words.js`, `DAILY_EPOCHS`, or the fixture automatically.

## Completed — first reviewed pool expansion (2026-07-22)

- Reviewer `neki` completed all 76 frozen candidates. The owner explicitly
  approved a one-time, hash-pinned single-reviewer exception for this batch;
  every future batch still requires two independent Albanian reviewers.
- All 76 candidates were approved. Four reviewer-selected metadata edits were
  applied to `balta`, `bishti`, `brumë`, and `lajthi`; word IDs and spellings
  remain immutable.
- The versioned proposal proved all seven served dates unchanged. A second
  epoch starts on 2026-07-23 with a frozen list of IDs 0–137, expanding the
  daily pool from 62 to 138 without changing the launch epoch.

## Now — verify the expanded beta

The launch pool remains 62 words through 2026-07-22; the scheduled pool is 138
from 2026-07-23. Close the release with public-origin and physical-device
checks, then build the next unpublished buffer under the normal two-reviewer
rule.

- Improve verb/adjective/adverb representation: 125 of 138 answers are nouns
  (see validator warnings); prioritize non-nouns in the next candidate batch.
- Run the remaining physical-device gate: iPhone Safari, Android Chrome/Firefox,
  and one WhatsApp share paste.
- Begin collecting missing-word emails manually; do not infer aggregate demand
  from device-local ratings.

This is a scope freeze. Do not add modes, accounts, multiplayer, pronunciation,
or a backend to the V1 polish round.

## Next — establish the market wedge

### Dictionary breadth

- **Done:** `sq_AL.dic` + `sq_AL.aff` are vendored and checksum-pinned;
  Hunspell-declared forms expand deterministically (corpus version
  `2-hunspell-declared-2026-07-18`) with a reviewed probe set including
  `shokun` and `gjyshja`.
- Keep manual standard overrides and reviewed regional guess-only forms in
  separate layers.
- Add a reviewed maximum-diff guard for future corpus regenerations.
- Do not call this work “full paradigms”; gaps require additional reviewed
  sources. The underlying dictionary (v1.6.4) is old — a reviewed manual
  override and regional-word workflow will eventually be needed.

### Editorial runway and stable identity

- Keep the complete 138-word challenge hash green while legacy codes exist.
- Immutable answer IDs and legacy challenge-link preservation: **implemented**
  (see "Completed"). Reordering `ANSWERS` stays forbidden while legacy pre-ID
  clients persist raw indices.
- Append-only daily epochs: **implemented and exercised**. The 2026-07-23 epoch
  expands the pool from 62 to 138 through a frozen list of approved answer IDs;
  later growth uses the same append-only path and never resizes an old epoch.
- Grow to at least 365 two-reviewer daily answers with a maintained 90-day
  unpublished buffer, publishing pool growth through a new epoch.
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

## Competitive position (researched 2026-07-20)

Field: fjalth.com (single-tile digraphs, dictionary definitions, any-date
archive, hard mode, statistics transfer, Google Analytics); Fjalëz Rreshti at
fjalez.com (all 36 Albanian keys, five- and six-letter rounds, accounts and
server-backed history); wordle.global/sq (large multilingual, multi-mode
platform whose Albanian page still uses generic English examples and has no
dedicated digraph keys); Fjalëza at fjaleza.com (custom domain, indexed daily
archive, sequential digraph parsing but no dedicated digraph keyboard); and the
legacy Fjalëz/metinferati game (long history, split digraphs, dated UI). Mobile
competitors add store distribution, accounts, coins or leaderboards. The
original luaj.live is dead.

FJALË's defensible moat is no longer digraph handling by itself. It is the
combination of first-class Albanian tokenization, human-reviewed answers with a
two-reviewer standard for future batches, definitions/syllables/examples,
symbol-backed accessibility, true no-analytics privacy, reliable offline play,
and the daily/archive/practice/Besa ritual.

Known weaknesses to close, in wedge order: daily history remains young even
with 138 scheduled answers (P2 epochs), stats die with localStorage (P3 recovery code;
fjalth ships stats transfer), no store shelf presence (P1), asynchronous-only
social (P4). Brand hazard: "FJALË" as a search term is owned by the fjale.al
dictionary — the custom-domain decision must weigh a distinctive name.

## Launch surface — store, privacy, and monetization

The only V1 launch surface is the web PWA on the canonical origin. Everything
below extends that surface without reopening the V1 scope freeze.

### Privacy (required before any store listing or marketing)

- Today the app stores everything in browser localStorage, sets no cookies,
  loads no third-party resources (CSP is `'self'` plus one JSON-LD hash), and
  has no analytics. Reports leave the device only when the player sends the
  pre-filled email.
- **Done (2026-07-20):** `/privatesia.html` states exactly that: what is stored
  locally, that nothing is transmitted, that email reports are voluntary and
  include only what the player sees, and how to erase data (clear site data).
  Linked from the settings dialog and the page footer.
- No consent banner is needed while there is no tracking. The moment any
  analytics, ads, or collection endpoint is added, GDPR/ePrivacy consent and
  the privacy page must ship in the same release — never after.

### Monetization stance

- V1 ships ad-free; "Not planned" below still bans coins, purchasable hints,
  and ad-driven mechanics. Revisiting monetization is a product decision that
  must be made explicitly, not slipped into a feature round.
- If web ads are ever considered: every ad network breaks the current strict
  CSP (`script-src 'self'` + one hash) and requires a consent management
  platform. That is a real engineering and trust cost; price it before saying
  yes.
- Recorded constraint from sibling projects: AdMob is not available for
  Kosovo-targeted apps. Since Kosovo is a core audience, any future Android
  ad plan must verify network availability for the region first, at project
  start, not mid-flight.
- The trust-preserving alternatives, in order: nothing (grow first), a
  donation/support link, then a cosmetic-only supporter tier. All three keep
  the CSP and the privacy page unchanged.

### App-store packaging (P1, after the live origin is verified)

- Google Play: package the deployed PWA as a Trusted Web Activity
  (Bubblewrap). Needs the privacy-page URL, the Play Data safety form (answers
  follow from the privacy page: no data collected or shared), a content
  rating questionnaire, Digital Asset Links on the origin, a 512px icon and
  feature graphic, and a one-time developer account.
- iOS: no TWA equivalent. A thin WebView wrapper risks App Store guideline
  4.2 rejection; rely on Safari PWA install until native demand is proven
  (matches "Later").
- The store listing must never promise features the web app does not have.

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
- Every change to a precached runtime file advances `CACHE_NAME`; the CI
  cache-version guard must pass before publication.
