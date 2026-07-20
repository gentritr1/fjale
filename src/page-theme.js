// Static pages (like /privatesia.html) do not load the game app, so they apply
// the player's saved theme themselves. Reads the same preferences record the
// game writes; anything unreadable falls back to the system color scheme.
try {
  const raw = window.localStorage.getItem("fjale:preferences:v1");
  const theme = raw ? JSON.parse(raw)?.theme : null;
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  }
} catch {
  // Storage blocked or corrupt: the system theme applies.
}
