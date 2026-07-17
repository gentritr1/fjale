# Lexicon contract

This document defines which words FJALË accepts, which words it may publish as
answers, and which identifiers must remain stable. Dictionary breadth and answer
quality are separate concerns.

## Current baseline

- The answer catalog contains 138 metadata-bearing entries awaiting the stated
  native-review gate where applicable.
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

### Challenges

Current `SQ-*` challenge codes encode an answer's array index. Therefore the
complete 138-word sequence at commit `180be20` is frozen, not just the first 62
words. `tests/words.test.js` locks that full ordered sequence with a SHA-256
regression test. Until challenge codes use immutable answer IDs:

- do not reorder, delete, or replace an existing word;
- metadata corrections are allowed;
- append-only additions are allowed after review; and
- a rejected answer must be made ineligible by a future explicit flag, not
  removed from its published index.

The durable design assigns every answer an immutable ID. New challenge codes
encode that ID, while the decoder retains the frozen legacy index map so old
links continue to open the original word.

### Daily epochs

Changing `DAILY_POOL_SIZE` changes historical answers. It is prohibited.

`daily-v1` begins on the Tirana date `2026-07-16` and preserves the existing
62-word pool, order, and selector for every date it serves. Dates before that
remain outside the archive.

Every later daily epoch must be an append-only manifest containing:

- an immutable epoch ID;
- a future `effectiveOn` date in `Europe/Tirane`; and
- an ordered list of immutable answer IDs in publication order.

For a new epoch, day zero maps to the first ID and the index for a later Tirana
date is `dayOffset % answerIds.length`. A date resolves through the latest epoch
whose `effectiveOn` is not later than that date. Once any date in an epoch has
been served, its ID, effective date, ordered IDs, and date-to-answer mapping
never change. Expansion happens by appending another future epoch before the
old list repeats, never by resizing an old pool.

Daily play and Archive must use the same resolver. Tests must freeze all
published mappings and both sides of every epoch boundary.

## Change gate

A lexicon change may merge only when:

- all source checksums and licenses are recorded;
- normalization, five-token, uniqueness, and answer-acceptance checks pass;
- the full challenge catalog and every published daily mapping are unchanged;
- additions/removals and representative competitor probes are reviewed; and
- `npm run check` passes on the supported Node version.
