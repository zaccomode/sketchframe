// The preview image's URL arrives in a posted `load` message. The extension
// host only ever sends a data URI of a raster image or a webview URI into the
// folder package, so anything else is dropped rather than put in <img src>.

const dataImage = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/;

/**
 * `url` if it's a base64 data URI of a PNG, JPEG, GIF or WebP, or an https
 * URL on `resourceOrigin` (the origin of the package's webview URIs, which
 * the host writes into the page); otherwise `''`, meaning no preview.
 */
export function safePreviewUrl(url: unknown, resourceOrigin: string): string {
  if (typeof url !== 'string') return '';
  if (dataImage.test(url)) return url;
  if (resourceOrigin === '') return '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  return parsed.protocol === 'https:' && parsed.origin === resourceOrigin ? parsed.href : '';
}
