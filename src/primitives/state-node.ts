/**
 * State node primitives — sizing and rendering for state-diagram entities.
 *
 * Node types:
 *   - state_start : filled black circle (initial pseudo-state)
 *   - state_end   : double circle (bull's eye, final pseudo-state)
 *   - state_fork / state_join : thick horizontal bar
 *   - state_choice: small diamond (decision point)
 *   - state       : rounded rectangle — delegates to shared Content system
 */

import { Content } from '../shared/content.ts';
import { escapeXml, mxVertex } from '../shared/xml-utils.ts';
import { measureText } from '@markdown-viewer/text-measure';
import { Renderer, SwimlaneRenderer } from './renderer.ts';
import { buildClusterDotBlock } from './group.ts';
import type { DotContext } from './renderer.ts';
import { textRowStyle, separatorStyle } from './class-node.ts';
import { parseNodeStyle, darkenColor } from '../shared/color-utils.ts';
import { DEFAULT_FONT_FAMILY, SMALL_FONT_SIZE, DEFAULT_FILL, COLOR_DARK } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { ContentBox, FinalizeBodyCtx } from '../shared/content.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const START_DIAMETER = 28;
const END_OUTER = 22;

const FORK_WIDTH = 80;
const FORK_HEIGHT = 6;

const CHOICE_SIZE = 24;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const START_STYLE = 'shape=startState;whiteSpace=wrap;html=1;aspect=fixed;'
  + `fillColor=${COLOR_DARK};strokeColor=${COLOR_DARK};strokeWidth=1;`;

const END_STYLE = 'shape=endState;whiteSpace=wrap;html=1;aspect=fixed;'
  + `fillColor=${COLOR_DARK};strokeColor=${COLOR_DARK};strokeWidth=1;`;

const FORK_STYLE = `line;html=1;strokeWidth=6;strokeColor=${COLOR_DARK};`
  + `fillColor=${COLOR_DARK};perimeter=linePerimeter;`;

const CHOICE_STYLE = 'rhombus;whiteSpace=wrap;html=1;'
  + `fillColor=${DEFAULT_FILL};strokeColor=${COLOR_DARK};strokeWidth=0.5;`;

const CHOICE_LABEL_GAP = 2; // gap between label and diamond
const CHOICE_LABEL_STYLE = `text;html=1;align=center;verticalAlign=bottom;`
  + `fontSize=${SMALL_FONT_SIZE};fontColor=${COLOR_DARK};`
  + `resizable=0;points=[];autosize=1;strokeColor=none;fillColor=none;`;

// ---------------------------------------------------------------------------
// Start / End renderers
// ---------------------------------------------------------------------------

class StateStartRenderer extends Renderer {
  private node: { id: string };
  constructor(node: { id: string }) { super(node.id); this.node = node; }

  protected doMeasure() {
    return { width: START_DIAMETER, height: START_DIAMETER };
  }

  render(box: ContentBox) {
    const d = START_DIAMETER;
    const x = box.x + Math.round((box.width - d) / 2);
    const y = box.y + Math.round((box.height - d) / 2);
    return [mxVertex({ id: this.node.id, value: '', style: START_STYLE, parent: this.parentId || '1', x, y, width: d, height: d })];
  }
}

class StateEndRenderer extends Renderer {
  private node: { id: string };
  constructor(node: { id: string }) { super(node.id); this.node = node; }

  protected doMeasure() {
    return { width: END_OUTER, height: END_OUTER };
  }

  render(box: ContentBox) {
    const d = END_OUTER;
    const x = box.x + Math.round((box.width - d) / 2);
    const y = box.y + Math.round((box.height - d) / 2);
    return [mxVertex({ id: this.node.id, value: '', style: END_STYLE, parent: this.parentId || '1', x, y, width: d, height: d })];
  }
}

// ---------------------------------------------------------------------------
// Fork / Join renderer
// ---------------------------------------------------------------------------

class StateForkJoinRenderer extends Renderer {
  private node: { id: string };
  constructor(node: { id: string }) { super(node.id); this.node = node; }

  protected doMeasure() {
    return { width: FORK_WIDTH, height: FORK_HEIGHT };
  }

  render(box: ContentBox) {
    const w = FORK_WIDTH;
    const h = FORK_HEIGHT;
    const x = box.x + Math.round((box.width - w) / 2);
    const y = box.y + Math.round((box.height - h) / 2);
    return [mxVertex({ id: this.node.id, value: '', style: FORK_STYLE, parent: this.parentId || '1', x, y, width: w, height: h })];
  }
}

// ---------------------------------------------------------------------------
// Choice renderer
// ---------------------------------------------------------------------------

class StateChoiceRenderer extends Renderer {
  private node: RenderDescriptor;
  private label: string;
  private labelWidth: number;
  private labelHeight: number;

  constructor(node: RenderDescriptor) {
    super(node.id);
    this.node = node;
    this.label = node.label || '';
    if (this.label) {
      const meas = measureText(this.label, SMALL_FONT_SIZE, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
      this.labelWidth = Math.ceil(meas.width);
      this.labelHeight = Math.ceil(meas.height);
    } else {
      this.labelWidth = 0;
      this.labelHeight = 0;
    }
  }

  protected doMeasure() {
    // Label sits to the left of the diamond
    const w = CHOICE_SIZE + (this.label ? this.labelWidth + 4 : 0);
    const h = Math.max(CHOICE_SIZE, this.labelHeight);
    return { width: w, height: h };
  }

  render(box: ContentBox) {
    const d = CHOICE_SIZE;
    const cells: string[] = [];

    if (this.label) {
      // Label to the left of diamond center line (avoid overlap with incoming edge)
      const dx = box.x + Math.round((box.width - d) / 2);
      const dy = box.y + Math.round((box.height - d) / 2);
      const labelX = dx - this.labelWidth - 4;
      const labelY = dy + Math.round((d - this.labelHeight) / 2);
      cells.push(mxVertex({
        id: `${this.node.id}__label`,
        value: this.label,
        style: CHOICE_LABEL_STYLE,
        parent: this.parentId || '1',
        x: labelX, y: labelY, width: this.labelWidth, height: this.labelHeight,
      }));
      // Diamond centered in box
      cells.push(mxVertex({ id: this.node.id, value: '', style: CHOICE_STYLE, parent: this.parentId || '1', x: dx, y: dy, width: d, height: d }));
    } else {
      // No label — just diamond centered
      const x = box.x + Math.round((box.width - d) / 2);
      const y = box.y + Math.round((box.height - d) / 2);
      cells.push(mxVertex({ id: this.node.id, value: '', style: CHOICE_STYLE, parent: this.parentId || '1', x, y, width: d, height: d }));
    }

    return cells;
  }
}

// ---------------------------------------------------------------------------
// State (rounded rectangle) renderer — delegates to shared Content system
// ---------------------------------------------------------------------------

/** Generate swimlane style for a state node with optional color. */
function stateNodeStyle(startSize: number, style?: string | null): string {
  const parsed = parseNodeStyle(style);
  const base = [
    'swimlane', 'html=1', 'rounded=1', 'absoluteArcSize=1', 'arcSize=10',
    'align=center', 'verticalAlign=middle',
    'childLayout=stackLayout', 'horizontal=1',
    `startSize=${startSize}`,
    'horizontalStack=0', 'resizeParent=1', 'resizeLast=0',
    'collapsible=0', 'marginBottom=0',
    'strokeWidth=0.5',
    'fontStyle=0',
  ];
  if (parsed) {
    if (parsed.fillColor) {
      base.push(`fillColor=${parsed.fillColor}`);
      if (!parsed.strokeColor) base.push(`strokeColor=${darkenColor(parsed.fillColor)}`);
    }
    if (parsed.strokeColor) base.push(`strokeColor=${parsed.strokeColor}`);
    if (parsed.textColor) base.push(`fontColor=${parsed.textColor}`);
    if (parsed.lineStyle === 'dashed') base.push('dashed=1');
    else if (parsed.lineStyle === 'dotted') base.push('dashed=1', 'dashPattern=1 2');
    else if (parsed.lineStyle === 'bold') base.push('strokeWidth=2');
  }
  if (!base.some(s => s.startsWith('fillColor='))) base.push(`fillColor=${DEFAULT_FILL}`);
  if (!base.some(s => s.startsWith('strokeColor='))) base.push(`strokeColor=${COLOR_DARK}`);
  return base.join(';') + ';';
}

class StateNodeRenderer extends SwimlaneRenderer {
  private nodeLabel: string;
  private nodeStyle?: string | null;

  constructor(node: RenderDescriptor) {
    super(node.id);
    this.nodeLabel = node.label ?? '';
    this.nodeStyle = node.style;
    const titleHtml = Content.inline(node.label ?? '').html;
    this.initContent(titleHtml, { bodyLines: node.bodyLines });
  }

  protected finalizeBody(ctx: FinalizeBodyCtx) {
    if (ctx.lines.length === 0) return { emptyBodyPad: 10 };
    return {};
  }

  protected getContainerStyle(titleHeight: number) {
    return stateNodeStyle(titleHeight, this.nodeStyle);
  }

  protected getRowStyle() { return textRowStyle(); }
  protected getSeparatorStyle() { return separatorStyle(); }

  /**
   * DOT block: composite state with children → cluster; leaf → node.
   */
  buildDotBlock(ctx: DotContext, indent: string): string[] {
    if (this.children.length > 0) {
      return buildClusterDotBlock(this.id, this.nodeLabel, this.children, ctx, indent);
    }
    return super.buildDotBlock(ctx, indent);
  }

  /**
   * Render: composite state → group container; leaf → swimlane.
   */
  render(box: ContentBox): string[] {
    if (this.children.length > 0) {
      const labelHtml = Content.inline(this.nodeLabel).html;
      const parentCellId = this.parentId || '1';
      const style = stateGroupStyle(this.nodeStyle);
      const cells = [`<mxCell id="${escapeXml(this.id)}" value="${escapeXml(labelHtml)}" style="${style}" vertex="1" parent="${escapeXml(parentCellId)}">`
        + `<mxGeometry x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" as="geometry"/>`
        + `</mxCell>`];
      // Render direct children; sub-groups handle their own via polymorphism
      cells.push(...this.renderChildren());
      return cells;
    }
    return super.render(box);
  }
}

// ---------------------------------------------------------------------------
// Composite state group style
// ---------------------------------------------------------------------------

/** DrawIO style for a composite state container with optional color. */
function stateGroupStyle(style?: string | null): string {
  const parsed = parseNodeStyle(style);
  const base = [
    'swimlane', 'html=1', 'rounded=1', 'absoluteArcSize=1', 'arcSize=10',
    'align=center', 'verticalAlign=top',
    'startSize=26',
    'collapsible=0', 'marginBottom=0',
    'strokeWidth=0.5',
    'fontStyle=0',
  ];
  if (parsed) {
    if (parsed.fillColor) {
      base.push(`fillColor=${parsed.fillColor}`);
      if (!parsed.strokeColor) base.push(`strokeColor=${darkenColor(parsed.fillColor)}`);
    }
    if (parsed.strokeColor) base.push(`strokeColor=${parsed.strokeColor}`);
    if (parsed.textColor) base.push(`fontColor=${parsed.textColor}`);
    if (parsed.lineStyle === 'dashed') base.push('dashed=1');
    else if (parsed.lineStyle === 'dotted') base.push('dashed=1', 'dashPattern=1 2');
    else if (parsed.lineStyle === 'bold') base.push('strokeWidth=2');
  }
  if (!base.some(s => s.startsWith('fillColor='))) base.push(`fillColor=${DEFAULT_FILL}`);
  if (!base.some(s => s.startsWith('strokeColor='))) base.push(`strokeColor=${COLOR_DARK}`);
  return base.join(';') + ';';
}

// ---------------------------------------------------------------------------
// Public factories
// ---------------------------------------------------------------------------

/** Register all state-node renderers into global registry. */
export function registerStateNodeRenderers(): void {
  registerRenderer('state_start', (desc: RenderDescriptor) => new StateStartRenderer(desc));
  registerRenderer('state_end', (desc: RenderDescriptor) => new StateEndRenderer(desc));
  registerRenderer('state_fork', (desc: RenderDescriptor) => new StateForkJoinRenderer(desc));
  registerRenderer('state_join', (desc: RenderDescriptor) => new StateForkJoinRenderer(desc));
  registerRenderer('state_choice', (desc: RenderDescriptor) => new StateChoiceRenderer(desc));
  registerRenderer('state', (desc: RenderDescriptor) => new StateNodeRenderer(desc));
}
