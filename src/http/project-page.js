function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderProjectPage(template, settings) {
  const projectName = escapeHtml(settings.projectName);
  const keywords = escapeHtml((settings.keywords ?? []).join(', '));
  return template
    .replaceAll('{{PROJECT_NAME}}', projectName)
    .replaceAll('{{PROJECT_KEYWORDS}}', keywords)
    .replace('{{PROJECT_FOOTER_HTML}}', settings.footerHtml);
}

export function projectManifest(settings) {
  return {
    name: settings.projectName,
    short_name: settings.projectName,
    icons: [
      {
        src: '/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    theme_color: '#ffffff',
    background_color: '#ffffff',
    display: 'standalone',
  };
}
