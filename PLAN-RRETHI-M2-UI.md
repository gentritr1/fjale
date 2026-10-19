# PLAN — Rrethi M2: the UI, behind the flag

> **DRAFT — for review. Nothing here is implemented.** This document expands
> `PLAN-RRETHI-2026-08.md` §2.1, §2.2, §2.6 and §2.11 into an implementable
> contract, the way `PLAN-RRETHI-M1-API.md` did for §2.7. It is subordinate to
> the plan: where this file and the plan disagree, the plan wins unless the
> disagreement is recorded in §12 (Deviations) below.
>
> **Every Albanian string in this document is UNVERIFIED** and stays UNVERIFIED
> until a native review pass. M1 put no human-readable string on the wire; M2 is
> where the copy becomes real, so the native pass moves from "eventually" to a
> **merge blocker** — see §11, line 41.

M1 shipped the nine endpoints (`api/_lib/router.js`, `http.js`, `auth.js`,
`limits.js`, three store methods, the §6 schema deltas) and they are dark:
`RRETHI_API_ENABLED` is unset, so every route answers `404`. M2 builds the client
that talks to them and stays equally dark behind a **second, independent** flag.
Two flags, not one: the server gate is an environment variable owned by the
deploy, the client gate is a reviewed constant owned by the build, and neither
implies the other. M3 flips the server gate beside the rewritten privacy page;
the client flag flips when the UI is accepted.

---

## 0. Scope

**In scope.** The identity layer (secret, recovery code, storage); the API
client; the offline outbox; the Rrethi card in the stats sheet; create, join,
board and week screens; leave and delete; the `RRETHI_ENABLED` flag and the test
that proves it is a real flag; the two carried obligations from M1 (§9, §10).

**Non-goals, explicitly.** No new endpoint — the nine are the nine, and an
implementer who finds themselves needing a tenth has left the brief and must
raise it rather than add it. No invite-code revocation, no `show_time` toggle, no
ownership transfer (§11 O3/O7 of the M1 contract settled all three as out).
No cross-member streaks on the board (O4 — the client shows its own local streak,
which it already has, and no one else's). No `Sfida`. No push notification, no
polling, no presence, no chat, no reactions. **No change to `submitGuess` or
`finishGame` beyond one non-awaited outbox write** — §2.6 is non-negotiable and
§11 line 12 is how it is proven.

**Module layout.**

| File | Contents |
|---|---|
| `src/config.js` (edit) | `export const RRETHI_ENABLED = false;` |
| `src/identity.js` (new) | Secret generation, Crockford encode/decode, checksum, storage |
| `src/rrethi-client.js` (new) | The nine calls, error mapping, no transport logic anywhere else |
| `src/rrethi-outbox.js` (new) | Queue, cap, flush triggers, terminal-vs-retryable classification |
| `src/rrethi-ui.js` (new) | Card, dialogs, board and week rendering |
| `src/app.js` (edit) | One flag-gated construction call, one outbox write in `finishGame` |
| `index.html` (edit) | The Rrethi section and its dialogs |
| `styles.css` (edit) | Board, lobby, card states |
| `api/_lib/board.js` (edit) | `avatarId` / `letterSeal` on unmasked rows (§9) |
| `api/_lib/router.js`, adapters, `schema.sql` (edit) | The `rate_bucket` prune (§10) |

`src/identity.js` and `src/rrethi-client.js` are separate on purpose: the
identity module is the only place the raw secret exists in client code, and
keeping it out of the module that builds URLs and log lines is what makes §2.2's
"the raw secret never appears in a URL, log line, analytics event, or error"
auditable by reading one file.

---

## 1. The flag

§2.11 is stricter than `REWARDS_ENABLED` and the difference is deliberate.

```js
// src/config.js
export const RRETHI_ENABLED = false;
```

**No URL override. No localStorage override. No loopback exception.**
`REWARDS_ENABLED` has a `?shperblime=1` developer override gated to loopback
hosts (`src/app.js:93-121`); `RRETHI_ENABLED` gets **none of that**, because the
rollout §2.11 specifies is "a protected preview deployment with an explicit
build-time flag (never a public URL/localStorage override)". An override that
exists at all is an override that can be reached on a preview URL that leaks.

**When false, the UI is not *constructed* — not hidden.** No DOM is built, no
listener is attached, no `fetch` to `/api/*` is reachable, the outbox is never
written, and `fjale:identity:v1` is never created. A flag that only hides a
button is not a flag.

The implementation shape that makes this true: `src/app.js` reaches Rrethi
through exactly one call site, and the modules are loaded with a **dynamic
`import()`** behind the flag, so with the flag false the client bundle never
evaluates them:

```js
if (RRETHI_ENABLED) {
  const { mountRrethi } = await import("./rrethi-ui.js");
  mountRrethi(/* … */);
}
```

This mirrors the discipline `api/_lib/store.js` already uses for the Neon driver,
and it is what makes §11 line 2 provable by static reachability rather than by
reading and nodding.

---

## 2. Identity

### 2.1 The secret

On first Rrethi use — **not on app start** — the client generates 128 bits:

```js
const secret = crypto.getRandomValues(new Uint8Array(16));
```

Stored at `fjale:identity:v1`, canonically encoded (§2.2 below). It is created
lazily, at the first action that needs it (create or join), so a player who never
opens Rrethi never has an identity to leak or to delete.

**Never**: in a URL, a query string, a log line, an analytics event, an error
message, a `dataset` attribute, or the outbox payload. The outbox stores the job,
not the credential; the client reads the secret from storage at flush time.

### 2.2 The wire form and the recovery code

Three faces of one secret, per §2.2:

| Face | Form |
|---|---|
| Storage | The canonical 26-character string |
| Bearer | `Authorization: Bearer <the same 26 characters>` |
| Recovery code | `RKTH-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX-C` |

**Canonical form.** The 16 bytes as a big-endian integer, encoded in Crockford
base32 into exactly 26 characters, uppercase, zero-padded on the left. 26 × 5 =
130 bits, so the top two bits are always zero — that is expected, not a bug.
Alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no `I`, `L`, `O`, `U`). This is
byte-for-byte what `BEARER_PATTERN` in `api/_lib/auth.js` already accepts:
`/^[0-9A-HJKMNP-TV-Z]{26}$/u`. **The server accepts only this form** — it never
sees the label, the dashes or the checksum (M1 §2.1).

**The checksum**, per Crockford: `n mod 37`, mapped through the 37-symbol
checksum alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U`. One character,
appended after a dash. It is validated **entirely locally**, so a typo costs no
round trip and the server needs no second checksum implementation that could
drift.

**Decoding a pasted code** must accept what a human paste actually looks like:
strip whitespace and dashes, uppercase, strip a leading `RKTH` label, fold
Crockford's confusables (`I`→`1`, `L`→`1`, `O`→`0`), then split the final
character as the checksum and verify it. A failed checksum is a local error with
its own copy and **no network call**.

### 2.3 Recovery, and the one screen that must not be skippable

The recovery code is shown **once**, immediately after the identity is first
created, on its own screen with a copy button and an explicit warning. It is
shown again on demand from settings — §2.1's "once" means "once unprompted", not
"once ever"; a code the owner cannot re-read is a code they cannot back up, and
we cannot regenerate it for them.

The screen may not be dismissed by backdrop click or `Escape`. It requires an
explicit acknowledgement control. This is the one dialog in the app that behaves
that way, and it is justified: **every other dialog can be reopened; this one
guards data we can never restore.** Rotating the server pepper or losing the code
orphans the member irreversibly, by design (§2.2, M1 §2.2).

Recovery on a new device is: paste the code → validate the checksum locally →
store → call `POST /api/rrethi/members` → the member's circles reappear.

---

## 3. The API client

`src/rrethi-client.js` is the only module that calls `fetch` with an `/api/`
path. One function per endpoint, each returning a discriminated result rather
than throwing for expected outcomes — the same discipline `store.js` sets
server-side.

```js
{ ok: true, status, body } | { ok: false, error: "<code>", field?, status }
```

**The error codes are M1's closed set** (`api/_lib/http.js` `ERROR_STATUS`).
The client maps them to copy; it must never render a code it does not recognise,
and an unrecognised code renders the generic failure line rather than the raw
string.

Rules that are not negotiable because M1's behaviour depends on them:

| Rule | Why |
|---|---|
| `409 result_exists` is **success** for the outbox: drop the job, do not retry, show no error | M1 §8.6. A client that treats it as failure retries forever and burns the minute bucket |
| `POST /circles` is **never** auto-retried | M1 §8.2 — it is not idempotent; a retry creates a second circle. The outbox carries results only |
| `429` carries `Retry-After`; honour it, never busy-retry | M1 §3.2 |
| `401 unauthorized` → the identity is broken → show recovery. `401 unknown_member` → call `POST /members` first | M1 §1.1 distinguishes these precisely so the client can react differently |
| `404` on a join means "wrong code **or** service off" and must read as one thing | M1 §1.1 collapses them deliberately; the UI must not guess which |
| No `Origin` header is ever set by hand | The browser sets it; M1's check derives the expected value from the connection (M1 deviation D10) |

**Timeouts.** Every call carries an `AbortController` with a 10-second timeout.
A timeout is a retryable failure for the outbox and a `pa lidhje` state for a
read; it is never an error dialog.

---

## 4. The outbox

§2.6 is the hardest constraint in this milestone: **`submitGuess` and
`finishGame` contain zero awaited network calls, today and after.**

`fjale:rrethi:outbox:v1`, cap **30**, oldest dropped on overflow. A completed
daily writes one job synchronously to storage and returns. Nothing in the
completion path awaits, retries, or observes the network.

**Flush triggers:** app start, the `online` event, and after any successful board
fetch. Failures are silent — never a toast, never a dialog. The toast channel
stays reserved for gameplay.

**Job classification on flush**, and this is the part that must be got right:

| Response | Action |
|---|---|
| `201` | Done, drop |
| `409 result_exists` | **Done, drop.** The row exists; the job succeeded earlier |
| `403 not_a_member` | Drop — the member left that circle; the job can never succeed |
| `400 date_out_of_range` | Drop — the write window has closed and will not reopen (M1 §5: the grace is monotone) |
| `400 invalid_*` | Drop, and log a bounded client-side warning: this is a client bug, not a transient failure |
| `401`, `404`, `429`, `5xx`, timeout, offline | Keep, retry on the next trigger |

A job that is kept must not be retried in a tight loop: one attempt per flush
trigger, in queue order, stopping the flush at the first retryable failure.

**The card's three states** (§2.6), none of which is a toast or a dialog:
`synced` · `në pritje` · `pa lidhje`. With the backend fully down the app is
byte-identical to today's plus one greyed card.

---

## 5. Screens

### 5.1 The Rrethi card — stats sheet

A new section in the stats dialog (`index.html:521`). Empty state:
`Ende pa rreth. Krijo një dhe fto familjen.` with `Krijo rreth` and `Bashkohu`.
With circles: one row per circle (name, member count, sync state), tapping opens
the board.

A member is in at most **10** circles (M1 `MEMBER_MAX_CIRCLES`); the list is
therefore never long and never paginates.

### 5.2 Create

Display name (2–20 code points) + circle name (same rule) + the Shenja avatar the
player already has. **Reuse the existing picker** in the passport dialog's
`Shenja` tab (`src/app.js:1978-2154`) rather than building a second one; it
already persists validated `profile.avatarId` + `profile.letterSeal`, which are
exactly the two values `POST /members` sends.

On success: the invite screen. The app builds
`https://www.xn--fjal-opa.com/?rrethi=RR-XXXX-XXXX-XXXXX` **client-side** — M1
§8.2 is explicit that the server returns the canonical code and never a URL,
because hard-coding the origin server-side breaks preview deployments. Hand it to
`shareOrCopy` (`src/app.js:2909`), which already does `navigator.share` with a
clipboard fallback. (Plan §2.1 cites `src/app.js:2103` for it; the function has
moved since that line was written — it is the same function.)

### 5.3 Join

`?rrethi=` on load shows the join card: circle name, member count, and the 2×5
lobby of §2.1.1 — **occupied seats only, no names**. `GET /circles/:code` returns
`{code, name, memberCount, joined}` and deliberately no display names (M1 §8.3:
shipping names on a pre-join endpoint would hand a family roster to anyone who
ever saw the code). The lobby therefore renders `memberCount` filled seats and
`10 - memberCount` empty ones, and **must not imply it knows who they are**.

Then display name + avatar + `Bashkohu`. On success, if this was the identity's
first use, the recovery screen (§2.3).

An invalid or unknown code shows one line and no retry loop. The existing
invalid-`?sfida=` warning is the precedent for visible failure.

### 5.4 Board

The screen the whole milestone exists for. `GET /circles/:code/board`.

**Masked** (`masked: true`) — the viewer has not finished this day. Rows carry
only `displayName` and `finished`; the payload has no `attempts` key at all.
Render `Ka mbaruar` / `Ende po luan` and **nothing else**. The client must not
compute, infer, or display a position, a count of finishers ranked, or any
ordering derived from anything but the roster: a masked board is deliberately
unsorted server-side (`board.js` keeps roster order) and re-sorting it client-side
would leak exactly what the mask exists to hide.

**Unmasked** — rows carry `attempts` (number or `"X"`), `besa`, `hint`, `points`,
plus `avatarId`/`letterSeal` once §9 lands. Render `{name} · {n} prova`, the
Besa seal where `besa && !hint`, and the viewer's own row marked from `you: true`
(never by comparing a member key — the payload contains none).

`masked` is a boolean the client may read and act on; it leaks nothing, since the
viewer already knows whether *they* have finished.

**Yesterday.** M1 deviation D5 masks today *and* yesterday until the viewer posts
that day, and the honest cost is that a member who skipped yesterday sees
yesterday's board masked for the rest of the Tirana day (~18 hours) with no way
to unmask it. **The UI must say so** rather than looking broken:
`Tabela e djeshme hapet sonte në mesnatë.` — otherwise every skipped day reads as
a bug report.

### 5.5 Week

`GET /circles/:code/week`. `maskedDates` is always present and may be empty.
Every date in it is absent from every row's `days` and excluded from every
`total`. Render the partial-week state — `javë e pjesshme` — rather than a
leaderboard that silently omits days, because a total that looks complete and is
not is worse than one that admits it.

Days with no result are **absent** from `days`; a zero-point loss is present with
`0`. These are different facts and must render differently.

### 5.6 Leave and delete

`Dil nga rrethi` → `DELETE /circles/:code/members/me` → always `204`, always
safe to retry. The confirmation must state that the member's results **in that
circle** go with them.

`Fshi të dhënat` → `DELETE /api/rrethi/me` → `204`. The confirmation must state,
in plain Albanian, that **circles the member owns are destroyed for everyone
else too** (M1 §8.9, `schema.sql`'s recorded decision that an FK must never block
a deletion request). This copy is a correctness requirement, not a nicety: it is
the one irreversible action in the app.

---

## 6. Copy

All UNVERIFIED. Full string inventory for the native pass, in one table so the
reviewer sees every new string at once rather than hunting them in a diff.

| Key | String |
|---|---|
| Section | `Rrethi` |
| Empty | `Ende pa rreth. Krijo një dhe fto familjen.` |
| Actions | `Krijo rreth` · `Bashkohu` · `Dil nga rrethi` |
| Invite | `Të pres në rrethin tim në FJALË. E njëjta fjalë çdo ditë.` |
| Pre-finish rows | `Ka mbaruar` / `Ende po luan` |
| Post-finish row | `{name} · {n} prova` |
| Loss row | `{name} · nuk e gjeti` |
| Recovery | `Ky është kodi yt i rikthimit. Pa të, rrethi humbet nëse ndërron telefon.` |
| Sync states | `E ruajtur` / `Në pritje` / `Pa lidhje` |
| Yesterday masked | `Tabela e djeshme hapet sonte në mesnatë.` |
| Partial week | `Javë e pjesshme` |
| Circle full | `Ky rreth është plot (10 veta).` |
| Circle limit | `Je në 10 rrethe. Dil nga një për të hapur vend.` |
| Bad code | `Ky kod nuk vlen.` |
| Delete warning | needs a native writer: must convey that owned circles die with the account |

---

## 7. Motion

Per §4.3 and §2.1.1, and every one needs an explicit reduced-motion rule
(§2.12's M2 acceptance).

| Moment | Motion | Reduced motion |
|---|---|---|
| Choosing a character | 180ms tilt-and-settle | final state, immediately |
| Seal landing in an empty seat | press-and-settle | final state, immediately |
| A completed player | quiet progress ring | static ring |
| Last player completes | group ring closes | static closed ring |

**No avatar loops while the player is reading or solving.** No idle animation
anywhere in Rrethi. The two easter eggs of §2.1.1 (`Nëntë Shenjat`, `Rrethi u
mbyll`) are out of M2 scope — they are earned states, not first-run UI.

---

## 8. Accessibility

The board is a list, not a table of scores; it must read sensibly to a screen
reader in both masked and unmasked states, and the masked state must not
announce anything the visual state hides. Every control ≥44×44pt. The state
matrix of `review-scars` #5 applies: default/hover/pressed/disabled/pressed+
disabled × light/dark, which is the 16-state screenshot grid §2.12 requires.

---

## 9. Carried obligation: avatars on the board (M1 §11, O2)

M1 deliberately kept `board.js` byte-identical so the spoiler-test surface would
not move. M2 extends it: unmasked rows gain `avatarId` and `letterSeal`, taken
from the roster `listMembers` already returns (the columns exist since M1's
schema deltas — this is a payload change, not a migration).

**Masked rows gain nothing.** The masked row shape stays exactly
`{displayName, finished}` plus `you: true`. The M1 spoiler tests assert on the
raw response text and must keep passing unchanged; if any of them needs editing,
the change is wrong.

---

## 10. Carried obligation: the `rate_bucket` prune (M1 deviation D6)

M1 recorded this explicitly: §0 of the M1 contract assigned the prune to M2, and
**it must ship before `RRETHI_STORE=neon` is ever set in production**, or plan
§2.5's "rotated and pruned within 48 hours" is an unmet privacy promise rather
than a storage optimisation.

Implementation, as M1 §3.1 describes it: `DELETE FROM rate_bucket WHERE
window_start < now() - interval '1 day'`, run **opportunistically** — a 1-in-500
chance per authenticated request, best-effort, failure ignored — so no cron job
is required on Hobby. §2.8's 48-hour promise is met with a 24-hour threshold and
margin.

This needs one new store method (`pruneRateBuckets`), which takes the interface
from 17 methods to 18. M1 refused to add it because §7 of that contract pinned
the additions at exactly three; M2 has no such constraint, and the conformance
suite gains one case: the method deletes rows older than the threshold, leaves
newer ones, and is a silent no-op on an empty table.

---

## 11. Test checklist

Observable assertions with named verification methods. An implementer is done
when every line is a passing test **or** a recorded artifact, and not before.
Lines marked **[M2 acceptance]** are copied from plan §2.12 and are the gate.

**The flag**
1. With `RRETHI_ENABLED = false`, `npm run check` passes and the full suite is
   green — the flag passes in both positions.
2. **[M2 acceptance-adjacent, §2.11 mandated]** With the flag false, no `/api/`
   string is reachable from the app entry path. Asserted by walking the static
   import graph from `src/app.js`, not by grepping the bundle: the Rrethi modules
   are behind a dynamic `import()`, so reachability is the property that matters.
3. With the flag false, `fjale:identity:v1` and `fjale:rrethi:outbox:v1` are
   never written. Asserted by driving a full daily game and diffing the
   `localStorage` key set before and after.
4. No URL or localStorage override turns the flag on: `?rrethi=1`,
   `?rrethi-enabled=1` and a pre-seeded flag key all leave it off, on loopback
   and on a non-loopback host alike.

**Identity**
5. 128 bits round-trip: secret → canonical 26 chars → recovery code → paste →
   the same 16 bytes. 10 000 random secrets, no loss, no collision.
6. Every canonical encoding matches `api/_lib/auth.js`'s `BEARER_PATTERN`
   exactly. Asserted by importing the real pattern, not a copy of it.
7. A single-character typo in a recovery code is rejected locally by the
   checksum, with **no** `fetch` call made (assert with a `fetch` spy).
8. Confusable folding: `I`/`L`→`1` and `O`→`0` decode to the same secret as the
   canonical form; a code with dashes, lowercase, surrounding whitespace, and
   the `RKTH` label decodes identically.
9. The raw secret appears in no URL, no `dataset`, no thrown error, and no
   console output across a full scripted run — the same capture technique M1
   line 7 uses.

**Offline (§2.6, non-negotiable)**
10. **[M2 acceptance]** With the dev server stopped mid-session, complete the
    daily: the game finishes normally, no error UI appears at any point, and the
    card reads `pa lidhje`. Restart the server → the result appears with no
    player action. **Method:** `preview_stop` / `preview_start` against the local
    dev server, driven in the browser pane; artifact is the before/after card
    state plus the server log showing the POST arriving after restart.
11. The outbox caps at 30 and drops oldest-first; job 31 evicts job 1.
12. **[§2.6 non-negotiable]** `submitGuess` and `finishGame` contain zero awaited
    network calls. Asserted structurally — walk the call graph of both functions
    and assert no `await` reaches the client module — **and** empirically, by
    completing a game with `fetch` replaced by a spy that never resolves, and
    asserting the result panel still renders.
13. Each outbox terminal case drops the job and each retryable case keeps it —
    one test per row of §4's table, driven against a stubbed client.
14. A `409 result_exists` shows no error UI anywhere.

**Spoiler (the M1 guarantees, now visible)**
15. **[M2 acceptance]** Two real devices/profiles, A finishes and B has not: B's
    board screen shows no number, no seal, and no ordering derived from scores.
    **Method:** screenshot of B's board while A's result is posted.
16. The client never re-sorts a masked board. Asserted by feeding a masked
    payload whose roster order differs from any score order and comparing the
    rendered order to the payload order.
17. No masked-board code path reads `attempts`, `points`, `besa`, `hint` or
    `seconds`. Asserted on the rendering function with a payload whose masked
    rows are frozen objects with throwing getters for those keys.
18. Yesterday's masked board shows the "opens at midnight" line rather than an
    empty or broken state.

**Layout and states**
19. **[M2 acceptance]** The board renders with no horizontal overflow at **320px**
    and **390px**, with **8 members** and the longest legal **20-code-point**
    name. **Method:** `resize_window` + screenshot at both widths; artifact is
    both screenshots, and `document.scrollingElement.scrollWidth <=
    clientWidth` asserted in the same run so "no overflow" is measured, not
    eyeballed.
20. **[M2 acceptance]** Create / join / leave specified and screenshotted in
    default/hover/pressed/disabled × light/dark = **16 states**.
21. The 2×5 lobby renders 10 seats for every `memberCount` 0–10 and never names
    an occupant.
22. A 20-code-point name and a 2-emoji name both render without clipping in a
    board row at 320px.

**Motion**
23. **[M2 acceptance]** Every new Rrethi animation has an explicit reduced-motion
    rule, verified with the **OS setting on**. **Method:** iOS Simulator with
    Settings → Accessibility → Motion → Reduce Motion enabled; artifact is a
    screenshot of each of §7's four moments in its final state.
24. No Rrethi element animates while the game board has focus or a guess is in
    flight.

**Client ↔ server contract**
25. Every error code in `ERROR_STATUS` has client copy, and an unknown code
    renders the generic line. Asserted by importing the real `ERROR_STATUS` so a
    new server code fails this test loudly.
26. `POST /circles` is never retried automatically — assert with a client whose
    first attempt times out, that exactly one request was made.
27. A `429` response's `Retry-After` is honoured and no request is made before it
    elapses.
28. The invite URL is built client-side and uses the canonical IDNA origin;
    `tests/launch.test.js` already pins that origin and must cover this string.

**Board payload (§9)**
29. Unmasked rows carry `avatarId` and `letterSeal`; masked rows carry neither.
30. **Every M1 spoiler test still passes unedited.** If one needs a change, §9
    was implemented wrongly.

**Prune (§10)**
31. `pruneRateBuckets` deletes rows older than the threshold, leaves newer ones,
    and is a no-op on an empty table — on **both** adapters, in the conformance
    suite.
32. The opportunistic trigger fires at roughly the stated rate and never turns a
    successful request into a failure when it throws.

**Privacy**
33. **[M1 acceptance 47, re-run]** After a full scripted M2 run in a
    service-worker-controlled browser, Cache Storage contains zero `/api/*`
    entries. Already closed for M1 on 2026-08-11; re-run because M2 adds the
    first real client calls.
34. No circle code appears in `document.title`, the URL after join, an analytics
    event, or any log line. The code is an invite credential (M1 §2.3).
35. The URL is cleaned of `?rrethi=` after the join card is handled, so a shared
    screenshot of the address bar does not leak the code.

**Regression**
36. With the flag **off**, the app is byte-identical to today's behaviour.
    **Method:** the technique `review-scars` #6 forced — execute old vs new logic
    modules with identical inputs, **and** diff the service-worker precache list,
    the network waterfall, and the rendered copy. "The flag gates the UI" is not
    evidence.
37. The service worker still bypasses `/api` before any cache strategy
    (`service-worker.js:104`), and `CACHE_NAME` advances if any cached runtime
    file changes (`review-scars` #9 — this trips four pins in
    `tests/launch.test.js`).
38. Daily / archive / practice stats are untouched by Rrethi. A circle result
    never writes to `modeStats`.
39. **Archive cannot hurt the daily record** stays true with Rrethi on — the
    roadmap's Phase-2 acceptance, re-asserted because M2 adds a second writer to
    the completion path.

**Sequencing**
40. `RRETHI_ENABLED` and `RRETHI_API_ENABLED` are independent: all four
    combinations behave sanely, and flag-on/server-off shows `pa lidhje` rather
    than an error dialog (the server answers `404`, which the client must treat
    as "service unavailable", not "bad code" — see §3's table).
41. **Native Albanian copy pass completed** on the §6 table. This is a **merge
    blocker for M2**, not a follow-up: M2 is the first milestone that puts
    Albanian on a user's screen, and `review-scars` #3 records that generated
    Albanian carries agreement errors and non-words.

---

## 12. Open decisions

**P1 — Where does the Rrethi entry point live?** §2.1 says "stats sheet → new
Rrethi section". The stats dialog is already dense (four mode sections).
*Recommendation: start in the stats sheet as specified*, and treat a dedicated
tab as an M4 question answered by whether people find it. Needs a yes/no.

**P2 — Does the board screen show the week, or is it a second screen?**
Unspecified. *Recommendation: one screen, board on top, week collapsed below*,
because two taps to see a week nobody asked for is worse than one long screen —
but this is a layout call that wants your eye on a 320px screenshot before it is
built.

**P3 — What does a member see for a circle they are in but whose board is fully
masked and whose week is fully masked?** (A new member who has played nothing.)
*Recommendation: the roster with `Ende po luan` for everyone and the "opens at
midnight" line* — never an empty state that reads as an error.

**P4 — Should the recovery screen block the first join, or follow it?**
§2.1 says the code is shown "on joining". *Recommendation: after the join
succeeds*, so a network failure does not strand the player on a screen about a
credential they may not need yet.

**P5 — Rollout target.** §2.11 says a protected preview deployment, owner's
device first. *Recommendation: adopt it as written*, which means M2 lands with
both flags off and a preview build is the only place it runs until M4.

---

## 13. Deviations from the plan text, recorded

*(None yet — this is a draft. Anything the implementation must change about
plan §2.1/§2.2/§2.6/§2.11 gets a numbered entry here, as M1's D1–D10 did, so the
precedence rule in the preamble cannot silently revert it.)*
