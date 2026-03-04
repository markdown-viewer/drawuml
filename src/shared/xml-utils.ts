/**
 * Shared XML utilities for DrawIO generation.
 */

/**
 * Round a number to at most 4 decimal places for XML output.
 * Strips trailing zeroes so e.g. 10.0000 → "10".
 */
export function n4(v: number): string {
  return +v.toFixed(4) + '';
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '&#10;');
}

/**
 * Prefix a semantic-model id so it never collides with JavaScript
 * built-in property names (toString, constructor, map, keys, values …).
 *
 * draw.io's mxCodec stores decoded cells in a plain `{}` object.
 * Accessing `objects[id]` for ids like "map" or "toString" returns
 * the built-in prototype method instead of `undefined`, which causes
 * `d.setId is not a function` at decode time.
 *
 * Root cell ids "0" and "1" are hard-coded by draw.io and must NOT
 * be prefixed.
 */
export function cellId(id: string): string {
  if (id === '0' || id === '1') return id;
  return '_' + id;
}

/**
 * Build a vertex mxCell XML string with mxGeometry.
 * `id`, `value` and `parent` are auto-escaped.
 * Cell ids are automatically prefixed via `cellId()` to avoid
 * collisions with JavaScript built-in property names in draw.io.
 */
export function mxVertex(opts: {
  id?: string;
  value: string;
  style: string;
  parent: string;
  x?: number;
  y: number;
  width: number;
  height: number;
}): string {
  const idAttr = opts.id != null ? ` id="${escapeXml(cellId(opts.id))}"` : '';
  const value = escapeXml(opts.value);
  const parent = escapeXml(cellId(opts.parent));
  const xAttr = opts.x != null ? ` x="${n4(opts.x)}"` : '';
  const yAttr = ` y="${n4(opts.y)}"`;
  return `<mxCell${idAttr} value="${value}" style="${opts.style}" vertex="1" parent="${parent}">`
    + `<mxGeometry${xAttr}${yAttr} width="${n4(opts.width)}" height="${n4(opts.height)}" as="geometry"/>`
    + `</mxCell>`;
}

/** Default DrawIO page width. */
export const PAGE_WIDTH = 850;
/** Default DrawIO page height. */
export const PAGE_HEIGHT = 1100;

/**
 * Wrap an array of mxCell strings into a complete mxfile XML document.
 */
export function wrapMxfile(cells: string[], options?: {
  pageWidth?: number;
  pageHeight?: number;
  diagramId?: string;
  diagramName?: string;
}) {
  const {
    pageWidth = PAGE_WIDTH,
    pageHeight = PAGE_HEIGHT,
    diagramId = 'diagram-1',
    diagramName = 'Diagram',
  } = options || {};

  return `<mxfile>
  <diagram id="${diagramId}" name="${diagramName}">
    <mxGraphModel dx="1216" dy="1130" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">
      <root>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

/**
 * Build a child text mxCell that fills the parent container, used
 * to render a label inside a shape whose drawio2svg handler may not
 * natively render cell value text.
 *
 * The generated cell uses the parent shape as its parent and occupies
 * the full container area so the text is centred inside the shape.
 */
export function mxContentLabel(parentId: string, label: string, width: number, height: number, fontStyle: string = '', yOffset: number = 0, xOffset: number = 0, rightPad: number = 0, bottomPad: number = 0): string {
  const style = `text;html=1;align=center;verticalAlign=middle;`
    + `resizable=0;points=[];autosize=0;strokeColor=none;fillColor=none;`
    + fontStyle;
  return mxVertex({
    id: `${parentId}__label`,
    value: label,
    style,
    parent: parentId,
    x: xOffset, y: yOffset, width: width - xOffset - rightPad, height: height - yOffset - bottomPad,
  });
}
