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
