// Sketch exposes enums as plain objects (e.g. StackLayout.Direction). Reverse
// look up the key so we don't depend on whether the underlying values are
// strings or numbers.
export function enumKey(enumObject, value) {
  if (value === undefined || value === null) return undefined;
  if (enumObject) {
    const keys = Object.keys(enumObject);
    for (let i = 0; i < keys.length; i++) {
      if (enumObject[keys[i]] === value) return keys[i];
    }
  }
  return String(value);
}

// "ColorBurn" -> "color-burn"
export function kebab(key) {
  if (!key) return undefined;
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

// "InsideSquare" -> "insideSquare"
export function camel(key) {
  if (!key) return undefined;
  const str = String(key);
  return str.charAt(0).toLowerCase() + str.slice(1);
}
