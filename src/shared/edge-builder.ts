/**
 * Shared edge cell builder — generates mxCell XML for edges/connections.
 *
 * Centralizes:
 *   1. Label processing (raw PlantUML → Content.inline → HTML)
 *   2. mxCell XML envelope (id, value, style, source, target)
 *   3. mxGeometry (source/target points, waypoints, label offset)
 *   4. Sub-labels (cardinality markers at edge endpoints)
 *
 * Business modules supply raw label text and geometry —
 * all PlantUML unescape, Creole, and HTML conversion is handled here.
 */

import { escapeXml } from './xml-utils.ts';
import { Content } from './content.ts';

export interface EdgeCellSpec {
  id: string;
  /** Raw PlantUML label text — automatically processed via Content.inline(). */
  label?: string;
  /** Pre-built DrawIO style string. `html=1` is appended when label is non-empty. */
  style: string;
  /** Parent cell id (default "1"). */
  parent?: string;
  /** Source cell id. Omit to leave unbound. */
  source?: string;
  /** Target cell id. Omit to leave unbound. */
  target?: string;
  /** Edge geometry — points, waypoints, label offset. */
  geometry?: {
    /** mxGeometry x attribute (label relative position). */
    x?: number;
    /** mxGeometry y attribute (label relative position). */
    y?: number;
    /** Label offset mxPoint. */
    offset?: { x: number; y: number };
    /** Edge source point. */
    sourcePoint?: { x: number; y: number };
    /** Edge target point. */
    targetPoint?: { x: number; y: number };
    /** Interior waypoints. */
    waypoints?: { x: number; y: number }[];
  };
  /** Raw PlantUML text — cardinality marker at source end. */
  cardFrom?: string;
  /** Raw PlantUML text — cardinality marker at target end. */
  cardTo?: string;
  /** Font size for label / cardinality text (from theme). */
  fontSize?: number;
  /** Font family for label / cardinality text (from theme). */
  fontFamily?: string;
}

/**
 * Build one or more mxCell XML strings for an edge and its sub-labels.
 * Label text is automatically processed through the Content.inline() pipeline
 * (unescapePlantUml → creoleInline → finalizeHtml).
 */
export function buildEdgeCells(spec: EdgeCellSpec): string[] {
  const cells: string[] = [];

  // Process label through Content pipeline
  const fontOpts = { fontSize: spec.fontSize, fontFamily: spec.fontFamily };
  const htmlLabel = spec.label ? Content.inline(spec.label, fontOpts).html : '';
  const value = htmlLabel ? escapeXml(htmlLabel) : '';
  let style = spec.style;
  if (htmlLabel && !style.includes('html=1')) style += 'html=1;';
  // Inject font settings into edge style when provided
  if (spec.fontSize && !style.includes('fontSize=')) style += `fontSize=${spec.fontSize};`;
  if (spec.fontFamily && !style.includes('fontFamily=')) style += `fontFamily=${spec.fontFamily};`;

  const parent = spec.parent || '1';
  const srcAttr = spec.source != null ? ` source="${escapeXml(spec.source)}"` : '';
  const tgtAttr = spec.target != null ? ` target="${escapeXml(spec.target)}"` : '';

  // Build geometry inner XML
  const geo = spec.geometry;
  let geoContent = '';
  let geoAttrs = '';

  if (geo) {
    if (geo.x != null) geoAttrs += ` x="${geo.x}"`;
    if (geo.y != null) geoAttrs += ` y="${geo.y}"`;

    if (geo.offset) {
      geoContent += `<mxPoint x="${geo.offset.x}" y="${geo.offset.y}" as="offset"/>`;
    }
    if (geo.sourcePoint) {
      geoContent += `<mxPoint x="${geo.sourcePoint.x}" y="${geo.sourcePoint.y}" as="sourcePoint"/>`;
    }
    if (geo.targetPoint) {
      geoContent += `<mxPoint x="${geo.targetPoint.x}" y="${geo.targetPoint.y}" as="targetPoint"/>`;
    }
    if (geo.waypoints && geo.waypoints.length > 0) {
      const entries = geo.waypoints.map(p => `<mxPoint x="${p.x}" y="${p.y}"/>`).join('');
      geoContent += `<Array as="points">${entries}</Array>`;
    }
  }

  if (geoContent) {
    cells.push(
      `<mxCell id="${escapeXml(spec.id)}" value="${value}" style="${style}" edge="1" parent="${parent}"${srcAttr}${tgtAttr}>`
      + `<mxGeometry relative="1" as="geometry"${geoAttrs}>`
      + geoContent
      + `</mxGeometry>`
      + `</mxCell>`
    );
  } else {
    cells.push(
      `<mxCell id="${escapeXml(spec.id)}" value="${value}" style="${style}" edge="1" parent="${parent}"${srcAttr}${tgtAttr}>`
      + `<mxGeometry relative="1" as="geometry"${geoAttrs}/>`
      + `</mxCell>`
    );
  }

  // Sub-labels (cardinality markers at edge endpoints)
  const cardFontStyle = (spec.fontSize ? `fontSize=${spec.fontSize};` : '') + (spec.fontFamily ? `fontFamily=${spec.fontFamily};` : '');
  if (spec.cardFrom) {
    const cardHtml = escapeXml(Content.inline(spec.cardFrom, fontOpts).html);
    cells.push(
      `<mxCell value="${cardHtml}" style="edgeLabel;html=1;align=left;verticalAlign=bottom;resizable=0;points=[];${cardFontStyle}" vertex="1" connectable="0" parent="${escapeXml(spec.id)}">`
      + `<mxGeometry x="-1" y="0" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry>`
      + `</mxCell>`
    );
  }
  if (spec.cardTo) {
    const cardHtml = escapeXml(Content.inline(spec.cardTo, fontOpts).html);
    cells.push(
      `<mxCell value="${cardHtml}" style="edgeLabel;html=1;align=left;verticalAlign=bottom;resizable=0;points=[];${cardFontStyle}" vertex="1" connectable="0" parent="${escapeXml(spec.id)}">`
      + `<mxGeometry x="1" y="0" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry>`
      + `</mxCell>`
    );
  }

  return cells;
}
