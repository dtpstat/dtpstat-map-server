function metaContent(name) {
  return document.querySelector(`meta[name="${name}"]`)?.content?.trim() ?? '';
}

const metricsState = {
  yandex: {
    configured: false,
    initialized: false,
    ready: false,
    scriptStatus: 'disabled',
    scriptSrc: null,
    lastError: null,
  },
  google: {
    configured: false,
    initialized: false,
    ready: false,
    scriptStatus: 'disabled',
    scriptSrc: null,
    lastError: null,
  },
};

// Public, read-only-by-convention diagnostics for DevTools. Analytics IDs are
// already public browser identifiers; the state intentionally stores only
// loader status and URLs so a blocked script can be diagnosed immediately.
window.dtpstatMetrics = metricsState;

function publishStatus(provider) {
  window.dispatchEvent(new CustomEvent('dtpstat:metrics-status', {
    detail: {
      provider,
      state: { ...metricsState[provider] },
    },
  }));
}

function setScriptStatus(provider, status, src, error = null) {
  const state = metricsState[provider];
  state.scriptStatus = status;
  state.scriptSrc = src;
  state.lastError = error;
  publishStatus(provider);
}

function markInitialized(provider) {
  metricsState[provider].initialized = true;
  publishStatus(provider);
}

function markReady(provider) {
  metricsState[provider].ready = true;
  publishStatus(provider);
}

function appendScript(src, provider, onLoad) {
  const existing = document.querySelector(`script[data-metrics-provider="${provider}"]`);
  if (existing) return existing;

  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  script.dataset.metricsProvider = provider;
  script.addEventListener('load', () => {
    setScriptStatus(provider, 'loaded', src);
    onLoad?.();
  }, { once: true });
  script.addEventListener('error', () => {
    const message = `Failed to load ${provider} analytics script`;
    setScriptStatus(provider, 'error', src, message);
    console.warn(`[dtpstat metrics] ${message}: ${src}`);
  }, { once: true });
  setScriptStatus(provider, 'loading', src);
  document.head.append(script);
  return script;
}

function startYandexMetrika(counterId) {
  if (!/^[1-9][0-9]{0,14}$/.test(counterId)) return;
  metricsState.yandex.configured = true;

  window.ym = window.ym || function yandexMetrikaQueue() {
    (window.ym.a = window.ym.a || []).push(arguments);
  };
  window.ym.l = window.ym.l || Date.now();

  const readyEvent = `yacounter${counterId}inited`;
  document.addEventListener(readyEvent, () => markReady('yandex'), { once: true });
  appendScript('https://mc.yandex.ru/metrika/tag.js', 'yandex');
  window.ym(Number(counterId), 'init', {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: true,
    triggerEvent: true,
  });
  markInitialized('yandex');
}

function startGoogleAnalytics(measurementId) {
  if (!/^G-[A-Z0-9]{4,32}$/.test(measurementId)) return;
  metricsState.google.configured = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function googleAnalyticsQueue() {
    window.dataLayer.push(arguments);
  };

  const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  appendScript(src, 'google', () => markReady('google'));
  window.gtag('js', new Date());
  window.gtag('config', measurementId);
  markInitialized('google');
}

const yandexMetrikaId = metaContent('yandex-metrika-id');
const googleAnalyticsId = metaContent('google-analytics-id').toUpperCase();

if (yandexMetrikaId) startYandexMetrika(yandexMetrikaId);
if (googleAnalyticsId) startGoogleAnalytics(googleAnalyticsId);
