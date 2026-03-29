/**
 * A multipart body for app.inject(), built the way a browser builds one.
 *
 * @param {{ name?: string, filename: string, data: Uint8Array, type?: string }[]} files
 * @param {object} [options]
 */
export async function form(files, options) {
  const fd = new FormData();
  for (const f of files) fd.append(f.name ?? 'file', new Blob([f.data], { type: f.type ?? 'application/octet-stream' }), f.filename);
  if (options !== undefined) fd.append('options', JSON.stringify(options));
  const request = new Request('http://localhost/', { method: 'POST', body: fd });
  return { payload: Buffer.from(await request.arrayBuffer()), headers: { 'content-type': /** @type {string} */ (request.headers.get('content-type')) } };
}
