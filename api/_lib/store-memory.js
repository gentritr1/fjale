// In-memory RrethiStore — PLAN-RRETHI-2026-08.md §2.9.
//
// Zero dependencies: this is the adapter the test suite and local development
// run on, and it must stay importable with no `node_modules` present.
//
// It is not a convenience stub. The conformance suite defines correctness for
// *both* adapters, so every cascade below mirrors the SQL in §2.8 literally:
//
//   member  --ON DELETE CASCADE-->  membership  --ON DELETE CASCADE-->  result
//   circle  --ON DELETE CASCADE-->  membership  (and so, transitively, result)
//   member  --ON DELETE CASCADE-->  circle (owner_key)
//
// which means: deleting a member removes their memberships, the results reached
// through them, and the circles they own together with *those* circles'
// memberships and results; removing one membership removes only that member's
// results in that circle.

import {
  CIRCLE_MAX_MEMBERS,
  DEFAULT_PROFILE,
  assertDateKey,
  assertDateRange,
  assertKey,
  assertPositiveInteger,
  foreignKeyError,
  normalizeResultInput,
  storeError,
} from "./store.js";

const SEPARATOR = "\u0000";

/** @param {...string} parts */
function compositeKey(...parts) {
  return parts.join(SEPARATOR);
}

function nowIso() {
  return new Date().toISOString();
}

/** Losses (`null` attempts) sort last, matching `ORDER BY attempts` in Postgres. */
function compareAttempts(a, b) {
  if (a.attempts === b.attempts) return 0;
  if (a.attempts === null) return 1;
  if (b.attempts === null) return -1;
  return a.attempts - b.attempts;
}

function compareStrings(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Rows leave as fresh objects so a caller cannot mutate stored state — the
 * Neon adapter cannot hand out live references either.
 */
function cloneMember(row) {
  return {
    memberKey: row.memberKey,
    displayName: row.displayName,
    avatarId: row.avatarId,
    letterSeal: row.letterSeal,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  };
}

function cloneCircle(row) {
  return {
    code: row.code,
    name: row.name,
    ownerKey: row.ownerKey,
    showTime: row.showTime,
    createdAt: row.createdAt,
  };
}

function cloneResult(row) {
  return {
    circleCode: row.circleCode,
    memberKey: row.memberKey,
    playDate: row.playDate,
    attempts: row.attempts,
    besa: row.besa,
    hint: row.hint,
    seconds: row.seconds,
    createdAt: row.createdAt,
  };
}

/**
 * @returns {import("./store.js").RrethiStore}
 */
export function createMemoryStore() {
  /** @type {Map<string, object>} */ const members = new Map();
  /** @type {Map<string, object>} */ const circles = new Map();
  /** @type {Map<string, object>} */ const memberships = new Map();
  /** @type {Map<string, object>} */ const results = new Map();
  /** @type {Map<string, {count:number, windowStart:number}>} */ const buckets = new Map();

  /** Deletes every result of one member in one circle (membership cascade). */
  function cascadeResultsOfMembership(circleCode, memberKey) {
    for (const [key, row] of results) {
      if (row.circleCode === circleCode && row.memberKey === memberKey) {
        results.delete(key);
      }
    }
  }

  /**
   * Lowest unoccupied seat in `1..CIRCLE_MAX_MEMBERS`, or `null` when the circle
   * is full — the same expression the Neon adapter runs in SQL.
   *
   * Lowest-free rather than plan §4.2's `MAX(seat) + 1`: with a hard
   * `CHECK (seat BETWEEN 1 AND 10)`, counting up from the maximum makes a circle
   * that has ever been full permanently unjoinable. Nine members holding seats
   * 1..3 and 5..10 (seat 4 left) would compute seat 11 and violate the CHECK,
   * which is exactly the case §4.3(a) requires to succeed. Recorded as deviation
   * D7 in PLAN-RRETHI-M1-API.md §12.
   */
  function lowestFreeSeat(code) {
    const taken = new Set();
    for (const row of memberships.values()) {
      if (row.circleCode === code) taken.add(row.seat);
    }
    for (let seat = 1; seat <= CIRCLE_MAX_MEMBERS; seat += 1) {
      if (!taken.has(seat)) return seat;
    }
    return null;
  }

  /** Deletes a circle and everything reachable from it (circle cascade). */
  function cascadeCircle(code) {
    circles.delete(code);
    for (const [key, row] of memberships) {
      if (row.circleCode === code) memberships.delete(key);
    }
    for (const [key, row] of results) {
      if (row.circleCode === code) results.delete(key);
    }
  }

  return {
    async createMember(key, name) {
      assertKey(key, "memberKey");
      assertKey(name, "displayName");
      if (members.has(key)) return; // ON CONFLICT (member_key) DO NOTHING
      const at = nowIso();
      members.set(key, {
        memberKey: key,
        displayName: name,
        // Mirrors the columns' NOT NULL DEFAULT in schema.sql: a row written by
        // the narrow primitive still carries a valid profile.
        avatarId: DEFAULT_PROFILE.avatarId,
        letterSeal: DEFAULT_PROFILE.letterSeal,
        createdAt: at,
        lastSeenAt: at,
      });
    },

    async getMember(key) {
      assertKey(key, "memberKey");
      const row = members.get(key);
      return row === undefined ? null : cloneMember(row);
    },

    async renameMember(key, name) {
      assertKey(key, "memberKey");
      assertKey(name, "displayName");
      const row = members.get(key);
      if (row === undefined) return; // UPDATE ... WHERE member_key = $1 matched no row
      row.displayName = name;
    },

    async upsertMember(key, profile) {
      assertKey(key, "memberKey");
      if (profile === null || typeof profile !== "object") {
        throw storeError("profile must be an object");
      }
      const displayName = assertKey(profile.displayName, "displayName");
      const avatarId = assertKey(profile.avatarId, "avatarId");
      const letterSeal = assertKey(profile.letterSeal, "letterSeal");
      const row = members.get(key);
      if (row !== undefined) {
        // ON CONFLICT (member_key) DO UPDATE: all three profile columns move.
        // created_at and last_seen_at are untouched — an edit is not a visit.
        row.displayName = displayName;
        row.avatarId = avatarId;
        row.letterSeal = letterSeal;
        return "updated";
      }
      const at = nowIso();
      members.set(key, {
        memberKey: key,
        displayName,
        avatarId,
        letterSeal,
        createdAt: at,
        lastSeenAt: at,
      });
      return "created";
    },

    async touchMember(key) {
      assertKey(key, "memberKey");
      const row = members.get(key);
      if (row === undefined) return; // UPDATE ... WHERE matched no row
      row.lastSeenAt = nowIso();
    },

    async deleteMember(key) {
      assertKey(key, "memberKey");
      for (const circle of [...circles.values()]) {
        if (circle.ownerKey === key) cascadeCircle(circle.code);
      }
      for (const [membershipKey, row] of memberships) {
        if (row.memberKey === key) {
          memberships.delete(membershipKey);
          cascadeResultsOfMembership(row.circleCode, key);
        }
      }
      members.delete(key);
    },

    async createCircle(code, name, owner) {
      assertKey(code, "circleCode");
      assertKey(name, "circleName");
      assertKey(owner, "ownerKey");
      // Order matters: `ON CONFLICT DO NOTHING` inserts no row, so Postgres
      // never fires the owner_key foreign-key trigger on a conflicting insert.
      if (circles.has(code)) return "conflict"; // ON CONFLICT (code) DO NOTHING
      if (!members.has(owner)) throw foreignKeyError();
      circles.set(code, {
        code,
        name,
        ownerKey: owner,
        showTime: false,
        createdAt: nowIso(),
      });
      return "created";
    },

    async getCircle(code) {
      assertKey(code, "circleCode");
      const row = circles.get(code);
      return row === undefined ? null : cloneCircle(row);
    },

    async addMembership(code, key) {
      assertKey(code, "circleCode");
      assertKey(key, "memberKey");
      const membershipKey = compositeKey(code, key);
      if (memberships.has(membershipKey)) return "conflict"; // ON CONFLICT DO NOTHING
      if (!circles.has(code) || !members.has(key)) throw foreignKeyError();
      // `seat` is NOT NULL, so even the narrow primitive assigns one. It applies
      // no caps — `claimSeat` is the method that enforces them — but a circle
      // with no free seat has nothing valid to write, which in Postgres is a
      // NOT NULL violation mapped to the same "stored constraint" error.
      const seat = lowestFreeSeat(code);
      if (seat === null) throw storeError("value violates a stored constraint");
      memberships.set(membershipKey, {
        circleCode: code,
        memberKey: key,
        seat,
        joinedAt: nowIso(),
      });
      return "created";
    },

    async claimSeat(code, key, maxSeats, maxCircles) {
      assertKey(code, "circleCode");
      assertKey(key, "memberKey");
      assertPositiveInteger(maxSeats, "maxSeats");
      assertPositiveInteger(maxCircles, "maxCircles");
      if (maxSeats > CIRCLE_MAX_MEMBERS) {
        // The database CHECK is hard-coded at 10; a larger argument would
        // surface there as a confusing constraint violation instead of an
        // answer, so both adapters refuse it up front.
        throw storeError(`maxSeats must be at most ${CIRCLE_MAX_MEMBERS}`);
      }

      // The order below is the SQL's disambiguation order (plan §4.2 step 4),
      // not the order of its WHERE clause. It matters: an existing member
      // re-joining a circle that is now full must read as 'conflict' (an
      // idempotent repeat join), never as 'full'.
      if (!circles.has(code)) return "missing";
      const membershipKey = compositeKey(code, key);
      if (memberships.has(membershipKey)) return "conflict";

      let seatsTaken = 0;
      let circlesJoined = 0;
      for (const row of memberships.values()) {
        if (row.circleCode === code) seatsTaken += 1;
        if (row.memberKey === key) circlesJoined += 1;
      }
      if (circlesJoined >= maxCircles) return "over_circle_limit";
      if (seatsTaken >= maxSeats) return "full";
      if (!members.has(key)) throw foreignKeyError();

      const seat = lowestFreeSeat(code);
      // Unreachable while `seatsTaken < maxSeats <= CIRCLE_MAX_MEMBERS`; kept
      // because the alternative to a loud failure is a silent NULL seat.
      if (seat === null) return "full";
      memberships.set(membershipKey, {
        circleCode: code,
        memberKey: key,
        seat,
        joinedAt: nowIso(),
      });
      return "created";
    },

    async removeMembership(code, key) {
      assertKey(code, "circleCode");
      assertKey(key, "memberKey");
      if (!memberships.delete(compositeKey(code, key))) return;
      cascadeResultsOfMembership(code, key);
    },

    async listCirclesFor(key) {
      assertKey(key, "memberKey");
      return [...memberships.values()]
        .filter((row) => row.memberKey === key)
        .sort(
          (a, b) =>
            compareStrings(a.joinedAt, b.joinedAt) ||
            compareStrings(a.circleCode, b.circleCode),
        )
        .map((row) => circles.get(row.circleCode))
        .filter((row) => row !== undefined)
        .map(cloneCircle);
    },

    async listMembers(code) {
      assertKey(code, "circleCode");
      return [...memberships.values()]
        .filter((row) => row.circleCode === code)
        .sort(
          (a, b) =>
            compareStrings(a.joinedAt, b.joinedAt) ||
            compareStrings(a.memberKey, b.memberKey),
        )
        .map((row) => members.get(row.memberKey))
        .filter((row) => row !== undefined)
        .map(cloneMember);
    },

    async putResult(result) {
      const row = normalizeResultInput(result);
      const resultKey = compositeKey(row.circleCode, row.memberKey, row.playDate);
      // INSERT ... ON CONFLICT (circle_code, member_key, play_date) DO NOTHING:
      // first write wins and the stored row is never updated (plan §2.5). The
      // conflict is resolved before the membership foreign key for the same
      // reason as in `createCircle` — a skipped insert fires no FK trigger.
      if (results.has(resultKey)) return "conflict";
      if (!memberships.has(compositeKey(row.circleCode, row.memberKey))) {
        throw foreignKeyError();
      }
      results.set(resultKey, { ...row, createdAt: nowIso() });
      return "created";
    },

    async listResults(code, date) {
      assertKey(code, "circleCode");
      assertDateKey(date, "playDate");
      return [...results.values()]
        .filter((row) => row.circleCode === code && row.playDate === date)
        .sort(
          (a, b) => compareAttempts(a, b) || compareStrings(a.memberKey, b.memberKey),
        )
        .map(cloneResult);
    },

    async listResultRange(code, from, to) {
      assertKey(code, "circleCode");
      const range = assertDateRange(from, to);
      return [...results.values()]
        .filter(
          (row) =>
            row.circleCode === code &&
            row.playDate >= range.from &&
            row.playDate <= range.to,
        )
        .sort(
          (a, b) =>
            compareStrings(a.playDate, b.playDate) ||
            compareStrings(a.memberKey, b.memberKey),
        )
        .map(cloneResult);
    },

    async takeToken(bucket, limit, windowMs) {
      assertKey(bucket, "bucketKey");
      assertPositiveInteger(limit, "limit");
      assertPositiveInteger(windowMs, "windowMs");
      const now = Date.now();
      const existing = buckets.get(bucket);
      if (existing === undefined || now - existing.windowStart >= windowMs) {
        buckets.set(bucket, { count: 1, windowStart: now });
        return true;
      }
      existing.count += 1;
      return existing.count <= limit;
    },
  };
}
