import type { NormalizedText, NormalizedTextSourceHint } from './normalized-text.ts';
import { normalizedHtml } from './normalized-text.ts';

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

/**
 * Normalize a semantic text value into the canonical HTML carrier.
 *
 * Note: this helper is intentionally side-car in Stage-1 and does not mutate
 * parser input/output. It is introduced for incremental migration only.
 */
export function normalizeSemanticText(
  text: string,
  sourceHint: NormalizedTextSourceHint = 'literal',
): NormalizedText {
  return normalizedHtml(escapeHtmlText(text), sourceHint);
}

/** Batch helper for fields that can be normalized independently. */
export function normalizeSemanticTexts(
  texts: readonly string[],
  sourceHint: NormalizedTextSourceHint = 'literal',
): NormalizedText[] {
  return texts.map((text) => normalizeSemanticText(text, sourceHint));
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

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
