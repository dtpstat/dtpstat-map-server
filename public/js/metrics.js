function metaContent(name) {
  return document.querySelector(`meta[name="${name}"]`)?.content?.trim() ?? '';
}

function appendScript(src, provider) {
  if (document.querySelector(`script[data-metrics-provider="${provider}"]`)) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  script.dataset.metricsProvider = provider;
  document.head.append(script);
}

function startYandexMetrika(counterId) {
  if (!/^[1-9][0-9]{0,14}$/.test(counterId)) return;

  window.ym = window.ym || function yandexMetrikaQueue() {
    (window.ym.a = window.ym.a || []).push(arguments);
  };
  window.ym.l = window.ym.l || Date.now();

  appendScript('https://mc.yandex.ru/metrika/tag.js', 'yandex');
  window.ym(Number(counterId), 'init', {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
  });
}

function startGoogleAnalytics(measurementId) {
  if (!/^G-[A-Z0-9]{4,32}$/.test(measurementId)) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function googleAnalyticsQueue() {
    window.dataLayer.push(arguments);
  };

  window.gtag('js', new Date());
  window.gtag('config', measurementId);
  appendScript(
    `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`,
    'google',
  );
}

const yandexMetrikaId = metaContent('yandex-metrika-id');
const googleAnalyticsId = metaContent('google-analytics-id').toUpperCase();

if (yandexMetrikaId) startYandexMetrika(yandexMetrikaId);
if (googleAnalyticsId) startGoogleAnalytics(googleAnalyticsId);
