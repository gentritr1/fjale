import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ANSWERS } from "../src/words.js";

export const EDITORIAL_SCHEMA_VERSION = 1;
export const EDITORIAL_BATCH_KIND = "fjale-editorial-batch";
export const EDITORIAL_BATCH_ID = "answers-2026-07-62-137-v1";
export const EDITORIAL_BATCH_FILENAME = `${EDITORIAL_BATCH_ID}.json`;
export const FIRST_EDITORIAL_ANSWER_ID = 62;
export const LAST_EDITORIAL_ANSWER_ID = 137;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_EDITORIAL_BATCH_PATH = resolve(
  REPOSITORY_ROOT,
  "editorial",
  "batches",
  EDITORIAL_BATCH_FILENAME,
);

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

export function sha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function buildEditorialBatch(answers = ANSWERS) {
  const selected = answers.filter(
    ({ id }) => id >= FIRST_EDITORIAL_ANSWER_ID && id <= LAST_EDITORIAL_ANSWER_ID,
  );
  const expectedIds = Array.from(
    { length: LAST_EDITORIAL_ANSWER_ID - FIRST_EDITORIAL_ANSWER_ID + 1 },
    (_, offset) => FIRST_EDITORIAL_ANSWER_ID + offset,
  );

  if (
    selected.length !== expectedIds.length ||
    selected.some((entry, index) => entry.id !== expectedIds[index])
  ) {
    throw new Error(
      `Editorial batch ${EDITORIAL_BATCH_ID} requires every answer id ` +
        `${FIRST_EDITORIAL_ANSWER_ID}-${LAST_EDITORIAL_ANSWER_ID} in catalog order.`,
    );
  }

  const entries = selected.map((entry) => {
    const frozenEntry = {
      id: entry.id,
      word: entry.word,
      partOfSpeech: entry.partOfSpeech,
      syllables: entry.syllables,
      clue: entry.clue,
      definition: entry.definition,
      example: entry.example,
      region: entry.region,
    };

    return {
      answerId: entry.id,
      sourceSha256: sha256(frozenEntry),
      entry: frozenEntry,
    };
  });
  const answerIds = entries.map(({ answerId }) => answerId);

  return {
    schemaVersion: EDITORIAL_SCHEMA_VERSION,
    kind: EDITORIAL_BATCH_KIND,
    batch: {
      id: EDITORIAL_BATCH_ID,
      sourceCatalogSha256: sha256(entries),
      answerIds,
    },
    entries,
  };
}

async function atomicWriteJson(pathname, value) {
  await mkdir(dirname(pathname), { recursive: true });
  const temporaryPath = `${pathname}.${process.pid}.${Date.now()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, pathname);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function writeFrozenEditorialBatch(
  pathname = DEFAULT_EDITORIAL_BATCH_PATH,
  batch = buildEditorialBatch(),
) {
  const serialized = `${JSON.stringify(batch, null, 2)}\n`;
  let existing;

  try {
    existing = await readFile(pathname, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (existing !== undefined) {
    if (existing !== serialized) {
      throw new Error(
        `Refusing to overwrite frozen editorial batch ${pathname}. ` +
          "Create a new versioned batch instead.",
      );
    }
    return { pathname, written: false };
  }

  await atomicWriteJson(pathname, batch);
  return { pathname, written: true };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = await writeFrozenEditorialBatch();
  console.log(
    `${result.written ? "Wrote" : "Verified"} ${result.pathname} ` +
      `(${LAST_EDITORIAL_ANSWER_ID - FIRST_EDITORIAL_ANSWER_ID + 1} entries).`,
  );
}
