// Client-facing configuration. The game UI remains static, so "configurable"
// means one reviewed place to change before a deploy. Server-only health and
// future Rrethi settings live in environment variables under /api instead.

// Where "missing word" and error reports go. Switching to a branded address
// (a product decision, pending the custom-domain choice) is a one-line change
// here; no other file mentions the address.
export const REPORT_EMAIL = "gentrit.rashiti2@gmail.com";

// Master switch for the "Lëvizje & shpërblime" experiment (plan §4): motion,
// tiered wins, Vulat, and the one-day streak grace. FALSE preserves both the
// current presentation and the current streak rules. Flipping this to true is
// an owner decision after native copy and device review. A loopback-only
// override (?shperblime=1) exists for local testing.
export const REWARDS_ENABLED = false;
