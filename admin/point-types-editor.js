import {
  adminConfirm,
} from './admin-dialog.js';
import {
  trackDirtyForm,
} from './admin-dirty-state.js';

const MAX_ICON_BYTES =
  512 * 1024;

function requestJson(
  url,
  options = {},
) {
  return fetch(
    url,
    {
      credentials:
        'same-origin',
      headers: {
        Accept:
          'application/json',
        ...(options.headers ?? {}),
      },
      ...options,
    },
  ).then(
    async (response) => {
      const payload =
        await response
          .json()
          .catch(
            () => ({}),
          );
      if (!response.ok) {
        throw new Error(
          payload.error ??
          'HTTP ' +
            response.status,
        );
      }
      return payload;
    },
  );
}

if (
  typeof document !==
  'undefined'
) {
  const host =
    document.querySelector(
      '#point-types-editor-host',
    );

  if (host) {
    host.innerHTML = `
      <div class="mode-heading">
        <div>
          <h4>Типы точек</h4>
          <p>
            NAME — бизнес-тип Point. Размер задаёт отображение на карте,
            anchor — точку изображения, совмещаемую с координатой.
          </p>
        </div>
      </div>

      <form id="point-type-create-form"
            class="point-type-create-form">
        <label>Новый тип
          <input name="name" type="text"
                 maxlength="120" required
                 placeholder="Например: Остановка">
        </label>
        <label class="check">
          <input name="isActive"
                 type="checkbox" checked>
          Активен
        </label>
        <button type="submit">
          Добавить тип
        </button>
      </form>

      <div class="point-types-table"
           id="point-types-table"></div>

      <p class="point-types-message"
         id="point-types-message"
         role="status"></p>
    `;

    const table =
      host.querySelector(
        '#point-types-table',
      );
    const createForm =
      host.querySelector(
        '#point-type-create-form',
      );
    const message =
      host.querySelector(
        '#point-types-message',
      );

    function setMessage(
      text,
      tone = '',
    ) {
      message.textContent =
        text ?? '';
      message.className =
        'point-types-message' +
        (
          tone
            ? ' is-' + tone
            : ''
        );
    }

    function label(
      text,
      control,
    ) {
      const wrapper =
        document.createElement(
          'label',
        );
      wrapper.append(
        document.createTextNode(
          text,
        ),
        control,
      );
      return wrapper;
    }

    function numberInput(
      name,
      value,
      {
        min,
        max,
        step = '1',
      },
    ) {
      const input =
        document.createElement(
          'input',
        );
      input.name = name;
      input.type = 'number';
      input.inputMode =
        'decimal';
      input.min =
        String(min);
      input.max =
        String(max);
      input.step =
        String(step);
      input.required = true;
      input.value =
        String(value);
      return input;
    }

    function typePayload(row) {
      return {
        name:
          row.querySelector(
            '[name="name"]',
          ).value.trim(),
        isActive:
          row.querySelector(
            '[name="isActive"]',
          ).checked,
        displayWidth:
          Number(
            row.querySelector(
              '[name="displayWidth"]',
            ).value,
          ),
        displayHeight:
          Number(
            row.querySelector(
              '[name="displayHeight"]',
            ).value,
          ),
        anchorX:
          Number(
            row.querySelector(
              '[name="anchorX"]',
            ).value,
          ),
        anchorY:
          Number(
            row.querySelector(
              '[name="anchorY"]',
            ).value,
          ),
      };
    }

    function preview(
      pointType,
    ) {
      const frame =
        document.createElement(
          'div',
        );
      frame.className =
        'point-type-preview-frame';

      const sourceWidth =
        Number(
          pointType.displayWidth ??
          32,
        );
      const sourceHeight =
        Number(
          pointType.displayHeight ??
          32,
        );
      const scale =
        Math.min(
          1,
          96 / sourceWidth,
          96 / sourceHeight,
        );

      const stage =
        document.createElement(
          'div',
        );
      stage.className =
        'point-type-preview-stage';
      stage.style.width =
        sourceWidth *
        scale +
        'px';
      stage.style.height =
        sourceHeight *
        scale +
        'px';

      if (pointType.iconUrl) {
        const image =
          document.createElement(
            'img',
          );
        image.src =
          pointType.iconUrl;
        image.alt =
          'Иконка: ' +
          pointType.name;
        image.width =
          Math.round(
            sourceWidth *
            scale,
          );
        image.height =
          Math.round(
            sourceHeight *
            scale,
          );
        stage.append(image);
      } else {
        const empty =
          document.createElement(
            'span',
          );
        empty.className =
          'point-type-preview-empty';
        empty.textContent =
          'нет иконки';
        stage.append(empty);
      }

      const anchor =
        document.createElement(
          'span',
        );
      anchor.className =
        'point-type-preview-anchor';
      anchor.style.left =
        (
          Number(
            pointType.anchorX,
          ) /
          sourceWidth *
          100
        ) + '%';
      anchor.style.top =
        (
          Number(
            pointType.anchorY,
          ) /
          sourceHeight *
          100
        ) + '%';
      anchor.title =
        'Anchor';
      stage.append(anchor);
      frame.append(stage);

      return frame;
    }

    function renderRow(
      pointType,
    ) {
      const row =
        document.createElement(
          'form',
        );
      row.className =
        'point-type-row';
      row.dataset.pointTypeId =
        String(pointType.id);

      const previewColumn =
        document.createElement(
          'div',
        );
      previewColumn.className =
        'point-type-preview-column';
      previewColumn.append(
        preview(pointType),
      );

      const stats =
        document.createElement(
          'small',
        );
      stats.textContent =
        'Геометрий: ' +
        Number(
          pointType.geometryCount ??
          0,
        );
      previewColumn.append(stats);

      const name =
        document.createElement(
          'input',
        );
      name.name = 'name';
      name.type = 'text';
      name.required = true;
      name.maxLength = 120;
      name.value =
        pointType.name;

      const active =
        document.createElement(
          'input',
        );
      active.name =
        'isActive';
      active.type =
        'checkbox';
      active.checked =
        pointType.isActive !==
        false;

      const activeLabel =
        label(
          'Активен',
          active,
        );
      activeLabel.className =
        'check point-type-active';

      const width =
        numberInput(
          'displayWidth',
          pointType
            .displayWidth ??
            32,
          {
            min: 8,
            max: 256,
          },
        );
      const height =
        numberInput(
          'displayHeight',
          pointType
            .displayHeight ??
            32,
          {
            min: 8,
            max: 256,
          },
        );
      const anchorX =
        numberInput(
          'anchorX',
          pointType.anchorX ??
            16,
          {
            min: 0,
            max:
              pointType
                .displayWidth ??
              32,
            step: '0.5',
          },
        );
      const anchorY =
        numberInput(
          'anchorY',
          pointType.anchorY ??
            16,
          {
            min: 0,
            max:
              pointType
                .displayHeight ??
              32,
            step: '0.5',
          },
        );

      const syncAnchorBounds =
        () => {
          anchorX.max =
            width.value;
          anchorY.max =
            height.value;

          if (
            Number(anchorX.value) >
            Number(width.value)
          ) {
            anchorX.value =
              width.value;
          }
          if (
            Number(anchorY.value) >
            Number(height.value)
          ) {
            anchorY.value =
              height.value;
          }
        };

      width.addEventListener(
        'input',
        syncAnchorBounds,
      );
      height.addEventListener(
        'input',
        syncAnchorBounds,
      );

      const icon =
        document.createElement(
          'input',
        );
      icon.type = 'file';
      icon.accept =
        '.png,.gif,.svg,image/png,image/gif,image/svg+xml';
      icon.dataset.dirtyIgnore =
        '';

      const iconLabel =
        label(
          'PNG / GIF / SVG',
          icon,
        );
      iconLabel.className =
        'point-type-icon-file';

      const actions =
        document.createElement(
          'div',
        );
      actions.className =
        'point-type-row-actions';

      const save =
        document.createElement(
          'button',
        );
      save.type = 'submit';
      save.textContent =
        'Сохранить';

      const reset =
        document.createElement(
          'button',
        );
      reset.type = 'button';
      reset.className =
        'secondary';
      reset.textContent =
        'Сбросить иконку';
      reset.disabled =
        !pointType
          .iconConfigured;

      const remove =
        document.createElement(
          'button',
        );
      remove.type = 'button';
      remove.className =
        'danger';
      remove.textContent =
        'Удалить тип';

      actions.append(
        save,
        reset,
        remove,
      );

      const settings =
        document.createElement(
          'div',
        );
      settings.className =
        'point-type-settings-grid';
      settings.append(
        label(
          'Название',
          name,
        ),
        activeLabel,
        label(
          'Ширина, px',
          width,
        ),
        label(
          'Высота, px',
          height,
        ),
        label(
          'Anchor X',
          anchorX,
        ),
        label(
          'Anchor Y',
          anchorY,
        ),
      );

      const iconControls =
        document.createElement(
          'div',
        );
      iconControls.className =
        'point-type-icon-controls';
      iconControls.append(
        iconLabel,
        actions,
      );

      row.append(
        previewColumn,
        settings,
        iconControls,
      );

      const dirtyState =
        trackDirtyForm(
          row,
          {
            label:
              'Тип точки «' +
              pointType.name +
              '»',
          },
        );

      row.addEventListener(
        'submit',
        async (event) => {
          event.preventDefault();

          if (
            !row.reportValidity()
          ) {
            return;
          }

          const file =
            icon.files?.[0] ??
            null;

          if (
            file &&
            file.size >
              MAX_ICON_BYTES
          ) {
            setMessage(
              'Файл не должен превышать ' +
                MAX_ICON_BYTES +
                ' байт.',
              'error',
            );
            return;
          }

          save.disabled = true;
          reset.disabled = true;
          setMessage(
            file
              ? 'Сохраняем тип точки и иконку…'
              : 'Сохраняем тип точки…',
          );

          let typeSaved =
            false;

          try {
            await requestJson(
              '/api/admin/point-types/' +
                pointType.id,
              {
                method:
                  'PATCH',
                headers: {
                  'Content-Type':
                    'application/json',
                },
                body:
                  JSON.stringify(
                    typePayload(row),
                  ),
              },
            );
            typeSaved =
              true;

            if (file) {
              await requestJson(
                '/api/admin/point-types/' +
                  pointType.id +
                  '/icon',
                {
                  method:
                    'PUT',
                  headers: {
                    'Content-Type':
                      file.type ||
                      'application/octet-stream',
                  },
                  body:
                    file,
                },
              );
              icon.value =
                '';
            }

            dirtyState?.markClean();
            setMessage(
              file
                ? 'Тип точки и иконка сохранены.'
                : 'Тип точки сохранён.',
              'success',
            );
            window.dispatchEvent(
              new CustomEvent(
                'dtpstat:point-types-changed',
              ),
            );
          } catch (error) {
            setMessage(
              typeSaved &&
              file
                ? (
                    'Тип точки сохранён, но иконка не сохранена: ' +
                    error.message
                  )
                : error.message,
              'error',
            );
          } finally {
            save.disabled =
              false;
            reset.disabled =
              !pointType
                .iconConfigured;
          }
        },
      );

      reset.addEventListener(
        'click',
        async () => {
          const confirmed =
            await adminConfirm({
              title:
                'Сбросить иконку?',
              message:
                'Тип «' +
                pointType.name +
                '» останется, но будет без собственной иконки.',
              confirmLabel:
                'Сбросить иконку',
              cancelLabel:
                'Отмена',
            });
          if (!confirmed) {
            return;
          }

          reset.disabled = true;
          try {
            await requestJson(
              '/api/admin/point-types/' +
              pointType.id +
              '/icon',
              {
                method: 'DELETE',
              },
            );
            setMessage(
              'Иконка сброшена.',
              'success',
            );
            window.dispatchEvent(
              new CustomEvent(
                'dtpstat:point-types-changed',
              ),
            );
          } catch (error) {
            setMessage(
              error.message,
              'error',
            );
            reset.disabled =
              false;
          }
        },
      );

      remove.addEventListener(
        'click',
        async () => {
          const count =
            Number(
              pointType
                .geometryCount ??
              0,
            );
          const confirmed =
            await adminConfirm({
              title:
                'Удалить тип точки?',
              message:
                count > 0
                  ? (
                      'Тип «' +
                      pointType.name +
                      '» используется геометриями: ' +
                      count +
                      '. Сами Point останутся, их тип станет пустым.'
                    )
                  : (
                      'Тип «' +
                      pointType.name +
                      '» будет удалён.'
                    ),
              confirmLabel:
                'Удалить тип',
              cancelLabel:
                'Отмена',
              destructive: true,
            });

          if (!confirmed) {
            return;
          }

          remove.disabled = true;
          try {
            const payload =
              await requestJson(
                '/api/admin/point-types/' +
                pointType.id,
                {
                  method:
                    'DELETE',
                },
              );

            setMessage(
              'Тип удалён' +
                (
                  payload
                    .unlinkedGeometryCount
                    ? (
                        '. Геометрий без типа: ' +
                        payload
                          .unlinkedGeometryCount
                      )
                    : ''
                ) +
                '.',
              'success',
            );
            window.dispatchEvent(
              new CustomEvent(
                'dtpstat:point-types-changed',
              ),
            );
          } catch (error) {
            setMessage(
              error.message,
              'error',
            );
            remove.disabled =
              false;
          }
        },
      );

      return row;
    }

    let loading = false;

    async function load({
      changed = false,
    } = {}) {
      if (loading) {
        return;
      }

      loading = true;
      setMessage(
        changed
          ? 'Обновляем типы точек…'
          : 'Загружаем типы точек…',
      );

      try {
        const payload =
          await requestJson(
            '/api/point-types',
          );
        const pointTypes =
          payload.pointTypes ??
          [];

        table.replaceChildren(
          ...pointTypes.map(
            renderRow,
          ),
        );

        setMessage(
          'Типов точек: ' +
          pointTypes.length,
          changed
            ? 'success'
            : '',
        );
      } catch (error) {
        setMessage(
          error.message,
          'error',
        );
      } finally {
        loading = false;
      }
    }

    createForm.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        if (
          !createForm
            .reportValidity()
        ) {
          return;
        }

        const button =
          createForm.querySelector(
            'button[type="submit"]',
          );
        button.disabled = true;

        try {
          await requestJson(
            '/api/admin/point-types',
            {
              method: 'POST',
              headers: {
                'Content-Type':
                  'application/json',
              },
              body:
                JSON.stringify({
                  name:
                    createForm
                      .elements
                      .name
                      .value
                      .trim(),
                  isActive:
                    createForm
                      .elements
                      .isActive
                      .checked,
                }),
            },
          );

          createForm.reset();
          createForm
            .elements
            .isActive
            .checked =
            true;

          setMessage(
            'Тип точки создан.',
            'success',
          );
          window.dispatchEvent(
            new CustomEvent(
              'dtpstat:point-types-changed',
            ),
          );
        } catch (error) {
          setMessage(
            error.message,
            'error',
          );
        } finally {
          button.disabled =
            false;
        }
      },
    );

    window.addEventListener(
      'dtpstat:point-types-changed',
      () => {
        void load({
          changed: true,
        });
      },
    );

    void load();
  }
}
