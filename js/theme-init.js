/* js/theme-init.js
   Runs before the page paints. Applies a saved light/dark choice.
   If nothing is saved, the device preference (prefers-color-scheme) is used. */
(function () {
  try {
    var saved = localStorage.getItem('habitTracker:theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (error) {
    /* localStorage can be blocked; fall back to the device preference. */
  }
})();