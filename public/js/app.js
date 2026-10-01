import {
  loadCities,
  loadGeometryTimeline,
  loadLineTypes,
  loadPointTypes,
  loadMapConfig,
  loadProjectSettings,
  loadReportConfig,
  loadViewportGeometries,
} from './api.js';
import { createCityList } from './city-list.js';
import { subscribeDerivedDataChanges } from '../../admin/derived-data-events.js';
import {
  createMapController,
} from './map-controller.js';
import {
  hidePageStandby,
} from './page-standby.js';

const legendStylesheet = document.createElement('link');
legendStylesheet.rel = 'stylesheet';
legendStylesheet.href = '/css/line-types.css';
document.head.append(legendStylesheet);

const mapMessage = document.querySelector('#map-message');
const mapPanel = document.querySelector('.map-panel');
const timeline =
  document.querySelector(
    '#geometry-timeline',
  );
const timelineToggle =
  document.querySelector(
    '#geometry-timeline-toggle',
  );
const timelineCollapse =
  document.querySelector(
    '#geometry-timeline-collapse',
  );
const timelinePlay =
  document.querySelector(
    '#geometry-timeline-play',
  );
const timelineRange =
  document.querySelector(
    '#geometry-timeline-range',
  );
const timelineSpeed =
  document.querySelector(
    '#geometry-timeline-speed',
  );
const timelineDate =
  document.querySelector(
    '#geometry-timeline-date',
  );
const timelineStart =
  document.querySelector(
    '#geometry-timeline-start',
  );
const timelineEnd =
  document.querySelector(
    '#geometry-timeline-end',
  );
const cityTable = document.querySelector('.city-table');
const cityTableHead = cityTable?.querySelector('thead');

function ensureTableStatus() {
  const existingStatus = document.querySelector('#status');
  const existingBody = existingStatus?.closest('tbody.city-table-status');

  if (existingStatus?.tagName === 'TD' && existingBody) {
    existingBody.hidden = true;
    existingStatus.hidden = true;
    if (cityTableHead && existingBody.previousElementSibling !== cityTableHead) {
      cityTableHead.after(existingBody);
    }
    return { status: existingStatus, body: existingBody };
  }

  // Compatibility with a server process that still has the previous index.html
  // template cached in memory: remove the old status paragraph from the header
  // and create the status row in the table without requiring a server restart.
  existingStatus?.remove();

  const body = document.createElement('tbody');
  body.className = 'city-table-status';
  body.hidden = true;

  const row = document.createElement('tr');
  const status = document.createElement('td');
  status.id = 'status';
  status.className = 'status column-city';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.colSpan = 1;
  status.hidden = true;

  row.append(status);
  body.append(row);
  cityTableHead?.after(body);

  return { status, body };
}

const { status: tableStatus, body: tableStatusBody } = ensureTableStatus();
const cityList = createCityList({
  list: document.querySelector('#city-list'),
  status: tableStatus,
  categoryButtons: document.querySelectorAll('[data-category]'),
});

let activeRequest = null;
let mapController = null;
let citiesById = new Map();
let focusedCityId = null;
let lineTypesSignature = '';
let pointTypesSignature = '';
let lineTypesRefresh = null;
let pointTypesRefresh = null;
let lineDisplayRefresh = null;
let openMapRefresh = null;
let derivedDataRefresh = null;
let derivedDataPending = false;
let timelineEnabled = false;
let timelinePlayback = null;
let timelineMinDay = null;
let timelineMaxDay = null;
let timelineHistoryStartDate = null;
let timelineSpeeds = [];
let timelineConfigSignature = '';
let geometryTypeVisibility = {
  showPointGeometries: true,
  showLineGeometries: true,
  showPolygonGeometries: true,
};

const DAY_MS =
  24 * 60 * 60 * 1000;

function localIsoDate() {
  const now =
    new Date();
  const year =
    now.getFullYear();
  const month =
    String(
      now.getMonth() + 1,
    ).padStart(2, '0');
  const day =
    String(
      now.getDate(),
    ).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function dateToDay(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/u
      .test(value)
  ) {
    return null;
  }

  const timestamp =
    Date.parse(
      value +
      'T00:00:00.000Z',
    );
  return Number.isFinite(timestamp)
    ? Math.floor(
        timestamp /
        DAY_MS,
      )
    : null;
}

function dayToDate(day) {
  return new Date(
    Number(day) *
    DAY_MS,
  ).toISOString()
    .slice(0, 10);
}

function formatTimelineDate(value) {
  const day =
    dateToDay(value);
  if (day === null) {
    return '—';
  }

  return new Intl.DateTimeFormat(
    'ru-RU',
    {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    },
  ).format(
    new Date(
      day *
      DAY_MS,
    ),
  );
}

export function addCalendarStep(
  isoDate,
  unit,
) {
  const day =
    dateToDay(isoDate);
  if (day === null) {
    return null;
  }

  const date =
    new Date(
      day * DAY_MS,
    );
  const originalDay =
    date.getUTCDate();

  const setMonthClamped =
    (delta) => {
      date.setUTCDate(1);
      date.setUTCMonth(
        date.getUTCMonth() +
        delta,
      );
      const targetMonth =
        date.getUTCMonth();
      const targetYear =
        date.getUTCFullYear();
      const lastDay =
        new Date(
          Date.UTC(
            targetYear,
            targetMonth + 1,
            0,
          ),
        ).getUTCDate();
      date.setUTCDate(
        Math.min(
          originalDay,
          lastDay,
        ),
      );
    };

  const setYearClamped =
    (delta) => {
      const month =
        date.getUTCMonth();
      date.setUTCDate(1);
      date.setUTCFullYear(
        date.getUTCFullYear() +
        delta,
      );
      const lastDay =
        new Date(
          Date.UTC(
            date.getUTCFullYear(),
            month + 1,
            0,
          ),
        ).getUTCDate();
      date.setUTCMonth(month);
      date.setUTCDate(
        Math.min(
          originalDay,
          lastDay,
        ),
      );
    };

  if (unit === 'day') {
    date.setUTCDate(
      originalDay + 1,
    );
  } else if (unit === 'week') {
    date.setUTCDate(
      originalDay + 7,
    );
  } else if (unit === 'month') {
    setMonthClamped(1);
  } else if (unit === 'quarter') {
    setMonthClamped(3);
  } else if (unit === 'year') {
    setYearClamped(1);
  } else if (unit === 'five_years') {
    setYearClamped(5);
  } else if (unit === 'decade') {
    setYearClamped(10);
  } else {
    return null;
  }

  return date.toISOString()
    .slice(0, 10);
}

function activeTimelineSpeeds(
  speeds,
) {
  return (
    Array.isArray(speeds)
      ? speeds
      : []
  ).filter(
    (speed) =>
      speed?.isActive !== false,
  );
}

function renderTimelineSpeeds(
  speeds,
) {
  timelineSpeeds =
    activeTimelineSpeeds(
      speeds,
    );

  if (!timelineSpeed) {
    return;
  }

  const previous =
    timelineSpeed.value;
  timelineSpeed.replaceChildren(
    ...timelineSpeeds.map(
      (speed) => {
        const option =
          document.createElement(
            'option',
          );
        option.value =
          String(speed.id);
        option.textContent =
          speed.name;
        return option;
      },
    ),
  );

  const selected =
    timelineSpeeds.find(
      (speed) =>
        String(speed.id) ===
        previous,
    ) ??
    timelineSpeeds.find(
      (speed) =>
        speed.isDefault === true,
    ) ??
    timelineSpeeds[0];

  if (selected) {
    timelineSpeed.value =
      String(selected.id);
  }
}

function selectedTimelineSpeed() {
  const selectedId =
    timelineSpeed?.value ??
    '';
  return (
    timelineSpeeds.find(
      (speed) =>
        String(speed.id) ===
        selectedId,
    ) ??
    timelineSpeeds.find(
      (speed) =>
        speed.isDefault === true,
    ) ??
    timelineSpeeds[0] ??
    null
  );
}

function setTimelineCollapsed(
  collapsed,
) {
  if (!timeline) {
    return;
  }
  timeline.dataset.collapsed =
    collapsed
      ? 'true'
      : 'false';
  timelineToggle
    ?.setAttribute(
      'aria-expanded',
      String(!collapsed),
    );
}

function stopTimelinePlayback() {
  if (timelinePlayback) {
    clearInterval(
      timelinePlayback,
    );
    timelinePlayback =
      null;
  }

  if (timelinePlay) {
    timelinePlay.textContent =
      '▶';
    timelinePlay
      .setAttribute(
        'aria-pressed',
        'false',
      );
    timelinePlay
      .setAttribute(
        'aria-label',
        'Запустить воспроизведение истории',
      );
    timelinePlay.title =
      'Воспроизвести историю';
  }
}

function applyTimelineDay(day) {
  if (
    !mapController ||
    !timelineRange ||
    timelineMinDay === null ||
    timelineMaxDay === null
  ) {
    return;
  }

  const normalized =
    Math.max(
      timelineMinDay,
      Math.min(
        timelineMaxDay,
        Math.round(
          Number(day),
        ),
      ),
    );
  const date =
    dayToDate(
      normalized,
    );

  timelineRange.value =
    String(normalized);
  timelineRange.setAttribute(
    'aria-valuetext',
    formatTimelineDate(
      date,
    ),
  );
  timelineRange.title =
    formatTimelineDate(
      date,
    );
  if (timelineDate) {
    timelineDate.value =
      formatTimelineDate(
        date,
      );
  }

  mapController
    .setTimelineDate(
      date,
    );
}

async function refreshGeometryTimelineBounds() {
  if (
    !timelineEnabled ||
    !timeline ||
    !timelineRange
  ) {
    return;
  }

  const bounds =
    await loadGeometryTimeline();
  const today =
    dateToDay(
      localIsoDate(),
    );
  const configuredMin =
    dateToDay(
      timelineHistoryStartDate,
    );
  const sourceMin =
    dateToDay(
      bounds.minDate,
    );
  const sourceMax =
    dateToDay(
      bounds.maxDate,
    );

  if (
    today === null ||
    (
      configuredMin === null &&
      sourceMin === null &&
      sourceMax === null
    )
  ) {
    timeline.hidden =
      true;
    mapPanel.classList
      .remove(
        'has-geometry-timeline',
      );
    return;
  }

  timelineMinDay =
    configuredMin ??
    Math.min(
      sourceMin ??
        sourceMax ??
        today,
      today,
    );
  timelineMaxDay =
    Math.max(
      sourceMax ??
        sourceMin ??
        today,
      today,
      configuredMin ??
        today,
    );

  timelineRange.min =
    String(
      timelineMinDay,
    );
  timelineRange.max =
    String(
      timelineMaxDay,
    );

  if (timelineStart) {
    timelineStart.textContent =
      formatTimelineDate(
        dayToDate(
          timelineMinDay,
        ),
      );
  }
  if (timelineEnd) {
    timelineEnd.textContent =
      formatTimelineDate(
        dayToDate(
          timelineMaxDay,
        ),
      );
  }

  const current =
    Number(
      timelineRange.value,
    );
  const initial =
    Number.isFinite(current) &&
    current >= timelineMinDay &&
    current <= timelineMaxDay &&
    timelineRange.dataset
      .initialized === 'true'
      ? current
      : today;

  timelineRange.dataset
    .initialized =
    'true';
  timeline.hidden =
    false;
  mapPanel.classList
    .add(
      'has-geometry-timeline',
    );
  applyTimelineDay(
    initial,
  );
}

async function configureGeometryTimeline(
  settings,
) {
  const nextEnabled =
    Boolean(
      settings
        ?.showGeometryTimeline,
    );
  const nextStartDate =
    settings
      ?.historyStartDate ??
    null;
  const nextSpeeds =
    activeTimelineSpeeds(
      settings
        ?.historySpeeds,
    );
  const signature =
    JSON.stringify({
      enabled:
        nextEnabled,
      startDate:
        nextStartDate,
      speeds:
        nextSpeeds.map(
          ({
            id,
            name,
            stepUnit,
            intervalSeconds,
            isDefault,
          }) => ({
            id,
            name,
            stepUnit,
            intervalSeconds,
            isDefault,
          }),
        ),
    });

  if (
    timelineConfigSignature ===
      signature &&
    (
      !nextEnabled ||
      timelineRange?.dataset
        .initialized === 'true'
    )
  ) {
    return;
  }

  timelineConfigSignature =
    signature;
  timelineEnabled =
    nextEnabled;
  timelineHistoryStartDate =
    nextStartDate;
  renderTimelineSpeeds(
    nextSpeeds,
  );
  stopTimelinePlayback();

  if (
    !timelineEnabled ||
    timelineSpeeds.length === 0
  ) {
    timelineMinDay =
      null;
    timelineMaxDay =
      null;
    if (timelineRange) {
      delete timelineRange
        .dataset.initialized;
    }
    if (timeline) {
      timeline.hidden =
        true;
    }
    mapPanel.classList
      .remove(
        'has-geometry-timeline',
      );
    mapController
      ?.setTimelineDate(
        localIsoDate(),
      );
    return;
  }

  try {
    await refreshGeometryTimelineBounds();
  } catch (error) {
    timelineEnabled =
      false;
    timeline.hidden =
      true;
    mapPanel.classList
      .remove(
        'has-geometry-timeline',
      );
    console.error(
      'Не удалось загрузить временную шкалу геометрий',
      error,
    );
  }
}

timelineToggle
  ?.addEventListener(
    'click',
    () => {
      setTimelineCollapsed(
        false,
      );
    },
  );

timelineCollapse
  ?.addEventListener(
    'click',
    () => {
      stopTimelinePlayback();
      setTimelineCollapsed(
        true,
      );
    },
  );

timelineRange
  ?.addEventListener(
    'input',
    () => {
      stopTimelinePlayback();
      applyTimelineDay(
        Number(
          timelineRange.value,
        ),
      );
    },
  );

timelineSpeed
  ?.addEventListener(
    'change',
    () => {
      stopTimelinePlayback();
    },
  );

timelinePlay
  ?.addEventListener(
    'click',
    () => {
      if (
        timelinePlayback
      ) {
        stopTimelinePlayback();
        return;
      }
      if (
        timelineMinDay === null ||
        timelineMaxDay === null
      ) {
        return;
      }

      let current =
        Number(
          timelineRange.value,
        );
      if (
        !Number.isFinite(current) ||
        current >=
          timelineMaxDay
      ) {
        current =
          timelineMinDay;
        applyTimelineDay(
          current,
        );
      }

      const speed =
        selectedTimelineSpeed();
      if (!speed) {
        return;
      }

      timelinePlay.textContent =
        '⏸';
      timelinePlay
        .setAttribute(
          'aria-pressed',
          'true',
        );
      timelinePlay
        .setAttribute(
          'aria-label',
          'Приостановить воспроизведение истории',
        );
      timelinePlay.title =
        'Пауза';

      timelinePlayback =
        setInterval(
          () => {
            const nextDate =
              addCalendarStep(
                dayToDate(
                  current,
                ),
                speed.stepUnit,
              );
            const nextDay =
              dateToDay(
                nextDate,
              );
            current =
              Math.min(
                timelineMaxDay,
                nextDay ??
                  timelineMaxDay,
              );
            applyTimelineDay(
              current,
            );

            if (
              current >=
              timelineMaxDay
            ) {
              stopTimelinePlayback();
            }
          },
          Math.max(
            100,
            Math.round(
              Number(
                speed.intervalSeconds,
              ) * 1000,
            ),
          ),
        );
    },
  );

function setMapMessage(message, isError = false) {
  mapMessage.hidden = !message;
  mapMessage.textContent = message;
  mapMessage.classList.toggle('is-error', isError);
}

function setCityStatus(message, isError = false) {
  tableStatusBody.hidden = !message;
  cityList.setStatus(message, isError);
}

/** @param {any[]} lineTypes */
function renderLineLegend(lineTypes) {
  document.querySelector('#line-legend')?.remove();
  if (!geometryTypeVisibility.showLineGeometries) return;
  const legendLineTypes = lineTypes.filter((lineType) => lineType.geometryCount > 0);
  if (legendLineTypes.length <= 1) return;

  const legend = document.createElement('section');
  legend.id = 'line-legend';
  legend.className = 'line-legend';
  legend.setAttribute('aria-label', 'Типы линий');

  const title = document.createElement('div');
  title.className = 'line-legend-title';
  title.textContent = 'Типы линий';
  legend.append(title);

  for (const lineType of legendLineTypes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'line-legend-item';
    button.setAttribute('aria-pressed', 'true');
    button.dataset.lineTypeCode = String(lineType.code);
    button.title = `Линий этого типа: ${lineType.geometryCount}`;

    const sample = document.createElement('span');
    sample.className = 'line-legend-sample';
    sample.style.borderTopColor = lineType.color;
    sample.style.borderTopStyle = lineType.style === 'solid' ? 'solid' : lineType.style;
    sample.style.borderTopWidth = `${Math.max(2, Math.min(8, lineType.width))}px`;

    const name = document.createElement('span');
    name.textContent = lineType.title ?? lineType.name;
    button.append(sample, name);
    button.addEventListener('click', () => {
      const enabled = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(enabled));
      button.classList.toggle('is-disabled', !enabled);
      mapController.setLineTypeVisibility(lineType.code, enabled);
    });
    legend.append(button);
  }

  mapPanel.append(legend);
}

/** @param {any[]} pointTypes */
function renderPointLegend(
  pointTypes,
) {
  document
    .querySelector(
      '#point-legend',
    )
    ?.remove();

  if (!geometryTypeVisibility.showPointGeometries) {
    return;
  }

  const visibleTypes =
    pointTypes.filter(
      (pointType) =>
        pointType.isActive !==
          false &&
        Number(
          pointType
            .geometryCount ??
          0,
        ) > 0,
    );

  if (
    visibleTypes.length === 0
  ) {
    return;
  }

  const legend =
    document.createElement(
      'section',
    );
  legend.id =
    'point-legend';
  legend.className =
    'point-legend';
  legend.setAttribute(
    'aria-label',
    'POI',
  );

  const title =
    document.createElement(
      'div',
    );
  title.className =
    'point-legend-title';
  title.textContent =
    'POI';
  legend.append(title);

  for (
    const pointType of
    visibleTypes
  ) {
    const button =
      document.createElement(
        'button',
      );
    button.type =
      'button';
    button.className =
      'point-legend-item';
    button.setAttribute(
      'aria-pressed',
      'true',
    );
    button.dataset
      .pointTypeId =
      String(pointType.id);
    const pointCount =
      Number(
        pointType
          .geometryCount ??
        0,
      );
    button.title =
      pointType.name;
    button.setAttribute(
      'aria-label',
      `${pointType.name}. Точек этого типа: ${pointCount}`,
    );

    const sample =
      document.createElement(
        'span',
      );
    sample.className =
      'point-legend-sample';

    if (pointType.iconUrl) {
      const image =
        document.createElement(
          'img',
        );
      image.src =
        pointType.iconUrl;
      image.alt =
        '';
      image.loading =
        'lazy';
      sample.append(
        image,
      );
    }

    button.append(
      sample,
    );
    button.addEventListener(
      'click',
      () => {
        const enabled =
          button.getAttribute(
            'aria-pressed',
          ) !== 'true';
        button.setAttribute(
          'aria-pressed',
          String(enabled),
        );
        button.classList.toggle(
          'is-disabled',
          !enabled,
        );
        mapController
          .setPointTypeVisibility(
            pointType.id,
            enabled,
          );
      },
    );
    legend.append(
      button,
    );
  }

  mapPanel.append(
    legend,
  );
}

/** @param {any[]} lineTypes */
function applyLineTypes(lineTypes) {
  const signature = JSON.stringify(
    lineTypes.map(({ code, name, title, color, style, width, geometryCount }) => ({
      code,
      name,
      title,
      color,
      style,
      width,
      geometryCount,
    })),
  );
  if (signature === lineTypesSignature) return false;
  lineTypesSignature = signature;
  mapController.setLineTypes(lineTypes);
  renderLineLegend(lineTypes);
  return true;
}

async function applyPointTypes(
  pointTypes,
) {
  const signature =
    JSON.stringify(
      pointTypes.map(
        ({
          id,
          name,
          isActive,
          displayWidth,
          displayHeight,
          anchorX,
          anchorY,
          iconUrl,
          geometryCount,
        }) => ({
          id,
          name,
          isActive,
          displayWidth,
          displayHeight,
          anchorX,
          anchorY,
          iconUrl,
          geometryCount,
        }),
      ),
    );

  if (
    signature ===
    pointTypesSignature
  ) {
    return false;
  }

  pointTypesSignature =
    signature;
  await mapController
    .setPointTypes(
      pointTypes,
    );
  renderPointLegend(
    pointTypes,
  );
  return true;
}

async function refreshPointTypes() {
  if (!mapController) {
    return;
  }
  if (pointTypesRefresh) {
    return pointTypesRefresh;
  }

  pointTypesRefresh =
    (async () => {
      try {
        await applyPointTypes(
          await loadPointTypes(),
        );
      } catch (error) {
        console.error(
          'Не удалось обновить типы точек',
          error,
        );
      } finally {
        pointTypesRefresh =
          null;
      }
    })();

  return pointTypesRefresh;
}

async function refreshLineTypes() {
  if (!mapController) return;
  if (lineTypesRefresh) return lineTypesRefresh;
  lineTypesRefresh = (async () => {
    try {
      const lineTypes = await loadLineTypes();
      if (!lineTypes.length) return;
      applyLineTypes(lineTypes);
    } catch (error) {
      console.error('Не удалось обновить справочник типов линий', error);
    } finally {
      lineTypesRefresh = null;
    }
  })();
  return lineTypesRefresh;
}

async function refreshLineDisplayOptions() {
  if (!mapController) return;
  if (lineDisplayRefresh) return lineDisplayRefresh;
  lineDisplayRefresh = (async () => {
    try {
      const projectSettings = await loadProjectSettings();
      const nextGeometryTypeVisibility = {
        showPointGeometries:
          projectSettings.showPointGeometries !== false,
        showLineGeometries:
          projectSettings.showLineGeometries !== false,
        showPolygonGeometries:
          projectSettings.showPolygonGeometries !== false,
      };
      const visibilityChanged =
        JSON.stringify(nextGeometryTypeVisibility) !==
        JSON.stringify(geometryTypeVisibility);
      geometryTypeVisibility =
        nextGeometryTypeVisibility;
      mapController.setGeometryTypeVisibility(
        geometryTypeVisibility,
      );
      if (visibilityChanged) {
        lineTypesSignature = '';
        pointTypesSignature = '';
        document.querySelector('#line-legend')?.remove();
        document.querySelector('#point-legend')?.remove();
      }
      mapController.setLineDisplayOptions({
        showLineLabels: Boolean(projectSettings.showLineLabels),
        showLinePopups: projectSettings.showLinePopups !== false,
      });
      await configureGeometryTimeline(
        projectSettings,
      );
    } catch (error) {
      console.error('Не удалось обновить настройки отображения линий', error);
    } finally {
      lineDisplayRefresh = null;
    }
  })();
  return lineDisplayRefresh;
}

async function refreshOpenMap() {
  if (!mapController) return;
  if (openMapRefresh) return openMapRefresh;
  openMapRefresh = (async () => {
    try {
      await refreshLineDisplayOptions();
      await Promise.all([
        refreshLineTypes(),
        refreshPointTypes(),
      ]);
      mapController.refreshViewport();
    } finally {
      openMapRefresh = null;
    }
  })();
  return openMapRefresh;
}

async function refreshDerivedData() {
  if (!mapController) {
    derivedDataPending = true;
    return;
  }
  if (derivedDataRefresh) {
    derivedDataPending = true;
    return derivedDataRefresh;
  }

  derivedDataPending = false;
  derivedDataRefresh = (async () => {
    setCityStatus('Обновляем таблицу и линии…');
    try {
      const [
        cities,
        lineTypes,
        pointTypes,
      ] = await Promise.all([
        loadCities(),
        loadLineTypes(),
        loadPointTypes(),
      ]);
      cityList.setCities(cities);
      citiesById = new Map(cities.map((city) => [city.id, city]));
      mapController.setCities(cities);
      applyLineTypes(lineTypes);
      await applyPointTypes(
        pointTypes,
      );
      if (timelineEnabled) {
        await refreshGeometryTimelineBounds()
          .catch(
            (error) => {
              console.error(
                'Не удалось обновить диапазон временной шкалы',
                error,
              );
            },
          );
      }
      if (focusedCityId !== null && !citiesById.has(focusedCityId)) {
        focusedCityId = null;
        cityList.select(null);
      }
      mapController.refreshViewport();
      setCityStatus(cities.length ? '' : 'Данные пока не загружены');
    } catch (error) {
      setCityStatus('Не удалось обновить таблицу после изменения данных', true);
      console.error('Не удалось обновить производные данные', error);
    } finally {
      derivedDataRefresh = null;
      if (derivedDataPending) void refreshDerivedData();
    }
  })();

  return derivedDataRefresh;
}

subscribeDerivedDataChanges(() => {
  void refreshDerivedData();
});

function selectCity(city, { revealMap = false } = {}) {
  activeRequest?.abort();
  activeRequest = null;
  focusedCityId = city.id;
  cityList.select(city.id);
  setCityStatus('');
  if (revealMap) mapPanel.scrollIntoView({ block: 'start' });
  mapController.focusCity(city.bounds);
}

async function updateViewport(viewport) {
  activeRequest?.abort();
  activeRequest = null;

  const request = new AbortController();
  activeRequest = request;
  setCityStatus('');
  setMapMessage('Загружаем данные видимого окна…');

  try {
    const geojson = await loadViewportGeometries(viewport, request.signal);
    if (activeRequest !== request) return;
    mapController.setViewportData(geojson);

    const centerCity = citiesById.get(focusedCityId)
      ?? citiesById.get(geojson.centerCityId);
    focusedCityId = null;
    cityList.select(centerCity?.id ?? null);
    setCityStatus('');
    setMapMessage('');
  } catch (error) {
    if (error.name === 'AbortError') return;
    focusedCityId = null;
    setCityStatus('Не удалось загрузить данные видимого окна', true);
    setMapMessage('Не удалось загрузить данные видимого окна', true);
    console.error(error);
  } finally {
    if (activeRequest === request) activeRequest = null;
  }
}

cityList.onSelect((city) => selectCity(city, { revealMap: true }));

async function start() {
  try {
    const reportConfig = await loadReportConfig();
    cityList.setReportConfig(reportConfig);
    tableStatus.colSpan = Math.max(1, reportConfig.tableColumns.length);
    setCityStatus('Загружаем список городов…');

    const cities = await loadCities();
    cityList.setCities(cities);
    setCityStatus(cities.length ? '' : 'Данные пока не загружены');

    const [
      mapConfig,
      projectSettings,
      lineTypes,
      pointTypes,
    ] = await Promise.all([
      loadMapConfig(),
      loadProjectSettings(),
      loadLineTypes(),
      loadPointTypes(),
    ]);
    geometryTypeVisibility = {
      showPointGeometries:
        projectSettings.showPointGeometries !== false,
      showLineGeometries:
        projectSettings.showLineGeometries !== false,
      showPolygonGeometries:
        projectSettings.showPolygonGeometries !== false,
    };
    mapController = await createMapController({
      ...mapConfig,
      showLineLabels: Boolean(projectSettings.showLineLabels),
      showLinePopups: projectSettings.showLinePopups !== false,
      ...geometryTypeVisibility,
    });
    await configureGeometryTimeline(
      projectSettings,
    );
    if (!lineTypes.length) throw new Error('Справочник типов линий пуст');

    applyLineTypes(lineTypes);
    await applyPointTypes(
      pointTypes,
    );
    citiesById = new Map(cities.map((city) => [city.id, city]));
    mapController.setCities(cities);
    mapController.onCitySelect((cityId) => {
      const city = citiesById.get(cityId);
      if (city) selectCity(city);
    });
    mapController.onViewportChange((viewport) => {
      void updateViewport(viewport);
    });
    if (derivedDataPending) void refreshDerivedData();

    if (!cities.length) {
      setMapMessage('Данные пока не загружены');
      return;
    }

    setCityStatus('');
    const firstCity = cities.find((city) => city.category === 'large') ?? cities[0];
    selectCity(firstCity);
  } catch (error) {
    setCityStatus('Приложение не удалось загрузить', true);
    setMapMessage(error.message || 'Ошибка запуска приложения', true);
    console.error(error);
  } finally {
    hidePageStandby();
  }
}

window.addEventListener('focus', () => {
  void refreshOpenMap();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshOpenMap();
});

start();