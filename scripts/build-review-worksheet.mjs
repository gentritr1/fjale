// Generates the editorial-review worksheet for catalog answers that are not in
// any frozen daily epoch: editorial/review-<year>-<month>.md (instructions +
// table) and .csv (for spreadsheet review). Rerun after catalog changes; the
// editorial/ directory is excluded from deployment via .vercelignore.
//
// Usage: node scripts/build-review-worksheet.mjs [batch-label]
import { mkdir, writeFile } from "node:fs/promises";
import { DAILY_EPOCHS } from "../src/game.js";
import { ANSWERS } from "../src/words.js";

const label = process.argv[2] ?? "2026-07";
const scheduledAnswerIds = new Set(
  DAILY_EPOCHS.flatMap((epoch) =>
    epoch.answerIds ?? Array.from({ length: epoch.poolSize }, (_, answerId) => answerId),
  ),
);
const pending = ANSWERS.filter((answer) => !scheduledAnswerIds.has(answer.id));

if (pending.length === 0) {
  console.log("No unscheduled answers need an editorial worksheet.");
  process.exit(0);
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvHeader = [
  "id",
  "fjala",
  "kategoria",
  "rrokjet",
  "gjurma",
  "perkufizimi",
  "shembulli",
  "recensuesi1_verdikt",
  "recensuesi1_shenime",
  "recensuesi2_verdikt",
  "recensuesi2_shenime",
];
const csvRows = pending.map((answer) =>
  [
    answer.id,
    answer.word,
    answer.partOfSpeech,
    answer.syllables,
    answer.clue,
    answer.definition,
    answer.example,
    "",
    "",
    "",
    "",
  ]
    .map(csvField)
    .join(","),
);

const markdown = `# Rishikimi editorial — ${label} (${pending.length} fjalë në pritje)

Ky dokument mbulon fjalët e paplanifikuara me id ${pending[0]?.id}–${pending.at(-1)?.id}, të cilat
NUK futen në rotacionin ditor para se dy recensues shqipfolës t'i miratojnë.
${scheduledAnswerIds.size} fjalë gjenden tashmë në epoka ditore të ngrira.

## Udhëzime për recensuesit

Për çdo fjalë jepni një **verdikt**: \`prano\`, \`prano-me-korrigjim\` ose \`refuzo\`.

Kontrolloni:
1. **Fjala** — shqipe standarde, e njohur gjerësisht, pa ngarkesë fyese, e drejtë
   për një lojë ditore (jo tepër e rrallë, jo termë tejet teknik).
2. **Kategoria gramatikore** — e saktë (emër, folje, mbiemër, ndajfolje…).
3. **Rrokjet** — ndarja e saktë sipas drejtshkrimit.
4. **Gjurma** — ndihmon pa e zbuluar fjalën; nuk përmban rrënjën e fjalës.
5. **Përkufizimi** — i saktë, i shkurtër, në regjistër neutral.
6. **Shembulli** — fjali e natyrshme; përdorimi i fjalës i saktë.

Korrigjimet shkruhen te kolona e shënimeve. Ndryshimi i metadatave është i lirë;
heqja ose rirenditja e fjalëve bëhet vetëm nga ekipi (id-të janë të pandryshueshme).

Regjistrohuni në CSV-në shoqëruese (\`review-${label}.csv\`) ose direkt në tabelën më poshtë.

## Fjalët

| id | fjala | kategoria | rrokjet | gjurma | përkufizimi | shembulli | verdikt R1 | verdikt R2 | shënime |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${pending
  .map(
    (answer) =>
      `| ${answer.id} | **${answer.word}** | ${answer.partOfSpeech} | ${answer.syllables} | ${answer.clue} | ${answer.definition} | ${answer.example} |  |  |  |`,
  )
  .join("\n")}
`;

await mkdir(new URL("../editorial/", import.meta.url), { recursive: true });
await writeFile(new URL(`../editorial/review-${label}.md`, import.meta.url), markdown);
await writeFile(
  new URL(`../editorial/review-${label}.csv`, import.meta.url),
  `${[csvHeader.join(","), ...csvRows].join("\n")}\n`,
);
console.log(`Wrote editorial/review-${label}.md and .csv (${pending.length} pending answers).`);
