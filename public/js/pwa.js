const PWAManager = (() => {
  async function cleanupLegacyServiceWorkers() {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch {}

    if ('caches' in window) {
      try {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      } catch {}
    }
  }

  function init() {
    cleanupLegacyServiceWorkers();
  }

  function promptInstall() {}
  function hideInstallBanner() {}
  function applyUpdate() {}
  function isInstalled() { return false; }
  function showInstallBanner() {}

  return {
    init,
    promptInstall,
    hideInstallBanner,
    applyUpdate,
    isInstalled,
    showInstallBanner,
  };
})();

PWAManager.init();
