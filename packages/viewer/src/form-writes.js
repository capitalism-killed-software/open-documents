// EmbedPDF's form plugin starts a new write for every keystroke without waiting for the one
// before. On a busy machine the writes finish out of order, and a field can end up holding an
// earlier, shorter value than the one typed. This runs the writes one at a time, in the order
// they were asked for, and skips a write that a newer one for the same widget has replaced.
import { Task } from '@embedpdf/models';

/**
 * @param {any} plugin  the form plugin instance, from registry.getPlugin('form')
 */
export function serializeFormWrites(plugin) {
  if (!plugin?.setFormFieldValues || plugin.serializedWrites) return;
  const write = plugin.setFormFieldValues.bind(plugin);
  /** @type {Promise<void>} */
  let tail = Promise.resolve();
  /** @type {Map<string, number>} widget to the number of its newest write */
  const newest = new Map();
  plugin.setFormFieldValues = (/** @type {number} */ pageIndex, /** @type {any} */ annotation, /** @type {any} */ field, /** @type {string} */ documentId) => {
    const task = new Task();
    const key = `${documentId ?? ''}\u0000${annotation?.id}`;
    const ticket = (newest.get(key) ?? 0) + 1;
    newest.set(key, ticket);
    tail = tail.then(() => new Promise((done) => {
      if (newest.get(key) !== ticket) {
        task.resolve(true);
        done();
        return;
      }
      write(pageIndex, annotation, field, documentId).wait(
        (/** @type {unknown} */ result) => {
          task.resolve(result);
          done();
        },
        (/** @type {any} */ error) => {
          task.fail(error);
          done();
        },
      );
    }));
    return task;
  };
  plugin.serializedWrites = true;
}
