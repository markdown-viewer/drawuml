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
import { escapeXml, mxVertex, cellId, n4 } from '../shared/xml-utils.ts';
import { Renderer, SwimlaneRenderer } from './renderer.ts';
import { RichRenderer } from './shapes/rich-renderer.ts';

import { parseNodeStyle, darkenColor } from '../shared/color-utils.ts';
import type { Theme } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { ContentBox, FinalizeBodyCtx } from '../shared/content.ts';
import type { LayoutGraphNode } from '../layout/layout-graph.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// (State pseudo-node sizes derived from theme: iconSize,
//  stateForkWidth, stateForkHeight.)

// ---------------------------------------------------------------------------
// Fork / Join renderer
// ---------------------------------------------------------------------------

class StateForkJoinRenderer extends Renderer {
  private node: { id: string };
  constructor(node: { id: string; theme?: Theme }) { super(node.id, node.theme); this.node = node; }

  protected doMeasure() {
    return { width: this.theme.sizeXL, height: this.theme.sizeXXS };
  }

  render(box: ContentBox) {
    const w = this.theme.sizeXL;
    const h = this.theme.sizeXXS;
    const x = box.x + (box.width - w) / 2;
    const y = box.y + (box.height - h) / 2;
    return [mxVertex({ id: this.node.id, value: '', style: `line;html=1;strokeWidth=${this.theme.sizeXXS};strokeColor=${this.theme.colorDark};fillColor=${this.theme.colorDark};perimeter=linePerimeter;`, parent: this.parentId || '1', x, y, width: w, height: h })];
  }
}

// ---------------------------------------------------------------------------
// Choice renderer
// ---------------------------------------------------------------------------

class StateChoiceRenderer extends RichRenderer {
  get isCluster(): boolean { return false; }

  // Hexagon side extent in pixels (computed in doMeasure for 45° angle)
  private _hexSize = 12;

  /** When label is present, use hexagon; otherwise use rhombus (diamond). */
  protected buildStyle(): string {
    const hasText = !!this.label;
    const shape = hasText
      ? `shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;size=${n4(this._hexSize)};whiteSpace=wrap;html=1;`
      : `rhombus;whiteSpace=wrap;html=1;`;
    const s = shape
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`
      + `fontSize=${this.theme.fontSize};fontFamily=${this.theme.fontFamily};`;
    return Renderer.applyInlineStyle(s, this.desc.style, this.theme.boldStrokeWidth).style;
  }

  // Shape style is complete — no fragment extraction needed
  protected get richBodyStyleComplete(): boolean { return true; }

  protected doMeasure() {
    const choiceSize = this.theme.sizeM;
    const hasText = !!this.label;
    if (!hasText) {
      // No text → rhombus; fixed square for 45° diamond
      return { width: choiceSize, height: choiceSize };
    }
    const base = super.doMeasure();
    const h = Math.max(choiceSize, base.height);
    // For 45° side angle: horizontal extent of each point = height / 2
    this._hexSize = h / 2;
    const w = Math.max(choiceSize, base.width + this._hexSize * 2);
    return { width: w, height: h };
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
  constructor(id: string, theme?: Theme) {
    super(id, theme);
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
      `<mxCell id="${escapeXml(cellId(this.id))}" value="" `
      + `style="group;strokeColor=none;fillColor=none;" `
      + `vertex="1" parent="${escapeXml(cellId(parentCellId))}">`
      + `<mxGeometry x="${n4(box.x)}" y="${n4(box.y)}" width="${n4(box.width)}" height="${n4(box.height)}" as="geometry"/>`
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

    // Collect region layout positions
    const regionInfos: { renderer: Renderer; elkBox: { x: number; y: number; width: number; height: number } }[] = [];
    for (const r of regions) {
      const rl = layout.groups?.[r.id];
      if (rl) regionInfos.push({ renderer: r, elkBox: rl });
    }

    // Detect LR mode: all regions share the same X → stacked vertically
    const allSameX = regionInfos.length > 1 &&
      regionInfos.every(ri => Math.abs(ri.elkBox.x - regionInfos[0].elkBox.x) < 1);

    if (allSameX) {
      // LR mode: lanes stacked vertically (horizontal bands)
      regionInfos.sort((a, b) => a.elkBox.y - b.elkBox.y);
      const n = regionInfos.length;
      const totalElkH = regionInfos.reduce((s, r) => s + r.elkBox.height, 0);
      const laneHeights = regionInfos.map(r => r.elkBox.height / totalElkH * box.height);

      const cells: string[] = [];
      let cumulY = 0;
      for (let i = 0; i < n; i++) {
        const ri = regionInfos[i];
        if (ri.renderer instanceof ConcurrentRegionRenderer) {
          ri.renderer._isHorizontalLane = true;
        }
        const laneY = cumulY;
        cumulY += laneHeights[i];
        const actualH = cumulY - laneY;
        const laneBox: ContentBox = { x: 0, y: laneY, width: box.width, height: actualH };
        cells.push(...ri.renderer.render(laneBox));
      }
      return cells;
    }

    // TB mode: lanes side-by-side (vertical columns)
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
      const laneX = cumulX;
      cumulX += laneWidths[i];
      const actualW = cumulX - laneX;
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
  /** When true, render label on the left side (LR / horizontal swimlane). */
  _isHorizontalLane: boolean = false;

  constructor(id: string, label: string = '', color: string = '', theme?: Theme) {
    super(id, theme);
    this.regionLabel = label;
    this.regionColor = color;
  }

  get isCluster(): boolean { return true; }
  get clusterLabel(): string { return this.regionLabel; }

  /** Height of the region title bar (startSize in DrawIO swimlane). */
  private get titleBarHeight(): number { return this.theme.sizeS; }

  // Uniform padding on all sides inside each region lane.
  override get groupTopPadding(): number {
    const headerSize = this.regionLabel ? this.titleBarHeight : 0;
    return this.theme.padXL + headerSize;
  }

  override buildLayoutGraph() {
    const node = super.buildLayoutGraph();
    if (node.padding) {
      const p = this.theme.padXL;
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
    // LR mode: horizontal=0 puts the label on the left side (double header).
    const headerH = this.titleBarHeight;
    const startSize = this.regionLabel ? (this._isHorizontalLane ? headerH * 2 : headerH) : 0;
    const fill = this.regionColor || 'none';
    const horizontalAttr = this._isHorizontalLane ? 'horizontal=0;' : '';
    const style = `swimlane;html=1;startSize=${startSize};${horizontalAttr}`
      + `collapsible=0;rounded=0;`
      + `strokeWidth=${this.theme.strokeWidth};fillColor=${fill};strokeColor=${this.theme.colorDark};`
      + `fontStyle=0;fontSize=${this.theme.smallFontSize};`;
    const label = this.regionLabel ? escapeXml(this.regionLabel) : '';
    const cells: string[] = [
      `<mxCell id="${escapeXml(cellId(this.id))}" value="${label}" style="${style}" vertex="1" parent="${escapeXml(cellId(parentCellId))}">`
      + `<mxGeometry x="${n4(box.x)}" y="${n4(box.y)}" width="${n4(box.width)}" height="${n4(box.height)}" as="geometry"/>`
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
function stateNodeStyle(startSize: number, theme: Theme, style?: string | null): string {
  const parsed = parseNodeStyle(style);
  const base = [
    'swimlane', 'html=1', 'rounded=1', 'absoluteArcSize=1', `arcSize=${theme.largeArcSize}`,
    'align=center', 'verticalAlign=middle',
    'childLayout=stackLayout', 'horizontal=1',
    `startSize=${startSize}`,
    'horizontalStack=0', 'resizeParent=1', 'resizeLast=0',
    'collapsible=0', 'marginBottom=0',
    `strokeWidth=${theme.strokeWidth}`,
    'fontStyle=0',
  ];
  if (theme.fontSize) base.push(`fontSize=${theme.fontSize}`);
  if (theme.fontFamily) base.push(`fontFamily=${theme.fontFamily}`);
  if (parsed) {
    if (parsed.fillColor) {
      base.push(`fillColor=${parsed.fillColor}`);
      if (!parsed.strokeColor) base.push(`strokeColor=${darkenColor(parsed.fillColor)}`);
    }
    if (parsed.strokeColor) base.push(`strokeColor=${parsed.strokeColor}`);
    if (parsed.textColor) base.push(`fontColor=${parsed.textColor}`);
    if (parsed.lineStyle === 'dashed') base.push('dashed=1');
    else if (parsed.lineStyle === 'dotted') base.push('dashed=1', 'dashPattern=1 2');
    else if (parsed.lineStyle === 'bold') base.push(`strokeWidth=${n4(theme.boldStrokeWidth)}`);
  }
  if (!base.some(s => s.startsWith('fillColor='))) base.push(`fillColor=${theme.defaultFill}`);
  if (!base.some(s => s.startsWith('strokeColor='))) base.push(`strokeColor=${theme.colorDark}`);
  return base.join(';') + ';';
}

class StateNodeRenderer extends SwimlaneRenderer {
  private _nodeLabel: string;
  private nodeStyle?: string | null;

  constructor(node: RenderDescriptor) {
    super(node.id, node.theme);
    this._nodeLabel = node.label ?? '';
    this.nodeStyle = node.style;
    const titleHtml = Content.inline(node.label ?? '').html;
    this.initContent(titleHtml, { bodyLines: node.bodyLines });
  }

  protected finalizeBody(ctx: FinalizeBodyCtx) {
    if (ctx.lines.length === 0) return { emptyBodyPad: this.theme.padS };
    return {};
  }

  protected getContainerStyle(titleHeight: number) {
    return stateNodeStyle(titleHeight, this.theme, this.nodeStyle);
  }

  protected getChildStyleOpts() { return { portConstraint: true as const, spacingX: this.theme.padXS }; }

  get clusterLabel(): string { return this._nodeLabel; }

  /** Height of the state title bar (startSize in DrawIO swimlane). */
  private get titleBarHeight(): number { return this.theme.sizeS; }

  // State title bar is a fixed title area
  // +2 compensates for visual gap difference vs non-fixed shapes
  override get groupTopPadding(): number { return this.theme.padXL + this.titleBarHeight + 2; }

  /**
   * Render: composite state → group container; leaf → swimlane.
   */
  render(box: ContentBox): string[] {
    if (this.children.length > 0) {
      const labelHtml = Content.inline(this._nodeLabel).html;
      const parentCellId = this.parentId || '1';
      const hasConcurrentRegions = this.children.some(c => c instanceof ConcurrentRegionRenderer);
      const style = stateGroupStyle(this.theme, this.nodeStyle, hasConcurrentRegions);
      const cells = [`<mxCell id="${escapeXml(cellId(this.id))}" value="${escapeXml(labelHtml)}" style="${style}" vertex="1" parent="${escapeXml(cellId(parentCellId))}">`
        + `<mxGeometry x="${n4(box.x)}" y="${n4(box.y)}" width="${n4(box.width)}" height="${n4(box.height)}" as="geometry"/>`
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

    // Lane vertical extent: from title bottom to container bottom
    const laneY = this.titleBarHeight;
    const laneH = box.height - laneY;

    // Proportional-width lanes filling the container:
    // distribute space based on ELK region widths
    const n = regionInfos.length;
    const totalElkW = regionInfos.reduce((s, r) => s + r.elkBox.width, 0);
    const laneWidths = regionInfos.map(r => r.elkBox.width / totalElkW * box.width);

    const cells: string[] = [];
    let cumulX = 0;
    for (let i = 0; i < n; i++) {
      const laneX = cumulX;
      cumulX += laneWidths[i];
      const actualW = cumulX - laneX;
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
function stateGroupStyle(theme: Theme, style?: string | null, noRounding?: boolean): string {
  const parsed = parseNodeStyle(style);
  const titleBarHeight = theme.sizeS; // swimlane startSize = title bar height
  const base = noRounding ? [
    'swimlane', 'html=1', 'rounded=0',
    'align=center', 'verticalAlign=top',
    `startSize=${titleBarHeight}`,
    'collapsible=0', 'marginBottom=0',
    `strokeWidth=${theme.strokeWidth}`,
    'fontStyle=0',
  ] : [
    'swimlane', 'html=1', 'rounded=1', 'absoluteArcSize=1', `arcSize=${theme.largeArcSize}`,
    'align=center', 'verticalAlign=top',
    `startSize=${titleBarHeight}`,
    'collapsible=0', 'marginBottom=0',
    `strokeWidth=${theme.strokeWidth}`,
    'fontStyle=0',
  ];
  if (theme.fontSize) base.push(`fontSize=${theme.fontSize}`);
  if (theme.fontFamily) base.push(`fontFamily=${theme.fontFamily}`);
  if (parsed) {
    if (parsed.fillColor) {
      base.push(`fillColor=${parsed.fillColor}`);
      if (!parsed.strokeColor) base.push(`strokeColor=${darkenColor(parsed.fillColor)}`);
    }
    if (parsed.strokeColor) base.push(`strokeColor=${parsed.strokeColor}`);
    if (parsed.textColor) base.push(`fontColor=${parsed.textColor}`);
    if (parsed.lineStyle === 'dashed') base.push('dashed=1');
    else if (parsed.lineStyle === 'dotted') base.push('dashed=1', 'dashPattern=1 2');
    else if (parsed.lineStyle === 'bold') base.push(`strokeWidth=${n4(theme.boldStrokeWidth)}`);
  }
  if (!base.some(s => s.startsWith('fillColor='))) base.push(`fillColor=${theme.defaultFill}`);
  if (!base.some(s => s.startsWith('strokeColor='))) base.push(`strokeColor=${theme.colorDark}`);
  return base.join(';') + ';';
}

// ---------------------------------------------------------------------------
// Public factories
// ---------------------------------------------------------------------------

/** Register all state-node renderers into global registry. */
export function registerStateNodeRenderers(): void {
  registerRenderer('state_fork', (desc: RenderDescriptor) => new StateForkJoinRenderer(desc));
  registerRenderer('state_join', (desc: RenderDescriptor) => new StateForkJoinRenderer(desc));
  registerRenderer('state_choice', (desc: RenderDescriptor) => new StateChoiceRenderer(desc));
  registerRenderer('state', (desc: RenderDescriptor) => new StateNodeRenderer(desc));
  registerRenderer('swimlane_container', (desc: RenderDescriptor) => new SwimlaneContainerRenderer(desc.id, desc.theme));
}
