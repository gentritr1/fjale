import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CANONICAL_ORIGIN = "https://fjale-self.vercel.app/";
const OG_IMAGE_URL = `${CANONICAL_ORIGIN}og-fjale-v2.png`;

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
  assert.equal(structuredData["@type"], "WebApplication");
  assert.equal(structuredData.url, CANONICAL_ORIGIN);
  assert.equal(structuredData.image, OG_IMAGE_URL);
  assert.ok(productionCsp?.includes(`'${structuredDataHash}'`));
  assert.ok(serverSource.includes(`"script-src 'self' '${structuredDataHash}'"`));
  assert.ok(serverSource.includes('"/og-fjale-v2.png"'));
});

test("keeps the versioned social card at the declared dimensions", async () => {
  const png = await readFile("og-fjale-v2.png");

  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 1_200);
  assert.equal(png.readUInt32BE(20), 630);
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

test("publishes crawl directives for the canonical origin", async () => {
  const [robots, sitemap, serverSource] = await Promise.all([
    readFile("robots.txt", "utf8"),
    readFile("sitemap.xml", "utf8"),
    readFile("server.mjs", "utf8"),
  ]);

  assert.ok(robots.includes(`Sitemap: ${CANONICAL_ORIGIN}sitemap.xml`));
  assert.ok(sitemap.includes(`<loc>${CANONICAL_ORIGIN}</loc>`));
  assert.ok(serverSource.includes('"/robots.txt"'));
  assert.ok(serverSource.includes('"/sitemap.xml"'));
});
