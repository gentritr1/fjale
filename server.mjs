import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const canonicalRoot = await realpath(rootDirectory);
const host = process.env.HOST || "127.0.0.1";
const port = parsePort(process.env.PORT || "3000");
const publicPaths = new Set([
  "/index.html",
  "/styles.css",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
  "/service-worker.js",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/og-fjale-v1.png",
  "/og-fjale-v1.svg",
  "/og-fjale-v2.png",
  "/og-fjale-v2.svg",
  "/besa-seal-v1.svg",
  "/stamp-digraph-v1.svg",
  "/src/app.js",
  "/src/game.js",
  "/src/words.js",
  "/src/accepted-words.js",
]);

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"]
]);

const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self' 'sha256-2N7wrc0qjrtbR9dL65oq0vbaRcXhhF2ZF+5w8oOrtJc='",
    "style-src 'self'",
    "worker-src 'self'"
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

const server = createServer(async (request, response) => {
  setHeaders(response, securityHeaders);

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Metoda nuk lejohet.\n", request.method);
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  } catch {
    sendText(response, 400, "Kërkesë e pavlefshme.\n", request.method);
    return;
  }

  if (pathname.includes("\0") || hasHiddenPathSegment(pathname)) {
    sendText(response, 404, "Nuk u gjet.\n", request.method);
    return;
  }

  // Only the actual index route resolves to the app shell. Unknown routes and
  // missing assets stay 404 so mistakes are not hidden behind an HTML response.
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  if (!publicPaths.has(requestedPath)) {
    sendText(response, 404, "Nuk u gjet.\n", request.method);
    return;
  }

  let filePath;
  try {
    filePath = resolveInsideRoot(requestedPath);
  } catch {
    sendText(response, 404, "Nuk u gjet.\n", request.method);
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      sendText(response, 404, "Nuk u gjet.\n", request.method);
      return;
    }

    const canonicalFile = await realpath(filePath);
    if (!isInsideRoot(canonicalFile)) {
      sendText(response, 404, "Nuk u gjet.\n", request.method);
      return;
    }

    const etag = `W/\"${fileStats.size.toString(16)}-${Math.trunc(fileStats.mtimeMs).toString(16)}\"`;
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Content-Length", fileStats.size);
    response.setHeader("Content-Type", mimeTypes.get(extname(canonicalFile).toLowerCase()) || "application/octet-stream");
    response.setHeader("ETag", etag);
    response.setHeader("Last-Modified", fileStats.mtime.toUTCString());

    if (pathname === "/service-worker.js") {
      response.setHeader("Service-Worker-Allowed", "/");
    }

    if (request.headers["if-none-match"] === etag) {
      response.removeHeader("Content-Length");
      response.writeHead(304);
      response.end();
      return;
    }

    response.writeHead(200);
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const stream = createReadStream(canonicalFile);
    stream.on("error", () => {
      if (!response.headersSent) {
        sendText(response, 500, "Gabim i brendshëm.\n", request.method);
      } else {
        response.destroy();
      }
    });
    stream.pipe(response);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR" || error?.code === "EACCES") {
      sendText(response, 404, "Nuk u gjet.\n", request.method);
      return;
    }

    console.error(error);
    sendText(response, 500, "Gabim i brendshëm.\n", request.method);
  }
});

server.on("clientError", (_error, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Porta ${port} është në përdorim.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`FJALË po punon në http://${host}:${port}`);
});

function parsePort(value) {
  if (!/^\d+$/.test(value)) {
    throw new TypeError("PORT duhet të jetë një numër i plotë.");
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new RangeError("PORT duhet të jetë ndërmjet 1 dhe 65535.");
  }
  return parsed;
}

function hasHiddenPathSegment(pathname) {
  return pathname.split("/").some((segment) => segment.startsWith(".") && segment !== ".well-known");
}

function resolveInsideRoot(pathname) {
  const relativePath = pathname.replace(/^\/+/, "");
  const candidate = resolve(canonicalRoot, relativePath);
  if (!isInsideRoot(candidate)) {
    throw new Error("Path traversal rejected");
  }
  return candidate;
}

function isInsideRoot(candidate) {
  const pathFromRoot = relative(canonicalRoot, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot));
}

function setHeaders(response, headers) {
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
}

function sendText(response, status, body, method) {
  const contentLength = Buffer.byteLength(body);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", contentLength);
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.writeHead(status);
  response.end(method === "HEAD" ? undefined : body);
}
