// Syntax-colours pretty-printed JSON for the details pane. The colours come
// from the active theme (see src/theme.ts), applied as CSS variables.

const token = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function highlightJSON(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > last) fragment.append(text.slice(last, index));
    const [whole, string, colon, constant, number] = match;
    if (string !== undefined) {
      fragment.append(span(string, colon ? 'json-key' : 'json-string'));
      if (colon) fragment.append(colon);
    } else if (constant !== undefined) {
      fragment.append(span(constant, 'json-constant'));
    } else if (number !== undefined) {
      fragment.append(span(number, 'json-number'));
    }
    last = index + whole.length;
  }
  if (last < text.length) fragment.append(text.slice(last));
  return fragment;
}

function span(text: string, className: string) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}
