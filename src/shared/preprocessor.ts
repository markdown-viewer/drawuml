/**
 * PlantUML preprocessor directive isolation.
 *
 * Strips lines starting with `!` (preprocessor directives) from the source
 * BEFORE PEG parsing, so the parser AST never contains preprocessor nodes.
 *
 * Extracts `!pragma` key-value pairs for downstream consumption.
 *
 * This module does NOT implement any actual preprocessing logic
 * (variable substitution, conditionals, includes, etc.).
 * Those are left for a future dedicated phase.
 */

export interface PreprocessResult {
  /** Source text with all `!` directive lines removed. */
  source: string;
  /** Extracted `!pragma` key→value map (e.g. { useIntermediatePackages: 'false' }). */
  pragmas: Record<string, string>;
}

export function preprocess(source: string): PreprocessResult {
  const lines = source.split(/\r?\n/);
  const kept: string[] = [];
  const pragmas: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('!')) {
      // Extract pragma: "!pragma key value"
      const m = trimmed.match(/^!pragma\s+(\S+)\s*(.*)?$/i);
      if (m) {
        pragmas[m[1]] = (m[2] || 'true').trim();
      }
      // All `!` lines are stripped from output
      continue;
    }
    kept.push(line);
  }

  return { source: kept.join('\n'), pragmas };
}
