/**
 * Shared color utilities for DrawIO generation.
 */

// CSS named colors → hex (subset used by PlantUML)
export const CSS_COLORS = {
  aliceblue: '#F0F8FF', antiquewhite: '#FAEBD7', aqua: '#00FFFF',
  black: '#000000', blue: '#0000FF', brown: '#A52A2A', cyan: '#00FFFF',
  darkblue: '#00008B', darkcyan: '#008B8B', darkgray: '#A9A9A9', darkgreen: '#006400',
  darkmagenta: '#8B008B', darkorange: '#FF8C00', darkred: '#8B0000', darksalmon: '#E9967A',
  darkviolet: '#9400D3', deepskyblue: '#00BFFF', fuchsia: '#FF00FF',
  gainsboro: '#DCDCDC', gold: '#FFD700', gray: '#808080', green: '#008000',
  greenyellow: '#ADFF2F', hotpink: '#FF69B4',
  lightblue: '#ADD8E6', lightcoral: '#F08080', lightcyan: '#E0FFFF',
  lightgray: '#D3D3D3', lightgreen: '#90EE90', lightpink: '#FFB6C1',
  lightskyblue: '#87CEFA', lightyellow: '#FFFFE0',
  lime: '#00FF00', magenta: '#FF00FF', maroon: '#800000', navy: '#000080',
  olive: '#808000', orange: '#FFA500', orangered: '#FF4500', palegreen: '#98FB98',
  pink: '#FFC0CB', purple: '#800080', red: '#FF0000', royalblue: '#4169E1',
  salmon: '#FA8072', silver: '#C0C0C0', skyblue: '#87CEEB',
  slategray: '#708090', slategrey: '#708090',
  teal: '#008080', tomato: '#FF6347', violet: '#EE82EE', white: '#FFFFFF',
  whitesmoke: '#F5F5F5', yellow: '#FFFF00', yellowgreen: '#9ACD32',
};

// Normalize color value: convert CSS named colors to hex
export function normalizeColor(color) {
  if (!color) return color;
  // If it starts with # and is not a hex code, look up CSS name
  if (color.startsWith('#')) {
    const name = color.slice(1).toLowerCase();
    if (CSS_COLORS[name]) return CSS_COLORS[name];
  }
  return color;
}

/**
 * Darken a color using the OKLAB perceptual color space.
 * OKLAB is perceptually uniform — equal lightness changes look equally dark
 * regardless of hue, producing the most natural darkening across all colors.
 *
 * @param color  Hex color string (e.g. '#FF8080') or CSS name (e.g. 'red')
 * @param ratio  How much to reduce perceptual lightness (0–1, default 0.25)
 */
export function darkenColor(color: string, ratio = 0.25): string {
  // Resolve CSS named color (with or without '#' prefix)
  let hex = normalizeColor(color) || color;
  if (!/^#/.test(hex)) {
    const named = CSS_COLORS[hex.toLowerCase()];
    if (named) hex = named;
  }
  // Extract 6-digit hex; support both '#RRGGBB' and 'RRGGBB'
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return color; // can't parse, return as-is

  // Parse sRGB [0,1]
  const ri = parseInt(m[1].slice(0, 2), 16);
  const gi = parseInt(m[1].slice(2, 4), 16);
  const bi = parseInt(m[1].slice(4, 6), 16);

  // Achromatic colors (white/gray/black) → always return black
  if (ri === gi && gi === bi) return '#000000';

  const sr = ri / 255;
  const sg = gi / 255;
  const sb = bi / 255;

  // sRGB → linear RGB (gamma decode)
  const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const lr = toLinear(sr);
  const lg = toLinear(sg);
  const lb = toLinear(sb);

  // Linear RGB → OKLAB (via LMS intermediary)
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  let L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  // Darken: reduce perceptual lightness L
  L = Math.max(0, L * (1 - ratio));

  // OKLAB → Linear RGB (inverse transform)
  const l2 = L + 0.3963377774 * A + 0.2158037573 * B;
  const m2 = L - 0.1055613458 * A - 0.0638541728 * B;
  const s2 = L - 0.0894841775 * A - 1.2914855480 * B;

  const or = +(4.0767416621 * l2 ** 3 - 3.3077115913 * m2 ** 3 + 0.2309699292 * s2 ** 3);
  const og = +(-1.2684380046 * l2 ** 3 + 2.6097574011 * m2 ** 3 - 0.3413193965 * s2 ** 3);
  const ob = +(-0.0041960863 * l2 ** 3 - 0.7034186147 * m2 ** 3 + 1.7076147010 * s2 ** 3);

  // Linear RGB → sRGB (gamma encode + clamp)
  const toSrgb = (c: number) => {
    const v = Math.max(0, Math.min(1, c));
    return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  };

  const toHex = (v: number) => Math.round(toSrgb(v) * 255).toString(16).padStart(2, '0').toUpperCase();
  return '#' + toHex(or) + toHex(og) + toHex(ob);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}

export interface ParsedNodeStyle {
  fillColor?: string;
  strokeColor?: string;
  lineStyle?: string;   // 'dashed' | 'dotted' | 'bold'
  textColor?: string;
}

/**
 * Resolve a color string that may contain gradient separators (-, |, /).
 * Takes the first color from a gradient like "red-green" or "red|green".
 */
function resolveGradientColor(raw: string): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^([^|\-\/]+)[|\-\/]/);
  return resolveColor(m ? m[1] : raw);
}

/**
 * Normalize a bare color value (without leading '#') to hex.
 * Handles CSS names, bare hex (e.g. '00FFFF'), and '#hex'.
 */
function resolveColor(raw: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  // Already hex with #
  if (s.startsWith('#')) return normalizeColor(s);
  // CSS named color
  const lower = s.toLowerCase();
  if (CSS_COLORS[lower]) return CSS_COLORS[lower];
  // Bare hex (3 or 6 digits)
  if (/^[0-9a-fA-F]{3}$/.test(s) || /^[0-9a-fA-F]{6}$/.test(s)) return '#' + s.toUpperCase();
  return '#' + s;
}

/**
 * Parse a PlantUML node style string into structured color/style info.
 *
 * Supported formats:
 *   "#palegreen ##[dashed]green"    → fill + stroke + lineStyle
 *   "#pink;line:red;line.bold;text:red"  → inline style
 *   "#line:green;back:lightblue"    → inline style
 *   "#line.dashed:blue"             → stroke + lineStyle
 *   "#line.bold"                    → lineStyle only
 *   "#back:lightgreen|yellow;header:blue/red" → fill (first color before |)
 */
export function parseNodeStyle(raw: string | null | undefined): ParsedNodeStyle | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || !s.startsWith('#')) return null;

  const result: ParsedNodeStyle = {};

  // Check for standalone "##" prefix (border-only style, no fill): "##[dotted]blue"
  if (s.startsWith('##')) {
    const strokePart = s.slice(2).trim();
    const modMatch = strokePart.match(/^\[(\w+)\](.*)$/);
    if (modMatch) {
      result.lineStyle = modMatch[1]; // dashed, dotted, bold
      if (modMatch[2]) result.strokeColor = resolveColor(modMatch[2]);
    } else if (strokePart) {
      result.strokeColor = resolveColor(strokePart);
    }
    return result;
  }

  // Check for "## " stroke part: "#fill ##[modifier]stroke"
  const dualIdx = s.indexOf(' ##');
  if (dualIdx >= 0) {
    const fillPart = s.slice(1, dualIdx); // after '#', before ' ##'
    const strokePart = s.slice(dualIdx + 3); // after ' ##'

    if (fillPart) result.fillColor = resolveGradientColor(fillPart);

    // Parse [modifier]color or just color
    const modMatch = strokePart.match(/^\[(\w+)\](.*)$/);
    if (modMatch) {
      result.lineStyle = modMatch[1]; // dashed, dotted, bold
      if (modMatch[2]) result.strokeColor = resolveColor(modMatch[2]);
    } else if (strokePart) {
      result.strokeColor = resolveColor(strokePart);
    }
    return result;
  }

  // Single token after '#'
  const body = s.slice(1);

  // Inline style with semicolons or line. prefix: "pink;line:red;line.bold;text:red"
  if (body.includes(';') || body.includes(':') || body.startsWith('line.')) {
    const parts = body.split(';');
    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      if (p.startsWith('back:')) {
        // "back:lightgreen|yellow" → take first color (before gradient separator)
        result.fillColor = resolveGradientColor(p.slice(5));
      } else if (p.startsWith('line:')) {
        result.strokeColor = resolveColor(p.slice(5));
      } else if (p.startsWith('line.dashed:')) {
        result.lineStyle = 'dashed';
        result.strokeColor = resolveColor(p.slice(12));
      } else if (p === 'line.dashed') {
        result.lineStyle = 'dashed';
      } else if (p.startsWith('line.dotted:')) {
        result.lineStyle = 'dotted';
        result.strokeColor = resolveColor(p.slice(12));
      } else if (p === 'line.dotted') {
        result.lineStyle = 'dotted';
      } else if (p.startsWith('line.bold:')) {
        result.lineStyle = 'bold';
        result.strokeColor = resolveColor(p.slice(9));
      } else if (p === 'line.bold') {
        result.lineStyle = 'bold';
      } else if (p.startsWith('text:')) {
        result.textColor = resolveColor(p.slice(5));
      } else if (p.startsWith('header:')) {
        // ignore header style
      } else if (!p.includes(':')) {
        // First bare value = fill color: "#pink;line:red" → pink is fill
        if (!result.fillColor) result.fillColor = resolveGradientColor(p);
      }
    }
    return result;
  }

  // Simple fill color: "#palegreen"
  // Handle gradient colors ("red-green", "red|green", "red/green") — take the first color.
  result.fillColor = resolveGradientColor(body);
  return result;
}

export interface ParsedEdgeStyle {
  strokeColor?: string;
  lineStyle?: string;   // 'dashed' | 'dotted' | 'bold' | 'hidden' | 'plain'
  thickness?: number;
  textColor?: string;
}

/**
 * Parse bracket-style edge modifiers from arrowMeta.color.
 * e.g. "red", "red,dashed,thickness=4", "bold"
 */
export function parseBracketEdgeStyle(raw: string | null | undefined): ParsedEdgeStyle | null {
  if (!raw) return null;
  const result: ParsedEdgeStyle = {};
  const parts = raw.split(',');
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    if (p === 'bold' || p === 'dashed' || p === 'dotted' || p === 'hidden' || p === 'plain') {
      result.lineStyle = p;
    } else if (p.startsWith('thickness=')) {
      result.thickness = parseInt(p.slice(10), 10) || 1;
    } else {
      // Color value (with or without leading #).
      // PlantUML supports multi-color specs separated by ';' (e.g. "#blue;#green").
      // Use the first color for stroke.
      const colorPart = p.includes(';') ? p.split(';')[0].trim() : p;
      result.strokeColor = resolveColor(colorPart);
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse inline edge style (NodeStyle format) into edge-specific properties.
 * e.g. "#line:red;line.bold;text:red" or "#green;line.dashed;text:green"
 */
export function parseEdgeInlineStyle(raw: string | null | undefined): ParsedEdgeStyle | null {
  const parsed = parseNodeStyle(raw);
  if (!parsed) return null;
  const result: ParsedEdgeStyle = {};
  // For edges, fillColor maps to strokeColor (edge "fill" = line color)
  if (parsed.strokeColor) result.strokeColor = parsed.strokeColor;
  else if (parsed.fillColor) result.strokeColor = parsed.fillColor;
  if (parsed.lineStyle) result.lineStyle = parsed.lineStyle;
  if (parsed.textColor) result.textColor = parsed.textColor;
  return Object.keys(result).length > 0 ? result : null;
}
