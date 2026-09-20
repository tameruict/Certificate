try {
  const response = await fetch('/api/config', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  if (response.ok) {
    const runtimeConfig = await response.json();
    if (runtimeConfig.url && runtimeConfig.anonKey) {
      window.CERTLAB_SUPABASE_CONFIG = Object.freeze(runtimeConfig);
    }
  }
} catch (_) {
  // Local static-server use can rely on the optional config.js override.
}

await import('./app.js');
