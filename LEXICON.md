# Lexicon contract

This document defines which words FJALË accepts, which words it may publish as
answers, and which identifiers must remain stable. Dictionary breadth and answer
quality are separate concerns.

## Current baseline

- The answer catalog contains 138 metadata-bearing entries awaiting the stated
  native-review gate where applicable. Every entry carries an immutable `id`
  (`0`–`137`, currently equal to its array position); see "Published identity is
  immutable".
- The published daily v1 pool is the first 62 entries, in its existing order.
- The final accepted-guess set contains 21,481 entries (corpus version
  `2-hunspell-declared-2026-07-18`): the 14,255 five-token roots from the
  vendored `sq_AL.dic`, plus the Hunspell-declared affix forms from the paired
  `sq_AL.aff` that tokenize to exactly five Albanian letters, unioned with every
  answer and deduplicated. Every published answer is already a declared form, so
  the union adds none.
- Hunspell affix expansion is implemented. `sq_AL.aff` is vendored and
  checksum-pinned beside `sq_AL.dic`, both taken from the same upstream commit.
  The generator expands the SFX and PFX rules the affix file declares, including
  declared prefix×suffix cross-products, honouring each rule's strip/add/
  condition. This is **Hunspell-declared form expansion, not full paradigms**:
  gaps in the upstream affix tables remain gaps here, and closing them requires
  additional reviewed sources.

## Lexicon layers

| Layer | Purpose | May be a shared daily answer? | Required review |
|---|---|---:|---|
| Answer catalog | Words with clue, definition, example, syllables, part of speech, and region | Only when explicitly scheduled | Two independent fluent-Albanian reviewers |
| Generated standard guesses | Standard forms declared by pinned Hunspell sources | No | Reproducible source/build review and regression probes |
| Manual standard overrides | Documented additions or exclusions that correct source gaps | No, unless separately promoted through answer review | Proposer plus independent approver |
| Reviewed regional guesses | Labeled Gheg or other regional forms with a standard equivalent | No | Two reviewers, including one fluent in that variety |

Keep these layers separate in source control. A report, rating, corpus hit, or
Hunspell entry is evidence for acceptance; none promotes a word into the answer
catalog automatically. Manual exclusions override generated guesses. An answer
must always remain accepted, so the build must fail if an exclusion conflicts
with an answer.

Future regional answer packs require their own labeled, reviewed schedules. A
regional guess accepted in the standard game remains guess-only.

## Word invariant

Every stored answer and accepted guess must:

1. be normalized to Unicode NFC and Albanian lowercase;
2. contain only letters from the 36-letter Albanian alphabet;
3. tokenize to exactly five Albanian letters, with `dh`, `gj`, `ll`, `nj`,
   `rr`, `sh`, `th`, `xh`, and `zh` treated atomically; and
4. contain no spaces, punctuation, digits, or combining-form duplicates.

The production tokenizer is the authority. Source generators and tests must use
the same behavior rather than a character-count approximation.

## Source and build provenance

Lexicon generation is offline and deterministic. It must never download a
mutable dictionary during a build.

- Vendor every upstream input under `third_party/`.
- Record its work, version, upstream URL or commit, license, local path, and
  SHA-256 in `THIRD_PARTY_NOTICES.md` and the source directory README.
- Verify each pinned checksum in tests.
- Before using Hunspell rules, vendor the matching `sq_AL.aff` beside
  `sq_AL.dic` and pin both checksums.
- Treat `.aff` expansion as **Hunspell-declared form expansion**, not proof of
  complete Albanian morphology.
- Generate normalized, deduplicated output in a stable order. Review the added
  and removed counts, probe failures, and output checksum before merging.
- Give every accepted-guess release an explicit corpus version. A deployed app,
  service worker, and generated lexicon must not disagree about that version.

## Editorial policy

An answer review covers the word, commonness and fairness, standard/regional
status, part of speech, syllables, clue, definition, and example. Reviewers must
also check that the entry is not needlessly obscure or ambiguous for a shared
daily puzzle. Disagreement blocks publication; it is not resolved by majority
guessing or generated text.

Generated definitions, examples, pronunciations, and regional labels are never
published without human review. Reports are triaged in batches, with source,
decision, reviewer, and date recorded for every manual override.

## Published identity is immutable

### Immutable answer IDs (implemented)

Every entry in `ANSWERS` carries an immutable `id`. IDs are **append-only**: a
new entry takes the next integer and an ID is never reused or reassigned, so any
ID stored in a challenge link or a saved game always resolves to the same word.
`getAnswerById(id)` is the lookup callers use instead of an array index. Today,
before any reordering, an entry's `id` equals its array position — that identity
is the bridge for legacy pre-ID clients that persisted the raw index as
`answerIndex`. `tests/words.test.js` pins the id→word binding with a SHA-256 that
is independent of array order, so it would survive a future reordering even
though reordering stays forbidden while those legacy clients exist.

### Challenges (implemented)

`SQ-*` challenge codes now encode an immutable answer **ID**. The wire format is
unchanged — `SQ-` prefix, `id * 37 + 911`, base36 uppercase — and because IDs
currently equal array positions, every code shared in the wild still decodes to
its original word. `decodeChallengeCode` returns an ID and callers resolve it
through `getAnswerById`, not an array position. The complete 138-word sequence
and the id→word binding are both locked by SHA-256 regression tests. Standing
rules for the catalog:

- do not reorder, delete, or replace an existing word;
- metadata corrections are allowed;
- append-only additions are allowed after review; and
- a rejected answer must be made ineligible by a future explicit flag, not
  removed from its published index.

### Daily epochs (implemented)

Resizing a live daily pool changes historical answers, so it is prohibited.
`DAILY_POOL_SIZE` in `src/app.js` is no longer an independent constant: it is
derived from the active entry in `DAILY_EPOCHS`, giving the pool size a single
source of truth that cannot drift from the rotation math.

`DAILY_EPOCHS` in `src/game.js` is a frozen, append-only table. Each epoch is
`{ start, poolSize, stepBase, offset }`, where `start` is a `Europe/Tirane`
date. `getDailyAnswerIndex(date)` selects the last epoch whose `start` is on or
before the Tirana date key and applies that epoch's rotation over the leading
`poolSize`-word prefix of `ANSWERS` (the same coprime-step selector the game has
always used, parameterised per epoch). The returned pool index doubles as an
immutable answer ID because IDs equal their prefix position.

The launch epoch `{ "2026-07-16", 62, 37, 911 }` reproduces the previous
selector for every date, so no historical daily word or challenge link shifts.
Dates before the first epoch clamp to it; the archive UI already gates out dates
earlier than the first published daily.

Growing the daily pool happens **only** by appending a later-dated epoch with a
larger `poolSize` — an editorial act taken after native review, never by editing
an existing epoch or resizing an old pool. Existing epochs are frozen: once any
date in an epoch has been served, its parameters and every date-to-answer
mapping it produces never change. Appending a future epoch cannot rewrite an
earlier epoch's history (`tests/game.test.js` proves this against a synthetic
138-word epoch).

Daily play and Archive use the same resolver. Tests freeze published mappings
across the pinned date span, the epoch table's contents, and epoch-append
safety.

## Change gate

A lexicon change may merge only when:

- all source checksums and licenses are recorded;
- normalization, five-token, uniqueness, and answer-acceptance checks pass;
- the full challenge catalog and every published daily mapping are unchanged;
- additions/removals and representative competitor probes are reviewed; and
- `npm run check` passes on the supported Node version.
