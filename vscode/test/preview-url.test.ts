import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safePreviewUrl } from '../webview/preview-url.ts';

const origin = 'https://file+.vscode-resource.vscode-cdn.net';

test('accepts raster data URIs and webview URIs into the package', () => {
  for (const type of ['png', 'jpeg', 'gif', 'webp']) {
    const url = `data:image/${type};base64,iVBORw0KGgo=`;
    assert.equal(safePreviewUrl(url, origin), url);
    assert.equal(safePreviewUrl(url, ''), url);
  }
  const url = `${origin}/Users/me/Cards.sketchframe/preview.png?v=3`;
  assert.equal(safePreviewUrl(url, origin), url);
});

test('drops anything else', () => {
  for (const url of [
    null,
    undefined,
    42,
    '',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png,<svg onload=alert(1)>',
    'data:image/png;base64,iVBOR"><script>',
    'javascript:alert(1)',
    'https://example.com/preview.png',
    'http://file+.vscode-resource.vscode-cdn.net/preview.png',
    `${origin}.example.com/preview.png`,
    'preview.png',
  ]) {
    assert.equal(safePreviewUrl(url, origin), '', String(url));
  }
  // A folder URI is refused when the page names no resource origin.
  assert.equal(safePreviewUrl(`${origin}/preview.png`, ''), '');
});
