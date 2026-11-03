import { round } from "./math";

// Sketch colors are "#rrggbbaa" strings. Opaque colors become "#rrggbb",
// translucent ones become rgba().
export function cssColor(hex) {
  if (!hex || typeof hex !== "string") return undefined;
  const h = hex.replace("#", "");
  const rgb = h.slice(0, 6).toLowerCase();
  const alpha = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  if (alpha >= 0.999) return `#${rgb}`;
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${round(alpha, 3)})`;
}

// Colors from the Sketch file-format JSON: { red, green, blue, alpha } in 0..1.
export function cssColorFromComponents(color) {
  if (!color || typeof color.red !== "number") return undefined;
  const r = Math.round(color.red * 255);
  const g = Math.round(color.green * 255);
  const b = Math.round(color.blue * 255);
  const alpha = typeof color.alpha === "number" ? color.alpha : 1;
  if (alpha >= 0.999) {
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${round(alpha, 3)})`;
}
