/**
 * Escape plain text for HTML.
 *
 * Spacing preservation is applied later on text nodes in finalizeHtml(), so
 * this helper only performs HTML escaping.
 */
export function escapeHtmlTextPreserveSpaces(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Preserve spaces in rendered HTML text nodes.
 *
 * DrawIO labels are measured by our pipeline and rendered without relying on
 * browser whitespace collapsing, so plain spaces can be normalized to NBSP.
 */
export function preserveTextNodeSpaces(text: string): string {
  return String(text || '')
    .replace(/\t/g, '\u00A0\u00A0\u00A0\u00A0')
    .replace(/ /g, '\u00A0');
}