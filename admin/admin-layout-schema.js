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
  },
  {
    id: 'line-types',
    title: 'Типы линий',
    openEvent:
      'dtpstat:line-types-changed',
  },
  {
    id: 'point-types',
    title: 'Типы точек',
    openEvent:
      'dtpstat:point-types-changed',
  },
  {
    id: 'project-transfer',
    title:
      'Импорт / экспорт проекта',
    permission:
      'superuser',
  },
];
