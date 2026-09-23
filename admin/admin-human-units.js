function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unit]}`;
}

function formatSeconds(value) {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 60) return `${value} сек`;
  if (value < 3600) {
    const minutes = value / 60;
    return Number.isInteger(minutes) ? `${minutes} мин` : `${minutes.toFixed(1)} мин`;
  }
  if (value < 86400) {
    const hours = value / 3600;
    return Number.isInteger(hours) ? `${hours} ч` : `${hours.toFixed(1)} ч`;
  }
  const days = value / 86400;
  return Number.isInteger(days) ? `${days} дн` : `${days.toFixed(1)} дн`;
}

function formatMeters(value) {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1000) return `${value} м`;
  const km = value / 1000;
  return Number.isInteger(km) ? `${km} км` : `${km.toFixed(2)} км`;
}

function humanValue(input) {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return '';
  switch (input.dataset.humanUnit) {
    case 'bytes': return formatBytes(value);
    case 'milliseconds': return formatSeconds(value / 1000);
    case 'seconds': return formatSeconds(value);
    case 'days': return `${value} дн`;
    case 'meters': return formatMeters(value);
    default: return '';
  }
}

function bind(input) {
  if (input.dataset.humanUnitBound === 'true') return;
  input.dataset.humanUnitBound = 'true';

  const wrapper = document.createElement('span');
  wrapper.className = 'admin-human-unit-wrap';
  input.before(wrapper);
  wrapper.append(input);

  const output = document.createElement('span');
  output.className = 'admin-human-unit';
  wrapper.append(output);

  const update = () => {
    const formatted = humanValue(input);
    output.textContent = formatted || '';
    output.hidden = !formatted;
  };
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  update();
}

export function bindHumanUnits(root = document) {
  for (const input of root.querySelectorAll('input[data-human-unit]')) bind(input);
}
