# PLAN — Rrethi M1: the nine HTTP endpoints

> **DRAFT — for review.** Nothing here is implemented. This document expands
> `PLAN-RRETHI-2026-08.md` §2.7 into an implementable contract and is subordinate
> to it: where this file and the plan disagree, the plan wins unless the
> disagreement is recorded in §12 (Deviations) below.
>
> **All Albanian user-facing strings quoted in this document are UNVERIFIED**
> and stay UNVERIFIED until the native review pass. No endpoint in M1 returns a
> human-readable message in any language — see §2 — so no Albanian string is on
> the wire. The strings appear here only as context for M2's UI.

Milestone M0 shipped storage and nothing else: `api/_lib/store.js` (interface +
shared validation), `store-memory.js`, `store-neon.js`, `schema.sql`. This
branch adds `api/_lib/board.js` (masking). The only live HTTP route today is
`api/health.js`. M1 adds the nine endpoints and the three store operations they
cannot be written without.

---

## 0. Scope

**In scope.** The nine endpoints of §2.7; the shared HTTP envelope; bearer auth;
rate-limit policy; the atomic seat claim; the schema deltas those require.

**Non-goals, explicitly.** No UI (M2). No `privatesia.html` rewrite (M3 — but see
§11, the server gate exists so M1 can deploy without breaking the §2.10 promise).
No invite-code revocation endpoint, no `show_time` toggle endpoint, no ownership
transfer, no avatar on the board payload, no streak field, no retention sweep
job — **the sweep is owned by M2**, alongside the daily `rate_bucket` prune the
schema already documents, and it must be running before M3's privacy page states
the 400-day promise publicly — no `Sfida`, no motion. Each of those is either a
later milestone or listed in §11 as an open decision. **An implementer who finds themselves adding a tenth
endpoint has left the brief.**

**Module layout.**

| File | Contents |
|---|---|
| `api/rrethi/[[...path]].js` | The single router: one Vercel function for all nine routes |
| `api/_lib/http.js` | Header set, method gate, origin check, body reader, error envelope |
| `api/_lib/auth.js` | Bearer parsing, `memberKey` derivation, log redaction |
| `api/_lib/limits.js` | Bucket key derivation + the four policies of §3 |
| `api/_lib/store.js` (edit) | Three new methods, `Member` typedef gains two fields (§7) |
| `api/_lib/store-memory.js`, `store-neon.js` (edit) | Implement them |
| `api/_lib/schema.sql` (edit) | §6 |
| `server.mjs` (edit) | Forward `/api/rrethi/…` to the router in local dev |

One router, not nine files. Vercel Hobby caps functions per deployment, every
route shares the same auth/limit/envelope preamble, and nine copies of that
preamble is nine places for the spoiler rule or the redaction rule to drift.
Path parsing is a `switch` over a split pathname, not a regex zoo.

**No new npm dependencies.** `node:crypto` covers HMAC; `@neondatabase/serverless`
is already a dependency and stays behind the dynamic `import()` in
`createStore` (`store.js` documents why: `rm -rf node_modules && npm test` must
stay green).

---

## 1. Shared HTTP envelope

Every one of the nine responses obeys this. It is `api/health.js`'s discipline,
lifted into `api/_lib/http.js` so it is written once.

**Headers on every response**, set before any branch runs (health.js sets them
first thing, so an early `405` carries them too):

```
Cache-Control: private, no-store, max-age=0
Content-Type: application/json; charset=utf-8
X-Content-Type-Options: nosniff
X-Robots-Tag: noindex, nofollow
Content-Length: <byte length of the payload>
```

`vercel.json` already sets `Cache-Control` and `X-Robots-Tag` for `/api/(.*)`.
The handler sets them anyway: §2.7 requires `no-store` to hold independently of
a handler *and* independently of a config file, and the local dev server
(`server.mjs`) does not read `vercel.json`.

**Never emitted:** `Access-Control-Allow-Origin` (CORS stays off, §2.7), any
`Set-Cookie`, any header derived from a request header.

**Method gating.** Each route declares its verbs. A mismatch returns `405` with
an `Allow` header listing them, exactly as health.js does. `OPTIONS` is *not*
implemented: it returns `405`. That is deliberate — a cross-origin JSON POST
requires a successful preflight, so refusing to answer preflights is a second,
independent CSRF defence behind the origin check.

**Origin check (state-changing verbs only: POST, DELETE).** Derive this
deployment's own origin from `x-forwarded-proto` (default `https`) and `host`.
If the request carries an `Origin` header that is not byte-equal to it → `403
forbidden_origin`. An absent `Origin` is allowed: non-browser clients (the
scripted M1 acceptance run, `curl`) send none, and a browser omits it only on
same-origin GETs, which are not state-changing. Deriving from `host` rather than
a hard-coded constant is what makes preview deployments work without an env var.

**Request body.** Read only for `POST`.

| Rule | Failure |
|---|---|
| `Content-Type` must be `application/json`, optionally `; charset=utf-8` | `415 unsupported_media_type` |
| Body ≤ **2048 bytes**, enforced while streaming (never buffer past the cap) | `413 payload_too_large` |
| Body must parse as JSON and be a non-null, non-array object | `400 malformed_json` |
| Unknown keys are **ignored**, not rejected | — |

Unknown keys are ignored so an older client is not broken by a newer field; the
2 KiB cap is what stops that leniency from being a memory hole. The largest legal
body (a 20-char name, an avatar id, a letter seal) is under 120 bytes, so 2 KiB
is roomy by a factor of seventeen and still nothing an attacker can use.

**Query strings** are parsed with `new URL(request.url, "http://localhost")`
inside a `try`; a malformed URL is `400 invalid_field`, never a crash.

### 1.1 The error envelope

Exactly one error shape across all nine endpoints:

```json
{ "status": "error", "error": "invalid_field", "field": "displayName" }
```

`status` is always the literal `"error"` (health.js's shape). `error` is a code
from the closed set below. `field` is **optional** and present only for
`invalid_field`; its value comes from a closed list too: `displayName`,
`avatarId`, `letterSeal`, `name`, `code`, `date`, `start`, `attempts`, `besa`,
`hint`, `seconds`.

**There is no `message` key, ever.** No driver text, no SQLSTATE, no hostname, no
schema name, no stack, no "expected 1..6, got 9". A code plus a field name is
everything a client needs to show its own Albanian copy, and it is the only shape
that cannot leak. Adapter errors are caught at the router boundary: log the
bounded pair health.js already logs (`{ name, code }`, both regex-clamped) and
return `500 server_error`. `store.js` guarantees every adapter error is a plain
`Error` whose message starts with `rrethi: ` with the driver error hidden in
`cause` — **`cause` is never logged and never serialised**, because a Postgres
connection error message can embed the connection URL.

**Closed error-code set.** Any status not in this table is a bug.

| Code | Status | Fires when |
|---|---|---|
| `not_found` | 404 | Unknown circle code; unknown path; the server gate is off (§11) |
| `method_not_allowed` | 405 | Verb not in the route's `Allow` list, including `OPTIONS` |
| `unsupported_media_type` | 415 | POST without `application/json` |
| `payload_too_large` | 413 | Body over 2048 bytes |
| `malformed_json` | 400 | Body is not a JSON object |
| `invalid_field` | 400 | A field fails its validation rule (carries `field`) |
| `invalid_date` | 400 | `date`/`start` is not a real `YYYY-MM-DD` calendar date |
| `date_out_of_range` | 400 | Date is legal but outside the endpoint's allowed window |
| `unauthorized` | 401 | Missing, malformed, or non-canonical bearer token |
| `unknown_member` | 401 | Well-formed bearer, no `member` row (register first) |
| `forbidden_origin` | 403 | Cross-origin state-changing request |
| `not_a_member` | 403 | Authenticated member is not in this circle |
| `circle_full` | 409 | All 10 seats taken |
| `circle_limit_reached` | 409 | Member already in 10 circles |
| `result_exists` | 409 | A result row already exists for (circle, member, date) |
| `rate_limited` | 429 | A bucket in §3 is exhausted; carries `Retry-After` (seconds) |
| `server_error` | 500 | Anything unexpected, including any adapter throw |
| `not_configured` | 503 | `RRETHI_SERVER_PEPPER` missing or not 64 hex chars |

`401 unauthorized` and `401 unknown_member` are distinguished because the client
must react differently: the first means "your token is broken, show recovery",
the second means "call `POST /members` first". Neither reveals whether a
*different* token exists, because the derivation is a one-way HMAC.

`404 not_found` deliberately covers both "no such circle" and "gate off". A
circle code is a 65-bit invite credential; distinguishing "wrong code" from
"service disabled" would confirm nothing useful, and collapsing them costs
nothing.

---

## 2. Auth

### 2.1 The token

`Authorization: Bearer <secret>` on **all nine endpoints**, including
`POST /api/rrethi/members`.

§2.7 says "bearer auth on all but `POST /members`". Read against §2.2 that can
only mean *the member row need not already exist* — it cannot mean the header is
absent, because `member_key = HMAC-SHA-256(pepper, secret)` is the only thing
that identifies the row being created. `POST /members` is therefore the one
endpoint that accepts a bearer resolving to a key with no row behind it. Every
other endpoint returns `401 unknown_member` in that case.

**Canonical wire form of `<secret>`:** the 128-bit secret encoded as **26
Crockford base32 characters, uppercase, no separators, no checksum character**:

```
^[0-9A-HJKMNP-TV-Z]{26}$
```

(Crockford's alphabet excludes `I`, `L`, `O`, `U`.) A token failing this regex is
`401 unauthorized` and is rejected **before** any HMAC, any store call, and any
member-scoped rate-limit take — a malformed token has no member to charge, so it
falls to the anonymous bucket (§3).

**The server never accepts the recovery-code display form.** §2.2 defines the
recovery code as `RKTH-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX-C`: the same 26
characters, regrouped, with a fixed label prefix that adds no entropy and one
checksum character. The client strips the prefix, the dashes and the checksum,
and validates the checksum **locally**, so a typo costs no round trip. If the
server also accepted the display form it would need a second checksum
implementation and a second normalisation, and the two would drift. One
canonical form on the wire; all cosmetics stay client-side.

**The server never mints the secret** and therefore never returns a recovery
code — see §12, deviation D1.

### 2.2 Derivation

```js
const key = Buffer.from(env.RRETHI_SERVER_PEPPER, "hex");   // 32 bytes
const memberKey = createHmac("sha256", key).update(secret, "utf8").digest("hex");
```

64 lowercase hex characters. `RRETHI_SERVER_PEPPER` must match health.js's
`PEPPER_PATTERN` (`/^[0-9a-f]{64}$/i`) — health.js already reports
`identity: "misconfigured"` when it does not, and the router returns
`503 not_configured` for the same condition rather than hashing with a weak or
empty key. The raw secret is never stored, never written to a variable that
outlives the request, and never passed to the store layer.

Rotating the pepper orphans every member row irreversibly. That is the intended
property (§2.2: "we cannot enumerate, re-identify, or restore anyone"), and it
means the pepper is a **backup-critical secret**, not a rotatable one. Say so in
the deploy runbook.

### 2.3 Log redaction

Non-negotiable, and M1 acceptance tests it (§2.12: "raw bearer values never
appear in logs").

- The `Authorization` header is never logged, never included in an error object,
  never echoed in a response, never placed in a URL.
- `memberKey` is never logged either. It is not the secret, but it is a stable
  identifier for a person whose whole privacy claim is that we hold nothing
  linkable; a log line is exactly the copy that survives `DELETE /api/rrethi/me`
  and quietly breaks §2.10's "immediate and irreversible".
- **Circle codes are never logged.** A code is an invite credential: anyone
  holding it can read a family's board.
- The permitted log line is health.js's: a bounded `name` and `code`, nothing
  else. If a log needs to correlate requests, use a per-request random id
  generated on the spot, not anything derived from identity.

### 2.4 `last_seen_at`

`store.js` records a known M0 gap: nothing updates `member.last_seen_at`. M1
closes it. After auth succeeds and **only for a member that exists**, the router
calls `touchMember(memberKey)` (§7). It is fire-and-forget: awaited but its
failure is swallowed (logged as bounded `{name, code}`), because a failed
bookkeeping write must not turn a successful board read into a `500`. It is also
skipped entirely on `DELETE /api/rrethi/me` — touching a row you are about to
delete is a wasted write and a race with the delete.

---

## 3. Rate limiting

§2.5 sets three limits: **60 req/min per member key, 10 circle creations/day, 20
joins/day**, plus a rotating anonymous bucket. `takeToken(bucket, limit, windowMs)`
is the only primitive; it is a fixed window that returns `false` once `limit`
calls have landed in the current window.

### 3.1 Bucket keys

Bucket keys are never a raw identifier. Both forms below are HMACs under the
same server pepper, truncated to 32 hex characters (128 bits — collision-free at
any scale this product will see):

```js
const h = (scope, value) =>
  createHmac("sha256", pepperBytes).update(`${scope}:${value}`).digest("hex").slice(0, 32);
```

| Bucket | Key | Limit | Window | Applies to |
|---|---|---|---|---|
| Member minute | `rl1:min:` + `h("min", memberKey)` | 60 | 60 000 ms | Every request with a canonical bearer |
| Circle creation | `rl1:create:` + `h("create", memberKey)` | 10 | 86 400 000 ms | `POST /circles` only |
| Join | `rl1:join:` + `h("join", memberKey)` | 20 | 86 400 000 ms | `POST /circles/:code/join` only |
| Anonymous | `rl1:ip:` + `h("ip", hourIndex + ":" + ip)` | 60 | 60 000 ms | Every request **without** a canonical bearer |

**Why the member bucket is an HMAC of `memberKey` and not `memberKey` itself.**
`rate_bucket` has no foreign key and no delete cascade. A raw `memberKey` sitting
in `rate_bucket` would survive `DELETE /api/rrethi/me` for up to 48 hours and be
trivially joinable to the identity we just promised to erase. The HMAC is
one-way, so a surviving bucket row is unlinkable. `schema.sql`'s own comment
already anticipates this: "The bucket key is a hash … and is never joined to a
member row."

**The anonymous bucket, precisely (§2.5: "a raw IP or plain hash is never
stored … short-lived HMAC of the IP plus the current window, rotated and pruned
within 48 hours").**

- `ip` = the first entry of `x-forwarded-for`, trimmed; empty or absent → the
  literal `"unknown"` (one shared bucket for clients we cannot distinguish;
  they get one shared 60/min allowance, which is the conservative direction).
- `hourIndex = Math.floor(Date.now() / 3_600_000)` — the key rotates hourly, so
  no bucket row is a durable identifier for an address, and at most 24 rows per
  address per day exist.
- The raw IP exists only as a local variable inside the derivation. It is never
  stored, never logged, never returned, and never used for anything else. No
  IP-reputation logic exists; §2.5 lists it as a deliberate non-goal.
- Pruning: `DELETE FROM rate_bucket WHERE window_start < now() - interval '1 day'`,
  the statement `schema.sql` already names. M1 runs it **opportunistically** —
  a 1-in-500 chance per authenticated request, best-effort, failure ignored — so
  no cron job is required on Hobby. §2.8's 48-hour promise is met with a 24-hour
  threshold and margin.

### 3.2 Policy

**Exactly one bucket take per request in the common case.** The member bucket if
the bearer is canonical; the anonymous bucket if it is not. Never both — charging
both would double the cost of every request for no extra protection, since a
request cannot be simultaneously authenticated and anonymous.

Order inside a request:

0. The `RRETHI_API_ENABLED` gate (O6) fires first — before any bucket take or
   store call. A disabled service answers `404` for free; it must not write
   `rate_bucket` rows while switched off.
1. Headers, method gate, origin check, body limits — all free, no store call.
2. Parse the bearer. Canonical → derive `memberKey`; else → anonymous bucket.
3. Take the minute bucket. `false` → `429 rate_limited` with `Retry-After: 60`,
   before any other store call.
4. Auth/lookup (`getMember`), then the endpoint's own work.
5. On `POST /circles` and `POST /circles/:code/join` only: take the second,
   daily bucket **after** validation passes but **before** the write. `false` →
   `429` with the constant `Retry-After: 3600` — `takeToken` does not expose
   `window_start`, and that is fine: a too-small retry-after costs the client
   one extra retry, while leaking the exact window start would let a caller
   schedule around the limiter precisely.

**Honest cost note.** With `RRETHI_STORE=neon`, step 3 is one `rate_bucket`
upsert per request — including cheap board reads, which `store.js` warns about
("reserve DB-backed buckets for the operations genuinely worth a round trip").
M1 pays it anyway, because §2.12's M1 acceptance ("61 requests in a minute
produce exactly one `429`") is only true of a globally counted bucket, and a
per-instance memory counter on Vercel gives `limit × instances`. **If M4's
CU-hour measurement (§2.12: ≤40 CU-hours over 14 days) shows this upsert is the
binding cost, the named fallback is:** move the *read* endpoints (board, week,
`GET /circles/:code`) to a per-instance in-memory limiter and downgrade their
guarantee to best-effort in writing, keeping the DB-backed bucket for writes.
Do not make that trade speculatively, and do not make it silently.

---

## 4. The 10-seat cap as a database invariant

§2.5 is explicit: "Both caps are database invariants: a handler-side count
followed by `addMembership` is forbidden because concurrent joins can create an
eleventh seat. M1 needs one atomic join operation and a two-request race test
that proves exactly one final seat is granted."

The M0 store cannot express this. `addMembership(code, key)` inserts
unconditionally and returns `'created' | 'conflict'` on the `(circle_code,
member_key)` primary key only — it has no idea how many seats are taken. A
handler that reads the count and then calls it is a TOCTOU race over a
non-interactive HTTP driver with no transaction spanning the two calls.

### 4.1 The new store method

```js
/**
 * Atomically seat a member in a circle.
 *
 * @property {(code:string, key:string, maxSeats:number, maxCircles:number)
 *            => Promise<'created'|'conflict'|'full'|'missing'|'over_circle_limit'>} claimSeat
 */
```

Discriminated return values, in the discipline `store.js` already sets (expected
outcomes are values, not exceptions):

| Value | Meaning | Handler maps to |
|---|---|---|
| `'created'` | A new membership row exists, holding a seat in `1..maxSeats` | `201` |
| `'conflict'` | This member already holds a seat in this circle; nothing changed | `200` (idempotent join) |
| `'full'` | The circle exists and all `maxSeats` seats are taken | `409 circle_full` |
| `'missing'` | No circle with this code | `404 not_found` |
| `'over_circle_limit'` | This member is already in `maxCircles` circles | `409 circle_limit_reached` |

`'missing'` is a value rather than the `foreignKeyError` throw that `putResult`
uses, because "someone typed a wrong invite code" is an ordinary outcome that
must become a `404`, not an exception path. `addMembership` stays in the
interface unchanged — the M0 conformance suite depends on it, and it remains the
correct primitive for tests that do not care about seats.

`maxSeats` and `maxCircles` are passed, not hard-coded in the adapter, but
`store.js` exports the constants the handler must use:

```js
export const CIRCLE_MAX_MEMBERS = 10;   // plan §2.1.1, §2.5
export const MEMBER_MAX_CIRCLES = 10;   // plan §2.5
```

The adapter rejects `maxSeats > CIRCLE_MAX_MEMBERS`, because the database CHECK
is hard-coded at 10 and a larger argument would produce a confusing constraint
violation instead of a clean answer.

### 4.2 The SQL that makes it true

One statement. Concurrency is resolved by the unique index, not by the handler:

```sql
INSERT INTO public.membership (circle_code, member_key, seat, joined_at)
SELECT c.code, $2,
       (SELECT COALESCE(MAX(m.seat), 0) + 1
          FROM public.membership m WHERE m.circle_code = c.code),
       now()
  FROM public.circle c
 WHERE c.code = $1
   AND (SELECT COUNT(*) FROM public.membership m WHERE m.circle_code = c.code) < $3
   AND (SELECT COUNT(*) FROM public.membership m WHERE m.member_key  = $2) < $4
ON CONFLICT (circle_code, member_key) DO NOTHING
RETURNING seat;
```

Two concurrent joins that both observe nine occupied seats both compute
`seat = 10`. One commits; the other violates `UNIQUE (circle_code, seat)` and
raises SQLSTATE `23505`. **The eleventh seat is refused by the index, not by a
count the handler read a moment ago.** `CHECK (seat BETWEEN 1 AND 10)` is the
second line of defence: even a caller that passes a wrong `maxSeats` cannot
write seat 11.

Adapter control flow:

1. Run the statement. One row back → `'created'`.
2. `23505` on the **seat** index → a concurrent join won the seat. Retry the
   whole statement, up to **5 attempts**. Each retry re-evaluates both count
   guards, so a loser converges to `'full'` when the circle filled up and to a
   higher seat when it did not. Exhausting five attempts throws
   `storeError("seat contention")` → `500`; with a 10-seat ceiling this is
   genuinely unreachable and must be loud if it ever happens.
3. `23505` on the membership **primary key** → `'conflict'` (the member raced
   themselves, e.g. an outbox double-flush).
4. Zero rows and no error → one disambiguating `SELECT` decides which guard
   failed: no circle row → `'missing'`; a membership row for this member in this
   circle → `'conflict'`; this member's total memberships ≥ `maxCircles` →
   `'over_circle_limit'`; otherwise → `'full'`. This extra read runs only on the
   failure path, so the happy path stays one round trip.

**Exactness, stated honestly.** The seat cap is exact: `UNIQUE (circle_code,
seat)` cannot be beaten. The circles-per-member cap is exact against concurrent
joins by *different* members, and best-effort against one member racing
themselves across two different circles — those two statements touch no common
unique key, so both can pass their guard and produce an eleventh circle for that
member. That failure needs a member deliberately racing their own requests to
gain nothing but a longer list, so M1 accepts it and does not add a second
`(member_key, slot)` unique index. Revisit only if M4 shows abuse (§11, O5).

**Memory adapter.** Mirrors the SQL, as `store.js` requires ("the memory adapter
mirrors the SQL rather than inventing convenient semantics"): assign
`max(seat)+1`, enforce both caps and the `1..10` range, return the same five
values. It is single-threaded, so it cannot *observe* the race — which is why
the race test below does not live there.

### 4.3 The required race test

Three layers, because no single one of them is honest on its own.

**(a) Deterministic invariant, every adapter, always runs.** Fill seats 1–10.
`claimSeat` for an eleventh member returns `'full'`, and `listMembers(code)`
still returns exactly 10 rows. Then remove seat 4 and claim again: the new member
gets a seat, total is 10 again, and no two members share a seat.

**(b) Real concurrency against real Postgres, gated.** With
`RRETHI_TEST_NEON_URL` set (a scratch project, never production — the M0 rule):
seat a circle to nine members, then

```js
const [a, b] = await Promise.all([
  store.claimSeat(code, keyA, 10, 10),
  store.claimSeat(code, keyB, 10, 10),
]);
```

Assert: exactly one of `a`/`b` is `'created'`, the other is `'full'`; `SELECT
COUNT(*) FROM membership WHERE circle_code = $1` is exactly 10; and
`SELECT COUNT(DISTINCT seat)` equals `COUNT(*)`. Repeat 20 times against fresh
circles — a single run of a race test proves nothing about a race.

**(c) The constraint itself, under the pglite bridge (`npm run test:neon-bridge`).**
The bridge runs real WASM Postgres but **serialises statements**, so it cannot
reproduce (b)'s interleaving — say so in the test file rather than letting a
green run imply a concurrency proof. What it *can* prove, and must: a direct
`INSERT` of a duplicate `(circle_code, seat)` raises `23505`, and a direct
`INSERT` of `seat = 11` raises `23514`. Those two assertions are what make (a)
and (b) meaningful; without them a passing suite only shows the handler behaves,
not that the database would refuse.

---

## 5. The result write window

§2.5: "today's or yesterday's Tirana date only (6-hour grace for someone who
finished at 23:58 offline)".

The date arithmetic reuses `src/game.js` and adds no second implementation —
§2.4 is explicit that "a second date implementation is how epochs drift", and
`board.js` already sets the precedent.

```js
import { getTiranaDateKey, tiranaMidnightEpoch } from "../../src/game.js";

const RESULT_GRACE_MS = 6 * 60 * 60 * 1000;

// `now` is injectable so the fake-clock acceptance runs of §2.12 can drive it.
function allowedPlayDates(now = new Date()) {
  const todayKey = getTiranaDateKey(now);
  const [y, m, d] = todayKey.split("-").map(Number);
  const midnight = tiranaMidnightEpoch(y, m, d);          // exact UTC instant
  if (now.getTime() >= midnight + RESULT_GRACE_MS) {
    return [todayKey];
  }
  // One millisecond before local midnight is unambiguously yesterday, on every
  // day of the year including both DST transitions. Never subtract 86_400_000
  // from `now` to get "yesterday".
  return [todayKey, getTiranaDateKey(new Date(midnight - 1))];
}
```

**`tiranaMidnightEpoch` is currently module-private in `src/game.js` (line 344).
M1 adds `export` to that one declaration and changes nothing else about it.** Do
not copy the function; do not write a `getTiranaHour`. §2.4 already names this
pair as the sanctioned source.

A `date` outside the returned set is `400 date_out_of_range`. A `date` that is
not a real calendar date is `400 invalid_date` (`assertDateKey` in `store.js`
is the referee — it rejects `2026-02-30`).

**Semantics of "6 hours", stated so the DST test has a right answer.** The grace
is six hours of *elapsed real time* after the exact instant of Tirana midnight.
On the spring-forward day (local clocks jump 02:00→03:00) that window ends at
07:00 local; on the fall-back day it ends at 05:00 local. Wall-clock-hour
semantics would need a second date implementation to ask "what is the local
hour", which §2.4 forbids. Elapsed-time semantics are also monotone: the window
never reopens.

---

## 6. Schema deltas

`schema.sql` today has **no `avatar_id`, no `letter_seal`** (§2.8 documents both
on `member`) and **no `seat`**. Every statement below is appended to
`schema.sql`, keeping its two parsing conventions: every object explicitly
`public.`-qualified (the conformance suite rewrites that prefix to isolate test
runs), and one statement per `;` at end of line with no dollar-quoted bodies.

```sql
-- M1. Plan §2.8: the member profile the client already persists locally
-- (src/avatars.js) and §2.1.1 says M1 transmits. Defaults are the catalog
-- defaults, so a row written by M0 code remains valid.
ALTER TABLE public.member
  ADD COLUMN IF NOT EXISTS avatar_id TEXT NOT NULL DEFAULT 'stick-racer';
ALTER TABLE public.member
  ADD COLUMN IF NOT EXISTS letter_seal TEXT NOT NULL DEFAULT 'ë';

-- M1. The 10-seat cap as an invariant (plan §2.5). Added nullable, backfilled,
-- then constrained, so the file stays runnable against an existing M0 database.
ALTER TABLE public.membership
  ADD COLUMN IF NOT EXISTS seat SMALLINT;

UPDATE public.membership m
   SET seat = s.rn
  FROM (SELECT circle_code, member_key,
               ROW_NUMBER() OVER (PARTITION BY circle_code
                                  ORDER BY joined_at, member_key) AS rn
          FROM public.membership) s
 WHERE m.circle_code = s.circle_code
   AND m.member_key = s.member_key
   AND m.seat IS NULL;

ALTER TABLE public.membership
  ALTER COLUMN seat SET NOT NULL;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, and the schema loader cannot
-- run a DO block (no dollar-quoting). DROP IF EXISTS + ADD is idempotent, needs
-- no new loader syntax, and the table is small enough that the lock is
-- irrelevant at this scale.
ALTER TABLE public.membership
  DROP CONSTRAINT IF EXISTS membership_seat_range;
ALTER TABLE public.membership
  ADD CONSTRAINT membership_seat_range CHECK (seat BETWEEN 1 AND 10);

-- This index is the cap. Two concurrent joins that compute the same seat
-- collide here instead of producing an eleventh member.
CREATE UNIQUE INDEX IF NOT EXISTS membership_circle_seat_idx
  ON public.membership (circle_code, seat);
```

Also update the `CREATE TABLE` bodies at the top of the file to include the same
three columns and the CHECK, so a fresh database gets them in one statement and
the ALTERs are a no-op. Both paths must end in the same shape; the test in §10
asserts it by applying the file twice to an empty database and once to an M0
database, then comparing `information_schema`.

**Migration risk, assessed rather than assumed.** No production database exists:
`RRETHI_STORE` is unset in production (health.js treats `memory` as the intended
production configuration until the Rrethi rollout), there are no endpoints, and
the only databases that have ever seen this schema are scratch/CI ones. So the
`UPDATE` backfill touches zero rows in practice and the `SET NOT NULL` cannot
fail. The one way it *can* fail is a hand-made scratch circle with more than ten
memberships, which would break `membership_seat_range`; if that happens, delete
the scratch circle rather than widening the constraint.

---

## 7. Store interface additions

Additive only. No existing method changes shape, so the M0 conformance suite
keeps passing unmodified — and the suite is extended, not replaced.

```js
/**
 * @property {(code:string, key:string, maxSeats:number, maxCircles:number)
 *            => Promise<'created'|'conflict'|'full'|'missing'|'over_circle_limit'>} claimSeat
 * @property {(key:string, profile:{displayName:string, avatarId:string, letterSeal:string})
 *            => Promise<'created'|'updated'>} upsertMember
 * @property {(key:string) => Promise<void>} touchMember
 */
```

- **`claimSeat`** — §4.
- **`upsertMember`** — `POST /members` is both registration and profile edit
  (§2.2: "The display name is per-player, circle-visible, editable"), and there
  is no `PATCH` endpoint among the nine. `createMember` is documented as an
  intentional no-op for an existing member, so it cannot serve the edit; rather
  than change its contract, M1 adds one upsert that covers both and returns
  which happened. `createMember` and `renameMember` stay for the conformance
  suite and for tests that want the narrow primitive.
- **`touchMember`** — updates `last_seen_at` only; the gap `store.js` records.

`Member` gains `avatarId` and `letterSeal` (both `string`, never null — the
columns are `NOT NULL DEFAULT`). `getMember` and `listMembers` return them.
**`buildBoard` is not changed to emit them**: the board payload identifies people
by display name only, and adding avatars to it is M2's problem (§11, O2). Keeping
`board.js` byte-identical in M1 keeps the spoiler test surface identical.

Conformance-suite additions (run against every configured adapter): the §4.3(a)
seat invariants; `upsertMember` returning `'created'` then `'updated'` and the
second call actually changing all three fields; `touchMember` advancing
`lastSeenAt` and being a silent no-op on an unknown key (matching
`renameMember`); `claimSeat` on a missing circle returning `'missing'` and
throwing nothing.

---

## 8. The nine endpoints

Conventions for every table below: the router has already applied §1 (headers,
method gate, origin, body limits), §2 (bearer → `memberKey`, `503
not_configured` if the pepper is bad) and §3 step 3 (minute bucket). Only
endpoint-specific behaviour is listed. Every endpoint can additionally return
`401 unauthorized`, `401 unknown_member` (all but 8.1), `429 rate_limited`,
`500 server_error`, `503 not_configured`, `405 method_not_allowed`, and `404
not_found` when the server gate is off.

### 8.0 Shared field rules

Written once; referenced by name below. These are §2.5's rules and `store.js`'s,
not new ones.

| Field | Rule |
|---|---|
| `displayName` | Trim, then NFC-normalise. Then: **2–20 code points** (`Array.from(s).length`), no control characters (the control-character rule of `store.js` — today a module-private constant; export `CONTROL_CHARACTER_PATTERN` additively rather than re-declaring it: `/[\u0000-\u001f\u007f]/u`), at most **2** `\p{Extended_Pictographic}` code points. Rejection → `400 invalid_field`, `field: "displayName"`. No profanity filter — §2.5 names it a deliberate non-goal. |
| `avatarId` | Must satisfy `isAvatarId` from `src/avatars.js`. The server validates against the fixed catalog and does **not** check whether the badge behind an earned avatar was actually earned — §2.1.1: policing a locally altered cosmetic would mean transmitting badge history for no security benefit. |
| `letterSeal` | Must be a member of `ALBANIAN_ALPHABET` (`src/game.js`, 36 entries) after `normalizeWord`. |
| `name` (circle) | Same rule as `displayName`, character for character (§11, O1). |
| `code` (circle) | Normalise: uppercase, strip `-` and the optional `RR` prefix, map Crockford's confusables (`I`,`L`→`1`, `O`→`0`). Then `^[0-9A-HJKMNP-TV-Z]{13}$`. Failure → `400 invalid_field`, `field: "code"`. Normalisation happens **before** the store call, so `getCircle` only ever sees canonical codes. |
| `date`, `start` | `^\d{4}-\d{2}-\d{2}$` **and** a real calendar date (`assertDateKey`). Failure → `400 invalid_date`. |
| `attempts` | Integer `1..6`, or the string `"X"` for a loss. The handler maps `"X"` → `null` for the store. `null`, `0`, `7`, `"3"` → `400 invalid_field`. The wire form matches §2.5's stated shape and the share text; `null` on the wire is ambiguous with "absent". |
| `besa`, `hint` | Strict booleans. `"true"`, `1`, `0` → `400 invalid_field`. |
| `seconds` | Optional. Integer `0..2147483647` (`SECONDS_MAX`) or absent. `null` is accepted as absent. |

---

### 8.1 `POST /api/rrethi/members`

Register or update the caller's profile. The only endpoint that tolerates a
bearer with no row behind it.

**Request** `{ displayName, avatarId, letterSeal }` — all three required.

**Order of store calls:** `getMember(memberKey)` → `upsertMember(memberKey,
profile)`. The `getMember` decides the status code; the upsert is the write.
(One extra read on a path called once per device per lifetime.)

**Success**

```
201 Created   { "memberId": "<64 hex>", "displayName": "…", "avatarId": "stick-racer", "letterSeal": "ë" }
200 OK        (same body, when the member already existed)
```

`memberId` is the `memberKey`. It is derived from the caller's own secret by a
one-way HMAC, it is returned only to the holder of that secret, and it appears in
no other payload — `board.js` deliberately omits member keys everywhere. The
client may keep it for support/debug purposes but **must never place it in a URL
or a share link**. No `recoveryCode` is returned; see §12, D1.

**Errors:** `400 invalid_field` (`displayName` | `avatarId` | `letterSeal`),
`400 malformed_json`, `413`, `415`, `403 forbidden_origin`.

**Idempotency:** fully idempotent. Replaying the same body yields `200` with an
identical body. A client that retries after a network timeout cannot create a
duplicate — the key is a function of the secret, not of the request.

---

### 8.2 `POST /api/rrethi/circles`

**Request** `{ name }`.

**Rate limit:** minute bucket, **plus** `rl1:create` (10/day) taken after
validation and before the first write.

**Order of store calls**

1. `listCirclesFor(memberKey)` — length ≥ `MEMBER_MAX_CIRCLES` → `409
   circle_limit_reached`. (This is the cheap pre-check; `claimSeat` in step 3 is
   the invariant that actually holds under concurrency.)
2. `createCircle(code, name, memberKey)` with a freshly generated code. On
   `'conflict'`, generate a new code and retry — **up to 5 attempts**, then
   `500 server_error`. At 65 bits a collision is a lottery win; five retries is
   for the lottery, not for the common case. `store.js` names this retry loop as
   M1's job.
3. `claimSeat(code, memberKey, CIRCLE_MAX_MEMBERS, MEMBER_MAX_CIRCLES)` — the
   creator takes seat 1. A non-`'created'` result here on a code we just minted
   is impossible; treat it as `500`.

**Code generation:** 13 characters from Crockford's base32 alphabet, drawn from
`crypto.randomBytes` by rejection sampling (mask to 5 bits, discard values ≥ 32
— never `% 32`, which biases the first eight symbols). ~65 bits, §2.5.

**Success**

```
201 Created   { "code": "8G2K4M9P1QRTV", "name": "Familja", "memberCount": 1 }
```

The client renders the invite URL itself: `https://www.xn--fjal-opa.com/?rrethi=RR-8G2K-4M9P-1QRTV`.
The server returns the canonical code and never builds a URL — the canonical
origin is a client concern and hard-coding it server-side breaks previews.

**Errors:** `400 invalid_field` (`name`), `409 circle_limit_reached`, `429`
(either bucket), plus the shared set.

**Idempotency:** **not idempotent.** A retried `POST /circles` creates a second
circle. This is why the daily creation bucket is 10 and not 100, and why the
client must not auto-retry this call from the outbox — the outbox carries results
only (§2.6).

---

### 8.3 `GET /api/rrethi/circles/:code`

The join-card preview. Auth required (any registered member), membership not
required — the code *is* the invitation.

**Order of store calls:** `getCircle(code)` → `null` → `404 not_found`; then
`listMembers(code)`.

**Success**

```
200 OK   { "code": "8G2K4M9P1QRTV", "name": "Familja", "memberCount": 7, "joined": false }
```

`joined` is true when the caller's key is in the roster. **No display names, no
avatars, no seats are returned here.** §2.1.1's 2×5 lobby preview is M2 UI over
the board endpoint after joining; shipping names on a pre-join endpoint would
hand a full family roster to anyone who ever saw the code, including after they
left the circle.

**Errors:** `400 invalid_field` (`code`), `404 not_found`.

**Idempotency:** safe, no side effects beyond `touchMember`.

---

### 8.4 `POST /api/rrethi/circles/:code/join`

**Request** `{ displayName? }` — optional. When present it is validated by the
8.0 rule and applied through `upsertMember` **before** the seat claim, keeping
the member's existing `avatarId`/`letterSeal`. Note for M2's copy: the display
name is **global, not per-circle** (§2.2), so renaming at join renames the member
on every board they are on. That is the plan's model, not an oversight.

**Rate limit:** minute bucket, plus `rl1:join` (20/day) before the write.

**Order of store calls:** (optional `upsertMember`) → `claimSeat(code,
memberKey, CIRCLE_MAX_MEMBERS, MEMBER_MAX_CIRCLES)` → `getCircle(code)` and
`listMembers(code)` to shape the response. Stated consequence of that order: a
join against a nonexistent code returns `404` *after* the rename has applied
globally. Accepted — the rename is user-intended independently of whether the
join lands, and reordering would cost a read on every successful join to save
a rename on the failure path.

**Success**

```
201 Created   { "code": "…", "name": "Familja", "memberCount": 8 }   // claimSeat -> 'created'
200 OK        { "code": "…", "name": "Familja", "memberCount": 8 }   // claimSeat -> 'conflict'
```

**Errors:** `400 invalid_field` (`code` | `displayName`), `404 not_found`
(`'missing'`), `409 circle_full` (`'full'`), `409 circle_limit_reached`
(`'over_circle_limit'`), `429`.

**Idempotency:** idempotent by design. A repeat join returns `200` and changes
nothing — including the seat number, which is assigned once and never reused
while the member stays. A client may retry freely.

---

### 8.5 `DELETE /api/rrethi/circles/:code/members/me`

Leave a circle.

**Order of store calls:** `removeMembership(code, memberKey)`. That is all — no
`getCircle` first. Removing a membership that does not exist is a no-op in both
adapters, and the response is the same either way, so the extra read would only
add a round trip and a way to probe which codes exist.

**Success:** `204 No Content`, empty body with explicit `Content-Length: 0` —
§1's "every response carries `Content-Length`" holds uniformly, and acceptance
test 8 asserts headers on every response including this one.

**Errors:** `400 invalid_field` (`code`), `403 forbidden_origin`. **Not** `404`
— leaving a circle you are not in succeeds silently, which is what makes the
call safely retryable.

**Cascade:** `schema.sql`'s FK takes this member's results **in this circle
only**; their results elsewhere are untouched. The freed seat number becomes
claimable again (`MAX(seat)+1` will reuse it only after the higher seats also
free up; seat numbers are an invariant mechanism, not a display value, and are
never returned in any payload).

**The owner may leave.** The circle survives: `circle.owner_key` still references
a live `member` row, so no FK breaks, and the owner keeps the powers M1 does not
implement anyway (there is no revocation or removal endpoint in the nine). A
circle whose last member leaves is inert and is collected by §2.10's 400-day
retention sweep. See §11, O3 — this is a real product call, flagged for sign-off.

**Idempotency:** fully idempotent; always `204`.

---

### 8.6 `POST /api/rrethi/circles/:code/results`

**Request** `{ date, attempts, besa, hint, seconds? }`.

**Order of store calls**

1. Validate all fields (8.0) and the write window (§5). Out of window → `400
   date_out_of_range`.
2. `getCircle(code)` → `null` → `404 not_found`. Needed anyway for `show_time`.
3. If `circle.showTime` is false → **drop `seconds` to `null` before the
   write.** §2.10 promises elapsed time leaves the device "only if your circle
   enabled it", and the honest reading of that promise is that we do not persist
   what we promised not to collect. `board.js` also strips `seconds` at read
   time; both layers stay, one as the privacy promise and one as defence in
   depth. Consequence to state in the UI later: enabling `show_time` does not
   retroactively reveal times for days recorded while it was off.
4. `putResult({ circleCode, memberKey, playDate, attempts, besa, hint, seconds })`.
   `'created'` → `201`; `'conflict'` → `409 result_exists`.
5. If the adapter **throws** with `FOREIGN_KEY_MESSAGE` (exported by
   `store.js`), the caller is not a member of this circle → `403 not_a_member`.
   Match on that exported constant, never on a driver code — that is the whole
   point of the constant existing.

**Success**

```
201 Created   { "playDate": "2026-08-07" }
```

No points, no rank, no board in the response. The client already has
`weeklyPoints` (`src/points.js`) and computes the same number from the same
module; returning it would be a second scoring path to keep in sync. Crucially,
a fat response here would also be a **spoiler vector**: the POST completes
before the player necessarily wants to see the board.

**Errors:** `400 invalid_field` (`attempts` | `besa` | `hint` | `seconds` |
`code`), `400 invalid_date`, `400 date_out_of_range`, `403 not_a_member`,
`404 not_found`, `409 result_exists`.

**Idempotency:** first write wins, row immutable (§2.5, and the M0 exit
acceptance). **`409 result_exists` is a success for the offline outbox** — the
job is done, drop it, do not retry, do not surface an error. Say this in the
outbox code comment; a client that treats `409` as a failure will retry forever
and burn the minute bucket.

---

### 8.7 `GET /api/rrethi/circles/:code/board?date=`

**Query:** `date` optional, default `getTiranaDateKey(now)`. Must be a real date
(§8.0), not in the future — "future" meaning lexicographically greater than
`getTiranaDateKey(now)`, the same comparison the fake-clock tests pin — and not
older than **400 days** (§2.10 retention) → `400 date_out_of_range`.

**Order of store calls:** `getCircle(code)` → `404` if null → `listMembers(code)`
→ caller not in roster → `403 not_a_member` → `listResults(code, date)` →
`buildBoard({ members, results, viewerKey: memberKey, playDate: date, showTime:
circle.showTime })`.

**The handler performs no masking of its own.** It calls `buildBoard` and
serialises what comes back. It must not re-derive `isBoardMasked`, must not
post-process rows, must not add a field to a masked row. `board.js` exists so
this rule lives in one place; a handler that "helpfully" adds `attempts: null`
to a masked row breaks the M1 acceptance test on the raw response text.

**The mask covers today *and* yesterday** — `isBoardMasked` as shipped on this
branch, which widens §2.4's "today only" because the archive keeps yesterday's
word one tap away, so revealing it spoils a game the viewer can still play
(deviation D5). Be precise about the escape hatch: yesterday's result is
POSTable only inside §5's 6-hour grace, so from 06:00 Tirana onward a viewer who
skipped yesterday sees its board masked with no unmask path until Tirana
midnight reveals the day — the accepted cost recorded in D5. Days older than
yesterday are never masked. **The handler must not encode any of that** — it
passes `playDate` and gets `masked` back.

`buildBoard` also throws if `viewerKey` is not in the roster. That is
defence in depth behind the `403 not_a_member` check, not a substitute for it:
reaching it means the handler skipped its own check, so it must surface as
`500 server_error`, never as a `403` synthesised from a store error message.

**Success**

```
200 OK
{
  "code": "8G2K4M9P1QRTV",
  "playDate": "2026-08-07",
  "masked": true,
  "rows": [ { "displayName": "Ana", "finished": true },
            { "displayName": "Ben", "finished": false, "you": true } ]
}
```

Unmasked, rows carry `attempts` (number or `"X"`), `besa`, `hint`, `points`, and
`seconds` **only when the circle enabled it** — exactly the keys `buildBoard`
emits, in the order it sorts them. M1 passes **no `streaks`** argument, so no
`streak` key appears (§11, O4).

`masked: true` is a boolean the client may read; it leaks nothing, since the
client already knows whether *it* has finished.

**Errors:** `400 invalid_field` (`code`), `400 invalid_date`, `400
date_out_of_range`, `403 not_a_member`, `404 not_found`.

**Idempotency:** safe. Two identical requests can legitimately differ — the
second may be unmasked because the viewer posted their result in between. That
is the feature, not a caching bug, and it is why `no-store` is not optional here.

---

### 8.8 `GET /api/rrethi/circles/:code/week?start=`

Weekly points, Monday–Sunday, Europe/Tirane (§2.3).

**Query:** `start` optional, default the Monday of the current Tirana week. Must
be a real date, **must be a Monday** (otherwise `400 invalid_field`, `field:
"start"` — a silent snap-to-Monday would make two clients disagree about which
week they are looking at), must not be in the future, and must not be older than
400 days.

Compute the Monday without a new date implementation: derive the weekday from
the `YYYY-MM-DD` key arithmetically (the key is already a Tirana calendar date;
no timezone maths is involved in "which weekday is 2026-08-03").

**Order of store calls:** `getCircle(code)` → `404` → `listMembers(code)` →
`403 not_a_member` if the caller is absent → `listResultRange(code, start,
start+6)` (7 days, far under `DATE_RANGE_MAX_DAYS`) → score with `weeklyPoints`
from `src/points.js`, **never a reimplementation**.

**Spoiler rule — a week can leak a masked day.** Points are invertible:
`points = 7 - attempts [+1]`, so publishing a day's points publishes that day's
attempts. The week view must therefore honour exactly the same mask as the
board, and the board's mask now covers **today and yesterday**.

Do it per day, with the shipped function and no second rule:

```js
const masked = new Set();
for (const dayKey of sevenDays) {
  const viewerFinishedThatDay = resultsByDay.get(dayKey)?.has(memberKey) ?? false;
  if (isBoardMasked(dayKey, viewerFinishedThatDay, now)) masked.add(dayKey);
}
```

Every key in `masked` is **omitted from every row's `days` map and excluded from
every `total`**, and the omitted keys are named in the response so the client
renders "javë e pjesshme" (UNVERIFIED copy) rather than a bogus leaderboard.
Note that the mask is per viewer and per day: a viewer who posted today but not
yesterday sees today and not yesterday.

**Do not build the week by feeding `listResultRange` output into `buildBoard`.**
`buildBoard` throws when it receives rows from more than one date — deliberately,
per its comment, because filtering would quietly publish one day's difficulty
under another day's heading. Group by day at the call site and use
`weeklyPoints` directly.

**Success**

```
200 OK
{
  "code": "8G2K4M9P1QRTV",
  "start": "2026-08-03",
  "end": "2026-08-09",
  "maskedDates": ["2026-08-06", "2026-08-07"],
  "rows": [
    { "displayName": "Ana", "days": { "2026-08-03": 6, "2026-08-04": 4 }, "total": 10 },
    { "displayName": "Ben", "you": true, "days": { "2026-08-03": 3 }, "total": 3 }
  ]
}
```

`maskedDates` is always present and is `[]` when nothing is hidden. It lists
dates the viewer cannot see *yet*; it reveals nothing, since the viewer already
knows which days they have finished.

Rows include every member (roster order source: `listMembers`), sorted by `total`
descending, ties broken by `displayName.localeCompare(name, "sq-AL")` — the same
collation `board.js` uses, so the two views never disagree about ordering. Days
with no result are **absent from the map**, not `0`: an absent day and a zero-point
loss are different facts, and omission matches `board.js`'s rule that a masked or
missing value is an absent key rather than a placeholder.

**Errors:** `400 invalid_field` (`code` | `start`), `400 invalid_date`, `400
date_out_of_range`, `403 not_a_member`, `404 not_found`.

**Idempotency:** safe; same caveat as 8.7 about the mask flipping mid-day.

---

### 8.9 `DELETE /api/rrethi/me`

§2.10: "erasing the member row and cascading to memberships and results
immediately and irreversibly".

**Order of store calls:** `deleteMember(memberKey)`. Nothing else — no
`getMember` first, no `touchMember` (§2.4).

**Success:** `204 No Content`. **A repeat delete is also `204`** — §2.12's M3
acceptance requires it explicitly, and there is nothing left to report on.

**Cascade, as `schema.sql` already defines it:** memberships, the results
reachable through them, and **the circles this member owns**, which in turn
cascade their memberships and results. A member who owned the family circle
destroys it for everyone by deleting their data. That is the plan's recorded
decision (`schema.sql` comment: an FK must never block a deletion request), and
M2's confirmation copy must say so in plain Albanian before the button is armed.

**Not erased:** `rate_bucket` rows, which have no cascade. They contain only an
HMAC (§3.1), expire within 24 hours, and are unlinkable to the deleted key —
which is precisely why the bucket key is an HMAC and not the raw `memberKey`.

**Errors:** `403 forbidden_origin`, plus the shared set. Not `404` for an
unknown key: the operation is defined as idempotent, and a `404` would confirm
that a given secret was never registered.

**Idempotency:** fully idempotent, always `204`, no body.

---

## 9. Endpoint summary

| # | Method | Path | Auth | Member row | Membership | Buckets | Success | Idempotent |
|---|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/rrethi/members` | bearer | may be absent | — | minute | 201/200 | yes |
| 2 | POST | `/api/rrethi/circles` | bearer | required | — | minute + create | 201 | **no** |
| 3 | GET | `/api/rrethi/circles/:code` | bearer | required | not required | minute | 200 | yes |
| 4 | POST | `/api/rrethi/circles/:code/join` | bearer | required | becomes one | minute + join | 201/200 | yes |
| 5 | DELETE | `/api/rrethi/circles/:code/members/me` | bearer | required | not required | minute | 204 | yes |
| 6 | POST | `/api/rrethi/circles/:code/results` | bearer | required | **required** | minute | 201 | yes (409 = done) |
| 7 | GET | `/api/rrethi/circles/:code/board` | bearer | required | **required** | minute | 200 | yes |
| 8 | GET | `/api/rrethi/circles/:code/week` | bearer | required | **required** | minute | 200 | yes |
| 9 | DELETE | `/api/rrethi/me` | bearer | not required | — | minute | 204 | yes |

---

## 10. Test checklist

Observable assertions. An implementer is done when every line below is a passing
test, and not before. Lines marked **[M1 acceptance]** are copied from §2.12 and
are the gate.

**Auth**
1. No `Authorization` header → `401 unauthorized`; the response body contains no
   key other than `status` and `error`.
2. `Bearer` with 25, 27, or lowercase characters, or containing `I`/`L`/`O`/`U`
   → `401 unauthorized`, and **no store method is called** (assert with a
   counting store double).
3. A valid token for a key with no row → `401 unknown_member` on endpoints 2–9;
   `201` on endpoint 1.
4. Two different secrets produce different `memberId`s; the same secret produces
   the same one across processes given the same pepper.
5. Changing `RRETHI_SERVER_PEPPER` makes a previously valid token resolve to a
   different `memberId` (the documented irreversibility of rotation).
6. `RRETHI_SERVER_PEPPER` absent or 63 hex chars → `503 not_configured` on all
   nine, with no store call.
7. **[M1 acceptance]** With `console.log`/`console.error` captured over a full
   scripted run, the raw bearer value never appears; neither does any
   `memberKey`, nor any circle code.

**Envelope**
8. Every response across the whole suite carries `Cache-Control: private,
   no-store, max-age=0` and `X-Content-Type-Options: nosniff`. **[M1 acceptance]**
9. Wrong verb → `405` with an `Allow` header naming exactly the supported verbs;
   `OPTIONS` → `405`. **[M1 acceptance]** (wrong content type)
10. `Content-Type: text/plain` on a POST → `415`; body of 2049 bytes → `413`,
    and the handler never buffers more than the cap.
11. A POST with `Origin: https://evil.example` → `403 forbidden_origin` before
    any store call. **[M1 acceptance]** (cross-origin mutation)
12. No error response anywhere in the suite contains the substrings `rrethi:`,
    `SQLSTATE`, `neon`, `postgres`, `password`, `Error:`, or `at ` — asserted on
    raw response text.
13. An adapter forced to throw yields `500 server_error` and a log line whose
    only fields are a bounded `name` and `code`.

**Validation**
14. `displayName` of 1 or 21 code points → `400 invalid_field` / `displayName`;
    20 code points passes; three emoji fails; `"Ana\u0007"` (a literal BEL) fails. **[M1
    acceptance]** (control character)
15. An `avatarId` not in the catalog fails; every one of the 24 catalog ids
    passes; every one of the 36 alphabet letters passes as `letterSeal`.
16. `attempts: 0`, `7`, `"3"`, `null`, `3.5` all fail; `1`–`6` and `"X"` pass,
    and `"X"` is stored as `null` (read back via `listResults`).
17. `besa: "true"` fails. `seconds: -1` and `seconds: 2147483648` fail.
18. `date: "2026-02-30"` → `400 invalid_date`. **[M1 acceptance]**
19. `week?start=2026-08-04` (a Tuesday) → `400 invalid_field` / `start`;
    a reversed or over-long range is impossible to construct through the API,
    and `listResultRange`'s own guard is asserted directly. **[M1 acceptance]**
    (reversed date range)

**Spoiler**
20. **[M1 acceptance]** Scripted two-member run: A posts, B fetches the board
    before posting → the **raw response text** does not contain the substring
    `attempts`. Assert on the string, not on a parsed object.
21. Same scenario, but assert the raw text also lacks `points`, `besa`, `hint`,
    and `seconds`.
22. B posts, re-fetches → all keys present, rows sorted best-first, B's row
    carries `you: true`.
23. **Yesterday's** board is masked for a member with no result for yesterday
    (raw text lacks `attempts`), unmasks for that member as soon as they post
    yesterday's result inside the §5 window, and is unmasked for everyone once
    the day is two days old — the widened rule this branch's `board.js` ships.
24. Week endpoint: with the viewer unfinished today and yesterday,
    `maskedDates` contains exactly those two keys, both are absent from every
    row's `days`, and every `total` equals the sum of the remaining days.
    Re-run with the viewer finished today and assert `maskedDates` drops to
    yesterday alone and every total grows by exactly today's `weeklyPoints`.
    With `start` on a fully past week, `maskedDates` is `[]`.
24b. Feeding a multi-day `listResultRange` array into `buildBoard` throws — the
    guard that stops the week handler from taking that shortcut.

**Boundaries (fake clock)**
25. **[M1 acceptance]** At 23:59:30 Europe/Tirane a POST files under `D`; at
    00:00:30 the next POST files under `D+1`, and the `D` board is fully
    unmasked **for any viewer holding a `D` result** (the member who posted at
    23:59:30). A viewer with neither a `D` nor a `D+1` result still sees `D`
    masked — at 00:00:30, `D` is "yesterday" and D5's widened window applies.
    Plan §2.12's unqualified phrasing predates D5.
26. **[M1 acceptance]** Repeat 25 on both DST transition dates (spring forward
    and fall back), using the clock-shim technique from the archive verification.
27. Grace: at 05:59 local a POST for yesterday succeeds; six hours plus one
    millisecond after the exact midnight instant it is `400 date_out_of_range`.
28. A POST for `D-2`, or for `D+1`, is `400 date_out_of_range`.
29. Board for `today - 401 days` → `400 date_out_of_range`; `today - 399` is
    accepted.

**Seats and caps** (see §4.3 for the layering)
30. **[M1 acceptance-adjacent, §2.5 mandated]** Two concurrent `claimSeat` calls
    on a 9-seat circle, run 20 times against real Postgres: exactly one
    `'created'`, one `'full'`, `COUNT(*) = 10`, `COUNT(DISTINCT seat) = COUNT(*)`.
31. Direct SQL: duplicate `(circle_code, seat)` raises `23505`; `seat = 11`
    raises `23514`.
32. Eleventh join through the HTTP layer → `409 circle_full`, and the roster
    stays at 10.
33. Repeat join by an existing member → `200`, `memberCount` unchanged, seat
    unchanged.
34. Eleventh circle creation → `409 circle_limit_reached`.
35. Applying `schema.sql` twice to an empty database, and once to a database
    built from the M0 version of the file, produces identical
    `information_schema.columns` and `pg_indexes` output.

**Rate limits**
36. **[M1 acceptance]** 61 requests in a minute from one member produce exactly
    one `429`, carrying `Retry-After`.
37. The 61st request from a *different* member in the same minute succeeds
    (buckets are per-member, not global).
38. 11 circle creations in a day → the 11th is `429`, not `409`.
39. 21 joins in a day → the 21st is `429`.
40. Requests with a malformed bearer charge the anonymous bucket, not a member
    bucket: 61 such requests from one IP produce a `429`, and a valid member's
    request in the same minute still succeeds.
41. The stored `bucket_key` never contains a `memberKey`, an IP address, or any
    substring of either — asserted against the actual `rate_bucket` rows.
42. The anonymous bucket key changes when the hour index changes.

**Deletion and cascade**
43. `DELETE /api/rrethi/me` → `204`; a second call → `204`. **[M3 acceptance]**
44. After deletion: the member is gone from a second member's board on the next
    fetch; their results in every circle are gone; circles they owned are gone
    along with the other members' memberships and results in them.
45. `DELETE /circles/:code/members/me` removes that member's results **in that
    circle only** and leaves their results in a second circle intact.
46. Leaving a circle the caller was never in → `204`.

**Service worker / caching**
47. **[M1 acceptance]** After a full scripted run in a service-worker-controlled
    browser, Cache Storage contains zero `/api/*` entries.

---

## 11. Open decisions

Places the plan genuinely does not decide. Each carries a recommendation; none is
silently resolved in the spec above without being named here.

**O1 — Circle name rules.** §2.1 asks for a "circle name" and never bounds it.
§8.0 above reuses the `displayName` rule verbatim (2–20 code points, NFC, ≤2
emoji). *Recommendation: keep it.* One validator, one rule to remember, and a
20-char circle name still fits the 320px board header that M2 must screenshot.
Needs a yes/no.

**O2 — Avatars on the board.** §2.1.1 clearly intends avatars to be visible in
the circle, but `board.js` emits `displayName` only and M1 does not change it.
*Recommendation: leave it. M2 extends `buildBoard` (and its tests) to carry
`avatarId`/`letterSeal`,* keeping M1's spoiler-test surface byte-identical. The
data is already stored by M1, so M2 is a payload change, not a migration.

**O3 — What happens when the owner leaves.** Not addressed by the plan. §8.5
specifies: the owner may leave, the circle survives, ownership is not
transferred. *Recommendation: keep it for M1 and add an explicit transfer in a
later milestone,* because the alternatives are worse — blocking the owner traps
them, and deleting the circle lets one person destroy a family's history with a
"leave" button that reads as harmless.

**O4 — Streaks on the board.** §2.3 says each row shows the member's own streak
as a quiet honey number; `buildBoard` accepts an optional `streaks` map; the
store has no streak query and computing one server-side means an extra
multi-week `listResultRange` per board read on a Free-plan compute budget.
*Recommendation: M1 sends no `streaks`. The client shows its own local streak
(which it already has) and no one else's.* If cross-member streaks are wanted,
they are a separate, measured decision, not a free field.

**O5 — The 10-circles-per-member cap is not an exact invariant.** §2.5 says
"both caps are database invariants"; §4.2 delivers an exact seat cap and a
guard-based circle cap that one member racing their own requests can overshoot.
*Recommendation: accept it for M1* (the overshoot benefits nobody and costs one
row) and add a `(member_key, slot)` unique index only if M4 shows abuse. Needs
acknowledgement that §2.5's wording is being met in spirit for one of the two
caps, not to the letter.

**O6 — The server gate.** §2.10 requires the rewritten `privatesia.html` to ship
"in the same deploy" as the first live `/api` route, but M1 needs to be
deployable and testable before M3 writes that page. §1/§8 therefore assume an
env gate `RRETHI_API_ENABLED` (default off) that makes all nine routes return
`404 not_found`. *Recommendation: adopt it,* and treat flipping it to `1` as the
M3 deploy step that ships beside the privacy page — the same discipline
`REWARDS_ENABLED` already uses in `src/config.js`. This is the one piece of
machinery in this document that the plan does not mention at all, so it needs an
explicit yes.

**O7 — Invite-code revocation and the `show_time` toggle.** §2.5 promises
revocable codes; §2.3 and `store.js` assume "M1 exposes a toggle". Neither is one
of the nine endpoints, and the store has no `updateCircle`. *Recommendation:
both stay out of M1.* `show_time` remains `FALSE` for every circle, so the
`seconds` path in §8.6/§8.7 is dead code with a live test until then — which is
the right order: the privacy-safe default ships first and the toggle ships with
the UI that explains it.

---

## 12. Deviations from the plan text, recorded

**D1 — `POST /api/rrethi/members` does not return `recoveryCode`.** §2.7's table
says it returns `{memberId, recoveryCode}`. §2.2 says the client generates the
128-bit secret and the recovery code *is* that secret, re-encoded. Both cannot be
true. §2.2 wins because it is the section that defines the security model. (To
state the rationale precisely: the server necessarily *sees* the secret on every
bearer request — what it never does is store or emit it. A server-issued recovery
code would be a pure re-encoding the client can already produce, and shipping it
server-side would mean a second Crockford/checksum implementation whose only
possible contribution is drift.) The recovery code is derived and displayed
entirely client-side. The response returns `memberId` plus the profile echo.

**D2 — Bearer auth is required on `POST /members` too.** §2.7 says "bearer auth
on all but `POST /members`". Reconciled in §2.1: the header is required; what is
*not* required is a pre-existing member row. Without the header there is no key
to create.

**D3 — Three new store methods and one extended typedef.** `claimSeat`,
`upsertMember`, `touchMember`; `Member` gains `avatarId` and `letterSeal`. §2.9's
typedef lists thirteen methods and `store.js` already records `listMembers` as a
deliberate fourteenth. All three additions are additive; no existing method
changes shape, and the M0 conformance suite runs unmodified.

**D4 — `src/game.js` gains one `export` keyword.** `tiranaMidnightEpoch` becomes
exported so §5 can compute the 6-hour grace without a second date
implementation, which §2.4 forbids. The function body is not touched.

**D5 — The board mask covers today AND yesterday, not today only.** §2.4 says
"yesterday and earlier are always fully visible, because the spoiler is gone."
That sentence predates the shipped archive: `isArchivableDate` (src/app.js)
keeps every day up to and including yesterday playable one tap away, so
revealing yesterday's board spoils a game the viewer can still play — the exact
harm §2.4 exists to prevent (found by the 2026-08-05 adversarial review of
`board.js`, MAJOR 1). `isBoardMasked` therefore masks `playDate ∈ {today,
yesterday}` until the viewer's own result for that date exists. Days older than
yesterday reveal unconditionally: §5's write window makes them permanently
unwritable, so masking them would be masking forever. Honest cost, accepted
deliberately: yesterday's result can only be posted within §5's 6-hour grace,
so a member who skipped yesterday sees yesterday's circle board masked for the
rest of that Tirana day (~18 hours) with no way to unmask it except waiting for
midnight. That trade favors spoiler protection over board access and self-heals
daily. Consequences recorded here so the precedence rule in the preamble cannot
revert them: (a) §2.4's "always visible" sentence and §2.12's "the D board is
fully unmasked at 00:00:30" are stale as unqualified statements — the D board at
00:00:30 is unmasked only for a viewer holding a D result; (b) the masked row
shape is `{displayName, finished}` plus `you: true` on the viewer's own row —
`you` is self-referential and leaks nothing about others; (c) plan §2.4 should
gain a one-line amendment when this merges.
