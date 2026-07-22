import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const CACHE_NAME_PATTERN = /const CACHE_NAME = "fjale-shell-v(\d+)";/u;
const APP_SHELL_PATTERN = /const APP_SHELL = \[([^\]]+)\];/u;
const APP_SHELL_ENTRY_PATTERN = /(["'])(\/[^"']*)\1/gu;

export function readCacheVersion(serviceWorkerSource) {
  const match = String(serviceWorkerSource).match(CACHE_NAME_PATTERN);
  if (match === null) {
    throw new Error('service-worker.js must declare CACHE_NAME as "fjale-shell-v<number>".');
  }
  return Number(match[1]);
}

export function readAppShellFiles(serviceWorkerSource) {
  const match = String(serviceWorkerSource).match(APP_SHELL_PATTERN);
  if (match === null) {
    throw new Error("service-worker.js must declare a literal APP_SHELL array.");
  }
  const unmatchedSource = match[1]
    .replace(APP_SHELL_ENTRY_PATTERN, "")
    .replace(/[\s,]/gu, "");
  if (unmatchedSource !== "") {
    throw new Error("APP_SHELL may contain only quoted root-relative paths.");
  }
  return [
    ...new Set(
      [...match[1].matchAll(APP_SHELL_ENTRY_PATTERN)].map(([, , pathWithQuery]) => {
        const pathname = pathWithQuery.slice(1).split(/[?#]/u, 1)[0];
        return pathname === "" ? "index.html" : pathname;
      }),
    ),
  ];
}

export function findChangedCachedFiles(changedFiles, previousSource, currentSource) {
  const cachedFiles = new Set([
    ...readAppShellFiles(previousSource),
    ...readAppShellFiles(currentSource),
    "service-worker.js",
  ]);
  return changedFiles.filter((pathname) => cachedFiles.has(pathname));
}

export function assertCacheVersionBump(changedCachedFiles, previousSource, currentSource) {
  const previousVersion = readCacheVersion(previousSource);
  const currentVersion = readCacheVersion(currentSource);
  if (changedCachedFiles.length > 0 && currentVersion <= previousVersion) {
    throw new Error(
      `Cached runtime files changed (${changedCachedFiles.join(", ")}), but CACHE_NAME ` +
        `did not advance beyond fjale-shell-v${previousVersion}.`,
    );
  }
  return { previousVersion, currentVersion };
}

async function runGit(arguments_) {
  const { stdout } = await execFileAsync("git", arguments_, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

async function findDefaultBaseRevision() {
  const worktreeStatus = await runGit(["status", "--porcelain", "--untracked-files=all"]);
  if (worktreeStatus.trim() !== "") {
    return "HEAD";
  }
  try {
    await runGit(["rev-parse", "--verify", "HEAD~1^{commit}"]);
    return "HEAD~1";
  } catch {
    return null;
  }
}

export async function checkCacheVersionBump(baseRevision) {
  if (
    typeof baseRevision !== "string" ||
    !/^(?:[a-f0-9]{7,40}|HEAD(?:~\d+)?)$/u.test(baseRevision)
  ) {
    throw new Error("Provide a base Git commit SHA or HEAD~<number>.");
  }

  const [previousSource, currentSource, changedOutput] = await Promise.all([
    runGit(["show", `${baseRevision}:service-worker.js`]),
    readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
    runGit(["diff", "--name-only", baseRevision, "--"]),
  ]);
  const changedFiles = changedOutput.split("\n").filter(Boolean);
  const changedCachedFiles = findChangedCachedFiles(
    changedFiles,
    previousSource,
    currentSource,
  );

  const { previousVersion, currentVersion } = assertCacheVersionBump(
    changedCachedFiles,
    previousSource,
    currentSource,
  );

  return { changedCachedFiles, previousVersion, currentVersion };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  try {
    const [baseRevision, extraArgument] = process.argv.slice(2);
    if (extraArgument !== undefined) {
      throw new Error("Usage: node scripts/check-cache-version-bump.mjs [base-commit]");
    }
    const resolvedBase = baseRevision ?? (await findDefaultBaseRevision());
    if (resolvedBase === null) {
      console.log("Initial commit: no earlier cache version exists to compare.");
      process.exit(0);
    }
    const result = await checkCacheVersionBump(resolvedBase);
    if (result.changedCachedFiles.length === 0) {
      console.log("No cached runtime files changed; no cache-version bump is required.");
    } else {
      console.log(
        `Cache guard passed: v${result.previousVersion} -> v${result.currentVersion} ` +
          `for ${result.changedCachedFiles.join(", ")}.`,
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
