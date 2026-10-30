// Read-only check against an already published build. Run after build:pwa.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../apps/pwa/dist/', import.meta.url);
const target = new URL(process.argv[2] || 'https://latch.theqrl.org');
assert.ok(target.pathname === '/' && !target.search && !target.hash && !target.username && !target.password, 'Pass the origin root URL');
assert.ok(target.protocol === 'https:' || (target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname)), 'Use HTTPS except for a local test server');
const sw = await readFile(new URL('sw.js', root), 'utf8');
const digests = JSON.parse(sw.match(/^self\.__LATCH_DIGESTS__=(\{.*\});\n/)?.[1] || 'null');
assert.ok(digests, 'Build with npm run build:pwa first');
const digest = (data) => 'sha256-' + createHash('sha256').update(data).digest('base64');
const request = (path) => fetch(new URL(path, target), {redirect:'error', cache:'no-store', signal:AbortSignal.timeout(15000)});
const expectedCsp = (await readFile(new URL('_headers', root), 'utf8')).match(/^  Content-Security-Policy: (.+)$/m)[1];
const files = {...digests, 'sw.js':digest(sw)};
let checked = 0;
for (const [path, expected] of Object.entries(files)) {
  // Netlify consumes these configuration files rather than serving them.
  if (['_headers','_redirects'].includes(path)) continue;
  const response = await request(path);
  assert.equal(response.status, 200, `${path}: missing or blocked`);
  assert.equal(digest(new Uint8Array(await response.arrayBuffer())), expected, `${path}: served bytes differ from this build`);
  assert.equal(response.headers.get('content-security-policy'), expectedCsp, `${path}: CSP missing or changed`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', `${path}: missing nosniff`);
  assert.match(response.headers.get('cache-control') || '', /no-cache/, `${path}: wrong cache policy`);
  const type = response.headers.get('content-type') || '';
  if (path.endsWith('.js')) assert.match(type, /(?:javascript|ecmascript)/);
  if (path.endsWith('.css')) assert.match(type, /^text\/css/);
  if (path.endsWith('.html')) assert.match(type, /^text\/html/);
  if (path.endsWith('.json')) assert.match(type, /application\/json/);
  if (path.endsWith('.webmanifest')) assert.match(type, /application\/manifest\+json/);
  if (path.endsWith('.png')) assert.match(type, /^image\/png/);
  if (path.endsWith('.woff2')) assert.match(type, /(?:font\/woff2|application\/font-woff2)/);
  if (path === 'sw.js') assert.equal(response.headers.get('service-worker-allowed'), '/');
  checked++;
}
const home = await request('/');
assert.equal(home.status, 200);
assert.equal(digest(new Uint8Array(await home.arrayBuffer())), digests['index.html'], 'Root does not serve the built index');
for (const path of ['assets/__latch_missing__.js','fonts/__latch_missing__.woff2','__latch_missing__.webmanifest']) {
  assert.equal((await request(path)).status, 404, `${path}: missing files must return 404, not the SPA shell`);
}
console.log(`Verified ${checked} deployed files, root HTML, headers, MIME types and missing-file responses at ${target.origin}.`);
console.log('This does not verify physical-device installation, storage retention, authenticator behavior or future releases.');
