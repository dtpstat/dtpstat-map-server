export const adminDynamicSections = [
  {
    id: 'users-audit',
    title: 'Пользователи и аудит',
    eyebrow: 'ДОСТУП И АУДИТ',
    sectionClass:
      'admin-security-users-audit-section',
    cardClass:
      'security-card',
    blocks: [
      {
        id: 'security-users-audit',
        hostId:
          'security-users-audit-host',
        span: {
          base: 12,
          wide: 12,
        },
        capabilities: {
          fill: true,
        },
        placeholder:
          'Загружаем пользователей и журнал…',
      },
    ],
  },
  {
    id: 'security',
    title: 'Безопасность',
    eyebrow: 'ЗАЩИТА И ПОЛИТИКИ',
    sectionClass:
      'admin-security-settings-section',
    cardClass:
      'security-card',
    blocks: [
      {
        id: 'security-settings',
        hostId:
          'security-settings-host',
        span: {
          base: 12,
          wide: 8,
        },
      },
      {
        id: 'security-ip-blocks',
        hostId:
          'security-ip-host',
        span: {
          base: 12,
          wide: 4,
        },
      },
    ],
  },
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
        id: 'messages-list',
        hostId:
          'discussion-inbox-list-host',
        className:
          'admin-messages-list-block',
        span: {
          base: 12,
          wide: 4,
        },
        capabilities: {
          fill: true,
        },
        placeholder:
          'Загружаем список обсуждений…',
      },
      {
        id: 'messages-thread',
        hostId:
          'discussion-inbox-thread-host',
        className:
          'admin-messages-thread-block',
        span: {
          base: 12,
          wide: 8,
        },
        capabilities: {
          fill: true,
        },
        placeholder:
          'Выберите обсуждение слева.',
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
        id: 'profile-account',
        hostId:
          'profile-account-host',
        span: {
          base: 12,
          wide: 5,
        },
      },
      {
        id: 'profile-password',
        hostId:
          'profile-password-host',
        span: {
          base: 12,
          wide: 7,
        },
      },
      {
        id: 'profile-mfa',
        hostId:
          'profile-mfa-host',
        span: {
          base: 12,
          wide: 12,
        },
      },
      {
        id: 'profile-sessions',
        hostId:
          'profile-sessions-host',
        span: {
          base: 12,
          wide: 12,
        },
      },
    ],
  },
];


export const adminInterfaceTabs = [
  {
    id: 'project',
    title: 'Проект',
    description:
      'Название, оформление, метаданные, аналитика и информационный блок проекта.',
    tabs: {
      stateKey:
        'project-settings',
      defaultId:
        'general',
      tabAttribute:
        'data-project-settings-tab',
      panelAttribute:
        'data-project-settings-panel',
      tabsHostId:
        'project-settings-tabs',
      tabsClass:
        'project-settings-tabs',
      panelsHostId:
        'project-settings-panels',
      panelClass:
        'project-settings-page',
      ariaLabel:
        'Разделы настроек проекта',
      panelIdPrefix:
        'project-settings-',
      items: [
        {
          id: 'general',
          title: 'Основное',
          blocks: [
            {
              id:
                'project-general',
              hostId:
                'project-settings-general-host',
              span: {
                base: 12,
                wide: 12,
              },
            },
          ],
        },
        {
          id: 'metadata',
          title:
            'Метаданные и API',
          blocks: [
            {
              id:
                'project-metadata',
              hostId:
                'project-settings-metadata-host',
              span: {
                base: 12,
                wide: 12,
              },
            },
          ],
        },
        {
          id: 'footer',
          title: 'Подвал',
          blocks: [
            {
              id:
                'project-footer',
              hostId:
                'project-settings-footer-host',
              span: {
                base: 12,
                wide: 12,
              },
            },
          ],
        },
      ],
    },
    blocks: [
      {
        id: 'project-settings',
        elementId:
          'operation-project-settings',
        hostId:
          'project-settings-editor-host',
        className:
          'operation-panel transfer-mode',
        span: {
          base: 12,
          wide: 12,
        },
      },
    ],
  },
  {
    id: 'map',
    title: 'Карта',
    description:
      'Отображение публичной карты, геометрии, история, маркеры и параметры классификации городов.',
    blocks: [
      {
        id: 'map-city-category',
        elementId:
          'operation-map-settings',
        hostId:
          'map-city-category-host',
        className:
          'operation-panel transfer-mode',
        span: {
          base: 12,
          wide: 6,
        },
      },
      {
        id: 'map-display',
        hostId:
          'map-display-host',
        className:
          'operation-panel transfer-mode',
        span: {
          base: 12,
          wide: 6,
        },
      },
      {
        id: 'map-history',
        hostId:
          'map-history-host',
        className:
          'operation-panel transfer-mode',
        span: {
          base: 12,
          wide: 7,
        },
      },
      {
        id: 'map-city-marker',
        hostId:
          'map-city-marker-host',
        className:
          'operation-panel transfer-mode',
        span: {
          base: 12,
          wide: 5,
        },
      },
      {
        id: 'map-actions',
        hostId:
          'map-actions-host',
        className:
          'operation-panel transfer-mode',
        span: {
          base: 12,
          wide: 12,
        },
      },
    ],
  },
  {
    id: 'report',
    title: 'Расчёты',
    description:
      'Безопасный конструктор расчётных показателей, колонок публичного рейтинга и статического CSV.',
    panelClass:
      'report-interface-panel',
    tabs: {
      stateKey:
        'report-view',
      defaultId:
        'metrics',
      tabAttribute:
        'data-report-view-tab',
      panelAttribute:
        'data-report-view-panel',
      activeClass:
        'is-active',
      tabsHostId:
        'report-view-tabs',
      tabsClass:
        'report-view-tabs',
      tabClass:
        'report-view-tab',
      tabsParentId:
        'report-view-tabs-slot',
      panelsHostId:
        'report-config-sections',
      panelClass:
        'report-builder-section report-view-panel',
      ariaLabel:
        'Разделы конструктора расчётов',
      panelIdPrefix:
        'report-view-',
      items: [
        {
          id: 'metrics',
          title: 'Метрики',
          blocks: [
            {
              id:
                'report-metrics-view',
              hostId:
                'report-metrics-view-host',
              span: {
                base: 12,
                wide: 12,
              },
            },
          ],
        },
        {
          id: 'table',
          title:
            'Публичная таблица',
          blocks: [
            {
              id:
                'report-table-view',
              hostId:
                'report-table-view-host',
              span: {
                base: 12,
                wide: 12,
              },
            },
          ],
        },
        {
          id: 'csv',
          title: 'CSV',
          blocks: [
            {
              id:
                'report-csv-view',
              hostId:
                'report-csv-view-host',
              span: {
                base: 12,
                wide: 12,
              },
            },
          ],
        },
        {
          id: 'rank',
          title: 'Рейтинг',
          blocks: [
            {
              id:
                'report-rank-view',
              hostId:
                'report-rank-view-host',
              span: {
                base: 12,
                wide: 12,
              },
            },
          ],
        },
      ],
    },
    blocks: [
      {
        id: 'report-config',
        hostId:
          'report-config-editor-host',
        className:
          'report-config-editor',
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
    description:
      'Суперадминский перенос настроек интерфейса, аналитики, типов линий и политики безопасности.',
    permission:
      'superuser',
    blocks: [
      {
        id: 'project-transfer-editor',
        hostId:
          'project-transfer-editor-host',
        className:
          'operation-panel transfer-mode',
        span: {
          base: 12,
          wide: 12,
        },
      },
    ],
  },
];


export const adminSecurityLayout = {
  tabs: {
    stateKey:
      'security',
    defaultId:
      'users',
    tabAttribute:
      'data-security-tab',
    panelAttribute:
      'data-security-panel',
    tabsHostId:
      'security-tabs',
    tabsClass:
      'security-tabs',
    panelsHostId:
      'security-panels',
    panelClass:
      'security-panel',
    ariaLabel:
      'Безопасность',
    panelIdPrefix:
      'security-panel-',
    items: [
      {
        id: 'users',
        title: 'Пользователи',
      },
      {
        id: 'audit',
        title: 'Аудит',
        blocks: [
          {
            id:
              'security-audit',
            hostId:
              'security-audit-host',
            className:
              'security-audit-block',
            span: {
              base: 12,
              wide: 12,
            },
            capabilities: {
              fill: true,
            },
          },
        ],
      },
    ],
  },
};
