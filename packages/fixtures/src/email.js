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
