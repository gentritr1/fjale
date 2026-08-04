import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AVATARS,
  AVATAR_IDS,
  DEFAULT_AVATAR_ID,
  DEFAULT_LETTER_SEAL,
  EARNED_AVATARS,
  FREE_AVATARS,
  getAvatarById,
  isAvatarId,
  unlockedAvatarIds,
} from "../src/avatars.js";
import { BADGE_IDS, sanitizeProfile } from "../src/game.js";

test("the avatar catalog has twelve free and twelve earned identities", () => {
  assert.equal(FREE_AVATARS.length, 12);
  assert.equal(EARNED_AVATARS.length, 12);
  assert.equal(AVATARS.length, 24);
  assert.equal(new Set(AVATAR_IDS).size, AVATAR_IDS.length);
  assert.ok(FREE_AVATARS.every((avatar) => avatar.badgeId === null));
  assert.equal(getAvatarById(DEFAULT_AVATAR_ID)?.id, DEFAULT_AVATAR_ID);
  assert.equal(getAvatarById("not-an-avatar"), null);
  assert.equal(isAvatarId("not-an-avatar"), false);

  const cupAvatar = getAvatarById("stick-wheelchair");
  assert.equal(cupAvatar?.name, "Filxhan");
  assert.equal(cupAvatar?.asset, "/avatars/stick-cup-v1.webp");
});

test("each local badge unlocks exactly one animal and Rrethi keeps one future slot", () => {
  const localUnlocks = EARNED_AVATARS.filter(
    (avatar) => avatar.badgeId !== "rrethi-days-7",
  ).map((avatar) => avatar.badgeId);

  assert.deepEqual(localUnlocks, [...BADGE_IDS]);
  assert.equal(new Set(localUnlocks).size, BADGE_IDS.length);
  assert.equal(
    EARNED_AVATARS.find((avatar) => avatar.id === "animal-badger")?.badgeId,
    "rrethi-days-7",
  );
});

test("unlock evaluation always includes the free cast and only earned animals", () => {
  const fresh = unlockedAvatarIds(new Set());
  assert.deepEqual(fresh, new Set(FREE_AVATARS.map((avatar) => avatar.id)));

  const progressed = unlockedAvatarIds(new Set(["daily-win-1", "letters-36"]));
  assert.ok(progressed.has("animal-owl"));
  assert.ok(progressed.has("animal-moth"));
  assert.ok(!progressed.has("animal-fox"));
  assert.ok(!progressed.has("animal-badger"));
});

test("profile migration validates avatar ids and Albanian letter seals", () => {
  const fresh = sanitizeProfile(null);
  assert.equal(fresh.avatarId, DEFAULT_AVATAR_ID);
  assert.equal(fresh.letterSeal, DEFAULT_LETTER_SEAL);

  const selected = sanitizeProfile({ avatarId: "animal-owl", letterSeal: "SH" });
  assert.equal(selected.avatarId, "animal-owl");
  assert.equal(selected.letterSeal, "sh");

  const rejected = sanitizeProfile({ avatarId: "/remote/avatar.png", letterSeal: "💰" });
  assert.equal(rejected.avatarId, DEFAULT_AVATAR_ID);
  assert.equal(rejected.letterSeal, DEFAULT_LETTER_SEAL);
});

test("every catalog asset is a small bundled WebP", async () => {
  for (const avatar of AVATARS) {
    assert.match(avatar.asset, /^\/avatars\/[a-z0-9-]+-v1\.webp$/u);
    const bytes = await readFile(new URL(`..${avatar.asset}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", avatar.asset);
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", avatar.asset);
    assert.ok(bytes.length > 1_000, `${avatar.asset} must not be an empty placeholder`);
    assert.ok(bytes.length < 30_000, `${avatar.asset} must stay lightweight`);
  }
});
