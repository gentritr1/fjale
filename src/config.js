// Deployment-facing configuration. The app has no backend, so "configurable"
// means one reviewed place to change before a deploy — nothing here is read
// from the environment at runtime.

// Where "missing word" and error reports go. Switching to a branded address
// (a product decision, pending the custom-domain choice) is a one-line change
// here; no other file mentions the address.
export const REPORT_EMAIL = "gentrit.rashiti2@gmail.com";

// Master switch for the "Lëvizje & shpërblime" layer (plan §4): the new motion
// table, the tiered win choreography, and the Vulat badge tab. FALSE ships the
// app exactly as it behaves today — including the confetti on every win, which
// the plan's end state removes. Flipping this to true is the owner's call, not
// an implementation detail, which is why it is a reviewed constant rather than
// a derived value. A local override (?shperblime=1) exists for testing only.
export const REWARDS_ENABLED = false;
