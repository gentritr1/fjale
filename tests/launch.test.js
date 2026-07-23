import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCacheVersionBump,
  findChangedCachedFiles,
  readAppShellFiles,
  readCacheVersion,
} from "../scripts/check-cache-version-bump.mjs";
import { ALBANIAN_ALPHABET } from "../src/game.js";

const CANONICAL_ORIGIN = "https://www.xn--fjal-opa.com/";
const OG_IMAGE_FILENAME = "og-fjale-v3.png";
const OG_IMAGE_URL = `${CANONICAL_ORIGIN}${OG_IMAGE_FILENAME}`;

test("keeps canonical, social, structured-data, and CSP metadata coherent", async () => {
  const [html, serverSource, vercelSource] = await Promise.all([
    readFile("index.html", "utf8"),
    readFile("server.mjs", "utf8"),
    readFile("vercel.json", "utf8"),
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

test("keeps the mobile keyboard in Albanian QWERTZ order with edge controls", async () => {
  const app = await readFile("src/app.js", "utf8");
  const keyboardBlock = app.match(
    /const KEYBOARD_ROWS = Object\.freeze\(\[([\s\S]*?)\]\);/u,
  );
  assert.ok(keyboardBlock, "app.js must declare literal keyboard rows");

  const rows = [...keyboardBlock[1].matchAll(/\[([^\]]+)\]/gu)].map(([, row]) =>
    [...row.matchAll(/"([^"]+)"/gu)].map(([, key]) => key),
  );
  assert.deepEqual(rows, [
    ["q", "e", "r", "t", "z", "u", "i", "o", "p", "ç"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", "ë"],
    ["y", "x", "c", "v", "b", "n", "m", "backspace"],
    ["dh", "gj", "ll", "nj", "rr", "sh", "th", "xh", "zh", "enter"],
  ]);

  const letters = rows.flat().filter((key) => !["backspace", "enter"].includes(key));
  assert.equal(new Set(letters).size, ALBANIAN_ALPHABET.length);
  assert.deepEqual([...letters].sort(), [...ALBANIAN_ALPHABET].sort());
  assert.equal(rows[2].at(-1), "backspace");
  assert.equal(rows[3].at(-1), "enter");
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
    "editor/",
    "tests/",
    "scripts/",
    "editorial/",
    "server.mjs",
  ]) {
    assert.ok(ignored.has(entry), `.vercelignore must exclude ${entry}`);
  }
});

test("keeps the report address in exactly one configurable place", async () => {
  const [app, config] = await Promise.all([
    readFile("src/app.js", "utf8"),
    readFile("src/config.js", "utf8"),
  ]);

  assert.match(config, /export const REPORT_EMAIL = "[^"@]+@[^"@]+"/u);
  assert.ok(app.includes('import { REPORT_EMAIL } from "./config.js"'));
  assert.doesNotMatch(
    app,
    /[\w.+-]+@[\w-]+\.[\w.]+/u,
    "app.js must not hardcode an email address",
  );
});

test("surfaces invalid challenge links instead of silently opening the daily", async () => {
  const app = await readFile("src/app.js", "utf8");

  assert.ok(app.includes("invalidChallengeCode: Boolean(challengeCode)"));
  assert.ok(app.includes("primaryDescriptor.invalidChallengeCode"));
  assert.ok(app.includes("Lidhja e sfidës nuk është e vlefshme"));
});

test("keeps the service-worker shell, server allowlist, and corpus policy synchronized", async () => {
  const [serviceWorker, serverSource] = await Promise.all([
    readFile("service-worker.js", "utf8"),
    readFile("server.mjs", "utf8"),
  ]);

  const extractPaths = (source, marker) => {
    const match = source.match(new RegExp(`${marker}[^\\[]*\\[([^\\]]+)\\]`, "u"));
    assert.ok(match, `${marker} list must exist`);
    return [...match[1].matchAll(/"([^"]+)"/gu)].map(([, path]) => path);
  };

  const appShell = extractPaths(serviceWorker, "const APP_SHELL = ");
  const publicPaths = new Set(extractPaths(serverSource, "const publicPaths = new Set\\("));

  // Every precached shell path must actually be served by the dev server, so a
  // rename or new file cannot ship half-wired ("/" maps to index.html).
  for (const path of appShell) {
    if (path === "/") {
      continue;
    }
    assert.ok(publicPaths.has(path), `APP_SHELL entry ${path} must be in server publicPaths`);
  }

  // The generated corpus must stay network-first with a versioned header, so a
  // corpus release reaches clients without a CACHE_NAME bump: precached for
  // offline, never cache-first.
  assert.ok(appShell.includes("/src/accepted-words.js"));
  const cacheFirstBlock = serviceWorker.match(/CACHE_FIRST_ASSETS = new Set\(\[([^\]]+)\]/u);
  assert.ok(cacheFirstBlock && !cacheFirstBlock[1].includes("accepted-words"));
  const corpus = await readFile("src/accepted-words.js", "utf8");
  assert.match(corpus, /Corpus version: \S+/u, "corpus must declare its version");
  assert.match(serviceWorker, /const CACHE_NAME = "fjale-shell-v\d+"/u);
});

test("pins the release cache and guards every cached runtime update", async () => {
  const serviceWorker = await readFile("service-worker.js", "utf8");
  const previousServiceWorker = serviceWorker.replace("fjale-shell-v15", "fjale-shell-v14");

  // This pin advances with every production release. CI additionally compares
  // the branch against its base so cached files cannot change without a bump.
  assert.equal(readCacheVersion(serviceWorker), 15);
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
    /did not advance beyond fjale-shell-v14/u,
  );
  assert.deepEqual(
    assertCacheVersionBump(["src/game.js"], previousServiceWorker, serviceWorker),
    { previousVersion: 14, currentVersion: 15 },
  );
});
