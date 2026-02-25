import { modify } from './modify.js';
import { fail } from './errors.js';

/**
 * What someone who opens the file with the user password may do. Everything is allowed unless
 * set to false. Viewers are trusted to respect these; they do not stop a determined reader.
 *
 * @typedef {object} Permissions
 * @property {boolean | 'low'} [print]  'low' allows only low-resolution printing
 * @property {boolean} [modify]
 * @property {boolean} [copy]
 * @property {boolean} [annotate]
 * @property {boolean} [fillForms]
 * @property {boolean} [accessibility]  text extraction for screen readers
 * @property {boolean} [assemble]       insert, rotate and delete pages
 */

// /P bits (PDF 2.0, 7.6.4.2). Bits 7, 8 and 13 to 32 must be 1.
const BASE = 0xfffff0c0;
const BITS = { print: 1 << 2, modify: 1 << 3, copy: 1 << 4, annotate: 1 << 5, fillForms: 1 << 8, accessibility: 1 << 9, assemble: 1 << 10 };
const PRINT_HIGH = 1 << 11;

/**
 * @param {Permissions} [permissions]
 * @returns {number}
 */
export function permissionBits(permissions = {}) {
  let p = BASE;
  for (const [name, bit] of Object.entries(BITS)) {
    const value = permissions[/** @type {keyof Permissions} */ (name)];
    if (value !== undefined && typeof value !== 'boolean' && !(name === 'print' && value === 'low')) {
      fail('INVALID_OPTION', `permissions.${name} must be true or false${name === 'print' ? ' or "low"' : ''}.`);
    }
    if (value !== false) p |= bit;
  }
  if (permissions.print === undefined || permissions.print === true) p |= PRINT_HIGH;
  return p | 0;
}

/**
 * Lock a document with AES-256.
 *
 * `userPassword` is needed to open the file; leave it out to let anyone open it but still apply
 * the permissions. `ownerPassword` lifts the permissions; if left out, a random one is made, so
 * nobody can lift them. The input's own encryption, if any, is replaced.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ userPassword?: string, ownerPassword?: string, permissions?: Permissions, password?: string }} options
 *   password opens the input if it is already encrypted
 * @returns {Promise<Uint8Array>}
 */
export async function encrypt(input, options) {
  if (!options || (options.userPassword === undefined && options.ownerPassword === undefined && options.permissions === undefined)) {
    fail('INVALID_OPTION', 'Give a userPassword, an ownerPassword or permissions.');
  }
  for (const key of /** @type {const} */ (['userPassword', 'ownerPassword'])) {
    const value = options[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > 127)) fail('INVALID_OPTION', `${key} must be a string of at most 127 characters.`);
  }
  const user = options.userPassword ?? '';
  const owner = options.ownerPassword || randomPassword();
  if (owner === user) fail('INVALID_OPTION', 'The owner password must differ from the user password, or the permissions mean nothing.');
  const bits = permissionBits(options.permissions);
  return modify(input, options, (pdf, doc) => {
    if (!pdf.fn.EPDF_SetEncryption(doc, user, owner, bits)) fail('ENGINE_ERROR', 'The document could not be encrypted.');
  });
}

/**
 * Remove a document's encryption. When the file restricts what its users may do, this needs
 * the owner password: the user password opens the file but does not lift the restrictions.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ password?: string }} options
 * @returns {Promise<Uint8Array>}
 */
export async function decrypt(input, options = {}) {
  return modify(input, options, (pdf, doc) => {
    const { fn } = pdf;
    if (!fn.EPDF_IsEncrypted(doc)) return;
    // bits 1 and 2 are always 0 in /P, so "everything allowed" reads as -4, not -1
    const restricted = (fn.FPDF_GetDocPermissions(doc) | 0b11) !== -1;
    if (restricted && !fn.EPDF_IsOwnerUnlocked(doc)) {
      fail('PASSWORD_REQUIRED', 'This file restricts what readers may do. Removing its protection needs the owner password.');
    }
    if (!fn.EPDF_RemoveEncryption(doc)) fail('ENGINE_ERROR', 'The encryption could not be removed.');
  });
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
