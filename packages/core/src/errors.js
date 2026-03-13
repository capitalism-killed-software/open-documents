/**
 * Every error thrown on purpose by this library. `code` is stable and safe to branch on;
 * `message` is for people and may change.
 *
 * Codes:
 * - `INVALID_INPUT`     the input is not bytes, or not a PDF
 * - `INVALID_OPTION`    an option is missing, out of range or of the wrong type
 * - `PASSWORD_REQUIRED` the file is encrypted and no password, or the wrong one, was given
 * - `UNSUPPORTED_SECURITY` the file uses an encryption scheme we cannot open
 * - `DAMAGED_FILE`      the file could not be parsed
 * - `PAGE_NOT_FOUND`    a page number is outside the document
 * - `ENGINE_ERROR`      the PDF engine failed in a way we did not expect
 * - `ENGINE_MISSING`    a program a conversion needs (LibreOffice, Chromium) is not installed
 * - `CONVERSION_FAILED` the converter ran but produced nothing usable
 * - `TIMEOUT`           a conversion took longer than allowed and was stopped
 * - `BUSY`              every converter is in use and the queue is full
 * - `BLOCKED`           a web page tried to reach an address it is not allowed to
 */
export class OpenDocumentsError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = 'OpenDocumentsError';
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
export function fail(code, message) {
  throw new OpenDocumentsError(code, message);
}
