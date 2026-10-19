// The Vercel entry point for every Rrethi route — PLAN-RRETHI-M1-API.md §0.
//
// One optional catch-all function serves all nine endpoints. The implementation
// is `api/_lib/router.js` so that `server.mjs` and the test suite can import it
// by a specifier that does not contain `[[...]]`, which URL parsing
// percent-encodes. Keeping this file a pure re-export means there is still
// exactly one router and one shared preamble.

export { handleRrethiRequest } from "../_lib/router.js";
export { default } from "../_lib/router.js";
