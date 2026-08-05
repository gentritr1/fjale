# PLAN — Rrethi, Sfida, Lëvizje (2026-08)

Plan for the next FJALË round: private circles, three Albanian-specific
challenges, a motion/badge layer. The original audit was written against commit
`a7a6bc1`; the implementation status below was refreshed on 2026-08-03 from the
retention branch.

**Copy warning:** every Albanian string here is **UNVERIFIED — pending native
review**. None of it is final feature copy.

## 0. Gjendja pas rishikimit

| Area | State on this branch | Ship decision |
|---|---|---|
| Reward logic, badge thresholds, migrations | implemented + tested | keep behind `REWARDS_ENABLED` until native copy/device review |
| Vulat UI, restrained win choreography, digraph motion | implemented + 320/375/390px, landscape, desktop reviewed | keep; use one-column badge rows on phones |
| Shenja local avatar picker | implemented + 24 optimized assets, badge unlocks, 36 seals, 320/390px and desktop reviewed | keep behind `REWARDS_ENABLED`; reuse for Rrethi join |
| Streak grace | implemented + explicitly flag-gated | recommended ON with the reward experiment, never silently before it |
| Rrethi storage M0 | memory + Neon adapters implemented; memory suite passes | keep dormant; tune the free provider later |
| Rrethi data endpoints, identity, 10-seat circle UI | not built; local avatar identity is ready | after stable launch only; `/api/health` is operational only and stores no user data |
| Missing-letter practice, Nëntë Vulat, narrow mode | planned, not built | build in that order; all reuse reviewed words |

**The retention cut:** ship fewer loops, each with a clear job. Vulat makes wins
feel cumulative; `Vula që të mungon` turns the passport into the best next
action; `Nëntë Vulat` creates a weekly Albanian-specific appointment; Rrethi
adds private social accountability after launch. Do not add a public global
leaderboard, coins, shops, notification pressure, or a generic collection of
timed modes.

**Market check (2026-08-03):** Fjalëza already offers an archive, definitions,
and correct digraph counting ([fjaleza.com](https://fjaleza.com/)); Fjalth has
dedicated Albanian digraph keys ([fjalth.com](https://www.fjalth.com/)); and a
newer Albanian word app already markets a global leaderboard
([Google Play](https://play.google.com/store/apps/details?id=com.blocify.lojefjalesh)),
while [fjalez.al](https://fjalez.al/) already covers generic 5/6/7-letter modes.
The defensible claim is therefore not “we support digraphs.” It is **progress
built around the 36-letter alphabet and nine digraphs, plus spoiler-safe private
circles**.

**Doc hygiene:** resolved. The plan and `design-concepts/` are excluded by
`.vercelignore` and guarded by the launch tests.

---

## 1. Përmbledhje

| # | Deliverable | When | Editorial cost | Backend |
|---|---|---|---|---|
| 1 | Motion refinements + badges ("Vulat") | pre-launch, flag OFF | none | none |
| 2 | Three new challenges (zero new words) | pre-launch, flag OFF | none | none |
| 3 | Rrethi — private circles + circle board | after stable launch | none | yes |

The order is forced by the roadmap: the launch blocker is human editorial review
of the answer pool, and `ROADMAP.md:127` freezes V1 scope against "modes,
accounts, multiplayer, pronunciation, or a backend". Items 1–2 cost **zero
editorial capacity** — they are selections and presentation over the 138 words
already reviewed — so they can be built behind flags now without competing for
the scarce resource. Item 3 is the only backend and must not ship before launch.

**The multiplayer answer.** Public leaderboards and stranger matchmaking stay
banned (`ROADMAP.md:179-181`). The compliant form is **Rrethi** — invite-link
private circles of family and friends, async play on the same daily word, a
circle-scoped board hidden until each member finishes, no accounts. This is
already the roadmap's own Phase-3 item (`ROADMAP.md:171`), so no amendment is
needed; WhatsApp/Viber invite links match how AL/KS groups already work, and the
existing `SQ-*` challenge share (`src/app.js:2090`) is the template. Anything
beyond it — public boards, global ranks, real-time duels, stranger matchmaking —
**requires a roadmap amendment plus explicit user sign-off** and is not planned
here.

**Cost.** ~3 weeks for items 1–2 (front-end only, no new data files); ~4–5 weeks
for Rrethi including adapter, one concrete DB, and the privacy rewrite. Zero
editorial. Target €0/month infrastructure. The real price is trust: Rrethi is the
first time player data leaves the device, changing the story from "nothing is
transmitted" to "this minimal circle profile and result summary are". The
privacy page must change **in the same release** (`ROADMAP.md:224`).

**Decisions used for this branch.** §5.3 records the recommended defaults rather
than leaving the implementation ambiguous. Rewards and grace stay behind the
same OFF-by-default flag; Rrethi stays post-launch; Neon is only a provisional
free-tier adapter. Native Albanian copy review and a physical-device feel pass
are the remaining activation gates.

**Two defects found and resolved on this branch.**

1. **Confetti fires on every win.** `finishGame()` calls `showCelebration()`
   unconditionally for any win in any mode (`src/app.js:1046-1047`). The
   anti-casino stance and DESIGN.md's "celebration that appears only after earned
   actions" describe a no-recurring-confetti rule the shipped code does not
   implement. §4.4 now gates it to milestones while rewards are enabled.
2. **`besaWins` counts every mode.** That legacy overall statistic remains intact,
   but Passport progress now reads the isolated `besaDailyWins` counter. Practice,
   Archive, and Challenge therefore cannot earn the Besa Passport badge.

---

## 2. Rrethi — private circles + leaderboard

### 2.1 UX flow

**Krijo rreth** (stats sheet → new "Rrethi" section; display name 2–20 chars +
circle name + one circle-seal avatar, no email, no password) → **Ftesa**: the app builds
`https://www.xn--fjal-opa.com/?rrethi=RR-XXXX-XXXX-XXXXX` and hands it to
`navigator.share` (already implemented as `shareOrCopy`, `src/app.js:2103`) so
WhatsApp/Viber get a native sheet, with copy fallback on desktop → **Bashkohu**:
the link shows a join card (circle name, member count, name field) and, on
joining, the recovery code **once**, with a copy button and an explicit save
warning → **Loja**: nothing about the daily game changes — same word, six
attempts, same board; on completion the result is queued and sent → **Tabela**: a
member who has finished sees everyone's attempts for today; a member who has not
sees only *who* is done, never how well.

Copy, all UNVERIFIED: section `Rrethi` · empty `Ende pa rreth. Krijo një dhe fto
familjen.` · `Krijo rreth` / `Bashkohu` · invite `Të pres në rrethin tim në
FJALË. E njëjta fjalë çdo ditë.` · pre-finish rows `Ka mbaruar` / `Ende po luan`
· post-finish `{name} · {n} prova` · recovery `Ky është kodi yt i rikthimit. Pa
të, rrethi humbet nëse ndërron telefon.`

#### 2.1.1 Dhjetë vende + Shenjat e Rrethit

One circle has **at most 10 members**. The join card previews the occupied seats
in a 2×5 lobby, then asks for a display name and avatar. Ten is intentionally
smaller than a generic community leaderboard: every person remains recognisable,
the complete group fits on one phone screen, and the cap is a hard free-tier and
abuse boundary rather than a setting.

Avatars are **Shenjat e Rrethit**, not profile photos or flag/folklore stickers.
The selected free join cast is the 12-character sheet at
`design-concepts/rrethi-avatar-flash-variety-v6.png`: racing-car driver,
rebellious asymmetric hair, two-tone dyed hair, skater, tinkerer, music fan,
wheelchair user, older player, reader, runner, creator, and hoodie character.
All 12 pass the 48px recognition check and are available immediately; a new
member is never forced into a generic silhouette or a reward grind just to look
distinct. Their stable catalog ids, in sheet order, are `stick-racer`,
`stick-rebel`, `stick-dyed`, `stick-skater`, `stick-tinkerer`, `stick-music`,
`stick-wheelchair`, `stick-elder`, `stick-reader`, `stick-runner`,
`stick-creator`, and `stick-hoodie`; art can improve later without changing a
member's stored identity.

At join, the player combines one free character with any of the 36 Albanian
letter seals. Every letter is free. That gives 432 day-one combinations while
keeping the runtime local, fast, consistent, and free of prompt abuse. The
local selection is now implemented in the existing passport dialog's `Shenja`
tab and persisted as validated `profile.avatarId` + `profile.letterSeal` values.
The 24 reviewed 160px WebP assets total about 180 KB under `/avatars/`; the fixed
catalog and unlock mapping live in `src/avatars.js`. M1 sends the same two values
as `avatar_id` and `letter_seal`; the dormant M0 server storage stays unchanged
until Rrethi is activated.

The bold cel-animation animal sheet at
`design-concepts/rrethi-avatar-cel-v4.png` is the selected earned set. Its 12
animals unlock one-for-one through the existing 11 local badges plus the future
server-derived Rrethi badge:

| Earned avatar | Stable `avatar_id` | Unlock condition | Badge id |
|---|---|---|---|
| Owl | `animal-owl` | first daily win | `daily-win-1` |
| Fox | `animal-fox` | daily win on the first attempt | `daily-attempt-1` |
| Hare | `animal-hare` | daily win on the sixth attempt | `daily-attempt-6` |
| Bear | `animal-bear` | 10 daily wins in three attempts or fewer | `daily-fast-10` |
| Mountain goat | `animal-goat` | a 7-day daily streak | `streak-7` |
| Cat | `animal-cat` | a 30-day daily streak | `streak-30` |
| Tortoise | `animal-tortoise` | 100 daily puzzles played | `daily-played-100` |
| Songbird | `animal-songbird` | 25 daily wins | `daily-win-25` |
| Hedgehog | `animal-hedgehog` | all 9 digraphs collected | `digraphs-9` |
| Moth | `animal-moth` | all 36 letters collected | `letters-36` |
| Frog | `animal-frog` | 3 daily Besa wins | `daily-besa-3` |
| Badger | `animal-badger` | finish the daily on 7 days as a circle member | `rrethi-days-7` *(future)* |

This is a visible, deterministic unlock path: no coins, random boxes, expiry,
paywall, or duplicate prizes. A locked animal shows its exact badge name and
progress; earning the badge reveals it once, after which it stays available
forever. The other studies remain references rather than selectable styles:
animal seal `v1`, animated clay `v2`, layered cut-paper `v3`, and the first
stick-character pass `v5`. Keeping only `v6` and `v4` in the picker avoids a
mixed-style gallery.

The unlock is cosmetic and based on progress already stored by the game. The
client sends only a stable catalog id, never badge history or an arbitrary image
URL; the future Rrethi server validates the id against the catalog. It does not
need to police a locally altered cosmetic unlock, which avoids transmitting more
personal play history for no security benefit.

Do **not** generate an avatar live during the join flow. OpenAI's current image
guide notes that complex generations can take up to two minutes and recurring
character consistency can vary; a network wait here would damage the first
social moment. A later opt-in creator may use only pre-approved visual chips,
server-side generation, default moderation, and a cached asset. It may not accept
selfies or free-form public prompts without a separate privacy and abuse review.

Motion answers state: choosing a character gives it one 180ms tilt-and-settle;
an empty seat receives the chosen seal with the same restrained press-and-settle;
a newly unlocked animal turns once in 240ms; a completed player gains a quiet
progress ring; and the last player completing closes the group ring. No avatar
loops while the player is reading or solving. Reduced motion renders the same
final states immediately. Two earned easter eggs are allowed: all nine digraph
letter seals in one circle unlock `Nëntë Shenjat`, and all 10 members finishing
on the same day unlock one shared `Rrethi u mbyll` seal. Neither runs as an idle
loop.

### 2.2 Identity — one secret, three faces

No accounts. On first Rrethi use the client generates a 128-bit secret with
`crypto.getRandomValues`, stored at `fjale:identity:v1`, used as: a localStorage
token; the bearer credential (`Authorization: Bearer <secret>`); and the
**recovery code**. The code must preserve all 128 random bits: 26 Crockford
base32 characters plus one checksum character, grouped for copying as
`RKTH-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX-C`. The fixed prefix is only a label and
adds no entropy. The server stores **only**
`HMAC-SHA-256(server_pepper, secret)` as `member_key`, so a lost secret is
unrecoverable by us — the point being that we cannot enumerate, re-identify, or
restore anyone. Recovery is pasting the code on a new device; the checksum is
validated locally so a typo costs no round-trip. The raw secret never appears in
a URL, log line, analytics event, or error. The display name is per-player,
circle-visible, editable, and not part of identity.

### 2.3 What the board ranks, and why

**Daily order: attempts ascending, losses last, ties share a rank.** It is the
only quantity the game already produces honestly (`getAttemptCount`,
`src/game.js:651`), it is what the share text already shows, and it needs no new
state. Hint use already costs an attempt, so the hint economy is priced in
without a second penalty.

**Time is stored but OFF by default.** `elapsedSeconds()` exists
(`src/app.js:2093`), but a timed daily board turns a five-minute coffee break
into a race and contradicts the product register. Ship it behind a per-circle
toggle the creator can enable; never the primary sort.

**Weekly points ("Pikët e javës")** — Monday–Sunday, Europe/Tirane. Win in 1–6 =
6/5/4/3/2/1; loss or unplayed = 0; **+1** for a Besa win with no hint. Max 7/day,
49/week. It is exactly the attempt distribution the game already renders, it
makes the Besa meta — our signature, which no competitor has — worth one real
point, and it never goes negative, so a bad day cannot feel punitive. This is the
recommended formula selected for the later Rrethi beta; it can be tuned after
observing one family circle rather than exposing a setting now.

**Streaks are shown, never ranked.** Each row shows the member's own streak as a
quiet honey number. Ranking by streak makes a single missed day socially visible
— precisely the churn driver market research names.

### 2.4 Spoiler safety

Enforced **server-side in the query**, never by client-side hiding:

```
GET /api/rrethi/circles/:code/board?date=YYYY-MM-DD
  if requester has no stored result for :date AND :date is today (Tirana):
      rows -> { display_name, finished: bool }        // numeric key omitted
  else:
      rows -> { display_name, attempts, besa, hint, points, streak }
```

Two testable consequences: the masked payload must **omit** the numeric key (not
send `null` or `0`), so devtools reveal nothing; and yesterday and earlier are
always fully visible, because the spoiler is gone. The date boundary uses the
existing `getTiranaDateKey` / `tiranaMidnightEpoch` pair (`src/game.js:283-334`),
which already handles DST. **The server must import that function, not
reimplement it** — a second date implementation is how epochs drift.

### 2.5 Anti-abuse

The server does not run the game, so a determined player can post a fake result.
That is acceptable in a family circle, and we say so plainly rather than build
detection theatre.

- **One write per (member, circle, date)** — first write wins, row immutable, a
  second POST returns `409`. **Window:** today's or yesterday's Tirana date only
  (6-hour grace for someone who finished at 23:58 offline), which stops
  backfilling a perfect history. **Shape:** `attempts ∈ 1..6 | "X"`, booleans are
  booleans, no free text except the display name.
- **Rate limits:** 60 req/min per member key, 10 circle creations/day, 20
  joins/day; a raw IP or plain hash is never stored. The anonymous bucket is a
  short-lived HMAC of the IP plus the current window, rotated and pruned within
  48 hours. **Caps:** 10 members/circle, 10 circles/member — small enough to
  stay personal, and also the free-tier cost control. Both caps are database
  invariants: a handler-side count followed by `addMembership` is forbidden
  because concurrent joins can create an eleventh seat. M1 needs one atomic
  join operation and a two-request race test that proves exactly one final seat
  is granted. **Invite codes:** 13 chars Crockford base32 from a CSPRNG (~65 bits),
  revocable by the creator; revocation issues a new code and keeps members.
- **Display names:** trimmed, NFC, ≤20 chars, no control characters, ≤2 emoji. No
  automated profanity filter — circles are self-selecting and the creator can
  remove a member. Deliberate non-goal, as are cheat detection, device
  fingerprinting, IP reputation, and CAPTCHAs.
- **Rejected on privacy grounds:** having the client submit its status grid so the
  server can re-derive the result. It would raise the anti-tamper bar slightly
  while transmitting per-position information about the day's answer. Data
  minimisation wins; we accept self-reported summaries.

### 2.6 Offline — the game never depends on the network

Non-negotiable: `submitGuess` and `finishGame` contain **zero** awaited network
calls, today and after. Completion writes a job to `fjale:rrethi:outbox:v1` (cap
30, oldest dropped) and returns immediately; the outbox flushes on app start, on
`online`, and after any successful board fetch, failing silently. The Rrethi card
has three states — `synced`, `në pritje`, `pa lidhje` — none of which is a toast
or dialog, since the toast channel stays reserved for gameplay. With the backend
fully down the app is byte-identical to today's plus one greyed card. The service
worker already serves the shell offline (`service-worker.js:1-35`); `/api/*` is
**never** precached and is explicitly bypassed by the SW fetch handler before
any cache strategy runs.

### 2.7 API surface

Same-origin Vercel functions under `/api/`. This matters: `vercel.json:9` sets
`connect-src 'self'`, so same-origin calls need **no CSP change**. Any
third-party BaaS SDK phoning home to its own domain would require a CSP edit and
is rejected on that ground alone. CORS stays disabled: state-changing requests
with a browser `Origin` other than the canonical origin return `403`. Bearer
credentials live only in the `Authorization` header, which request/error logs
must redact. Every `/api/*` response is `Cache-Control: no-store`; the Vercel
header rule and service-worker bypass enforce that independently of a handler.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/rrethi/members` | `{displayName, avatarId, letterSeal}` | `{memberId, recoveryCode}` |
| POST | `/api/rrethi/circles` | `{name}` | `{code, name, memberCount}` |
| GET | `/api/rrethi/circles/:code` | – | `{name, memberCount, joined}` |
| POST | `/api/rrethi/circles/:code/join` | `{displayName?}` | `{name, memberCount}` |
| DELETE | `/api/rrethi/circles/:code/members/me` | – | `204` |
| POST | `/api/rrethi/circles/:code/results` | `{date, attempts, besa, hint, seconds?}` | `201` \| `409` |
| GET | `/api/rrethi/circles/:code/board?date=` | – | masked or full rows (§2.4) |
| GET | `/api/rrethi/circles/:code/week?start=` | – | weekly points table |
| DELETE | `/api/rrethi/me` | – | `204`, cascades everything |

Nine endpoints, bearer auth on all but `POST /members`, all JSON with
`Cache-Control: no-store`.

### 2.8 Data model

```sql
member      (member_key TEXT PK,            -- HMAC-SHA-256(pepper, secret)
             display_name TEXT NOT NULL,
             avatar_id TEXT NOT NULL, letter_seal TEXT NOT NULL,
             created_at TIMESTAMPTZ NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL)
circle      (code TEXT PK, name TEXT NOT NULL,
             owner_key TEXT NOT NULL REFERENCES member,
             show_time BOOLEAN NOT NULL DEFAULT FALSE,
             created_at TIMESTAMPTZ NOT NULL)
membership  (circle_code TEXT REFERENCES circle ON DELETE CASCADE,
             member_key  TEXT REFERENCES member ON DELETE CASCADE,
             joined_at TIMESTAMPTZ NOT NULL,
             PRIMARY KEY (circle_code, member_key))
result      (circle_code TEXT, member_key TEXT,
             play_date DATE NOT NULL,       -- Tirana calendar date
             attempts SMALLINT,             -- 1..6, NULL = loss
             besa BOOLEAN NOT NULL, hint BOOLEAN NOT NULL,
             seconds INTEGER,               -- NULL unless circle.show_time
             created_at TIMESTAMPTZ NOT NULL,
             PRIMARY KEY (circle_code, member_key, play_date),
             FOREIGN KEY (circle_code, member_key)
               REFERENCES membership ON DELETE CASCADE)
rate_bucket (bucket_key TEXT PK, count INTEGER, window_start TIMESTAMPTZ)
```

Index `result(circle_code, play_date)` for the board; the PK covers the week
query. **Free-tier size math:** a `result` row is ~60 bytes, so 1,000 players ×
365 days × 1 circle ≈ 365k rows ≈ 22 MB/year with index overhead, against 0.5 GB
(Neon, Supabase) or 5 GB (Turso). **Storage is not the binding constraint at any
realistic scale — compute-hours and cold starts are** (§6.2). **Never stored
server-side:** the answer, the guesses, the board pattern, IP addresses, user
agents, email, location, or the raw secret. The share grid stays client-side.
Expired rate buckets are deleted after 48 hours; otherwise rotating anonymous
buckets become an unbounded table even though each individual row is tiny.

### 2.9 Storage adapter

The DB decision is deferred, so the driver sits behind one interface with no SQL
in the handlers. `api/_lib/store.js`:

```js
/**
 * @typedef {object} RrethiStore
 * @property {(key:string, name:string) => Promise<void>}                createMember
 * @property {(key:string) => Promise<?Member>}                          getMember
 * @property {(key:string, name:string) => Promise<void>}                renameMember
 * @property {(key:string) => Promise<void>}                             deleteMember
 * @property {(code:string, name:string, owner:string) => Promise<'created'|'conflict'>} createCircle
 * @property {(code:string) => Promise<?Circle>}                         getCircle
 * @property {(code:string, key:string) => Promise<'created'|'conflict'>} addMembership
 * @property {(code:string, key:string) => Promise<void>}                removeMembership
 * @property {(key:string) => Promise<Circle[]>}                         listCirclesFor
 * @property {(r:ResultInput) => Promise<'created'|'conflict'>}          putResult
 * @property {(code:string, date:string) => Promise<ResultRow[]>}        listResults
 * @property {(code:string, from:string, to:string) => Promise<ResultRow[]>} listResultRange
 * @property {(bucket:string, limit:number, windowMs:number) => Promise<boolean>} takeToken
 */
```

Rules that make the swap real rather than aspirational: **`putResult` returns a
discriminated result, never throws a driver error** (insert-if-absent is the
adapter's job; the handler never sees a Postgres code); **no driver types cross
the boundary** (dates are `YYYY-MM-DD` strings, not `Date`); and **two concrete
implementations at M0** — `store-memory.js` (tests, zero deps) and
`store-neon.js`, selected by `RRETHI_STORE`. One conformance suite
(`tests/rrethi-store.test.js`) runs the identical assertions against every
configured adapter. Add Turso only if the M4 free-tier and cold-start evidence
shows a real need; a speculative third driver would add maintenance without
improving the product today.

Recommendation when the decision is taken: **Neon** — it is Postgres, so the
schema above is portable to a paid tier or self-host; its HTTP driver suits
serverless; it needs no vendor auth system. **Turso** is the fallback if
cold-start latency disappoints. **Supabase** is the weakest fit: its value is
auth and realtime, both of which we have banned.

### 2.10 Privacy stance

The current claim is absolute — "localStorage only, nothing is transmitted"
(`privatesia.html`, `ROADMAP.md:216-222`). Rrethi breaks it, so the rewritten
page ships in the **same deploy** and must state: Rrethi is opt-in, and a player
who never joins a circle transmits nothing while the app makes zero network
requests beyond loading itself; **what leaves the device** is a random identifier
(never your name, email, or device details), your chosen display name, avatar ID,
letter seal, the circle code, and per day — attempts used, hint used, Besa
declared, plus elapsed time only if your circle enabled it; **what never leaves** is your guesses, the words
you tried, your ratings, reports, archive history, passport, and badges;
**retention** is 400 days for results and for circles with no activity;
**deletion** is `DELETE /api/rrethi/me` with the recovery code, erasing the member
row and cascading to memberships and results immediately and irreversibly, also
exposed as a `Fshi të dhënat e rrethit` button in settings. Still no cookies, no
analytics, no third-party resources, and therefore still no consent banner —
`ROADMAP.md:223-225` holds only while that stays true, and adding analytics later
requires a CMP in the same release.

### 2.11 Feature flag and rollout

`src/config.js` gains `export const RRETHI_ENABLED = false;`. When false: no
Rrethi UI is **constructed** (not hidden — not constructed), no `fetch` to
`/api/*` exists on any reachable path, the outbox is never written, and
`npm run check` passes with the flag in both positions. A test asserts that with
the flag false no `/api/` string is reachable from the app entry path — a flag
that only hides a button is not a flag. Rollout: ON for the owner's own device
first through a protected preview deployment with an explicit build-time flag
(never a public URL/localStorage override), then one real family circle for two
weeks, then default ON.

### 2.12 Milestones and acceptance criteria

**M0 — adapter + schema, no UI (implemented, dormant).** `store-memory` passes
the full conformance suite. `store-neon` uses the same suite and is conditionally
skipped until a temporary `RRETHI_TEST_NEON_URL` (a scratch project, never the
production URL) is supplied; choosing and tuning a
free instance is intentionally deferred. Schema lives in
`api/_lib/schema.sql` and is idempotent. *Exit acceptance:* on a disposable Neon
branch, `putResult` called twice with the same key returns `'created'` then
`'conflict'`, and the stored row remains the first one.

**M1 — endpoints, no UI (1 wk).** All nine respond correctly locally.
*Spoiler:* a scripted two-member run where B fetches the board before finishing
receives a body in which the substring `attempts` does not appear — asserted on
the **raw response text**, not a parsed object. *Boundary:* with a fake clock at
23:59:30 Europe/Tirane a POST files under date D; at 00:00:30 the next files under
D+1 and the D board is fully unmasked; repeat on a DST-transition date, using the
clock-shim technique already proven for archive verification. *Limits:* 61
requests in a minute produce exactly one `429`. *Security:* an invalid calendar
date, reversed date range, control character, oversized body, wrong content type,
or cross-origin mutation is rejected before storage; raw bearer values never
appear in logs; every response is `no-store`; and a service-worker-controlled
browser has zero `/api/*` entries in Cache Storage after the full scripted run.

**M2 — UI behind the flag (1.5 wk).** Create → share → join → play → board on a
real phone over WhatsApp. *320px:* the board renders with no horizontal overflow
at 320px and 390px with 8 members and the longest legal 20-char name — screenshot
required. *Offline:* with DevTools offline, complete the daily, reload, go online
— the result appears with no player action and no error UI was shown at any point.
*States:* create/join/leave specified and screenshotted in
default/hover/pressed/disabled × light/dark = 16 states. *Motion:* every new
Rrethi animation has an explicit reduced-motion rule (§4.3), verified with the OS
setting on.

**M3 — privacy + deletion (0.5 wk).** Rewritten `privatesia.html` in the same
commit as the first live `/api` route. *Acceptance:* deleting via recovery code
removes the member from a second device's board within one refresh; a repeat
delete returns `204`.

**M4 — family beta (2 wk calendar).** One real circle, 5+ members, 14 consecutive
days. *Acceptance:* zero spoiler complaints, zero "Rrethi broke my streak"
reports, no polling observed, and at most 40 CU-hours consumed over the 14 days
(an 80 CU-hour monthly projection, leaving 20% headroom).

---

## 3. Sfida të reja — new word challenges

Filter applied: **anything requiring new reviewed answer words is deferred.** The
team has 138 reviewed words (`LEXICON.md:9`), a two-independent-reviewer rule for
every future batch (`LEXICON.md:90-95`), and a stated need to reach 365 with a
90-day buffer (`ROADMAP.md:154`). Spending that capacity on a mode instead of the
daily runway is the wrong trade pre-launch, so all three recommendations cost
**zero new words**.

Catalog facts below were computed by running `tokenizeAlbanian` over `ANSWERS`
from `src/words.js` on Node v24.18.0 in this repo: 138 answers, of which **64
(46.4%) contain at least one digraph**; per digraph `sh` 22, `ll` 12, `dh` 8,
`gj` 7, `rr` 6, `th` 6, `xh` 3, `zh` 3, **`nj` 2**; all 36 letters appear in at
least one answer, the rarest being **`x` (1)**, `nj` (2), `xh` (3), `zh` (3),
`v` (4), `c` (5); part of speech 125 nouns, 3 adjectives, 3 adj/participle, 4
numerals, 2 verbs, 1 adverb; accepted guesses 21,481.

### 3.1 RECOMMENDED — "Nëntë Vulat" *(UNVERIFIED)*

**Mechanic.** A weekly puzzle drawn only from answers containing at least one
digraph. The board shows a counter of which of the nine digraph letters you have
found across the run, and solving stamps that digraph into a dedicated strip in
the passport. It never touches the daily word, the streak, or the epoch.

**Why no competitor has it.** fjalth.com and fjaleza.com both handle digraphs
correctly as *input* — dedicated keys and auto-merge respectively — but neither
treats a digraph as a **game object** you can collect or be challenged on;
fjalez.al and fjalez.metinferati.com split digraphs entirely, so the concept is
unrepresentable in their engines. This is the one mechanic that cannot be copied
without rebuilding their tokenizer, and it is the direct expression of "Të 36-at
vlejnë."

**Editorial cost: zero** — a computed filter over existing metadata; 64 words
support 64 weeks before any repeat.

**Constraint found in the data:** `nj` appears in only 2 answers and `xh`/`zh` in
3 each, so a naive random draw serves `sh` (22 words) seven times before `nj`
once and "collect all nine" is unfillable. The selector must be
**digraph-first** — pick the digraph the player is missing, *then* a word
containing it — which makes a full run exactly 9 puzzles, the right scope for a
weekly cadence.

**Retention hypothesis.** A weekly appointment with a bounded, visible goal
(9 stamps) gives a second reason to open the app that does not depend on the
daily streak, so a missed daily does not zero all progress. Measure: share of
weekly-active players completing one in weeks 2–4. **Phase fit:** build now behind
a flag, ship after stable launch with badges; it reuses the daily board wholesale,
so it is presentation, not a mode collection.

### 3.2 REJECTED — "Vula që të mungon" *(UNVERIFIED)*

**Decision.** Do not build a repeatable practice shortcut that fills the
passport. Passport letters now come only from a completed win on today's Daily
word; Archive, Practice, and Challenge can never add a stamp. This keeps the
passport as evidence of returning over time instead of something a player can
finish by grinding in one sitting.

**Why no competitor has it.** None of the five competitors has any
personalisation or progression object at all — fjalth, fjaleza, fjalez.al and
metinferati serve the identical puzzle to everyone, and Luaj Live is an ad farm.
Personalisation still uses `profile.collection`, but that collection is now
daily-only. A targeted practice puzzle could remain an optional learning tool,
but it must never update the passport or unlock its collection milestones.

**Editorial cost: zero** — a filter over `ANSWERS` intersected with
`profile.collection`, contained to `randomAnswerIndex` (`src/app.js:2245`), which
today draws uniformly from all 138.

**Constraint found in the data:** every letter is reachable, but `x` appears in
exactly **one** answer, so a player whose last missing letter is `x` gets a pool
of size 1 — and if they have already won that word, the puzzle is
unwinnable-as-new. Required handling: when the filtered pool is empty, fall back
to the full pool and say `Të gjitha fjalët me këtë shkronjë i ke luajtur`. A
silent repeat reads as a bug.

**Retention hypothesis.** The passport is currently a display; this makes it a
loop, giving a player one letter short a concrete single-tap next action.
Measure: share of players reaching 36/36, and practice sessions per player after
ship. **Phase fit:** Phase-3 adjacent ("Fjalori im" territory), zero backend, zero
editorial dependency, buildable now.

### 3.3 RECOMMENDED — "Mënyra e ngushtë" *(UNVERIFIED)*

**Mechanic.** An opt-in per-puzzle difficulty rule: revealed letters must be
reused, **and digraphs are enforced atomically** — a revealed `SH` must appear as
the letter `SH`, and a revealed single `S` may not be silently absorbed into an
`SH`. Toggleable before the first guess only; marked in the share text.

**Why no competitor has it in this form.** fjalth.com already ships a hard mode
(`ROADMAP.md:185`), so plain hard mode is **not** a differentiator and we must not
claim it as one. The Albanian-specific part is that atomic tokenisation
(`tokenizeAlbanian`, `src/game.js:125`) lets us state and enforce the digraph
constraint precisely; engines that split digraphs cannot express the rule at all,
and fjalth's hard mode operates on their tile model without the atomic
distinction. The honest claim is "the first Albanian hard mode that knows what a
letter is", not "the first hard mode".

**Editorial cost: zero** — pure evaluation logic over `evaluateGuess`
(`src/game.js:245`).

**Retention hypothesis.** ~30% of engaged players want hard mode (market research
2026-07) and it doubles as vocabulary training for the diaspora heritage-learner
segment. Measure: opt-in rate and 4-week retention of opted-in vs not. **Phase
fit:** buildable now, but must stay per-puzzle and reversible before the first
guess — never a profile-wide setting that can silently break a streak.

### 3.4 Backlog — right idea, wrong time

| Idea *(UNVERIFIED)* | Why it waits | Phase |
|---|---|---|
| **Fjala e rrallë e javës** — weekly hard word, 8 attempts, outside the daily pool | 52 reviewed words/year × two reviewers: a third of the entire current catalog spent annually on a weekly mode while the daily runway needs 365. Revisit once the buffer exists. | 4 |
| **Fjalë e urtë** — the answer is the missing word in a proverb | Each proverb needs sourcing, attribution, review, and a leak sweep proving it does not contain the answer's stem. Higher per-item cost than a plain answer; `scripts/validate-lexicon.mjs` already flags clue stem leaks as a standing warning. | 4 |
| **Koleksione Gegë / Toskë / Arbëreshe** | All 138 answers are `region: "standard"` (grep over `src/words.js`). A regional pack is a new reviewed layer needing a reviewer fluent in that variety (`LEXICON.md:36`) plus its own labeled schedule. Real, valuable, expensive. | 4 |
| **Afër fjalës** — semantic/association puzzle | Needs an Albanian association dataset that does not exist and must not be AI-generated (`LEXICON.md:86-88`). The roadmap allows exactly one semantic puzzle, after retention is proven. | 4 |
| **Nëntë Vulat as a daily variant** | Only 64 of 138 answers qualify, so a daily digraph word needs its own epoch — and the epoch table is append-only and SHA-pinned. Weekly cadence avoids the problem entirely. | — |

### 3.5 Rejected outright

**"Zinxhiri i javës"** (a themed week whose seven daily answers share a hidden
thread) is attractive and **impossible without breaking the pin**: the daily
answer is `(dayNumber * step + offset) % poolSize` over a frozen `answerIds` list
(`src/game.js:356-374, 91-115`), and `tests/fixtures/daily-schedule.json` locks
every mapping through 2030-12-31, so theming a week means reordering a published
rotation. Rejected on integrity, not taste. Also rejected: **6- and 7-letter
tiers** (fjalez.al's model — the definition of a generic mode collection the
roadmap bans, doubling the editorial surface and diluting "Pesë shkronja" in the
product's own tagline); **timed blitz / reverse / unlimited modes** (generic mode
collection); **duel me të panjohur** (stranger matchmaking, banned);
**guess-solver** (banned); and **AI-generated definitions, pronunciations, or
proverb glosses** (banned by `LEXICON.md:86-88` regardless of model quality).

---

## 4. Lëvizje & shpërblime — motion and rewards

### 4.1 Constraints read from the code

- Motion budget is **120–360ms** with a reduced-motion path (`DESIGN.md:201`); two
  existing animations already exceed it (`board-win` 420ms, `celebrate` 700ms).
  Do not add a third exception without deciding to widen the budget.
- Easing tokens exist — `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` and
  `--ease-standard: cubic-bezier(0.4, 0, 0.2, 1)` (`styles.css:87-88`). Use these
  two; introduce no third curve.
- **`renderBoard()` calls `elements.board.replaceChildren()`.** Every tile is a
  brand-new DOM node on every render, so any CSS animation on a tile **restarts on
  every keystroke**; the existing reveal survives only because `animatingRow`
  gates the class. Any new tile animation must be driven by a one-shot flag
  consumed during render — the pattern of `pendingEditedDigraphIndex`
  (`src/app.js:233`). This is the biggest implementation trap in this section.
- The reduced-motion block is a blunt global (`animation-duration: 1ms
  !important`, `styles.css:2449`) that lands correctly only for animations with
  `both` fill and a meaningful final keyframe, so **every new animation below gets
  its own explicit reduced-motion rule** rather than trusting the blanket.

### 4.2 Existing motion — refine, do not redesign

| Animation | Now | Change |
|---|---|---|
| `tile-pop` | 130ms `--ease-out`, transform | keep |
| `tile-reveal` | 360ms `--ease-standard`, `--reveal-delay: col×72ms` | keep |
| `status-in` | 360ms, opacity | keep |
| `row-shake` | 320ms `--ease-out`, transform | keep |
| `board-win` | 420ms `--ease-out`, transform | keep |
| `dialog-in` / `sheet-in` / `hint-confirmation-in` | 210 / — / 180ms | keep |
| `celebrate` | 700ms, 12 pieces, **fires on every win** | **gate to milestones** (§4.4) |
| reveal input lock | `revealDuration = 760ms` (`src/app.js:1021`) | **reduce to 680ms** |

The one timing change is measured, not taste: the last tile starts at
`4 × 72 = 288ms` and finishes at `288 + 360 = 648ms`, but input stays locked until
760ms — **112ms of dead time on every guess**. 680ms keeps a 32ms settle and
removes 80ms of felt latency six times per game. *Acceptance:* a frame-stepped
recording showing the final tile fully settled before the keyboard re-enables.

### 4.3 New motion spec

Transform and opacity only — no width, height, top, left, margin, or box-shadow
animation anywhere.

| Name | Trigger | Duration | Easing | Properties | Reduced-motion fallback |
|---|---|---:|---|---|---|
| `digraph-snap` | two typed characters merge into a digraph (`appendPhysicalCharacter` / `mergePhysicalCharacterAt` return one) | 140ms | `--ease-out` | `scaleX(0.90)→1` on `.tile-letter`; `scale(1.04)→1` on the tile | none; tile renders in its final `.is-digraph` state |
| `key-press` | keyboard key `:active` | 90ms | `--ease-out` | `scale(0.96)` | none; the existing background change still confirms the tap |
| `stamp-land` | a letter newly enters `profile.collection` on a Daily win | 260ms | `--ease-out` | `scale(0.72)→1`, `opacity 0→1`, 40ms stagger if several | stamp in final state; a 900ms honey `outline` marks which are new |
| `streak-tick` | `currentStreak` increases | 220ms | `--ease-out` | two stacked digits, `translateY(-100%)`, `opacity` | number swaps instantly; honey underline still applies |
| `besa-seal-press` | daily win with Besa declared and no hint | 320ms | `--ease-out` | `scale(0.86)→1`, `opacity 0→1` | seal in final state |
| `milestone-band` | a milestone badge is earned (§4.4) | 700ms, once | `--ease-out` | `scaleX(0)→1` from centre, then `opacity→0` | static full-width band for 2.4s, then opacity fade only |
| `hot-underline` | streak ≥ 3 | 300ms on change | `--ease-standard` | `scaleX()` on a 2px honey rule under the streak figure | static honey rule, no grow |

`digraph-snap` is genuinely new: today a merged digraph gets only the generic
`tile-pop` (`styles.css:663`), so the product's signature interaction has no
signature motion. Implement it with a `justMergedIndex` one-shot flag set
alongside `pendingEditedDigraphIndex` (`src/app.js:879, 902`), consumed in
`renderBoard` and cleared immediately. `stamp-land` needs a "which letters are
new" diff, and since `applyCompletedGameToProfile` already returns a fresh
profile object, the caller can diff `previous.collection` against
`next.collection` at `recordCompletedGame` time — no new persisted field. All
colours come from `--primary`, `--primary-deep`, `--primary-pale`, `--correct`,
`--ink`; no new tokens, and both themes inherit automatically because every one of
those is redefined under `:root[data-theme="dark"]` (`styles.css:94-110`).

### 4.4 Win choreography — escalation without recurring confetti

Today every win in every mode fires 12 confetti pieces: the casino chrome the
product rejects, and because it always fires it signals nothing. Four tiers
replace it.

- **Tier 0 — every win.** `tile-reveal` cascade → `board-win` pulse → result panel
  focus. Nothing added; this is already good and it is the tier that runs 99% of
  the time.
- **Tier 1 — streak continues (≥2).** `streak-tick` on the header streak figure;
  at ≥3 the `hot-underline` appears. That is the entire hot-streak visual: a honey
  rule thickening from 2px at streak 3 to 3px at 7, taking `--primary-deep` at 30.
  **No fire emoji, no flame, no glow** — a flame is not in the Bright Coffee Break
  palette and reads as exactly the reward chrome DESIGN.md bans. Honey already
  means "earned" in this system.
- **Tier 2 — a new stamp lands.** `stamp-land` on the passport teaser plus the
  count increment; frequent early, rare later, which is correct because it should
  feel like progress.
- **Tier 3 — a milestone, once ever.** `milestone-band` plus **the existing
  `celebrate` particles, now exclusive to this tier**. Milestones: streak 7,
  streak 30, streak 100, all 9 digraphs, all 36 letters, first Besa daily win, 100
  daily wins — seven moments in a player's entire life with the product. That is
  the replacement for recurring confetti: the particles are not deleted, they are
  made scarce. A fired milestone is recorded in an additive `profile.milestones`
  array (§4.5) so it never repeats.

### 4.5 Vulat — the badge system

Badges extend the passport/stamp metaphor: a **vulë** on a second passport page,
using the same `.alphabet-stamp` visual language and the same
`stamp-digraph-v1.svg` engraved frame for the rare ones. **Stated plainly: no
coins, no gems, no currency, nothing purchasable, nothing tradeable, no expiry,
and a badge once earned is never lost** — including when a streak later breaks.
Badges gate no content and never appear in the share text unless the player taps
to include them. All 11 local badges come from data the profile already stores
(`src/app.js:2311-2346`, `src/game.js:678-769`); no new tracked field is needed
beyond the milestone list.

| # | Vula *(UNVERIFIED)* | Earn condition | Source |
|---|---|---|---|
| 1 | `Vula e parë` | first daily win | `modeStats.daily.won >= 1` |
| 2 | `Goditje e parë` | daily win on the first attempt | `modeStats.daily.distribution[0] >= 1` |
| 3 | `Këmbëngulja` | daily win on the sixth attempt | `modeStats.daily.distribution[5] >= 1` |
| 4 | `Dora e sigurt` | 10 daily wins in ≤3 attempts | `sum(modeStats.daily.distribution[0..2]) >= 10` |
| 5 | `Java e plotë` | a 7-day daily streak | `bestStreak >= 7` |
| 6 | `Muaji i plotë` | a 30-day daily streak | `bestStreak >= 30` |
| 7 | `Njëqind ditë` | 100 daily puzzles played | `modeStats.daily.played >= 100` |
| 8 | `Njëzet e pesë` | 25 daily wins | `modeStats.daily.won >= 25` |
| 9 | `Nëntë vulat` | all 9 digraphs collected | `collection ∩ DIGRAPHS === 9` |
| 10 | `Pasaporta e plotë` | all 36 letters collected | `collection.length === 36` |
| 11 | `Besa e trefishtë` | 3 daily Besa wins | `besaDailyWins >= 3` |
| 12 | `Vula e rrethit` | finish the daily on 7 days as a circle member | `rrethi-days-7`, server-derived and Rrethi-gated |

**Meaning of #11.** `besaWins` remains an overall legacy statistic, but it does
not unlock Passport progress. The badge, milestone, and engraved result seal all
read the strict daily counter so the Passport cannot be completed by grinding.

**Do not use `dailyResults` for daily-only counts.** `completionDateKey`
(`src/game.js:636-644`) writes both `daily-` and `archive-` completions into the
same date-keyed map, so an archive play for date D creates `dailyResults[D]`.
Every daily badge above therefore reads `modeStats.daily.*`, which is genuinely
mode-isolated.

**Migration — implemented and tested.** `profile.milestones`, `besaDailyWins`,
and `lastGraceDate` are additive. A captured pre-rewards production profile is
loaded by the test suite; every legacy total and preference is asserted intact,
and the new fields default without a wipe or exception.

**Display.** A `Vulat` tab inside the existing passport dialog — not a new dialog,
not a new nav item. Each row has a code-native double-ring passport seal, its
plain-Albanian goal, and concrete progress (`5 / 10`), because a visible next step
is the retention mechanism. The list is one column on phones and two only when
space supports it; earned state uses the existing honey token and a small check.
Following the user-controlled principle of Apple Fitness awards, each seal tilts
only on precise hover and turns only on tap, click, or keyboard activation; none
auto-spin. The backs quietly spell `FJALË ME BESË` in badge order. Reduced-motion
keeps the same two faces but swaps instantly, so the discovery remains available.
The ImageGen exploration is preserved at
`design-concepts/vulat-imagegen-v1.png`; production seals remain HTML/CSS so they
stay crisp, accessible, theme-aware, and lightweight.

---

## 5. Rendi & varësitë — sequencing

### 5.1 The launch blocker is unchanged

`ROADMAP.md:113-128` puts pool verification first and line 127 freezes V1 scope
against modes, accounts, multiplayer, and a backend; nothing here may slip into
that round. The gate stays: two-reviewer batches, physical-device pass (iPhone
Safari, Android Chrome/Firefox, one WhatsApp share paste), live-origin
verification, and the non-noun rebalance (125 of 138 answers are nouns — verified
by counting `partOfSpeech` over `ANSWERS`).

### 5.2 Pre-launch vs post-launch

**Buildable now, behind flags, default OFF — consumes no editorial capacity:**
badges + milestone gating of confetti (§4.4–4.5); new motion (§4.3) and the
760→680ms reveal-lock change (§4.2); Mënyra e ngushtë (§3.3); Vula që të mungon
(§3.2); the Nëntë Vulat selector and passport strip (§3.1); and Rrethi **M0
only** — writing an interface plus a memory implementation is not "adding a
backend", deploying an endpoint is, and M0 has no `/api` route and no network
call.

**Waits for stable launch:** everything in Rrethi from M1 (endpoints, UI, privacy
rewrite), any epoch or pool change of any kind, and the §3.4 backlog.

**Hard dependencies.** Rrethi M3 (privacy page) **must** be in the same deploy as
the first live `/api` route — not the release before, not after. Any change to a
precached runtime file must bump `CACHE_NAME` (now `fjale-shell-v33`,
`service-worker.js:1`), enforced in CI by `scripts/check-cache-version-bump.mjs`;
every item in §4 touches `styles.css` and `src/app.js`, so every one needs a bump.
`/api/*` is already excluded from the service-worker fetch handler and protected
by a production `no-store` rule; M1 tests must keep both guards. Badges depend
on the §4.5 migration test passing against a **real captured production profile**,
not a synthetic one.

### 5.3 Recommended decisions used for this preview

1. **Streak forgiveness:** one automatic grace day per rolling 30 days, free and
   never announced in advance. It is enabled only with `REWARDS_ENABLED`; the
   default-OFF build keeps today's streak semantics exactly.
2. **Weekly points:** 6-5-4-3-2-1, +1 Besa, no negative points.
3. **Rrethi timing:** M0 may remain in the repository, but endpoints and UI wait
   until after a stable launch.
4. **Database:** Neon is the provisional free Postgres option. Tune or replace it
   only after a real beta exposes a constraint; no paid commitment now.
5. **Celebration:** confetti is milestone-only with rewards enabled. Ordinary wins
   retain the board pulse and result transition.
6. **Private-circle names:** no automated filter in the first beta; circle owners
   can remove members, and names are never public. Recheck this before M2 because
   it affects moderation policy, not the current preview.

---

## 6. Rreziqet — top risks

**1. Spoiler leakage in circles.** A member sees another's attempt count before
finishing and the day is ruined. *Mitigation:* mask server-side in the query,
never client-side (§2.4); assert on the **raw response body** that the key is
absent, not zeroed; keep the outbox fire-and-forget so a pending upload cannot
render a partial board; add fake-clock boundary tests at Tirana midnight including
a DST date, using the archive clock-shim technique.

**2. Backend cost creep past the free tier.** Serverless Postgres free tiers meter
CU-hours and active compute time, not storage alone, and the §2.8 math shows 22 MB/year
at 1,000 players — so **the risk is request volume and cold starts, not rows**.
*Mitigation:* board fetch at most once per app foreground, never on an interval;
the week query reuses the board's index; caps of 10 members/circle and 10
circles/member; and a hard tripwire — if projected monthly compute reaches 80
CU-hours at M4, the flag goes back OFF and we re-scope rather than upgrade
silently. Paying for infrastructure is a product decision, not an ops reflex.

**Cost-model addendum (2026-08-04 re-check).** The earlier quota arithmetic was
based on a superseded allowance. Neon's current published Free plan is
**100 CU-hours/project/month**, 0.5 GB storage, computes up to 2 CU, with a
fixed 5-minute scale-to-zero delay ([pricing](https://neon.com/pricing),
[scale to zero](https://neon.com/docs/introduction/scale-to-zero)). At a fixed
0.25 CU, that buys about **400 active compute-hours/month**, or 13.3 h/day in a
30-day month. If traffic keeps the compute continuously active, 10 h/day uses
75% of quota, 12 h/day 90%, 16 h/day 120%, and 24 h/day 180%. A 16–24-hour
diaspora window therefore cannot be promised at €0; only a sparse beta that
actually returns to zero between bursts can.

- Billing is **average CU × active compute time**, not request count. At beta
  scale, the five-minute warm tail will usually dominate the SQL execution
  time, but query work still affects latency and can trigger autoscaling under
  load. The prior absolute claims that cost becomes flat past 64 users and that
  query optimization can never affect cost are removed; arrival gaps and the
  Console's measured CU-hours decide the result.
- Restate the M4 tripwire in provider units: keep Rrethi private and flag-off by
  default until a two-week family beta projects below 80 CU-hours/month at the
  fixed 0.25 CU size. At 80–100, stop expansion and tune; at 100 or above,
  choose a paid plan/provider explicitly rather than letting the backend fail.
- Before M1 ships, in order of leverage and correctness: (1) run the Vercel
  function and Neon compute in the same European region, then measure cold and
  warm p95; (2) pin min=max=0.25 CU and keep scale-to-zero enabled; (3) enforce
  no polling — board refresh only on foreground or explicit action, and deep
  health never on a sub-five-minute cadence; (4) fold authorization, membership,
  board rows, and the once-daily `last_seen_at` touch into the fewest one-shot
  statements; (5) make the 10-seat and 10-circle caps atomic in the database,
  with concurrent race tests; (6) use versioned additive migrations over an
  **unpooled** migration URL — `CREATE TABLE IF NOT EXISTS` is bootstrap, not a
  migration system, and will not add future columns to an existing table; (7)
  add `avatar_id`/`letter_seal` before endpoints; (8) HMAC and prune anonymous
  rate buckets as specified in §2.5.

The Vercel Hobby plan is suitable only while FJALË remains a personal,
non-commercial project. Ads, paid client work, or another commercial use require
moving to Pro before launch under Vercel's current
[Hobby terms](https://vercel.com/docs/plans/hobby).

**3. Animation overload undermines the anti-gimmick position.** Market research
names heavy animation the lowest-ROI direction and the product's anti-references
ban casino chrome; seven new animations is near the ceiling. *Mitigation:*
transform/opacity only; the 120–360ms budget with only the two pre-existing
exceptions; confetti becomes rarer than today, not more common; and a required
screenshot or recording acceptance from the owner before any of §4 is called done,
because math never closes a feel ticket. If the reaction to the recording is
"busy", cut `milestone-band` first.

**4. Editorial bandwidth is the real constraint.** Any mode needing words competes
with the 365-word daily runway. *Mitigation:* all three recommendations cost zero
new words, and §3.4 states each deferred idea's cost in words-per-year so the
trade is explicit when revisited. Standing rule: a mode proposal without a
word-cost number is not a proposal.

**5. Streak mechanics create the anxiety they exist to cure.** Badges 5–6 plus a
circle board showing streaks can turn a missed day into a public event.
*Mitigation:* streaks are displayed but **never ranked** (§2.3); badges are never
lost (§4.5); no notifications and no "your streak is at risk" copy of any kind,
ever; and the grace-day decision (§5.3.1) is taken before badges ship, not after.
If exactly one thing in this plan gets cut for feeling wrong, it should be showing
streaks on the circle board.

**6. Epoch / SHA-pin integrity.** Nothing here may touch the daily pool or
schedule; the concrete hazard is a challenge feature quietly filtering the daily
rotation. *Mitigation:* Nëntë Vulat and Vula që të mungon operate **only** on the
practice and weekly surfaces via `randomAnswerIndex` (`src/app.js:2245`), never on
`getDailyAnswerIndex`; `tests/fixtures/daily-schedule.json` must stay green
through every commit, and if it turns red the change is wrong by definition
regardless of how good it looks. §3.5 rejects "Zinxhiri i javës" on this ground.

**7. The privacy claim regresses.** The current page says nothing is transmitted,
so shipping an endpoint without updating it is exactly the trust failure this
product is positioned against — and the positioning is the moat. *Mitigation:* M3
is a release gate, not a task; the rewrite lands in the same commit as the first
live route; no analytics in that release or any release without a CMP.

**8. The flag is theatre.** A "default OFF" flag that only hides a button still
ships the network code, and one bug makes it reachable. *Mitigation:* the flag
gates construction, not visibility; a test asserts no `/api/` string is reachable
from the app entry path with the flag false; `npm run check` runs green with the
flag in both positions (§2.11).

---

## Verification status of this document

- **Executed and observed:** the §3 catalog statistics (digraph counts, per-letter
  coverage, part-of-speech distribution, accepted-guess total) come from running
  `tokenizeAlbanian` over `ANSWERS` on Node v24.18.0 in this repo.
- **Read, not run:** every line reference, the two defects in §1, the CSP and
  service-worker constraints, and the profile schema — readings of the source at
  `a7a6bc1`, not exercised at runtime.
- **UNVERIFIED, needs a human:** all Albanian copy (native review); every duration
  and easing value in §4 — **no motion claim in this document has been seen on a
  device**; the free-tier cost projection in §6.2 (needs a real M4 measurement,
  not an estimate); and whether the 760→680ms reveal-lock change *feels* better
  rather than merely measuring shorter.
