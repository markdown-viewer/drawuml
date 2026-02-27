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
import { textRowStyle, separatorStyle } from './class-node.ts';
import { parseNodeStyle, darkenColor } from '../shared/color-utils.ts';
import { DEFAULT_FONT_FAMILY, SMALL_FONT_SIZE, DEFAULT_FILL, COLOR_DARK } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { ContentBox, FinalizeBodyCtx } from '../shared/content.ts';
import type { LayoutGraphNode, LayoutLabel } from '../layout/layout-graph.ts';

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

const HISTORY_SIZE = 22;
const HISTORY_STYLE = 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;'
  + `fillColor=${DEFAULT_FILL};strokeColor=${COLOR_DARK};strokeWidth=0.5;`
  + `fontSize=${SMALL_FONT_SIZE};fontStyle=1;`;

const CHOICE_LABEL_GAP = 4; // gap between label and diamond
const CHOICE_LABEL_STYLE = `text;html=1;align=left;verticalAlign=top;`
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
    // Label is rendered as an overlay and does NOT participate in DOT layout.
    // Only the diamond itself occupies layout space.
    return { width: CHOICE_SIZE, height: CHOICE_SIZE };
  }

  graphicCenterOffset() {
    // No offset — the diamond is always at the DOT node center.
    return { dx: 0, dy: 0 };
  }

  /**
   * Build layout graph node with optional external label.
   */
  override buildLayoutGraph(): LayoutGraphNode {
    const node = super.buildLayoutGraph();
    if (this.label) {
      const labels: LayoutLabel[] = [{
        text: this.label,
        width: this.labelWidth,
        height: this.labelHeight,
        placement: 'OUTSIDE H_RIGHT V_TOP H_PRIORITY',
      }];
      node.labels = labels;
    }
    return node;
  }

  render(box: ContentBox) {
    const d = CHOICE_SIZE;
    const cells: string[] = [];

    // Diamond centered in box
    const dx = box.x + Math.round((box.width - d) / 2);
    const dy = box.y + Math.round((box.height - d) / 2);

    if (this.label) {
      let labelX: number;
      let labelY: number;
      if (box.xlabelPos) {
        // Use Graphviz auto-positioned xlabel center to place the label cell.
        labelX = Math.round(box.xlabelPos.x - this.labelWidth / 2);
        labelY = Math.round(box.xlabelPos.y - this.labelHeight / 2);
      } else {
        // Fallback: label floats at the upper-left of the diamond.
        labelX = dx - this.labelWidth - CHOICE_LABEL_GAP;
        labelY = dy - this.labelHeight - CHOICE_LABEL_GAP;
      }
      cells.push(mxVertex({
        id: `${this.node.id}__label`,
        value: this.label,
        style: CHOICE_LABEL_STYLE,
        parent: this.parentId || '1',
        x: labelX, y: labelY, width: this.labelWidth, height: this.labelHeight,
      }));
    }

    cells.push(mxVertex({ id: this.node.id, value: '', style: Renderer.applyInlineStyle(CHOICE_STYLE, this.node.style).style, parent: this.parentId || '1', x: dx, y: dy, width: d, height: d }));

    return cells;
  }
}

// ---------------------------------------------------------------------------
// History pseudo-state renderer — circle with H or H* label
// ---------------------------------------------------------------------------

class StateHistoryRenderer extends Renderer {
  private node: RenderDescriptor;
  private label: string;

  constructor(node: RenderDescriptor) {
    super(node.id);
    this.node = node;
    this.label = node.label || 'H';
  }

  protected doMeasure() {
    return { width: HISTORY_SIZE, height: HISTORY_SIZE };
  }

  render(box: ContentBox) {
    const d = HISTORY_SIZE;
    const x = box.x + Math.round((box.width - d) / 2);
    const y = box.y + Math.round((box.height - d) / 2);
    return [mxVertex({
      id: this.node.id,
      value: this.label,
      style: HISTORY_STYLE,
      parent: this.parentId || '1',
      x, y, width: d, height: d,
    })];
  }
}

// ---------------------------------------------------------------------------
// Swimlane container — invisible root group that tiles lane children
// ---------------------------------------------------------------------------

/**
 * Invisible container renderer for activity diagram swimlanes.
 * It draws no frame; its children (ConcurrentRegionRenderers) are tiled
 * side-by-side, each spanning the full container height.
 */
export class SwimlaneContainerRenderer extends Renderer {
  constructor(id: string) {
    super(id);
  }

  get isCluster(): boolean { return true; }
  get clusterLabel(): string { return ''; }

  override get groupTopPadding(): number { return 0; }

  override buildLayoutGraph() {
    const node = super.buildLayoutGraph();
    // Zero padding: regions fill the entire area
    if (node.padding) {
      node.padding.top = 0;
      node.padding.left = 0;
      node.padding.right = 0;
      node.padding.bottom = 0;
    }
    return node;
  }

  protected doMeasure() {
    // Size computed by layout engine
    return { width: 100, height: 100 };
  }

  render(box: ContentBox): string[] {
    const parentCellId = this.parentId || '1';

    // Invisible group container
    const cells: string[] = [
      `<mxCell id="${escapeXml(this.id)}" value="" `
      + `style="group;strokeColor=none;fillColor=none;" `
      + `vertex="1" parent="${escapeXml(parentCellId)}">`
      + `<mxGeometry x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" as="geometry"/>`
      + `</mxCell>`,
    ];

    // Tile concurrent region children side-by-side
    const regionChildren = this.children.filter(c => c instanceof ConcurrentRegionRenderer);
    if (regionChildren.length > 1) {
      cells.push(...this.renderConcurrentLanes(box, regionChildren));
    } else {
      cells.push(...this.renderChildren());
    }
    return cells;
  }

  /**
   * Tile region lanes side-by-side filling the container area.
   * Uses proportional widths from ELK-computed positions.
   */
  private renderConcurrentLanes(box: ContentBox, regions: Renderer[]): string[] {
    const layout = this._layoutRef;
    if (!layout) return this.renderChildren();

    const myAbs = (layout.groups && layout.groups[this.id]) || layout.nodes[this.id];
    if (!myAbs) return this.renderChildren();

    // Collect region ELK positions, sorted by x
    const regionInfos: { renderer: Renderer; elkBox: { x: number; y: number; width: number; height: number } }[] = [];
    for (const r of regions) {
      const rl = layout.groups?.[r.id];
      if (rl) regionInfos.push({ renderer: r, elkBox: rl });
    }
    regionInfos.sort((a, b) => a.elkBox.x - b.elkBox.x);

    // No title bar; lanes fill the entire container height
    const laneY = 0;
    const laneH = box.height;

    // Proportional-width lanes filling the container
    const n = regionInfos.length;
    const totalElkW = regionInfos.reduce((s, r) => s + r.elkBox.width, 0);
    const laneWidths = regionInfos.map(r => r.elkBox.width / totalElkW * box.width);

    const cells: string[] = [];
    let cumulX = 0;
    for (let i = 0; i < n; i++) {
      const laneX = Math.round(cumulX);
      cumulX += laneWidths[i];
      const actualW = Math.round(cumulX) - laneX;
      const laneBox: ContentBox = { x: laneX, y: laneY, width: actualW, height: laneH };
      cells.push(...regionInfos[i].renderer.render(laneBox));
    }

    // Non-region children rendered normally
    for (const child of this.children) {
      if (child instanceof ConcurrentRegionRenderer) continue;
      if (child.isPort) continue;
      const cl = layout.nodes[child.id] || (layout.groups && layout.groups[child.id]);
      if (!cl) continue;
      cells.push(...child.render({
        x: cl.x - myAbs.x,
        y: cl.y - myAbs.y,
        width: cl.width,
        height: cl.height,
      }));
    }
    return cells;
  }
}

// ---------------------------------------------------------------------------
// Concurrent region renderer — child swimlane lane within a composite state
// ---------------------------------------------------------------------------

/**
 * Renders a concurrent region as a DrawIO swimlane lane.
 * - With label: shows a secondary title header (startSize=20)
 * - Without label: just a bordered region (startSize=0, no title bar)
 */
export class ConcurrentRegionRenderer extends Renderer {
  private regionLabel: string;
  private regionColor: string;

  constructor(id: string, label: string = '', color: string = '') {
    super(id);
    this.regionLabel = label;
    this.regionColor = color;
  }

  get isCluster(): boolean { return true; }
  get clusterLabel(): string { return this.regionLabel; }

  // Uniform padding on all sides inside each region lane.
  // No label: all sides equal; with label: top adds startSize.
  private static readonly REGION_PAD = 23;

  override get groupTopPadding(): number {
    return ConcurrentRegionRenderer.REGION_PAD + (this.regionLabel ? 20 : 0);
  }

  override buildLayoutGraph() {
    const node = super.buildLayoutGraph();
    if (node.padding) {
      const p = ConcurrentRegionRenderer.REGION_PAD;
      node.padding.left = p;
      node.padding.right = p;
      node.padding.bottom = p;
    }
    return node;
  }

  protected doMeasure() {
    // Size is computed by ELK; this is a placeholder
    return { width: 100, height: 100 };
  }

  render(box: ContentBox): string[] {
    const parentCellId = this.parentId || '1';
    // Render as a standard DrawIO swimlane lane with visible borders.
    // Adjacent lanes naturally form visual separators.
    const startSize = this.regionLabel ? 20 : 0;
    const fill = this.regionColor || 'none';
    const style = `swimlane;html=1;startSize=${startSize};`
      + `collapsible=0;rounded=0;`
      + `strokeWidth=0.5;fillColor=${fill};strokeColor=${COLOR_DARK};`
      + `fontStyle=0;fontSize=11;`;
    const label = this.regionLabel ? escapeXml(this.regionLabel) : '';
    const cells: string[] = [
      `<mxCell id="${escapeXml(this.id)}" value="${label}" style="${style}" vertex="1" parent="${escapeXml(parentCellId)}">`
      + `<mxGeometry x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" as="geometry"/>`
      + `</mxCell>`,
    ];
    // Render children positioned relative to this Lane's actual absolute position.
    // laneAbs = parentAbs + box offset.  Using this for coordinate translation
    // keeps nodes at the exact positions computed by the layout engine, so edges
    // (which use absolute waypoints in DOT) stay aligned with nodes.
    const layout = this._layoutRef;
    if (layout && this.children.length > 0) {
      const parentAbs = layout.groups?.[this.parentId!] || layout.nodes[this.parentId!];
      if (parentAbs) {
        const laneAbsX = parentAbs.x + box.x;
        const laneAbsY = parentAbs.y + box.y;
        for (const child of this.children) {
          if (child.isPort) continue;
          const cl = layout.nodes[child.id] || layout.groups?.[child.id];
          if (!cl) continue;
          cells.push(...child.render({
            x: cl.x - laneAbsX,
            y: cl.y - laneAbsY,
            width: cl.width,
            height: cl.height,
          }));
        }
      }
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

  get clusterLabel(): string { return this.nodeLabel; }

  // State title bar (startSize=26) is a fixed title area
  // +2 compensates for visual gap difference vs non-fixed shapes
  override get groupTopPadding(): number { return Renderer.GROUP_BASE_PAD + 26 + 2; }

  /**
   * Render: composite state → group container; leaf → swimlane.
   */
  render(box: ContentBox): string[] {
    if (this.children.length > 0) {
      const labelHtml = Content.inline(this.nodeLabel).html;
      const parentCellId = this.parentId || '1';
      const hasConcurrentRegions = this.children.some(c => c instanceof ConcurrentRegionRenderer);
      const style = stateGroupStyle(this.nodeStyle, hasConcurrentRegions);
      const cells = [`<mxCell id="${escapeXml(this.id)}" value="${escapeXml(labelHtml)}" style="${style}" vertex="1" parent="${escapeXml(parentCellId)}">`
        + `<mxGeometry x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" as="geometry"/>`
        + `</mxCell>`];

      // If has concurrent regions, render them as tiled lanes filling the
      // parent content area, with boundaries at midpoints between regions.
      const regionChildren = this.children.filter(c => c instanceof ConcurrentRegionRenderer);
      if (regionChildren.length > 1) {
        cells.push(...this.renderConcurrentLanes(box, regionChildren));
      } else {
        cells.push(...this.renderChildren());
      }
      return cells;
    }
    return super.render(box);
  }

  /**
   * Render concurrent region children as tiled swimlane lanes that fill
   * the parent container's content area with no gaps. Lane boundaries
   * are computed at midpoints between ELK-positioned regions.
   */
  private renderConcurrentLanes(box: ContentBox, regions: Renderer[]): string[] {
    const layout = this._layoutRef;
    if (!layout) return this.renderChildren();

    const myAbs = (layout.groups && layout.groups[this.id]) || layout.nodes[this.id];
    if (!myAbs) return this.renderChildren();

    // Collect region ELK positions, sorted by x
    const regionInfos: { renderer: Renderer; elkBox: { x: number; y: number; width: number; height: number } }[] = [];
    for (const r of regions) {
      const rl = layout.groups?.[r.id];
      if (rl) regionInfos.push({ renderer: r, elkBox: rl });
    }
    regionInfos.sort((a, b) => a.elkBox.x - b.elkBox.x);

    // Lane vertical extent: from title bottom (startSize=26) to container bottom
    const STATE_START_SIZE = 26;
    const laneY = STATE_START_SIZE;
    const laneH = box.height - laneY;

    // Proportional-width lanes filling the container:
    // distribute space based on ELK region widths
    const n = regionInfos.length;
    const totalElkW = regionInfos.reduce((s, r) => s + r.elkBox.width, 0);
    const laneWidths = regionInfos.map(r => r.elkBox.width / totalElkW * box.width);

    const cells: string[] = [];
    let cumulX = 0;
    for (let i = 0; i < n; i++) {
      const laneX = Math.round(cumulX);
      cumulX += laneWidths[i];
      const actualW = Math.round(cumulX) - laneX;
      const laneBox: ContentBox = { x: laneX, y: laneY, width: actualW, height: laneH };
      cells.push(...regionInfos[i].renderer.render(laneBox));
    }

    // Also render any non-region children normally
    for (const child of this.children) {
      if (child instanceof ConcurrentRegionRenderer) continue;
      if (child.isPort) continue;
      const cl = layout.nodes[child.id] || (layout.groups && layout.groups[child.id]);
      if (!cl) continue;
      cells.push(...child.render({
        x: cl.x - myAbs.x,
        y: cl.y - myAbs.y,
        width: cl.width,
        height: cl.height,
      }));
    }
    return cells;
  }
}

// ---------------------------------------------------------------------------
// Composite state group style
// ---------------------------------------------------------------------------

/** DrawIO style for a composite state container with optional color. */
function stateGroupStyle(style?: string | null, noRounding?: boolean): string {
  const parsed = parseNodeStyle(style);
  const base = noRounding ? [
    'swimlane', 'html=1', 'rounded=0',
    'align=center', 'verticalAlign=top',
    'startSize=26',
    'collapsible=0', 'marginBottom=0',
    'strokeWidth=0.5',
    'fontStyle=0',
  ] : [
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
  registerRenderer('state_history', (desc: RenderDescriptor) => new StateHistoryRenderer(desc));
  registerRenderer('state', (desc: RenderDescriptor) => new StateNodeRenderer(desc));
  registerRenderer('swimlane_container', (desc: RenderDescriptor) => new SwimlaneContainerRenderer(desc.id));
}
