# Admin UI architecture

Административный интерфейс DTP-Stat строится из общей layout-системы, а не из
набора независимых «окон» со своими копиями одного и того же UI.

## Layout source of truth

Основные файлы:

```text
admin/admin-layout-schema.js
admin/admin-layout.js
admin/admin-layout.css
admin/admin-tab-state.js
```

Schema описывает:

- top-level sections;
- nested tabs;
- host nodes для feature editors;
- 12-column span;
- capabilities `fill`, `scroll`, `sticky`;
- permission-dependent visibility.

Feature editor должен наполнять предоставленный host, а не создавать ещё один
параллельный page shell.

## Height and scroll ownership

По умолчанию block имеет natural height.

`height: 100%` используется только для block с явным `fill`. Scroll должен
иметь одного понятного владельца: например длинная audit table прокручивается
внутри table wrapper, а paging остаётся видимым снизу. Не допускается
случайная цепочка page scroll + card scroll + table scroll для одного контента.

Responsive composition строится через container queries block/grid, а не
только через viewport media queries.

## Tabs

Общий tab helper отвечает за:

- ARIA roles/selected state;
- panel visibility;
- сохранение state key;
- восстановление выбранной вкладки;
- единый визуальный active state.

Текущие важные nested groups:

- **Настройка интерфейса**: Проект, Карта, Расчёты, Типы линий, Типы точек,
  Импорт/экспорт проекта;
- **Пользователи и аудит**: Пользователи, Аудит;
- **Безопасность**: Защита, Метрики и тайминги, Блокировки.

## Reusable visual primitives

При UI-аудите одинаковые паттерны рассматриваются как кандидаты на общий
primitive:

- block/card shell;
- section header + actions;
- tabs;
- toolbar;
- data table + sort/filter/paging;
- search/filter bar;
- detail pane;
- form field group + hint/validation;
- status badge/marker;
- empty/loading/error state;
- dialog/action bar.

Критерий — одинаковая визуальная и UX-семантика, а не совпадение domain data.
Например users, blocked IP и point types могут использовать общий table/card
primitive, сохраняя разные render/data handlers.

## Geometry editor specifics

Geometry editor — трёхпанельный workspace:

1. searchable city/filter/list panel;
2. map;
3. selected geometry detail pane.

Lease state виден в левом списке и на карте. Discussion action закреплён в
правом верхнем углу detail header. Selected/edited/leased/conflict states не
должны взаимно скрывать друг друга.

## Security specifics

Security settings визуально разделены на три tabs, но policy submit остаётся
единым domain form. Блокировки используют двухколоночную desktop composition;
active-IP table занимает остаток доступной высоты и имеет собственный paging.

Audit table использует bounded scroll owner и sticky header; paging не должен
уезжать за нижний край card.

## Правило для новых экранов

Перед добавлением нового CSS/DOM паттерна:

1. проверить, нет ли уже общего primitive;
2. если есть — использовать его;
3. если почти одинаковая реализация встречается второй раз — вынести общий
   primitive до появления третьей копии;
4. не объединять разные workflows только ради одинакового внешнего вида;
5. regression test должен проверять layout contract, а не случайные пиксели.
