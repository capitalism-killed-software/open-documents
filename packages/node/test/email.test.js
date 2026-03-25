import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emlMessage } from '@open-documents/fixtures';
import { emlToHtml } from '../src/index.js';

test('headers on top, the html part below, inline pictures from the message', async () => {
  const page = await emlToHtml(emlMessage().bytes);
  assert.equal(page.subject, 'Site visit on Tuesday');
  assert.match(page.html, /<th>From<\/th><td>Site Office &lt;office@example\.com&gt;<\/td>/);
  assert.match(page.html, /<th>Cc<\/th><td>Lead &lt;lead@example\.com&gt;<\/td>/);
  assert.match(page.html, /<th>Date<\/th><td>Mon, 2 Mar 2020 09:30:00 \+0000<\/td>/);
  assert.match(page.html, /The visit is <b>confirmed<\/b>/);
  assert.match(page.html, /src="cid\/logo%40example"/);
  assert.ok(page.assets['cid/logo%40example'] instanceof Uint8Array);
  assert.doesNotMatch(page.html, /<script/i);
  assert.deepEqual(page.attachments.map((a) => a.filename), ['agenda.txt']);
  assert.match(page.html, /Attachments: agenda\.txt \(35 B\)/);
});

test('a plain-text message is shown as it was written', async () => {
  const page = await emlToHtml(emlMessage({ html: false, subject: 'Re: <plans> & dates' }).bytes);
  assert.match(page.html, /<pre class="text">Hello team,/);
  assert.match(page.html, /<p class="subject">Re: &lt;plans&gt; &amp; dates<\/p>/);
});
