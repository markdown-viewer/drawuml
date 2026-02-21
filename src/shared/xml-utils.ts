/**
 * Shared XML utilities for DrawIO generation.
 */

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
 * Build a vertex mxCell XML string with mxGeometry.
 * `id`, `value` and `parent` are auto-escaped.
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
  const idAttr = opts.id != null ? ` id="${escapeXml(opts.id)}"` : '';
  const value = escapeXml(opts.value);
  const parent = escapeXml(opts.parent);
  const xAttr = opts.x != null ? ` x="${opts.x}"` : '';
  const yAttr = ` y="${opts.y}"`;
  return `<mxCell${idAttr} value="${value}" style="${opts.style}" vertex="1" parent="${parent}">`
    + `<mxGeometry${xAttr}${yAttr} width="${opts.width}" height="${opts.height}" as="geometry"/>`
    + `</mxCell>`;
}

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
    pageWidth = 850,
    pageHeight = 1100,
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
export function mxContentLabel(parentId: string, label: string, width: number, height: number, fontStyle: string = '', yOffset: number = 0, xOffset: number = 0): string {
  const style = `text;html=1;align=center;verticalAlign=middle;`
    + `resizable=0;points=[];autosize=0;strokeColor=none;fillColor=none;`
    + fontStyle;
  return mxVertex({
    id: `${parentId}__label`,
    value: label,
    style,
    parent: parentId,
    x: xOffset, y: yOffset, width: width - xOffset, height: height - yOffset,
  });
}
