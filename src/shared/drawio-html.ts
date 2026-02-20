/**
 * DrawIO HTML label adapter — runs AFTER creole processing.
 *
 * Converts semantic HTML output from creole into DrawIO-compatible XHTML:
 *   - newlines → <br>
 *   - DOMParser normalization → well-formed XHTML (close unclosed tags, fix malformed markup)
 */
export function toDrawioHtml(html: string): string {
  let s = html;

  // Convert newlines to <br> for multi-line labels
  s = s.replace(/\n/g, '<br>');

  // Normalize HTML via DOMParser: close unclosed tags, fix malformed markup
  const doc = new DOMParser().parseFromString(s, 'text/html');
  const body = doc.getElementsByTagName('body')[0];
  const serializer = new XMLSerializer();
  let xhtml = serializer.serializeToString(body);
  // Extract body content (strip <body ...> wrapper)
  const idx = xhtml.indexOf('>');
  if (idx !== -1) xhtml = xhtml.slice(idx + 1);
  if (xhtml.endsWith('</body>')) xhtml = xhtml.slice(0, -7);
  // Remove xmlns attributes added by XMLSerializer
  xhtml = xhtml.replace(/ xmlns="[^"]*"/g, '');

  return xhtml;
}
