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

CREATE TABLE IF NOT EXISTS public.member (
  member_key   TEXT PRIMARY KEY,             -- sha256(secret || server_pepper)
  display_name TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS public.membership (
  circle_code TEXT NOT NULL REFERENCES public.circle (code) ON DELETE CASCADE,
  member_key  TEXT NOT NULL REFERENCES public.member (member_key) ON DELETE CASCADE,
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
  seconds     INTEGER CHECK (seconds >= 0),  -- NULL unless circle.show_time
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_code, member_key, play_date),
  FOREIGN KEY (circle_code, member_key)
    REFERENCES public.membership (circle_code, member_key) ON DELETE CASCADE
);

-- The board reads one circle for one day; the primary key already covers the
-- weekly (circle, member, date-range) query.
CREATE INDEX IF NOT EXISTS result_circle_date_idx
  ON public.result (circle_code, play_date);

-- Fixed-window counters. The bucket key is a hash or an ephemeral IP bucket and
-- is never joined to a member row (plan §2.5: IPs are not stored).
CREATE TABLE IF NOT EXISTS public.rate_bucket (
  bucket_key   TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);
