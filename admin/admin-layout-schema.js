export const adminDynamicSections = [
  {
    id: 'messages',
    title: 'Сообщения',
    eyebrow: 'ОБСУЖДЕНИЯ',
    description:
      'Обсуждения геометрий и объектов OSM, доступных вашей роли.',
    sectionClass:
      'admin-messages-section',
    cardClass:
      'admin-messages-card',
    headingClass:
      'admin-messages-heading',
    descriptionClass:
      'admin-messages-subtitle',
    headingAside: {
      id: 'admin-messages-total',
      text: '0 непрочитанных',
    },
    blocks: [
      {
        id: 'messages-inbox',
        hostId:
          'discussion-inbox-host',
        className:
          'admin-messages-layout',
        span: {
          base: 12,
          wide: 12,
        },
        placeholder:
          'Загружаем сообщения…',
      },
    ],
  },
  {
    id: 'profile',
    title: 'Профиль',
    eyebrow:
      'АКТИВНАЯ УЧЁТНАЯ ЗАПИСЬ',
    blocks: [
      {
        id: 'profile-editor',
        hostId:
          'profile-editor-host',
        span: {
          base: 12,
          wide: 12,
        },
        placeholder:
          'Загружаем профиль…',
      },
    ],
  },
];


export const adminInterfaceTabs = [
  {
    id: 'project',
    title: 'Проект',
  },
  {
    id: 'map',
    title: 'Карта',
  },
  {
    id: 'report',
    title: 'Расчёты',
    description:
      'Безопасный конструктор расчётных показателей, колонок публичного рейтинга и статического CSV.',
    blocks: [
      {
        id: 'report-config',
        hostId:
          'report-config-editor-host',
        className:
          'transfer-mode report-config-editor',
        span: {
          base: 12,
          wide: 12,
        },
      },
    ],
  },
  {
    id: 'line-types',
    title: 'Типы линий',
    description:
      'NAME и CODE задаются импортом/БД; здесь редактируются только подпись легенды и визуальный стиль.',
    openEvent:
      'dtpstat:line-types-changed',
    blocks: [
      {
        id: 'line-types-editor',
        hostId:
          'line-types-editor-host',
        className:
          'operation-panel transfer-mode line-types-editor',
        span: {
          base: 12,
          wide: 12,
        },
      },
    ],
  },
  {
    id: 'point-types',
    title: 'Типы точек',
    description:
      'Тип определяет иконку Point-геометрии на карте. Неактивные типы остаются в данных, но не отображаются на публичной карте.',
    openEvent:
      'dtpstat:point-types-changed',
    blocks: [
      {
        id: 'point-types-editor',
        hostId:
          'point-types-editor-host',
        className:
          'operation-panel transfer-mode point-types-editor',
        span: {
          base: 12,
          wide: 12,
        },
      },
    ],
  },
  {
    id: 'project-transfer',
    title:
      'Импорт / экспорт проекта',
    permission:
      'superuser',
  },
];
