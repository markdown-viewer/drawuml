/**
 * Pure Creole inline markup conversion.
 *
 * Converts PlantUML Creole markup and HTML-like tags to standard HTML.
 * This module contains ONLY Creole semantics — no PlantUML escape handling,
 * no DrawIO output formatting, no stereotype processing.
 *
 * Input:  text with PlantUML escapes already resolved (via unescapePlantUml)
 * Output: HTML string with Creole markup converted to standard HTML tags
 */

/** Escape text so it renders as literal content in HTML. */
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Emoji name → Unicode code point mapping (common subset used in fixtures) ---
// PlantUML uses Unicode CLDR short names. This covers the most common ones.
const EMOJI_MAP: Record<string, number> = {
  // Smileys & People
  'grinning': 0x1F600, '1f600': 0x1F600, 'smile': 0x1F604, 'laughing': 0x1F606,
  'innocent': 0x1F607, 'wink': 0x1F609, 'blush': 0x1F60A, 'heart_eyes': 0x1F60D,
  'sunglasses': 0x1F60E, 'thinking': 0x1F914, 'neutral_face': 0x1F610,
  'expressionless': 0x1F611, 'unamused': 0x1F612, 'sweat': 0x1F613,
  'pensive': 0x1F614, 'confused': 0x1F615, 'disappointed': 0x1F61E,
  'worried': 0x1F61F, 'angry': 0x1F620, 'cry': 0x1F622, 'sob': 0x1F62D,
  'scream': 0x1F631, 'sleeping': 0x1F634, 'dizzy_face': 0x1F635,
  'mask': 0x1F637, 'thumbsup': 0x1F44D, 'thumbsdown': 0x1F44E,
  'clap': 0x1F44F, 'wave': 0x1F44B, 'pray': 0x1F64F,
  'muscle': 0x1F4AA, 'raised_hands': 0x1F64C,
  // Hearts & Symbols
  'heart': 0x2764, 'broken_heart': 0x1F494, 'star': 0x2B50, 'sparkles': 0x2728,
  'fire': 0x1F525, 'zap': 0x26A1, 'sunny': 0x2600, 'cloud': 0x2601,
  'umbrella': 0x2602, 'snowflake': 0x2744, 'rainbow': 0x1F308,
  // Objects
  'phone': 0x1F4DE, 'email': 0x1F4E7, 'computer': 0x1F4BB, 'key': 0x1F511,
  'lock': 0x1F512, 'unlock': 0x1F513, 'bell': 0x1F514, 'gear': 0x2699,
  'wrench': 0x1F527, 'hammer': 0x1F528, 'bulb': 0x1F4A1, 'bomb': 0x1F4A3,
  'trophy': 0x1F3C6, 'clock': 0x1F554, 'hourglass': 0x231B,
  // Checkmarks & Arrows
  'check': 0x2714, 'x': 0x274C, 'warning': 0x26A0, 'no_entry': 0x26D4,
  'question': 0x2753, 'exclamation': 0x2757, 'info': 0x2139,
  'arrow_right': 0x27A1, 'arrow_left': 0x2B05, 'arrow_up': 0x2B06, 'arrow_down': 0x2B07,
  // Animals & Nature
  'dog': 0x1F436, 'cat': 0x1F431, 'bug': 0x1F41B, 'ant': 0x1F41C,
  'fish': 0x1F41F, 'turtle': 0x1F422, 'monkey': 0x1F435,
  // Food
  'coffee': 0x2615, 'beer': 0x1F37A, 'cake': 0x1F370, 'pizza': 0x1F355,
  // Transport
  'car': 0x1F697, 'rocket': 0x1F680, 'airplane': 0x2708, 'ship': 0x1F6A2,
};

// --- OpenIconic icon name → Unicode approximation mapping ---
// PlantUML supports OpenIconic icons via <&name>. We map to closest Unicode symbols.
const OPENICONIC_MAP: Record<string, number> = {
  'heart': 0x2665, 'star': 0x2605, 'check': 0x2714, 'x': 0x2718,
  'plus': 0x002B, 'minus': 0x2212, 'ban': 0x1F6AB,
  'bell': 0x1F514, 'bolt': 0x26A1, 'book': 0x1F4D6, 'bookmark': 0x1F516,
  'box': 0x25A1, 'bug': 0x1F41B, 'calendar': 0x1F4C5, 'chat': 0x1F4AC,
  'clock': 0x1F554, 'cloud': 0x2601, 'cog': 0x2699, 'compass': 0x1F9ED,
  'dashboard': 0x1F4CA, 'delete': 0x2716, 'document': 0x1F4C4,
  'envelope-closed': 0x2709, 'envelope-open': 0x1F4E8, 'eye': 0x1F441,
  'file': 0x1F4C4, 'flag': 0x1F3F3, 'flash': 0x26A1, 'folder': 0x1F4C1,
  'fork': 0x1F374, 'globe': 0x1F310, 'graph': 0x1F4C8, 'grid': 0x25A6,
  'home': 0x1F3E0, 'image': 0x1F5BC, 'inbox': 0x1F4E5,
  'info': 0x2139, 'key': 0x1F511, 'laptop': 0x1F4BB, 'layers': 0x1F5C2,
  'link-intact': 0x1F517, 'list': 0x1F4CB, 'location': 0x1F4CD,
  'lock-locked': 0x1F512, 'lock-unlocked': 0x1F513, 'loop': 0x1F503,
  'magnifying-glass': 0x1F50D, 'map': 0x1F5FA, 'map-marker': 0x1F4CD,
  'menu': 0x2630, 'microphone': 0x1F3A4, 'monitor': 0x1F5A5,
  'moon': 0x1F319, 'musical-note': 0x1F3B5, 'paperclip': 0x1F4CE,
  'pencil': 0x270F, 'people': 0x1F465, 'person': 0x1F464,
  'phone': 0x1F4DE, 'pin': 0x1F4CC, 'play-circle': 0x25B6,
  'power-standby': 0x23FB, 'print': 0x1F5A8, 'project': 0x1F4CB,
  'puzzle-piece': 0x1F9E9, 'question-mark': 0x2753, 'reload': 0x1F503,
  'rss': 0x1F4E1, 'script': 0x1F4DC, 'share': 0x1F517, 'shield': 0x1F6E1,
  'signal': 0x1F4F6, 'spreadsheet': 0x1F4CA, 'sun': 0x2600,
  'tag': 0x1F3F7, 'tags': 0x1F3F7, 'target': 0x1F3AF,
  'task': 0x2611, 'terminal': 0x1F4BB, 'thumb-down': 0x1F44E,
  'thumb-up': 0x1F44D, 'timer': 0x23F1, 'transfer': 0x21C4,
  'trash': 0x1F5D1, 'underline': 0x005F, 'warning': 0x26A0,
  'wifi': 0x1F4F6, 'wrench': 0x1F527, 'zoom-in': 0x1F50D, 'zoom-out': 0x1F50E,
};
export function creoleInline(text: string): string {
  let s = text;

  // --- Wave-underline ~~text~~ — must be handled BEFORE tilde escape ---
  // Otherwise ~~ is consumed by tilde escape ~(.) eating the second ~.
  const waveEscapes: string[] = [];
  s = s.replace(/~~(.+?)~~/g, (_, inner) => {
    waveEscapes.push(inner);
    return `\x00WAVE${waveEscapes.length - 1}\x00`;
  });

  // --- Phase 1.1: Tilde escape (~) — protect next markup character ---
  // Replace ~X with a placeholder before any markup processing,
  // then restore X (without ~) at the end.
  const tildeEscapes: string[] = [];
  s = s.replace(/~(.)/g, (_, ch) => {
    tildeEscapes.push(ch);
    return `\x00TESC${tildeEscapes.length - 1}\x00`;
  });

  // --- Phase 1.2: <plain>text</plain> — disable all markup inside ---
  const plainEscapes: string[] = [];
  s = s.replace(/<plain>([\s\S]*?)<\/plain>/gi, (_, inner) => {
    plainEscapes.push(inner);
    return `\x00PLAIN${plainEscapes.length - 1}\x00`;
  });

  // --- PlantUML HTML-like tags → standard HTML ---

  // <color[:/ ]value>text</color> → <font color="value">text</font>
  s = s.replace(/<color[: ]+([^>]+)>([\s\S]*?)<\/color>/gi,
    (_, c, t) => `<font color="${c.trim()}">${t}</font>`);

  // <size[:/ ]N>text</size> → <font style="font-size:Npx">text</font>
  s = s.replace(/<size[: ]+(\d+)>([\s\S]*?)<\/size>/gi,
    (_, n, t) => `<font style="font-size:${n}px">${t}</font>`);

  // <back[:/ ]value>text</back> → <span style="background-color:value">text</span>
  s = s.replace(/<back[: ]+([^>]+)>([\s\S]*?)<\/back>/gi,
    (_, c, t) => `<span style="background-color:${c.trim()}">${t}</span>`);

  // <font:family>text</font> → <font face="family">text</font>
  // Only matches colon-notation; standard <font color=...> passes through unchanged.
  s = s.replace(/<font:([^>]+)>([\s\S]*?)<\/font>/gi,
    (_, f, t) => `<font face="${f.trim()}">${t}</font>`);

  // <w[:color]>text</w> → <u>text</u>  (wave underline approximated as underline)
  s = s.replace(/<w(?::[^>]*)?>(([\s\S]*?))<\/w>/gi, '<u>$1</u>');

  // <u:color> → <u>  (strip color attribute, keep underline)
  s = s.replace(/<u:[^>]+>/gi, '<u>');

  // <s:color> → <s>  (strip color attribute, keep strikethrough)
  s = s.replace(/<s:[^>]+>/gi, '<s>');

  // <strike> / </strike> → <s> / </s>  (normalize alias)
  s = s.replace(/<strike>/gi, '<s>');
  s = s.replace(/<\/strike>/gi, '</s>');

  // Phase 1.3: <sub>/<sup> — pass through to HTML (DrawIO supports them)
  // No transformation needed — these are already valid HTML tags.

  // <img ...> → (Cannot decode)  (external images not supported)
  s = s.replace(/<img\s+[^>]*>/gi, '(Cannot decode)');

  // --- Creole inline markup → HTML ---
  // Use non-greedy .+? instead of negated char classes so text containing
  // the delimiter character (e.g. "stricken-out" with dashes) still matches.
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/\/\/(.+?)\/\//g, '<i>$1</i>');
  s = s.replace(/__(.+?)__/g, '<u>$1</u>');
  s = s.replace(/--(.+?)--/g, '<s>$1</s>');
  s = s.replace(/""(.+?)""/g, '<code>$1</code>');

  // Unescape PlantUML Unicode escape: <U+XXXX> → character
  s = s.replace(/<U\+([0-9A-Fa-f]{4,5})>/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16))
  );

  // Phase 1.4: Emoji <:name:> → Unicode character (common subset)
  s = s.replace(/<(?:#[0-9a-fA-F]*:)?([a-z0-9_]+):>/gi, (match, name) => {
    const cp = EMOJI_MAP[name.toLowerCase()];
    return cp ? String.fromCodePoint(cp) : match;
  });

  // Phase 1.5: OpenIconic <&name> → Unicode approximation
  s = s.replace(/<&([a-z0-9-]+)>/gi, (match, name) => {
    const cp = OPENICONIC_MAP[name.toLowerCase()];
    return cp ? String.fromCodePoint(cp) : match;
  });

  // --- Restore escaped sections (reverse order) ---

  // Restore <plain> blocks as literal text (HTML-escaped)
  for (let i = 0; i < plainEscapes.length; i++) {
    s = s.replace(`\x00PLAIN${i}\x00`, escapeHtmlText(plainEscapes[i]));
  }

  // Restore tilde escapes as literal characters (HTML-escaped)
  for (let i = 0; i < tildeEscapes.length; i++) {
    s = s.replace(`\x00TESC${i}\x00`, escapeHtmlText(tildeEscapes[i]));
  }

  // Restore wave-underline placeholders → <u>text</u>
  // Inner text still needs inline processing (bold etc. inside wave-underlined spans).
  for (let i = 0; i < waveEscapes.length; i++) {
    s = s.replace(`\x00WAVE${i}\x00`, `<u>${creoleInline(waveEscapes[i])}</u>`);
  }

  // --- Escape stray angle brackets that are NOT known HTML tags ---
  // PlantUML only supports a fixed set of HTML-like tags.  Anything else
  // (e.g. "Map<Integer, String>") must be escaped so it renders as literal
  // text instead of being swallowed by the DOM parser.
  const ALLOWED_TAG = /^<\/?(?:b|i|u|s|strike|del|plain|back|w|font|color|size|sub|sup|code|pre|img|text|math|latex|hr|br|span|div|p|table|tr|td|th)[\s>/]/i;
  const VOID_ALLOWED = /^<(?:br|hr|img)\s*\/?>/i;
  s = s.replace(/<[^>]*>/g, (tag) => {
    if (ALLOWED_TAG.test(tag) || VOID_ALLOWED.test(tag)) return tag;
    // Also allow self-closing variants like </b>
    if (/^<\/[a-z]+\s*>/i.test(tag) && ALLOWED_TAG.test('<' + tag.slice(2))) return tag;
    return tag.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });

  return s;
}

