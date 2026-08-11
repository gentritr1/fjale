-- Rrethi schema — PLAN-RRETHI-2026-08.md §2.8. Postgres (Neon).
--
-- Apply it by hand:      psql "$NEON_DATABASE_URL" -f api/_lib/schema.sql
-- or from the adapter:   applyNeonSchema(process.env)   (api/_lib/store-neon.js)
--
-- Every statement is IF NOT EXISTS, so re-running the file is a no-op and it is
-- safe to run on every deploy (plan §2.12, M0).
--
-- Two conventions this file must keep, because `applyNeonSchema` parses it:
--
--   1. Every object is explicitly qualified `public.`. The conformance suite
--      rewrites that one prefix to run against a throwaway schema, so a test
--      run against a real Neon project cannot touch production tables. Adding
--      an unqualified object name would silently break that isolation.
--   2. Statements are separated by a semicolon at end of line, and there are no
--      dollar-quoted bodies or semicolons inside literals — the loader splits
--      on `;`. Keep it that way, or teach the loader to tokenise.
--
-- Never stored here, by design (plan §2.8, §2.10): the answer, the guesses, the
-- board pattern, IP addresses, user agents, email, location, or the raw secret.

-- avatar_id / letter_seal are the profile the client already keeps locally
-- (src/avatars.js) and M1 transmits (plan §2.1.1). The DEFAULT literals must
-- stay byte-equal to DEFAULT_AVATAR_ID / DEFAULT_LETTER_SEAL there; the
-- conformance suite asserts that against this file.
CREATE TABLE IF NOT EXISTS public.member (
  member_key   TEXT PRIMARY KEY,             -- HMAC-SHA-256(server_pepper, secret)
  display_name TEXT NOT NULL,
  avatar_id    TEXT NOT NULL DEFAULT 'stick-racer',
  letter_seal  TEXT NOT NULL DEFAULT 'ë',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- owner_key cascades: a member deleting their data (DELETE /api/rrethi/me,
-- plan §2.10) must never be blocked by an FK, so the circles they created go
-- with them. Plan §2.8 leaves the delete action unspecified; §2.10 promises the
-- deletion is "immediate and irreversible", which decides it. Transferring
-- ownership instead of destroying the circle is an M1 question for the owner.
CREATE TABLE IF NOT EXISTS public.circle (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_key  TEXT NOT NULL REFERENCES public.member (member_key) ON DELETE CASCADE,
  show_time  BOOLEAN NOT NULL DEFAULT FALSE, -- plan §2.3: time is off by default
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- `seat` is what makes the 10-member cap of plan §2.5 a database invariant
-- rather than a count a handler read a moment ago. Two concurrent joins that
-- compute the same seat collide on membership_circle_seat_idx below; the loser
-- retries and converges to a free seat or to "full". The CHECK is the second
-- line of defence: even a caller passing a wrong maxSeats cannot write seat 11.
CREATE TABLE IF NOT EXISTS public.membership (
  circle_code TEXT NOT NULL REFERENCES public.circle (code) ON DELETE CASCADE,
  member_key  TEXT NOT NULL REFERENCES public.member (member_key) ON DELETE CASCADE,
  seat        SMALLINT NOT NULL CONSTRAINT membership_seat_range CHECK (seat BETWEEN 1 AND 10),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_code, member_key)
);

-- result hangs off membership, not off circle and member separately, so that
-- leaving a circle takes that member's results in that circle with it while
-- leaving their results in other circles alone.
CREATE TABLE IF NOT EXISTS public.result (
  circle_code TEXT NOT NULL,
  member_key  TEXT NOT NULL,
  play_date   DATE NOT NULL,                 -- Tirana calendar date
  attempts    SMALLINT CHECK (attempts BETWEEN 1 AND 6), -- NULL = loss
  besa        BOOLEAN NOT NULL,
  hint        BOOLEAN NOT NULL,
  seconds     INTEGER CHECK (seconds >= 0),  -- storage accepts it always; the
                                             -- M1 handler must strip it when
                                             -- circle.show_time is FALSE
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_code, member_key, play_date),
  FOREIGN KEY (circle_code, member_key)
    REFERENCES public.membership (circle_code, member_key) ON DELETE CASCADE
);

-- This index — not the primary key — serves both board reads. The PK is
-- (circle_code, member_key, play_date), so a query filtering on circle_code
-- and play_date only gets the circle_code prefix from it and would filter the
-- rest; (circle_code, play_date) matches the daily board and the weekly range
-- exactly.
CREATE INDEX IF NOT EXISTS result_circle_date_idx
  ON public.result (circle_code, play_date);

-- listCirclesFor filters membership on member_key (the second PK column, so
-- the PK cannot serve it) and the member -> membership delete cascade walks
-- the same path.
CREATE INDEX IF NOT EXISTS membership_member_idx
  ON public.membership (member_key);

-- circle.owner_key is a cascading FK with no index of its own: deleteMember
-- has to find the circles a member owns.
CREATE INDEX IF NOT EXISTS circle_owner_idx
  ON public.circle (owner_key);

-- Fixed-window counters. The bucket key is a hash or an ephemeral IP bucket and
-- is never joined to a member row (plan §2.5: IPs are not stored).
CREATE TABLE IF NOT EXISTS public.rate_bucket (
  bucket_key   TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- rate_bucket rows are permanent otherwise: every distinct bucket key ever
-- seen stays forever against the 0.5 GB free-tier budget. This index is what
-- makes pruning cheap; the M1 daily cron (or an opportunistic delete) runs
--   DELETE FROM rate_bucket WHERE window_start < now() - interval '1 day'.
CREATE INDEX IF NOT EXISTS rate_bucket_window_idx
  ON public.rate_bucket (window_start);

-- M1 deltas (PLAN-RRETHI-M1-API.md §6).
--
-- The CREATE TABLE bodies above already carry avatar_id, letter_seal and seat,
-- so on an empty database every statement below is a no-op. They exist so the
-- same file also upgrades a database built from the M0 version of it, and both
-- paths must end in the same shape — the conformance suite applies the file
-- twice to an empty database and once to an M0 database and compares
-- information_schema.columns and pg_indexes.
--
-- Migration risk, assessed rather than assumed: no production database exists
-- (RRETHI_STORE is unset in production and there were no endpoints before M1),
-- so the backfill below touches zero rows in practice and SET NOT NULL cannot
-- fail. The one way it can fail is a hand-made scratch circle with more than ten
-- memberships, which would break membership_seat_range; delete that scratch
-- circle rather than widening the constraint.

ALTER TABLE public.member
  ADD COLUMN IF NOT EXISTS avatar_id TEXT NOT NULL DEFAULT 'stick-racer';

ALTER TABLE public.member
  ADD COLUMN IF NOT EXISTS letter_seal TEXT NOT NULL DEFAULT 'ë';

-- Added nullable, backfilled, then constrained, so the file stays runnable
-- against an existing M0 database.
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

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, and this loader cannot run a DO
-- block (no dollar-quoting). DROP IF EXISTS + ADD is idempotent, needs no new
-- loader syntax, and the table is small enough that the lock is irrelevant at
-- this scale. The name matches the CREATE TABLE body above, so a fresh database
-- and an upgraded one end with exactly one constraint of the same name.
ALTER TABLE public.membership
  DROP CONSTRAINT IF EXISTS membership_seat_range;

ALTER TABLE public.membership
  ADD CONSTRAINT membership_seat_range CHECK (seat BETWEEN 1 AND 10);

-- This index IS the cap. Two concurrent joins that observe the same free seat
-- both try to take it; one commits and the other raises 23505 and retries.
-- The eleventh seat is refused here, not by a count the handler read.
CREATE UNIQUE INDEX IF NOT EXISTS membership_circle_seat_idx
  ON public.membership (circle_code, seat);
