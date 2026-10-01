function appendClassNames(
  node,
  value,
) {
  if (!value) return;

  for (
    const name of
    String(value)
      .split(/\s+/u)
      .filter(Boolean)
  ) {
    node.classList.add(name);
  }
}

function applyBlockSpan(
  block,
  span = {},
) {
  const base =
    Number(span.base ?? 12);
  const wide =
    Number(span.wide ?? base);

  block.style.setProperty(
    '--admin-block-span',
    String(base),
  );
  block.style.setProperty(
    '--admin-block-span-wide',
    String(wide),
  );
}

function createHeading(
  section,
) {
  const heading =
    document.createElement(
      'div',
    );
  heading.className =
    'section-heading admin-layout-heading';
  appendClassNames(
    heading,
    section.headingClass,
  );

  const copy =
    document.createElement(
      'div',
    );

  if (section.eyebrow) {
    const eyebrow =
      document.createElement(
        'p',
      );
    eyebrow.className =
      'eyebrow';
    eyebrow.textContent =
      section.eyebrow;
    copy.append(
      eyebrow,
    );
  }

  const title =
    document.createElement(
      'h2',
    );
  title.id =
    `${section.id}-title`;
  title.textContent =
    section.title;
  copy.append(
    title,
  );

  if (section.description) {
    const description =
      document.createElement(
        'p',
      );
    description.className =
      'admin-layout-description';
    appendClassNames(
      description,
      section.descriptionClass,
    );
    description.textContent =
      section.description;
    copy.append(
      description,
    );
  }

  heading.append(
    copy,
  );

  if (section.headingAside) {
    const aside =
      document.createElement(
        'strong',
      );
    aside.id =
      section.headingAside.id;
    aside.textContent =
      section.headingAside.text;
    heading.append(
      aside,
    );
  }

  return heading;
}

function createBlock(
  definition,
) {
  const block =
    document.createElement(
      'section',
    );
  block.className =
    'admin-layout-block';
  block.dataset
    .adminLayoutBlock =
    definition.id;
  appendClassNames(
    block,
    definition.className,
  );
  applyBlockSpan(
    block,
    definition.span,
  );

  const host =
    document.createElement(
      'div',
    );
  host.id =
    definition.hostId;
  host.className =
    'admin-layout-block-host';

  if (definition.placeholder) {
    const placeholder =
      document.createElement(
        'p',
      );
    placeholder.className =
      'empty-state';
    placeholder.textContent =
      definition.placeholder;
    host.append(
      placeholder,
    );
  }

  block.append(
    host,
  );

  return block;
}

export function ensureAdminSections({
  tabsHost,
  sectionsHost,
  sections,
}) {
  if (
    !tabsHost ||
    !sectionsHost
  ) {
    return;
  }

  for (const definition of sections) {
    const tabSelector =
      `[data-admin-section-tab="${definition.id}"]`;
    let tab =
      tabsHost.querySelector(
        tabSelector,
      );

    if (!tab) {
      tab =
        document.createElement(
          'button',
        );
      tab.type =
        'button';
      tab.role =
        'tab';
      tab.dataset
        .adminSectionTab =
        definition.id;
      tab.setAttribute(
        'aria-selected',
        'false',
      );
      tab.setAttribute(
        'aria-controls',
        `admin-section-${definition.id}`,
      );
      tab.textContent =
        definition.title;
      tabsHost.append(
        tab,
      );
    }

    const panelSelector =
      `[data-admin-section-panel="${definition.id}"]`;
    if (
      sectionsHost.querySelector(
        panelSelector,
      )
    ) {
      continue;
    }

    const panel =
      document.createElement(
        'section',
      );
    panel.className =
      'admin-section-panel admin-layout-section';
    appendClassNames(
      panel,
      definition.sectionClass,
    );
    panel.id =
      `admin-section-${definition.id}`;
    panel.dataset
      .adminSectionPanel =
      definition.id;
    panel.role =
      'tabpanel';
    panel.hidden =
      true;

    const layout =
      document.createElement(
        'div',
      );
    layout.className =
      'admin-layout admin-layout-single';

    const card =
      document.createElement(
        'section',
      );
    card.className =
      'settings-card admin-layout-card';
    appendClassNames(
      card,
      definition.cardClass,
    );
    card.setAttribute(
      'aria-labelledby',
      `${definition.id}-title`,
    );

    card.append(
      createHeading(
        definition,
      ),
    );

    const grid =
      document.createElement(
        'div',
      );
    grid.className =
      'admin-layout-grid';

    for (
      const block of
      definition.blocks ?? []
    ) {
      grid.append(
        createBlock(
          block,
        ),
      );
    }

    card.append(
      grid,
    );
    layout.append(
      card,
    );
    panel.append(
      layout,
    );
    sectionsHost.append(
      panel,
    );
  }
}
