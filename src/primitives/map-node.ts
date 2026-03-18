/**
 * Map node primitive — sizing, styling, and rendering for PlantUML "map" blocks.
 *
 * Renders map entries as a two-column table using drawio-native
 * partialRectangle cells (key column | value column) inside a
 * swimlane container, matching the entity_relationship.drawio pattern.
 */

import { TextBlock } from '../shared/text-block.ts';
import { buildTitleHtml, classNodeStyle } from './class-node.ts';
import { mxVertex, escapeXml, cellId, n4 } from '../shared/xml-utils.ts';
import { Renderer } from './renderer.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor, NodeDescriptor } from './registry.ts';
import type { ContentBox } from '../shared/content-types.ts';
import type { LayoutGraphNode, LayoutPort } from '../layout/layout-graph.ts';
import type { Theme } from '../shared/theme.ts';

// ---------------------------------------------------------------------------
// Scaled metrics helpers
// ---------------------------------------------------------------------------

/** Row height for each map entry — scales with fontSize. */
function mapRowHeight(theme: Theme): number {
  return theme.rowH;
}

/** Horizontal padding inside each cell — scales with fontSize. */
function cellPadX(theme: Theme): number {
  return theme.cornerClip;
}

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
  private titleBlock: TextBlock;
  private _keyColWidth = 0;
  private _titleH = 0;

  constructor(node: NodeDescriptor) {
    super(node.id, node.theme);
    this.node = node;
    this.entries = (node.mapEntries || []) as MapEntry[];
    const titleHtml = buildTitleHtml(node);
    this.titleBlock = TextBlock.fromHtml(titleHtml, { size: this.theme.fontSize, family: this.theme.fontFamily });
  }

  protected doMeasure() {
    const rowH = mapRowHeight(this.theme);
    const padX = cellPadX(this.theme);
    const titleMinExtra = this.theme.titlePadX;           // minimum extra width added to title text
    const titlePadY = this.theme.contentPad;                      // title vertical padding

    // Title dimensions
    const titleSize = this.titleBlock.measure();
    const titleW = titleSize.width + titleMinExtra;
    const titleH = (titleSize.height || this.theme.fontSize) + titlePadY;
    this._titleH = titleH;

    // Measure key and value columns
    let maxKeyW = 0;
    let maxValW = 0;
    const plainFont = { size: this.theme.fontSize, family: this.theme.fontFamily };
    for (const entry of this.entries) {
      const km = TextBlock.plain(entry.key, plainFont).measure();
      const vm = TextBlock.plain(entry.value || '', plainFont).measure();
      maxKeyW = Math.max(maxKeyW, Math.ceil(km.width));
      maxValW = Math.max(maxValW, Math.ceil(vm.width));
    }

    const keyColW = maxKeyW + padX * 2;
    const valColW = maxValW + padX * 2;
    this._keyColWidth = keyColW;

    const bodyW = keyColW + valColW + this.theme.edgeGap;
    const totalW = Math.max(titleW, bodyW);
    const bodyH = this.entries.length * rowH;
    const totalH = titleH + bodyH;

    return { width: totalW, height: totalH };
  }

  render(box: ContentBox) {
    const cells: string[] = [];
    const size = this.measure();
    const style = classNodeStyle(this.node, this._titleH, this.theme);
    const rowH = mapRowHeight(this.theme);
    const padX = cellPadX(this.theme);
    const sw = this.theme.strokeWidth;
    const fs = this.theme.fontSize;
    const ff = this.theme.fontFamily;

    // Common font/stroke suffix for partialRectangle cells
    const fontStyle = `fontSize=${fs};fontFamily=${ff};strokeWidth=${sw};`;

    // Swimlane container
    cells.push(mxVertex({
      id: this.node.id,
      value: this.titleBlock.html,
      style,
      parent: this.parentId || '1',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    }));

    // Map entry rows as partialRectangle cells
    let y = this._titleH;
    const entries = this.entries;
    const keyColW = this._keyColWidth;
    const plainFont = { size: fs, family: ff };

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
          `spacingLeft=${padX}`,
          `spacingRight=${padX}`,
          'whiteSpace=wrap',
          'overflow=hidden',
          'rotatable=0',
          'points=[[0,0.5],[1,0.5]]',
          'portConstraint=eastwest',
        ].join(';') + ';' + fontStyle;

        cells.push(
          `<mxCell id="${escapeXml(cellId(rowId))}" value="${escapeXml(TextBlock.plain(entry.key, plainFont).html)}" style="${rowStyle}" vertex="1" parent="${escapeXml(cellId(this.node.id))}">`
          + `<mxGeometry y="${n4(y)}" width="${n4(box.width)}" height="${n4(rowH)}" as="geometry"/>`
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
          `spacingLeft=${keyColW + padX}`,
          `spacingRight=${padX}`,
          'whiteSpace=wrap',
          'overflow=hidden',
          'rotatable=0',
          'points=[[0,0.5],[1,0.5]]',
          'portConstraint=eastwest',
          'dropTarget=0',
        ].join(';') + ';' + fontStyle;

        cells.push(
          `<mxCell id="${escapeXml(cellId(rowId))}" value="${escapeXml(TextBlock.plain(entry.value || '', plainFont).html)}" style="${rowStyle}" vertex="1" parent="${escapeXml(cellId(this.node.id))}">`
          + `<mxGeometry y="${n4(y)}" width="${n4(box.width)}" height="${n4(rowH)}" as="geometry"/>`
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
          `spacingLeft=${padX}`,
          `spacingRight=${padX}`,
          'whiteSpace=wrap',
          'overflow=hidden',
          'rotatable=0',
          'points=[]',
          'portConstraint=eastwest',
          'part=1',
        ].join(';') + ';' + fontStyle;

        cells.push(
          `<mxCell id="${escapeXml(cellId(keyId))}" value="${escapeXml(TextBlock.plain(entry.key, plainFont).html)}" style="${keyStyle}" vertex="1" connectable="0" parent="${escapeXml(cellId(rowId))}">`
          + `<mxGeometry width="${n4(keyColW)}" height="${n4(rowH)}" as="geometry"/>`
          + `</mxCell>`
        );
      }

      y += rowH;
    }

    return cells;
  }

  /**
   * Build layout graph node with ports derived from map entry rows.
   */
  override buildLayoutGraph(): LayoutGraphNode {
    const node = super.buildLayoutGraph();
    const titleH = this._titleH || (this.measure() && this._titleH);
    const rowH = mapRowHeight(this.theme);
    const ports: LayoutPort[] = [];
    let y = titleH;

    for (const entry of this.entries) {
      ports.push({
        id: `${this.id}::${entry.key}`,
        width: node.width,
        height: rowH,
        y,
      });
      y += rowH;
    }

    if (ports.length > 0) node.ports = ports;
    return node;
  }
}

/** Register map-node renderer into global registry. */
export function registerMapNodeRenderer(): void {
  registerRenderer('map', (desc: RenderDescriptor) => new MapNodeRenderer(desc as NodeDescriptor));
}
