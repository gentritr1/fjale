// Weekly points for a circle board (plan §2.3). Deliberately dependency-free:
// the same module scores a locally stored day and a row read back from the
// Rrethi server, so the two can never drift apart.
//
// A win in n attempts is worth 7 - n points (6 for a one-attempt win down to 1
// for a six-attempt win), plus one point for a Besa win declared without a
// hint. A loss, an unplayed day, or any malformed row is worth 0 — the scale
// never goes negative, so a bad day cannot feel punitive.
//
// `result` is the stored day: { attempts, besa, hint }, where `attempts` is an
// integer 1..6 for a win and anything else ("X", null, undefined) for a loss or
// an unplayed day.
export function weeklyPoints(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return 0;
  }

  const { attempts, besa, hint } = result;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 6) {
    return 0;
  }

  return 7 - attempts + (besa && !hint ? 1 : 0);
}
