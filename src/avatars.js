// Shenjat e Rrethit — a fixed, reviewed avatar catalog.
//
// The browser never accepts an image URL from storage or from another player.
// Persist only these stable ids; the art file can be replaced later without
// changing anybody's identity. Badge ids deliberately match src/game.js.

export const DEFAULT_AVATAR_ID = "stick-racer";
export const DEFAULT_LETTER_SEAL = "ë";

// UNVERIFIED sq copy — short picker names need a native Albanian pass.
export const FREE_AVATARS = Object.freeze([
  { id: "stick-racer", name: "Turbo", asset: "/avatars/stick-racer-v1.webp", badgeId: null },
  { id: "stick-rebel", name: "Rebel", asset: "/avatars/stick-rebel-v1.webp", badgeId: null },
  { id: "stick-dyed", name: "Dy ngjyra", asset: "/avatars/stick-dyed-v1.webp", badgeId: null },
  { id: "stick-skater", name: "Skejt", asset: "/avatars/stick-skater-v1.webp", badgeId: null },
  { id: "stick-tinkerer", name: "Vegla", asset: "/avatars/stick-tinkerer-v1.webp", badgeId: null },
  { id: "stick-music", name: "Ritëm", asset: "/avatars/stick-music-v1.webp", badgeId: null },
  { id: "stick-wheelchair", name: "Rrota", asset: "/avatars/stick-wheelchair-v1.webp", badgeId: null },
  { id: "stick-elder", name: "Urtësi", asset: "/avatars/stick-elder-v1.webp", badgeId: null },
  { id: "stick-reader", name: "Libri", asset: "/avatars/stick-reader-v1.webp", badgeId: null },
  { id: "stick-runner", name: "Vrap", asset: "/avatars/stick-runner-v1.webp", badgeId: null },
  { id: "stick-creator", name: "Skicë", asset: "/avatars/stick-creator-v1.webp", badgeId: null },
  { id: "stick-hoodie", name: "Kapuç", asset: "/avatars/stick-hoodie-v1.webp", badgeId: null },
]);

export const EARNED_AVATARS = Object.freeze([
  { id: "animal-owl", name: "Buf", asset: "/avatars/animal-owl-v1.webp", badgeId: "daily-win-1" },
  { id: "animal-fox", name: "Dhelpër", asset: "/avatars/animal-fox-v1.webp", badgeId: "daily-attempt-1" },
  { id: "animal-hare", name: "Lepur", asset: "/avatars/animal-hare-v1.webp", badgeId: "daily-attempt-6" },
  { id: "animal-bear", name: "Ariu", asset: "/avatars/animal-bear-v1.webp", badgeId: "daily-fast-10" },
  { id: "animal-goat", name: "Dhi mali", asset: "/avatars/animal-goat-v1.webp", badgeId: "streak-7" },
  { id: "animal-cat", name: "Mace", asset: "/avatars/animal-cat-v1.webp", badgeId: "streak-30" },
  { id: "animal-tortoise", name: "Breshkë", asset: "/avatars/animal-tortoise-v1.webp", badgeId: "daily-played-100" },
  { id: "animal-songbird", name: "Zog", asset: "/avatars/animal-songbird-v1.webp", badgeId: "daily-win-25" },
  { id: "animal-hedgehog", name: "Iriq", asset: "/avatars/animal-hedgehog-v1.webp", badgeId: "digraphs-9" },
  { id: "animal-moth", name: "Flutur nate", asset: "/avatars/animal-moth-v1.webp", badgeId: "letters-36" },
  { id: "animal-frog", name: "Bretkosë", asset: "/avatars/animal-frog-v1.webp", badgeId: "daily-besa-3" },
  { id: "animal-badger", name: "Vjedull", asset: "/avatars/animal-badger-v1.webp", badgeId: "rrethi-days-7" },
]);

export const AVATARS = Object.freeze([...FREE_AVATARS, ...EARNED_AVATARS]);
export const AVATAR_IDS = Object.freeze(AVATARS.map((avatar) => avatar.id));

const AVATAR_BY_ID = new Map(AVATARS.map((avatar) => [avatar.id, avatar]));

export function getAvatarById(id) {
  return AVATAR_BY_ID.get(id) ?? null;
}

export function isAvatarId(id) {
  return typeof id === "string" && AVATAR_BY_ID.has(id);
}

export function isAvatarUnlocked(avatar, earnedBadgeIds) {
  return avatar.badgeId === null || earnedBadgeIds.has(avatar.badgeId);
}

export function unlockedAvatarIds(earnedBadgeIds) {
  return new Set(
    AVATARS.filter((avatar) => isAvatarUnlocked(avatar, earnedBadgeIds)).map(
      (avatar) => avatar.id,
    ),
  );
}
