/**
 * Canonical text carrier after normalization.
 *
 * Stage-1 contract: keep a single measurable representation (`kind: 'html'`)
 * while preserving source hints for incremental migration.
 */
export type NormalizedTextKind = 'html';

export type NormalizedTextSourceHint = 'inline' | 'block' | 'literal';

export interface NormalizedText {
  readonly html: string;
  readonly kind: NormalizedTextKind;
  readonly sourceHint?: NormalizedTextSourceHint;
}

/** Build a normalized text payload from an already-normalized HTML string. */
export function normalizedHtml(
  html: string,
  sourceHint?: NormalizedTextSourceHint,
): NormalizedText {
  return { html, kind: 'html', sourceHint };
}
