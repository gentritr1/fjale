import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCacheVersionBump,
  findChangedCachedFiles,
  readAppShellFiles,
  readCacheVersion,
} from "../scripts/check-cache-version-bump.mjs";
import {
  ALBANIAN_ALPHABET,
  ALBANIAN_DIGRAPHS,
  BADGE_IDS,
  MILESTONE_IDS,
} from "../src/game.js";
import { REWARDS_ENABLED } from "../src/config.js";

const CANONICAL_ORIGIN = "https://www.xn--fjal-opa.com/";
const OG_IMAGE_FILENAME = "og-fjale-v3.png";
const OG_IMAGE_URL = `${CANONICAL_ORIGIN}${OG_IMAGE_FILENAME}`;

test("keeps canonical, social, structured-data, and CSP metadata coherent", async () => {
  const [html, serverSource, vercelSource, rrethiPlan] = await Promise.all([
    readFile("index.html", "utf8"),
    readFile("server.mjs", "utf8"),
    readFile("vercel.json", "utf8"),
    readFile("PLAN-RRETHI-2026-08.md", "utf8"),
  ]);
  const vercel = JSON.parse(vercelSource);
  const structuredDataMatch = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/u,
  );

  assert.ok(structuredDataMatch, "index.html must contain WebApplication JSON-LD");
  const structuredData = JSON.parse(structuredDataMatch[1]);
  const structuredDataHash = `sha256-${createHash("sha256")
    .update(structuredDataMatch[1])
    .digest("base64")}`;
  const productionCsp = vercel.headers
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === "Content-Security-Policy")?.value;

  assert.ok(html.includes(`<link rel="canonical" href="${CANONICAL_ORIGIN}"`));
  assert.ok(html.includes(`<meta property="og:image" content="${OG_IMAGE_URL}"`));
  assert.ok(html.includes('<meta property="og:site_name" content="FJALË"'));
  assert.ok(html.includes('<meta property="og:title" content="FJALË · Fjala shqipe e ditës"'));
  assert.doesNotMatch(html, /fjale-self\.vercel\.app/u);
  assert.equal(structuredData["@type"], "WebApplication");
  assert.equal(structuredData.url, CANONICAL_ORIGIN);
  assert.equal(structuredData.image, OG_IMAGE_URL);
  assert.ok(productionCsp?.includes(`'${structuredDataHash}'`));
  assert.ok(serverSource.includes(`"script-src 'self' '${structuredDataHash}'"`));
  assert.ok(serverSource.includes(`"/${OG_IMAGE_FILENAME}"`));
  assert.ok(html.includes("5 kuti · 36 shkronja · 1 fjalë"));
  assert.ok(
    rrethiPlan.includes(`${CANONICAL_ORIGIN}?rrethi=`),
    "future invite examples must use the canonical IDNA origin",
  );
  assert.doesNotMatch(rrethiPlan, /xn--fjal-9ra\.com/u);
});

test("keeps the versioned social card at the declared dimensions", async () => {
  const [png, svg] = await Promise.all([
    readFile(OG_IMAGE_FILENAME),
    readFile("og-fjale-v3.svg", "utf8"),
  ]);

  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 1_200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.match(svg, />fjalë\.com</u);
  assert.match(svg, />36</u);
  assert.doesNotMatch(svg, /fjale-self\.vercel\.app/u);
});

test("keeps the signature art wired end to end", async () => {
  const [html, app, styles, serviceWorker, vercelSource] = await Promise.all([
    readFile("index.html", "utf8"),
    readFile("src/app.js", "utf8"),
    readFile("styles.css", "utf8"),
    readFile("service-worker.js", "utf8"),
    readFile("vercel.json", "utf8"),
  ]);

  assert.ok(html.includes('id="result-besa-seal"'));
  assert.ok(html.includes('src="/besa-seal-v1.svg"'));
  assert.ok(app.includes("resultBesaSeal.hidden"));
  assert.ok(
    app.includes('besaEarned && state.mode === "daily"'),
    "the seal is reserved for the genuine no-hint daily Besa win",
  );
  assert.ok(styles.includes('url("/stamp-digraph-v1.svg")'));
  assert.ok(styles.includes(".alphabet-stamp.is-digraph.is-collected"));
  assert.ok(serviceWorker.includes('"/besa-seal-v1.svg"'));
  assert.ok(serviceWorker.includes('"/stamp-digraph-v1.svg"'));
  assert.ok(vercelSource.includes("besa-seal-v1.svg"));

  const seal = await readFile("besa-seal-v1.svg", "utf8");
  const stamp = await readFile("stamp-digraph-v1.svg", "utf8");
  assert.ok(seal.startsWith("<svg"));
  assert.ok(stamp.startsWith("<svg"));
  assert.doesNotMatch(seal, /rgb\(247,232,196\)" d="M 0 0/u, "seal ships without its generator background");
  assert.doesNotMatch(stamp, /<text|font-family/u, "stamp frame carries no baked-in letters");

  assert.ok(html.includes('src="/help-hero-v1.svg"'));
  assert.ok(styles.includes(".help-hero"));
  assert.ok(serviceWorker.includes('"/help-hero-v1.svg"'));
  const hero = await readFile("help-hero-v1.svg", "utf8");
  assert.ok(hero.startsWith("<svg"));
  assert.doesNotMatch(hero, /<text/u, "welcome banner stays text-free");
});

test("declares real install screenshots for both form factors", async () => {
  const manifest = JSON.parse(await readFile("manifest.webmanifest", "utf8"));
  const forms = new Map(manifest.screenshots?.map((shot) => [shot.form_factor, shot]) ?? []);

  for (const [form, expectedSizes] of [
    ["narrow", "780x1688"],
    ["wide", "1280x800"],
  ]) {
    const shot = forms.get(form);
    assert.ok(shot, `manifest must declare a ${form} screenshot`);
    assert.equal(shot.sizes, expectedSizes);
    assert.ok(shot.label.length > 0);

    const png = await readFile(shot.src.replace(/^\//u, ""));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const [width, height] = expectedSizes.split("x").map(Number);
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
});

test("requires production revalidation for the generated accepted-word corpus", async () => {
  const vercel = JSON.parse(await readFile("vercel.json", "utf8"));
  const corpusRule = vercel.headers.find((rule) => rule.source === "/src/accepted-words.js");
  const cacheControl = corpusRule?.headers.find(
    (header) => header.key === "Cache-Control",
  )?.value;

  assert.equal(cacheControl, "public, max-age=0, must-revalidate");
});

test("keeps the service worker update prompt wired end to end", async () => {
  const [serviceWorker, app, html] = await Promise.all([
    readFile("service-worker.js", "utf8"),
    readFile("src/app.js", "utf8"),
    readFile("index.html", "utf8"),
  ]);

  assert.ok(serviceWorker.includes('event.data?.type === "SKIP_WAITING"'));
  assert.ok(serviceWorker.includes("self.skipWaiting()"));
  assert.ok(app.includes('postMessage({ type: "SKIP_WAITING" })'));
  assert.ok(app.includes('addEventListener("controllerchange"'));
  assert.ok(app.includes("updateReloadArmed"), "reloads must require an accepted prompt");
  assert.ok(app.includes("keepUpdatePromptOffKeyboard"));
  assert.ok(app.includes("keyboardRect.bottom - bannerRect.top"));
  assert.ok(app.includes('behavior: REDUCED_MOTION.matches ? "auto" : "smooth"'));
  assert.ok(html.includes('id="update-banner"'));
  assert.ok(html.includes('id="update-refresh"'));
  assert.ok(html.includes('id="update-dismiss"'));
});

test("keeps the paid, non-spoiling hint flow explicit", async () => {
  const [app, game, html, styles] = await Promise.all([
    readFile("src/app.js", "utf8"),
    readFile("src/game.js", "utf8"),
    readFile("index.html", "utf8"),
    readFile("styles.css", "utf8"),
  ]);

  assert.ok(html.includes('id="hint-confirmation"'));
  assert.ok(html.includes('id="hint-cancel"'));
  assert.ok(html.includes('id="hint-confirm"'));
  assert.ok(html.includes("Përdor 1 provë"));
  assert.ok(app.includes("state.hintRow = state.guesses.length"));
  assert.ok(app.includes('label.textContent = "Gjurmë · 1 provë e përdorur"'));
  assert.ok(app.includes("formatHintMetadata("));
  assert.ok(game.includes("syllableCount"));
  assert.ok(styles.includes(".hint-attempt-cell"));
  assert.doesNotMatch(
    app,
    /hintDescription\.textContent\s*=\s*`\$\{answer\.partOfSpeech\}\s*·\s*\$\{answer\.syllables\}`/u,
    "the active hint must not reveal the word's syllable spelling",
  );
});

test("keeps hint grammar correct and shared results compact", async () => {
  const app = await readFile("src/app.js", "utf8");

  assert.ok(app.includes('"Gjurmë pas një prove tjetër."'));
  assert.ok(app.includes('`Gjurmë pas ${remaining} provash të tjera.`'));
  assert.doesNotMatch(app, /\$\{remaining === 1 \? "prove" : "provash"\} të tjera/u);
  assert.ok(
    app.includes('const SHARE_MARK = Object.freeze({ absent: "×", present: "•", correct: "✓" });'),
  );
  assert.ok(app.includes('.map((status) => SHARE_MARK[status])\n      .join(" ")'));
  assert.ok(app.includes('gridRows.splice(state.hintRow, 0, "💡 Gjurmë")'));
  assert.ok(app.includes('"✓ në vend · • diku tjetër · × jo në fjalë"'));
  assert.ok(app.includes("formatShareDate("));
  assert.ok(app.includes('currentRoot.hostname === "fjale-self.vercel.app"'));
  assert.ok(app.includes("canonicalHref"));
  assert.doesNotMatch(app, /⬛|🟨|🟩/u);
});

test("keeps touch interaction contracts for mobile", async () => {
  const [styles, html] = await Promise.all([
    readFile("styles.css", "utf8"),
    readFile("index.html", "utf8"),
  ]);

  // (a) the button/a/select/input reset must opt into touch-action: manipulation
  const resetMatch = styles.match(
    /button,\s*a,\s*select,\s*input\s*\{([^}]*)\}/u,
  );
  assert.ok(resetMatch, "styles.css must keep the button/a/select/input reset rule");
  assert.match(
    resetMatch[1],
    /touch-action:\s*manipulation/u,
    "the interactive-element reset must set touch-action: manipulation",
  );

  // (b) the viewport meta must not disable user zoom
  const viewportMatch = html.match(/<meta name="viewport" content="([^"]*)"/u);
  assert.ok(viewportMatch, "index.html must declare a viewport meta");
  assert.doesNotMatch(
    viewportMatch[1],
    /user-scalable/u,
    "viewport meta must not disable user scaling",
  );
  assert.doesNotMatch(
    viewportMatch[1],
    /maximum-scale/u,
    "viewport meta must not cap maximum-scale",
  );

  // (c) pull-to-refresh must be suppressed on the game surface
  assert.match(
    styles,
    /overscroll-behavior-y:\s*none/u,
    "styles.css must suppress vertical overscroll (pull-to-refresh)",
  );

  // (d) every :hover rule must sit inside an @media (hover: hover) guard.
  // Strip balanced @media (hover: hover) { ... } blocks, then assert no :hover leaks.
  const marker = "@media (hover: hover)";
  let outsideGuards = "";
  let cursor = 0;
  while (cursor < styles.length) {
    const start = styles.indexOf(marker, cursor);
    if (start === -1) {
      outsideGuards += styles.slice(cursor);
      break;
    }
    outsideGuards += styles.slice(cursor, start);
    let depth = 0;
    let index = styles.indexOf("{", start);
    for (; index < styles.length; index += 1) {
      if (styles[index] === "{") depth += 1;
      else if (styles[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          break;
        }
      }
    }
    cursor = index;
  }

  const totalHover = (styles.match(/:hover/gu) ?? []).length;
  const unguardedHover = (outsideGuards.match(/:hover/gu) ?? []).length;
  assert.ok(totalHover > 0, "expected at least one :hover rule to guard");
  assert.equal(
    unguardedHover,
    0,
    "every :hover rule must live inside an @media (hover: hover) block",
  );
});

test("keeps focus treatment branded and non-interactive destinations quiet", async () => {
  const styles = await readFile("styles.css", "utf8");

  assert.match(styles, /--focus:\s*var\(--primary-deep\)/u);
  assert.match(
    styles,
    /:where\(button, a, select, input\):focus-visible\s*\{[^}]*var\(--focus\)/u,
  );
  assert.match(
    styles,
    /\.result-panel:focus\s*\{[^}]*outline:\s*none;[^}]*box-shadow:\s*none;/u,
  );
  assert.match(
    styles,
    /\.board-stage:focus\s*\{[^}]*outline:\s*none;[^}]*box-shadow:\s*none;/u,
  );
  assert.doesNotMatch(styles, /\.result-panel:focus-visible/u);
  assert.doesNotMatch(styles, /\.board-stage:focus-visible/u);
});

test("keeps the mobile keyboard in Albanian QWERTZ order with familiar controls", async () => {
  const app = await readFile("src/app.js", "utf8");
  const keyboardBlock = app.match(
    /const KEYBOARD_ROWS = Object\.freeze\(\[([\s\S]*?)\]\);/u,
  );
  assert.ok(keyboardBlock, "app.js must declare literal keyboard rows");

  const rows = [...keyboardBlock[1].matchAll(/\[([^\]]+)\]/gu)].map(([, row]) =>
    [...row.matchAll(/"([^"]+)"/gu)].map(([, key]) => key),
  );
  assert.deepEqual(rows, [
    ["q", "e", "r", "t", "z", "u", "i", "o", "p", "ç", "backspace"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", "ë", "enter"],
    ["y", "x", "c", "v", "b", "n", "m"],
  ]);

  const letters = rows.flat().filter((key) => !["backspace", "enter"].includes(key));
  const ordinaryLetters = ALBANIAN_ALPHABET.filter((letter) => !ALBANIAN_DIGRAPHS.includes(letter));
  assert.equal(new Set(letters).size, ordinaryLetters.length);
  assert.deepEqual([...letters].sort(), [...ordinaryLetters].sort());
  assert.equal(rows[0].at(-1), "backspace");
  assert.equal(rows[1].at(-1), "enter");
  assert.equal(rows[2].length, 7);
  assert.doesNotMatch(app, /\["dh",\s*"gj",\s*"ll",/u);
  assert.match(
    await readFile("styles.css", "utf8"),
    /@media \(max-width: 340px\)[\s\S]*?\.brand\s*\{[\s\S]*?left:\s*calc\(50% - 24px\)/u,
    "the brand mark must clear the Passport target at the 320px support floor",
  );
});

test("keeps current guess tiles selectable and replaceable without a saved cursor", async () => {
  const [app, styles] = await Promise.all([
    readFile("src/app.js", "utf8"),
    readFile("styles.css", "utf8"),
  ]);

  assert.ok(app.includes('elements.board.addEventListener("click", handleBoardClick)'));
  assert.ok(app.includes('elements.board.addEventListener("keydown", handleBoardKeydown)'));
  assert.ok(app.includes("tile.dataset.currentIndex = String(columnIndex)"));
  assert.ok(app.includes('tile.setAttribute("aria-selected", String(selected))'));
  assert.ok(app.includes("replaceGuessToken(before, selectedIndex, normalized)"));
  assert.ok(app.includes("mergePhysicalCharacterAt(before, editedIndex, normalized)"));
  assert.ok(app.includes("removeGuessTokenAt(state.current, selectedIndex)"));
  assert.ok(app.includes("inputLetter(event.key, { fromPhysicalKeyboard: true })"));
  assert.match(app, /fromPhysicalKeyboard\s*&&\s*Number\.isInteger\(pendingEditedDigraphIndex\)/u);
  assert.ok(app.includes("elements.boardStage.focus({ preventScroll: true })"));
  assert.match(styles, /\.tile\.is-editable\.is-selected\s*\{/u);
});

test("rejects a repeated guess before it can consume another attempt", async () => {
  const app = await readFile("src/app.js", "utf8");

  assert.ok(app.includes("hasSubmittedGuess(state.guesses, state.current)"));
  assert.ok(app.includes("E ke provuar tashmë këtë fjalë."));
});

test("publishes crawl directives for the canonical origin", async () => {
  const [robots, sitemap, serverSource] = await Promise.all([
    readFile("robots.txt", "utf8"),
    readFile("sitemap.xml", "utf8"),
    readFile("server.mjs", "utf8"),
  ]);

  assert.ok(robots.includes(`Sitemap: ${CANONICAL_ORIGIN}sitemap.xml`));
  assert.ok(sitemap.includes(`<loc>${CANONICAL_ORIGIN}</loc>`));
  assert.ok(sitemap.includes("<lastmod>"), "sitemap entries must carry lastmod");
  assert.ok(serverSource.includes('"/robots.txt"'));
  assert.ok(serverSource.includes('"/sitemap.xml"'));
});

test("wires the privacy page through every serving layer", async () => {
  const [privacy, html, serverSource, vercelSource, serviceWorker, sitemap] = await Promise.all([
    readFile("privatesia.html", "utf8"),
    readFile("index.html", "utf8"),
    readFile("server.mjs", "utf8"),
    readFile("vercel.json", "utf8"),
    readFile("service-worker.js", "utf8"),
    readFile("sitemap.xml", "utf8"),
  ]);

  // The page itself: Albanian, canonical, self-contained (CSP allows no inline
  // style/script, and the privacy promise forbids third-party resources).
  assert.ok(privacy.includes('<html lang="sq">'));
  assert.ok(privacy.includes(`href="${CANONICAL_ORIGIN}privatesia.html"`));
  assert.ok(privacy.includes('href="/styles.css"'));
  assert.ok(privacy.includes('src="/src/page-theme.js"'));
  assert.doesNotMatch(privacy, /<style|onclick|javascript:/u);
  assert.doesNotMatch(
    privacy.replaceAll(`${CANONICAL_ORIGIN}privatesia.html`, ""),
    /https?:\/\//u,
    "the privacy page must reference no external origin",
  );

  // Reachable from the game: footer and settings dialog both link it.
  const linkCount = (html.match(/href="\/privatesia\.html"/gu) ?? []).length;
  assert.ok(linkCount >= 2, "index.html must link the privacy page from footer and settings");
  assert.ok(html.includes('class="app-footer"'));

  // Served locally, cached correctly in production, available offline, crawlable.
  assert.ok(serverSource.includes('"/privatesia.html"'));
  assert.ok(serverSource.includes('"/src/page-theme.js"'));
  assert.ok(vercelSource.includes("privatesia.html"));
  assert.ok(serviceWorker.includes('"/privatesia.html"'));
  assert.ok(serviceWorker.includes('"/src/page-theme.js"'));
  assert.ok(sitemap.includes(`<loc>${CANONICAL_ORIGIN}privatesia.html</loc>`));
});

test("keeps internal documents out of the deployment", async () => {
  const vercelIgnore = await readFile(".vercelignore", "utf8");
  const ignored = new Set(vercelIgnore.split("\n").map((line) => line.trim()).filter(Boolean));

  for (const entry of [
    "ROADMAP.md",
    "LEXICON.md",
    "LESSONS.md",
    "DESIGN.md",
    "PRODUCT.md",
    "README.md",
    "EDITORIAL.md",
    "design-concepts/",
    "editor/",
    "tests/",
    "scripts/",
    "editorial/",
    "server.mjs",
  ]) {
    assert.ok(ignored.has(entry), `.vercelignore must exclude ${entry}`);
  }
});

test("deploys the health endpoint with no-cache guards on every serving layer", async () => {
  const [serverSource, serviceWorker, vercelSource, vercelIgnore] = await Promise.all([
    readFile("server.mjs", "utf8"),
    readFile("service-worker.js", "utf8"),
    readFile("vercel.json", "utf8"),
    readFile(".vercelignore", "utf8"),
  ]);
  const vercel = JSON.parse(vercelSource);
  const apiRule = vercel.headers.find((rule) => rule.source === "/api/(.*)");

  assert.ok(serverSource.includes('pathname === "/api/health"'));
  assert.ok(serverSource.includes("handleHealthRequest(request, response)"));
  assert.ok(serviceWorker.includes('url.pathname.startsWith("/api/")'));
  assert.equal(
    apiRule?.headers.find((header) => header.key === "Cache-Control")?.value,
    "private, no-store, max-age=0",
  );
  assert.doesNotMatch(vercelIgnore, /^api\/?$/gmu, "Vercel must not ignore /api/health");
});

test("keeps the report address in exactly one configurable place", async () => {
  const [app, config] = await Promise.all([
    readFile("src/app.js", "utf8"),
    readFile("src/config.js", "utf8"),
  ]);

  assert.match(config, /export const REPORT_EMAIL = "[^"@]+@[^"@]+"/u);
  // The address must reach app.js only through the config module. Other config
  // constants may share the import, so match the binding rather than the whole
  // statement.
  assert.match(app, /import \{[^}]*\bREPORT_EMAIL\b[^}]*\} from "\.\/config\.js"/u);
  assert.doesNotMatch(
    app,
    /[\w.+-]+@[\w-]+\.[\w.]+/u,
    "app.js must not hardcode an email address",
  );
});

test("ships the reward layer dark and gates every rule behind one class", async () => {
  const [app, styles, html] = await Promise.all([
    readFile("src/app.js", "utf8"),
    readFile("styles.css", "utf8"),
    readFile("index.html", "utf8"),
  ]);

  // The layer must reach production switched off. Flipping this constant is a
  // product decision; this assertion is what forces it to be a deliberate one.
  assert.equal(REWARDS_ENABLED, false, "REWARDS_ENABLED must ship false");

  // Every new stylesheet rule hangs off the body class, so "flag off" means no
  // reward selector can match rather than "the rules happen not to apply".
  assert.match(app, /classList\.toggle\("rewards-on", rewardsEnabled\(\)\)/u);
  assert.match(
    app,
    /LOCAL_FLAG_HOSTS = new Set\(\["localhost", "127\.0\.0\.1", "\[::1\]"\]\)/u,
    "the rewards query override must be restricted to loopback hosts",
  );
  assert.match(app, /if \(!LOCAL_FLAG_HOSTS\.has\(window\.location\.hostname\)\)/u);
  assert.match(
    app,
    /streakGraceEnabled: rewardsEnabled\(\)/u,
    "the dark reward flag must preserve the existing streak rules",
  );
  // The section runs from its banner to the end of the components layer, so the
  // token audit below cannot drift into unrelated rules.
  const rewardStart = styles.indexOf("Lëvizje & shpërblime (plan §4)");
  const rewardBlock = styles.slice(rewardStart, styles.indexOf("@layer utilities"));
  assert.ok(rewardStart > 0 && rewardBlock.length > 0, "styles.css must carry the reward section");

  // Timings and easings come straight from the §4.3 table; only the two
  // existing easing tokens are permitted.
  const timings = {
    "digraph-snap": "140ms",
    "stamp-land": "260ms",
    "streak-tick": "220ms",
    "besa-seal-press": "320ms",
    "hot-underline": "300ms",
    "milestone-band": "700ms",
  };
  for (const [name, duration] of Object.entries(timings)) {
    assert.ok(
      new RegExp(`animation: ${name} ${duration} var\\(--ease-(out|standard)\\)`, "u").test(styles),
      `${name} must animate for ${duration} on an existing easing token`,
    );
  }
  assert.doesNotMatch(
    rewardBlock,
    /cubic-bezier|--ease-(?!out\b|standard\b)[a-z-]+/u,
    "the reward layer must introduce no third easing curve",
  );

  // Motion is transform and opacity only: no layout property and no box-shadow
  // may appear inside a reward keyframe.
  const rewardKeyframes = [
    ...styles.matchAll(
      /@keyframes (digraph-snap|digraph-snap-letter|stamp-land|streak-tick|hot-underline|besa-seal-press|milestone-band|milestone-band-fade)\s*\{([^}]*\{[^}]*\}\s*)*\}/gu,
    ),
  ];
  assert.equal(rewardKeyframes.length, 8, "every reward keyframe must be present");
  for (const [block, name] of rewardKeyframes) {
    assert.doesNotMatch(
      block,
      /\b(width|height|top|left|right|bottom|margin|padding|box-shadow)\s*:/u,
      `@keyframes ${name} may animate only transform and opacity`,
    );
  }

  // Each animation carries its own reduced-motion rule; the blunt global only
  // lands correctly for `both`-filled animations with a real final keyframe.
  const reducedBlocks = [...styles.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/gu)];
  assert.ok(reducedBlocks.length >= 2, "the reward layer needs its own reduced-motion block");
  for (const selector of [
    ".tile.is-digraph.is-snapping",
    ".key.is-pressed",
    ".alphabet-stamp.is-landing",
    ".streak-figure.is-ticking .streak-digit",
    "#stat-streak.is-hot::after",
    ".result-besa-seal.is-pressing",
    ".badge-seal-coin",
    ".avatar-current-visual.is-changing img",
    ".avatar-option.is-unlocking img",
    ".milestone-band.is-running",
  ]) {
    assert.ok(
      styles.slice(styles.lastIndexOf("@media (prefers-reduced-motion: reduce)")).includes(selector),
      `${selector} needs an explicit reduced-motion fallback`,
    );
  }

  // No new colour token: the layer paints only with tokens both themes declare.
  const rewardColours = [...rewardBlock.matchAll(/var\((--[a-z-]+)\)/gu)].map(([, token]) => token);
  const allowed = new Set([
    "--bg", "--primary", "--primary-deep", "--primary-pale", "--correct", "--ink", "--ink-soft",
    "--muted", "--faint", "--surface", "--surface-hover", "--line-strong", "--on-primary",
    "--ease-out", "--ease-standard", "--radius-sm", "--radius-md", "--stamp-delay",
  ]);
  for (const token of new Set(rewardColours)) {
    assert.ok(allowed.has(token), `${token} is not an approved reward-layer token`);
  }

  // The badge page lives inside the existing passport dialog — not a new dialog
  // and not a new nav item — and every id from the game layer has Albanian copy.
  const passportDialog = html.slice(
    html.indexOf('id="passport-dialog"'),
    html.indexOf('id="stats-dialog"'),
  );
  assert.ok(passportDialog.includes('id="passport-tablist"'));
  assert.ok(passportDialog.includes('id="badge-dialog-count"'));
  assert.ok(passportDialog.includes('id="badge-grid"'));
  assert.ok(passportDialog.includes('id="passport-tab-avatar"'));
  assert.ok(passportDialog.includes('id="passport-panel-avatar"'));
  assert.ok(passportDialog.includes('id="avatar-free-grid"'));
  assert.ok(passportDialog.includes('id="avatar-earned-grid"'));
  assert.ok(passportDialog.includes('id="avatar-letter-select"'));

  // The alphabet section is on screen whether or not the flag is set, so its
  // tabpanel semantics must be attached at runtime. Authored in the markup they
  // would give the shipped dialog an extra tab stop and a tabpanel with no
  // tablist above it — "flag off" would stop meaning "unchanged".
  assert.doesNotMatch(
    passportDialog,
    /role="tabpanel"/u,
    "tabpanel roles must be applied by applyRewardsVisibility, not authored",
  );
  assert.match(app, /panel\.setAttribute\("role", "tabpanel"\)/u);
  assert.equal(
    [...html.matchAll(/<dialog/gu)].length,
    4,
    "Vulat must not add a fifth dialog",
  );
  for (const id of [...BADGE_IDS, ...MILESTONE_IDS]) {
    assert.ok(app.includes(`"${id}"`), `app.js must carry Albanian copy for ${id}`);
  }

  // The badge backs form one quiet, ordered easter egg. Interaction is a real
  // button with pressed state, not a hover-only decoration, and the coin uses a
  // bounded 3D transform that becomes instant under reduced motion.
  const badgeCopyBlock = app.slice(
    app.indexOf("const BADGE_COPY"),
    app.indexOf("const MILESTONE_COPY"),
  );
  const badgeSecrets = [...badgeCopyBlock.matchAll(/secret: "([^"]+)"/gu)].map(
    ([, secret]) => secret,
  );
  assert.equal(badgeSecrets.length, BADGE_IDS.length);
  assert.equal(badgeSecrets.join(""), "FJALËMEBESË");
  assert.match(app, /seal\.type = "button"/u);
  assert.match(app, /seal\.setAttribute\("aria-pressed", "false"\)/u);
  assert.match(app, /classList\.toggle\("is-flipped"\)/u);
  assert.match(rewardBlock, /transform-style: preserve-3d/u);
  assert.match(rewardBlock, /backface-visibility: hidden/u);
  assert.match(rewardBlock, /transition: transform 360ms var\(--ease-out\)/u);
  const badgeSealRule = rewardBlock.match(/\.badge-seal \{([^}]+)\}/u)?.[1] ?? "";
  assert.match(badgeSealRule, /width: 44px/u);
  assert.match(badgeSealRule, /height: 44px/u);
  // New Albanian copy stays flagged for a native pass.
  assert.ok(app.includes("UNVERIFIED sq copy"));
  assert.ok(html.includes("UNVERIFIED sq copy"));
});

test("surfaces invalid challenge links instead of silently opening the daily", async () => {
  const app = await readFile("src/app.js", "utf8");

  assert.ok(app.includes("invalidChallengeCode: Boolean(challengeCode)"));
  assert.ok(app.includes("primaryDescriptor.invalidChallengeCode"));
  assert.ok(app.includes("Lidhja e sfidës nuk është e vlefshme"));
});

test("keeps the service-worker shell, server allowlist, and corpus policy synchronized", async () => {
  const [serviceWorker, serverSource, vercelSource] = await Promise.all([
    readFile("service-worker.js", "utf8"),
    readFile("server.mjs", "utf8"),
    readFile("vercel.json", "utf8"),
  ]);

  const extractPaths = (source, marker) => {
    const match = source.match(new RegExp(`${marker}[^\\[]*\\[([^\\]]+)\\]`, "u"));
    assert.ok(match, `${marker} list must exist`);
    return [...match[1].matchAll(/"([^"]+)"/gu)].map(([, path]) => path);
  };

  const appShell = extractPaths(serviceWorker, "const APP_SHELL = ");
  const publicPaths = new Set(extractPaths(serverSource, "const publicPaths = new Set\\("));

  // Every precached shell path must actually be served by the dev server, so a
  // rename or new file cannot ship half-wired ("/" maps to index.html). Each
  // must also exist on disk: precacheAppShell is all-or-nothing, so a single
  // 404 during install aborts the whole service worker for every user.
  for (const path of appShell) {
    if (path === "/") {
      continue;
    }
    assert.ok(publicPaths.has(path), `APP_SHELL entry ${path} must be in server publicPaths`);
    const onDisk = path === "/index.html" ? "index.html" : path.slice(1);
    assert.ok(existsSync(onDisk), `APP_SHELL entry ${path} must exist on disk`);
  }

  // The generated corpus must stay network-first with a versioned header, so a
  // corpus release reaches clients without a CACHE_NAME bump: precached for
  // offline, never cache-first.
  assert.ok(appShell.includes("/src/accepted-words.js"));
  const cacheFirstBlock = serviceWorker.match(/CACHE_FIRST_ASSETS = new Set\(\[([^\]]+)\]/u);
  assert.ok(cacheFirstBlock && !cacheFirstBlock[1].includes("accepted-words"));

  // Cache-first assets are served immutable for a year AND sit outside the
  // cache-bump guard (they left APP_SHELL with v26), so the ONLY way their
  // bytes can ever change for an existing client is a filename change. Enforce
  // the -vN naming convention that makes that possible; icons predate it and
  // are grandfathered by exact name.
  const versionedExceptions = new Set([
    "/favicon.svg",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-maskable-512.png",
  ]);
  const cacheFirstPaths = [...cacheFirstBlock[1].matchAll(/"([^"]+)"/gu)].map(([, p]) => p);
  for (const path of cacheFirstPaths) {
    if (versionedExceptions.has(path)) {
      continue;
    }
    assert.match(
      path,
      /-v\d+\.\w+$/u,
      `${path} is cache-first + immutable: its filename must carry a -vN version`,
    );
    assert.ok(existsSync(path.slice(1)), `CACHE_FIRST_ASSETS entry ${path} must exist on disk`);
  }
  const corpus = await readFile("src/accepted-words.js", "utf8");
  assert.match(corpus, /Corpus version: \S+/u, "corpus must declare its version");
  assert.match(serviceWorker, /const CACHE_NAME = "fjale-shell-v\d+"/u);

  // A later authenticated API must never inherit the shell's Cache API policy.
  const apiGuard = serviceWorker.indexOf('url.pathname === "/api"');
  const networkFirstDispatch = serviceWorker.indexOf("event.respondWith(networkFirst");
  assert.ok(apiGuard >= 0 && apiGuard < networkFirstDispatch, "API bypass must run before caching");
  const vercel = JSON.parse(vercelSource);
  const apiRule = vercel.headers.find((rule) => rule.source === "/api/(.*)");
  assert.equal(
    apiRule?.headers.find((header) => header.key === "Cache-Control")?.value,
    "private, no-store, max-age=0",
  );
});

test("pins the release cache and guards every cached runtime update", async () => {
  const serviceWorker = await readFile("service-worker.js", "utf8");
  const previousServiceWorker = serviceWorker.replace("fjale-shell-v29", "fjale-shell-v28");

  // This pin advances with every production release. CI additionally compares
  // the branch against its base so cached files cannot change without a bump.
  assert.equal(readCacheVersion(serviceWorker), 29);
  assert.ok(readAppShellFiles(serviceWorker).includes("src/game.js"));
  assert.ok(
    readAppShellFiles(
      serviceWorker.replace('"/src/game.js"', "'/src/game.js?release=example#shell'"),
    ).includes("src/game.js"),
  );
  assert.throws(
    () => readAppShellFiles(serviceWorker.replace('"/src/game.js"', "runtimePath")),
    /only quoted root-relative paths/u,
  );
  assert.deepEqual(
    findChangedCachedFiles(
      ["src/game.js", "README.md", "service-worker.js"],
      previousServiceWorker,
      serviceWorker,
    ),
    ["src/game.js", "service-worker.js"],
  );
  assert.deepEqual(
    findChangedCachedFiles(["README.md"], previousServiceWorker, serviceWorker),
    [],
  );
  assert.throws(
    () => assertCacheVersionBump(["src/game.js"], previousServiceWorker, previousServiceWorker),
    /did not advance beyond fjale-shell-v28/u,
  );
  assert.deepEqual(
    assertCacheVersionBump(["src/game.js"], previousServiceWorker, serviceWorker),
    { previousVersion: 28, currentVersion: 29 },
  );
});
