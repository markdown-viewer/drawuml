/**
 * Bracket body node primitive — sizing, styling, and rendering for
 * deployment-diagram-like entities declared with bracket body syntax:
 *   node n [ body text ]
 *   rectangle r [ body text ]
 *   file f [ body text ]
 *   person p [ body text ]
 *   ...
 *
 * Content processing is delegated to Content.richBody() which handles
 * block-level Creole including structural separator extraction.
 * Separators are drawn as proper DrawIO line mxCells (same mechanism as classNode).
 *
 * Shape style and content offsets are obtained from the corresponding
 * RichRenderer via getShapeInfo(), eliminating duplicate style definitions.
 */

import { Content, richTextStyle } from '../shared/content.ts';
import { mxVertex } from '../shared/xml-utils.ts';
import { parseNodeStyle, darkenColor } from '../shared/color-utils.ts';
import { RichBodyRenderer } from './renderer.ts';
import { RichRenderer } from './shapes/rich-renderer.ts';
import { DEFAULT_FILL, COLOR_DARK, RECT_ARC_SIZE } from '../shared/theme.ts';
import { createRenderer, hasRenderer, registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { ContentBox } from '../shared/content.ts';
import type { BodyLine } from '../model/class-model.ts';

// ---------------------------------------------------------------------------
// Shape fragment extraction
// ---------------------------------------------------------------------------

/** Style keys that belong to container layout, not shape identity. */
const COMMON_STYLE_KEYS = new Set([
  'whiteSpace', 'html', 'fontStyle', 'fontSize', 'align', 'verticalAlign',
  'spacingTop', 'spacingLeft', 'spacingRight', 'spacingBottom',
  'fillColor', 'strokeColor', 'strokeWidth', 'fontColor',
  'collapsible', 'container', 'overflow', 'swimlaneHead', 'swimlaneBody',
]);

/**
 * Extract shape-specific style fragment from a full RichRenderer style.
 * Strips common layout properties, keeping only the shape identity
 * (e.g. 'shape=cube;size=10;').
 */
function extractShapeFragment(fullStyle: string): string {
  const parts = fullStyle.split(';').filter(p => {
    if (!p) return false;
    const key = p.split('=')[0];
    return !COMMON_STYLE_KEYS.has(key);
  });
  return parts.length > 0 ? parts.join(';') + ';' : `rounded=1;absoluteArcSize=1;arcSize=${RECT_ARC_SIZE};`;
}

// ---------------------------------------------------------------------------
// Internal style builders
// ---------------------------------------------------------------------------

/** Style string for rich text blocks inside a bracket body container. */
function textStyle(): string {
  return richTextStyle(10, 10);
}

/** Style string for separator lines inside a bracket body container. */
function sepStyle(): string {
  return [
    'line', 'strokeWidth=1', 'align=left', 'verticalAlign=middle',
    'spacingTop=-1', 'spacingLeft=3', 'spacingRight=3',
    'rotatable=0', 'labelPosition=right', 'points=[]',
  ].join(';') + ';';
}

/** Generate container style string for a bracket body node mxCell. */
function containerStyle(shapeFragment: string, topOffset: number, nodeStyle?: string | null): string {
  const parsed = parseNodeStyle(nodeStyle);
  const base = [
    'html=1', 'whiteSpace=wrap', 'container=1',
    shapeFragment.replace(/;$/, ''),
    `fillColor=${DEFAULT_FILL}`, `strokeColor=${COLOR_DARK}`, 'strokeWidth=0.5',
    'align=left', 'verticalAlign=top',
    'spacingLeft=10', 'spacingRight=10', `spacingTop=${6 + topOffset}`, 'spacingBottom=6',
    'overflow=hidden',
  ];

  if (parsed) {
    if (parsed.fillColor) {
      const idx = base.findIndex(s => s.startsWith('fillColor='));
      if (idx >= 0) base[idx] = `fillColor=${parsed.fillColor}`;
      if (!parsed.strokeColor) {
        const si = base.findIndex(s => s.startsWith('strokeColor='));
        if (si >= 0) base[si] = `strokeColor=${darkenColor(parsed.fillColor)}`;
      }
    }
    if (parsed.strokeColor) {
      const idx = base.findIndex(s => s.startsWith('strokeColor='));
      if (idx >= 0) base[idx] = `strokeColor=${parsed.strokeColor}`;
    }
    if (parsed.textColor) base.push(`fontColor=${parsed.textColor}`);
    if (parsed.lineStyle === 'dashed') base.push('dashed=1');
    else if (parsed.lineStyle === 'dotted') base.push('dashed=1', 'dashPattern=1 2');
    else if (parsed.lineStyle === 'bold') {
      const idx = base.findIndex(s => s.startsWith('strokeWidth='));
      if (idx >= 0) base[idx] = 'strokeWidth=2';
    }
  }

  return base.join(';') + ';';
}

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class BracketNodeRenderer extends RichBodyRenderer {
  private _contentYOffset: number;
  private _extraPadY: number;
  private _extraPadX: number;

  constructor(desc: RenderDescriptor) {
    super(desc.id);
    const ctype = (desc.stereotype || '').toLowerCase();
    this.content = Content.richBody((desc.bodyLines || []).map(l => typeof l === 'string' ? l : l.text));

    // Get shape info from the corresponding RichRenderer
    let shapeFragment = `rounded=1;absoluteArcSize=1;arcSize=${RECT_ARC_SIZE};`;
    let contentYOffset = 0;
    let extraPadY = 0;
    let extraPadX = 0;
    if (hasRenderer(ctype)) {
      const sr = createRenderer(ctype, desc);
      if (sr instanceof RichRenderer) {
        const info = sr.getShapeInfo();
        shapeFragment = extractShapeFragment(info.style);
        contentYOffset = info.contentYOffset;
        extraPadY = info.extraPadY;
        extraPadX = info.extraPadX;
      }
    }

    this._contentYOffset = contentYOffset;
    this._extraPadY = extraPadY;
    this._extraPadX = extraPadX;
    this.style = containerStyle(shapeFragment, contentYOffset, desc.style);
    this.fillColor = this.style.match(/fillColor=([^;]*)/)?.[1] || DEFAULT_FILL;
    this.strokeColor = this.style.match(/strokeColor=([^;]*)/)?.[1] || COLOR_DARK;
  }

  protected doMeasure() {
    const size = this.content.measure();
    // Add padding: spacingLeft+spacingRight (10+10) and spacingTop+spacingBottom (6+6)
    return {
      width: Math.max(size.width + 20 + this._extraPadX, 60),
      height: Math.max(size.height + 12 + this._extraPadY, 30),
    };
  }

  render(box: ContentBox) {
    const cells: string[] = [];
    if (this.content.hasSeparators) {
      cells.push(mxVertex({
        id: this.id, value: '', style: this.style,
        parent: this.parentId || '1',
        x: box.x, y: box.y, width: box.width, height: box.height,
      }));
      cells.push(...this.content.renderChildren(this.id, box.width, {
        rowStyle: this.getRowStyle(),
        separatorStyle: this.getSeparatorStyle(),
        fillColor: this.fillColor,
        strokeColor: this.strokeColor,
      }, this._contentYOffset));
    } else {
      cells.push(mxVertex({
        id: this.id, value: this.content.html, style: this.style,
        parent: this.parentId || '1',
        x: box.x, y: box.y, width: box.width, height: box.height,
      }));
    }
    return cells;
  }

  protected getRowStyle() { return textStyle(); }
  protected getSeparatorStyle() { return sepStyle(); }
}

/** Register bracket-node renderer into global registry. */
export function registerBracketNodeRenderer(): void {
  registerRenderer('bracket', (desc: RenderDescriptor) => new BracketNodeRenderer(desc));
}

