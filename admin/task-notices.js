import './line-types-editor.js';
import './project-settings-editor.js';
import './public-download-name-editor.js';
import './report-config-editor.js';
import './report-range-ui.js';
import './project-branding.js';
import './kml-transfer-editor.js';

/**
 * Keep each operation notice inside its own tab panel. A notice from one task
 * must never be rendered in another task's live region.
 *
 * @param {ArrayLike<HTMLElement>} elements
 * @param {Record<string, string>} taskNames
 */
export function createTaskNotices(elements, taskNames) {
  const notices = new Map(
    [...elements].map((element) => [element.dataset.taskNotice, element]),
  );

  return {
    /** @param {string} taskKey @param {string} message @param {string} [tone] */
    set(taskKey, message, tone = 'warning') {
      const notice = notices.get(taskKey);
      if (!notice) return false;
      notice.textContent = message;
      notice.className = `notice notice-${tone}`;
      return true;
    },

    /** @param {string} taskKey @param {string} message @param {string} [tone] */
    setForTask(taskKey, message, tone = 'warning') {
      const taskName = taskNames[taskKey] ?? taskKey;
      return this.set(taskKey, `${taskName}: ${message}`, tone);
    },
  };
}
