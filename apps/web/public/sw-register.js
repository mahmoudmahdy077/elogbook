// Service worker registration — deferred for performance
// Loaded via <script defer> so it doesn't block rendering
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(function (e) {
          console.warn('SW registration failed:', e);
        });
    });
  }
})();
