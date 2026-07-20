// Deployment-facing configuration. The app has no backend, so "configurable"
// means one reviewed place to change before a deploy — nothing here is read
// from the environment at runtime.

// Where "missing word" and error reports go. Switching to a branded address
// (a product decision, pending the custom-domain choice) is a one-line change
// here; no other file mentions the address.
export const REPORT_EMAIL = "gentrit.rashiti2@gmail.com";
