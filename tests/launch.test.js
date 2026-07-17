import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CANONICAL_ORIGIN = "https://fjale-self.vercel.app/";
const OG_IMAGE_URL = `${CANONICAL_ORIGIN}og-fjale-v1.png`;

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
  assert.ok(serverSource.includes('"/og-fjale-v1.png"'));
});

test("keeps the versioned social card at the declared dimensions", async () => {
  const png = await readFile("og-fjale-v1.png");

  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 1_200);
  assert.equal(png.readUInt32BE(20), 630);
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
