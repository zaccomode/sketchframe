export function round(value, precision = 2) {
  if (typeof value !== "number" || !isFinite(value)) return undefined;
  const factor = Math.pow(10, precision);
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded; // avoid -0
}

export function degrees(radians) {
  const deg = (radians * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

// Drops undefined / null / false values and empty arrays/objects so the JSON
// only carries information that differs from the defaults.
export function clean(object) {
  const out = {};
  Object.keys(object).forEach((key) => {
    const value = object[key];
    if (value === undefined || value === null || value === false) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    )
      return;
    out[key] = value;
  });
  return out;
}

export function isEmpty(object) {
  return !object || Object.keys(object).length === 0;
}
