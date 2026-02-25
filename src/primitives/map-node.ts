/**
 * Map node primitive — sizing, styling, and rendering for PlantUML "map" blocks.
 *
 * Renders map entries as a two-column table using drawio-native
 * partialRectangle cells (key column | value column) inside a
 * swimlane container, matching the entity_relationship.drawio pattern.
 */

import { measureText } from '@markdown-viewer/text-measure';
import { Content } from '../shared/content.ts';
import { buildTitleHtml, classNodeStyle } from './class-node.ts';
import { mxVertex, escapeXml } from '../shared/xml-utils.ts';
import { Renderer } from './renderer.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor, NodeDescriptor } from './registry.ts';
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '../shared/theme.ts';
import type { ContentBox } from '../shared/content.ts';
import type { LayoutGraphNode, LayoutPort } from '../layout/layout-graph.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Row height for each map entry. */
const MAP_ROW_HEIGHT = 26;

/** Horizontal padding inside each cell. */
const CELL_PAD_X = 6;

/** Extra horizontal gap between columns (for the vertical divider). */
const COL_GAP = 4;

/** Top padding above the first map row (below the title separator). */
const BODY_TOP_PAD = 0;

// ---------------------------------------------------------------------------
// Map entry type
// ---------------------------------------------------------------------------

export interface MapEntry {
  key: string;
  value: string;
  linked?: boolean;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

class MapNodeRenderer extends Renderer {
  private node: NodeDescriptor;
  private entries: MapEntry[];
  private titleContent: Content;
  private _keyColWidth = 0;
  private _titleH = 0;

  constructor(node: NodeDescriptor) {
    super(node.id);
    this.node = node;
    this.entries = (node.mapEntries || []) as MapEntry[];
    const titleHtml = buildTitleHtml(node);
    this.titleContent = Content.inline(titleHtml);
  }

  protected doMeasure() {
    // Title dimensions
    const titleSize = this.titleContent.measure();
    const titleW = titleSize.width + 40; // paddingX like class nodes
    const titleH = (titleSize.height || 12) + 12; // titlePaddingY
    this._titleH = titleH;

    // Measure key and value columns
    let maxKeyW = 0;
    let maxValW = 0;
    for (const entry of this.entries) {
      const km = measureText(entry.key, DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY, 'normal', 'normal', false);
      const vm = measureText(entry.value || '', DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY, 'normal', 'normal', false);
      maxKeyW = Math.max(maxKeyW, Math.ceil(km.width));
      maxValW = Math.max(maxValW, Math.ceil(vm.width));
    }

    const keyColW = maxKeyW + CELL_PAD_X * 2;
    const valColW = maxValW + CELL_PAD_X * 2;
    this._keyColWidth = keyColW;

    const bodyW = keyColW + valColW + COL_GAP;
    const totalW = Math.max(titleW, bodyW);
    const bodyH = this.entries.length * MAP_ROW_HEIGHT + BODY_TOP_PAD;
    const totalH = titleH + bodyH;

    return { width: totalW, height: totalH };
  }

  render(box: ContentBox) {
    const cells: string[] = [];
    const size = this.measure();
    const style = classNodeStyle(this.node, this._titleH);

    // Swimlane container
    cells.push(mxVertex({
      id: this.node.id,
      value: this.titleContent.html,
      style,
      parent: this.parentId || '1',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    }));

    // Map entry rows as partialRectangle cells
    let y = this._titleH + BODY_TOP_PAD;
    const entries = this.entries;
    const keyColW = this._keyColWidth;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const rowId = `${this.node.id}::${entry.key}`;
      const isLast = i === entries.length - 1;
      const rowBottom = isLast ? 0 : 1;

      if (entry.linked) {
        // Linked entry (*->): key spans full width, centered, no vertical divider
        const rowStyle = [
          'shape=partialRectangle',
          'top=0', 'left=0', 'right=0', `bottom=${rowBottom}`,
          'html=1',
          'fillColor=none',
          'align=center',
          'verticalAlign=middle',
          'spacingLeft=4',
          'spacingRight=4',
          'whiteSpace=wrap',
          'overflow=hidden',
          'rotatable=0',
          'points=[[0,0.5],[1,0.5]]',
          'portConstraint=eastwest',
        ].join(';') + ';';

        cells.push(
          `<mxCell id="${escapeXml(rowId)}" value="${escapeXml(entry.key)}" style="${rowStyle}" vertex="1" parent="${escapeXml(this.node.id)}">`
          + `<mxGeometry y="${y}" width="${box.width}" height="${MAP_ROW_HEIGHT}" as="geometry"/>`
          + `</mxCell>`
        );
      } else {
        // Normal entry (=>): two-column layout with key column + value column
        const rowStyle = [
          'shape=partialRectangle',
          'top=0', 'left=0', 'right=0', `bottom=${rowBottom}`,
          'html=1',
          'fillColor=none',
          'align=left',
          'verticalAlign=middle',
          `spacingLeft=${keyColW + CELL_PAD_X}`,
          `spacingRight=${CELL_PAD_X}`,
          'whiteSpace=wrap',
          'overflow=hidden',
          'rotatable=0',
          'points=[[0,0.5],[1,0.5]]',
          'portConstraint=eastwest',
          'dropTarget=0',
        ].join(';') + ';';

        cells.push(
          `<mxCell id="${escapeXml(rowId)}" value="${escapeXml(entry.value)}" style="${rowStyle}" vertex="1" parent="${escapeXml(this.node.id)}">`
          + `<mxGeometry y="${y}" width="${box.width}" height="${MAP_ROW_HEIGHT}" as="geometry"/>`
          + `</mxCell>`
        );

        // Key column cell (nested inside row, right border as vertical divider, centered)
        const keyId = `${rowId}__key`;
        const keyStyle = [
          'shape=partialRectangle',
          'top=0', 'left=0', 'bottom=0',
          'html=1',
          'fillColor=none',
          'align=center',
          'verticalAlign=middle',
          `spacingLeft=${CELL_PAD_X}`,
          `spacingRight=${CELL_PAD_X}`,
          'whiteSpace=wrap',
          'overflow=hidden',
          'rotatable=0',
          'points=[]',
          'portConstraint=eastwest',
          'part=1',
        ].join(';') + ';';

        cells.push(
          `<mxCell id="${escapeXml(keyId)}" value="${escapeXml(entry.key)}" style="${keyStyle}" vertex="1" connectable="0" parent="${escapeXml(rowId)}">`
          + `<mxGeometry width="${keyColW}" height="${MAP_ROW_HEIGHT}" as="geometry"/>`
          + `</mxCell>`
        );
      }

      y += MAP_ROW_HEIGHT;
    }

    return cells;
  }

  /**
   * Build layout graph node with ports derived from map entry rows.
   */
  override buildLayoutGraph(): LayoutGraphNode {
    const node = super.buildLayoutGraph();
    const titleH = this._titleH || (this.measure() && this._titleH);
    const ports: LayoutPort[] = [];
    let y = titleH + BODY_TOP_PAD;

    for (const entry of this.entries) {
      ports.push({
        id: `${this.id}::${entry.key}`,
        width: node.width,
        height: MAP_ROW_HEIGHT,
        y,
      });
      y += MAP_ROW_HEIGHT;
    }

    if (ports.length > 0) node.ports = ports;
    return node;
  }
}

/** Register map-node renderer into global registry. */
export function registerMapNodeRenderer(): void {
  registerRenderer('map', (desc: RenderDescriptor) => new MapNodeRenderer(desc as NodeDescriptor));
}
