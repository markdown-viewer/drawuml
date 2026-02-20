/**
 * PlantUML text unescape — runs BEFORE creole processing.
 *
 * Handles PlantUML-level escape sequences that are not part of Creole markup,
 * matching official PlantUML Display.java behaviour:
 *   \\  → literal backslash
 *   \n  → newline character
 *   \r  → newline (right-align hint; treated as plain newline for draw.io)
 *   \l  → newline (left-align hint; treated as plain newline for draw.io)
 *   \t  → tab character
 */
export function unescapePlantUml(text: string): string {
  let s = text;
  // Unescape PlantUML backslash pairs: \\ → literal backslash
  s = s.replace(/\\\\/g, '\x00');
  // Convert PlantUML escape sequences to actual characters
  s = s.replace(/\\n/g, '\n');
  s = s.replace(/\\r/g, '\n');
  s = s.replace(/\\l/g, '\n');
  s = s.replace(/\\t/g, '\t');
  // Restore literal backslashes
  s = s.replace(/\x00/g, '\\');
  return s;
}
