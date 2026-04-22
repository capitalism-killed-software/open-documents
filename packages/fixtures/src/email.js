// Email messages built in code: headers, an HTML part with an inline picture, a plain-text
// part and an attachment, so a converter can be checked for each.
import { pngImage } from './images.js';

/**
 * @param {{ html?: boolean, subject?: string }} [options]
 *   html: include an HTML part with an inline image; default true
 * @returns {{ bytes: Uint8Array, subject: string, words: string[] }}
 */
export function emlMessage({ html = true, subject = 'Site visit on Tuesday' } = {}) {
  const png = Buffer.from(pngImage({ width: 40, height: 20 })).toString('base64').replace(/.{76}/g, '$&\r\n');
  const attachment = Buffer.from('Agenda: walk the site, then lunch.\n').toString('base64');
  const text = 'Hello team,\r\n\r\nThe visit is confirmed for Tuesday at 10.\r\n';
  const parts = [
    'From: Site Office <office@example.com>',
    'To: Team <team@example.com>',
    'Cc: Lead <lead@example.com>',
    `Subject: ${subject}`,
    'Date: Mon, 2 Mar 2020 09:30:00 +0000',
    'Message-ID: <fixture-1@example.com>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="mixed"',
    '',
    '--mixed',
  ];
  if (html) {
    parts.push(
      'Content-Type: multipart/related; boundary="related"', '',
      '--related',
      'Content-Type: multipart/alternative; boundary="alt"', '',
      '--alt', 'Content-Type: text/plain; charset=utf-8', '', text,
      '--alt', 'Content-Type: text/html; charset=utf-8', '',
      '<html><body><p>Hello team,</p><p>The visit is <b>confirmed</b> for Tuesday at 10.</p><img src="cid:logo@example" style="width:2in;height:1in"><script>document.body.innerHTML = "replaced"</script></body></html>',
      '--alt--',
      '--related', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-ID: <logo@example>', 'Content-Disposition: inline; filename="logo.png"', '', png,
      '--related--',
    );
  } else {
    parts.push('Content-Type: text/plain; charset=utf-8', '', text);
  }
  parts.push(
    '--mixed', 'Content-Type: text/plain; name="agenda.txt"', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="agenda.txt"', '', attachment,
    '--mixed--', '',
  );
  return { bytes: new TextEncoder().encode(parts.join('\r\n')), subject, words: ['Hello', 'team,', 'visit', 'confirmed', 'Tuesday'] };
}

/**
 * An Outlook message (.msg): sender, a recipient, plain and HTML bodies, a picture shown inline
 * and a text attachment, written with msgreader's compound-file writer.
 *
 * @returns {Promise<{ bytes: Uint8Array, subject: string, words: string[] }>}
 */
export async function msgMessage() {
  const { default: burner } = await import('@kenjiuno/msgreader/lib/Burner.js');
  const subject = 'Quarterly numbers';
  const u16 = (/** @type {string} */ s) => {
    const b = new Uint8Array(s.length * 2 + 2);
    for (let i = 0; i < s.length; i++) {
      b[i * 2] = s.charCodeAt(i) & 255;
      b[i * 2 + 1] = s.charCodeAt(i) >> 8;
    }
    return b;
  };
  const stream = (/** @type {string} */ name, /** @type {Uint8Array} */ data) => ({ name, type: 2, length: data.length, binaryProvider: () => data });
  const html = '<html><body><p>The <b>numbers</b> are in for the quarter.</p><img src="cid:chart@example" style="width:2in;height:1in"><script>document.body.innerHTML = "replaced"</script></body></html>';
  /** @type {any[]} */
  const entries = [
    { name: 'Root Entry', type: 5, length: 0, children: [] },
    stream('__substg1.0_0037001F', u16(subject)),
    stream('__substg1.0_0C1A001F', u16('Finance Desk')),
    stream('__substg1.0_5D01001F', u16('finance@example.com')),
    stream('__substg1.0_1000001F', u16('The numbers are in for the quarter.')),
    stream('__substg1.0_10130102', new TextEncoder().encode(html)),
    { name: '__recip_version1.0_#00000000', type: 1, length: 0, children: [] },
    stream('__substg1.0_3001001F', u16('Team')),
    stream('__substg1.0_39FE001F', u16('team@example.com')),
    { name: '__attach_version1.0_#00000000', type: 1, length: 0, children: [] },
    stream('__substg1.0_3707001F', u16('chart.png')),
    stream('__substg1.0_370E001F', u16('image/png')),
    stream('__substg1.0_3712001F', u16('chart@example')),
    stream('__substg1.0_37010102', pngImage({ width: 40, height: 20 })),
    { name: '__attach_version1.0_#00000001', type: 1, length: 0, children: [] },
    stream('__substg1.0_3707001F', u16('notes.txt')),
    stream('__substg1.0_370E001F', u16('text/plain')),
    stream('__substg1.0_37010102', new TextEncoder().encode('Bring the slides.\n')),
  ];
  entries[0].children = [1, 2, 3, 4, 5, 6, 9, 14];
  entries[6].children = [7, 8];
  entries[9].children = [10, 11, 12, 13];
  entries[14].children = [15, 16, 17];
  return { bytes: burner.burn(entries), subject, words: ['numbers', 'quarter.'] };
}
