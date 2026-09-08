import './public-download-name-editor.js';

function applyAdminBranding(projectName) {
  const name = typeof projectName === 'string' ? projectName.trim() : '';
  if (!name) return false;

  document.title = `Администрирование — ${name}`;

  const topbar = document.querySelector('.topbar');
  const eyebrow = topbar?.querySelector('.eyebrow');
  const heading = topbar?.querySelector('h1');

  if (eyebrow) eyebrow.textContent = 'Администрирование';
  if (heading) heading.textContent = name;
  return true;
}

async function loadAdminBranding() {
  try {
    const response = await fetch('/api/project', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const settings = await response.json();
    applyAdminBranding(settings.projectName);
  } catch {
    // Keep the static fallback heading if project settings are unavailable.
  }
}

if (typeof document !== 'undefined') {
  void loadAdminBranding();
}

export { applyAdminBranding };
