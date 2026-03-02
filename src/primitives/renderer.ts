/**
 * Renderer — abstract base class for all visual element renderers.
 *
 * A renderer is stateful: constructed once with semantic data,
 * then reused for both layout (measure / buildLayoutGraph) and generation (render).
 *
 * Subclasses implement doMeasure() and render(). The base class
 * provides cached measure() and a default buildLayoutGraph() hook.
 *
 * One intermediate base class extracts common patterns:
 *   - SwimlaneRenderer  — for titled swimlane containers (Class, State)
 *
 * Usage:
 *   const r = createNodeRenderer(node, opts);
 *   const size = r.measure();        // for layout (cached)
 *   const graph = r.buildLayoutGraph(); // for layout engine IR
 *   const cells = r.render(box);     // after layout
 */

import { Content } from '../shared/content.ts';
import { mxVertex } from '../shared/xml-utils.ts';
import type { LayoutResult } from '../model/index.ts';
import { parseNodeStyle, darkenColor } from '../shared/color-utils.ts';
import type { ContentBox, FinalizeBodyCtx, ContentBlock, ChildStyleOpts } from '../shared/content.ts';
import type { BodyLine } from '../model/class-model.ts';
import type { LayoutGraphNode } from '../layout/layout-graph.ts';
import type { Theme } from '../shared/theme.ts';
import { createTheme } from '../shared/theme.ts';

// ─── Base class ──────────────────────────────────────────────────────────────

export abstract class Renderer {
  readonly id: string;
  /** Theme for the current conversion pass. */
  readonly theme: Theme;
  private _size: { width: number; height: number } | null = null;
  /** Child renderers managed by this container (empty for leaf nodes). */
  readonly children: Renderer[] = [];
  /** Parent cell id for nested containers. */
  parentId?: string;
  /** Layout data reference for recursive child rendering. */
  protected _layoutRef: LayoutResult | null = null;

  constructor(id: string, theme?: Theme) {
    this.id = id;
    this.theme = theme ?? createTheme();
  }

  /** Set layout reference for this renderer and all descendants. */
  setLayoutRef(layout: LayoutResult): void {
    this._layoutRef = layout;
    for (const child of this.children) child.setLayoutRef(layout);
  }

  /** Add a child renderer (for container renderers). */
  addChild(renderer: Renderer) {
    renderer.parentId = this.id;
    this.children.push(renderer);
  }

  /**
   * Render all direct children with coordinates relative to this container.
   * Looks up own absolute position and each child's absolute position from
   * the layout reference, then converts to parent-relative coordinates.
   * Sub-groups handle their own children via polymorphic render().
   */
  protected renderChildren(): string[] {
    const layout = this._layoutRef;
    if (!layout || this.children.length === 0) return [];
    // Look up own absolute coordinates from layout
    const myAbs = (layout.groups && layout.groups[this.id]) || layout.nodes[this.id];
    if (!myAbs) return [];
    const cells: string[] = [];
    for (const child of this.children) {
      // Port nodes are rendered separately with absolute coordinates in drawio-gen.ts
      if (child.isPort) continue;
      // Child layout may be in nodes (leaf or empty group) or groups (cluster)
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

  /** Compute content-based dimensions (result is cached). */
  measure(): { width: number; height: number } {
    if (!this._size) this._size = this.doMeasure();
    return this._size;
  }

  /** Produce DrawIO mxCell XML strings for a positioned bounding box. */
  abstract render(box: ContentBox): string[];

  /** Subclass implements actual dimension computation. */
  protected abstract doMeasure(): { width: number; height: number };

  /** Whether this renderer is a DOT subgraph cluster (container). */
  get isCluster(): boolean { return this.children.length > 0; }

  /** Cluster label text for DOT / ELK layout. Subclasses override. */
  get clusterLabel(): string { return ''; }

  /** Node label text for external label placement. Subclasses override. */
  get nodeLabel(): string { return ''; }

  /** Whether this renderer is a port node (port/portin/portout). */
  get isPort(): boolean { return false; }

  /** Port direction for port nodes. null for non-port nodes. */
  get portKind(): 'portin' | 'portout' | null { return null; }

  /**
   * Size of the visual graphic area only (excluding external labels).
   * Returns null when the graphic fills the entire bounding box.
   * Used by ELK adapter to set icon-only node dimensions with external
   * labels, so edges route to the icon boundary.
   * Used by DOT layout to compute graphic-center offset.
   */
  graphicSize(): { width: number; height: number } | null { return null; }

  /**
   * Top padding for ELK group containers (pixels).
   *
   * Two categories:
   *  1. Fixed title area (folder/frame tab) — always adds fixedAreaHeight.
   *  2. No fixed title area — adds titleHeight only when label is non-empty.
   *
   * Subclasses override for shape-specific logic.
   */
  get groupTopPadding(): number {
    const base = this.theme.groupPadding;
    return base + (this.clusterLabel ? this.theme.capHeight : 0);
  }

  /**
   * Build an engine-agnostic layout graph node for this renderer.
   *
   * The base implementation handles leaf nodes (fixed-size rectangle)
   * and container nodes (children + padding).  Subclasses override to
   * add ports, external labels, or custom padding.
   */
  buildLayoutGraph(): LayoutGraphNode {
    const sz = this.measure();
    const node: LayoutGraphNode = {
      id: this.id,
      width: sz.width,
      height: sz.height,
    };
    if (this.isCluster) {
      node.label = this.clusterLabel;
      node.children = this.children.map(c => c.buildLayoutGraph());
      node.padding = { top: this.groupTopPadding, right: this.theme.groupPadding, bottom: this.theme.groupPadding, left: this.theme.groupPadding };
    }
    return node;
  }

  /**
   * Apply PlantUML inline style string to a DrawIO style.
   * Returns `{ style, fontColorOverride }` where:
   *   - style: the modified DrawIO style string
   *   - fontColorOverride: a `fontColor=...;` fragment (empty string if no override)
   *
   * Handles fillColor, strokeColor, lineStyle (dashed/dotted/bold), textColor.
   * Each renderer calls this in its own render() to apply user-specified styles.
   */
  static applyInlineStyle(drawioStyle: string, rawStyle: string | null | undefined, boldStrokeWidth: number = 2): { style: string; fontColorOverride: string } {
    let s = drawioStyle;
    let fontColorOverride = '';
    const parsed = parseNodeStyle(rawStyle);
    if (parsed) {
      if (parsed.fillColor) {
        s = s.replace(/fillColor=[^;]*/, `fillColor=${parsed.fillColor}`);
        if (!parsed.strokeColor) s += `strokeColor=${darkenColor(parsed.fillColor)};`;
      }
      if (parsed.strokeColor) s += `strokeColor=${parsed.strokeColor};`;
      if (parsed.lineStyle === 'dashed') s += 'dashed=1;';
      else if (parsed.lineStyle === 'dotted') s += 'dashed=1;dashPattern=1 2;';
      else if (parsed.lineStyle === 'bold') s += `strokeWidth=${boldStrokeWidth};`;
      if (parsed.textColor) fontColorOverride = `fontColor=${parsed.textColor};`;
    }
    return { style: s, fontColorOverride };
  }
}

/** Backward-compatible type alias. */
export type NodeRenderer = Renderer;


// ─── SwimlaneRenderer ────────────────────────────────────────────────────────

/**
 * Base class for titled swimlane container renderers (Class, State).
 *
 * Subclasses call `initContent()` in their constructor to build the
 * Content object. Entity-specific separator behavior is handled by
 * overriding `finalizeBody()`.
 *
 * The common render logic creates a swimlane container with titleHtml
 * and appends body child rows/separators below the title area.
 */
export abstract class SwimlaneRenderer extends Renderer {
  protected content: Content;

  constructor(nodeId: string, theme?: Theme) {
    super(nodeId, theme);
  }

  /**
   * Build the Content object for this swimlane.
   * Wires up `this.finalizeBody()` as the callback for entity-specific
   * separator behavior inside Content.classBody().
   */
  protected initContent(titleHtml: string, opts?: {
    bodyLines?: BodyLine[];
    visibilityIcons?: boolean;
    hideFields?: boolean;
    hideMethods?: boolean;
  }) {
    this.content = Content.classBody({
      titleHtml,
      nodeId: this.id,
      bodyLines: opts?.bodyLines,
      visibilityIcons: opts?.visibilityIcons,
      hideFields: opts?.hideFields,
      hideMethods: opts?.hideMethods,
      fontSize: this.theme?.fontSize,
      fontFamily: this.theme?.fontFamily,
      theme: this.theme,
      finalizeBody: (ctx) => this.finalizeBody(ctx),
    });
  }

  /**
   * Override to customize body finalization behavior (auto-separator, metrics).
   * Return null to use the default auto-separator logic (class entity behavior).
   * Return an object (even {}) to skip auto-separator and apply metric overrides.
   */
  protected finalizeBody(_ctx: FinalizeBodyCtx): Partial<Record<string, any>> | null {
    return null;
  }

  protected doMeasure() {
    const size = this.content.measure();
    return { width: size.width, height: size.height };
  }

  /** DrawIO swimlane style for the container. */
  protected abstract getContainerStyle(titleHeight: number): string;
  /** Swimlane child style options (portConstraint, stroke/lineStyle overrides). */
  protected getChildStyleOpts(): ChildStyleOpts { return { portConstraint: true }; }

  render(box: ContentBox) {
    const cells: string[] = [];
    const size = this.content.measure();
    const style = this.getContainerStyle(size.titleHeight!);

    // Swimlane container with title as value
    cells.push(mxVertex({
      id: this.id, value: this.content.titleHtml,
      style, parent: this.parentId || '1',
      x: box.x, y: box.y, width: box.width, height: box.height,
    }));

    // Body rows + separators as children, starting below title
    cells.push(...this.content.renderChildren(this.id, box.width,
      this.getChildStyleOpts(), size.titleHeight));

    return cells;
  }
}

// ─── Renderer options ────────────────────────────────────────────────────────

/** Options for class-diagram node renderers. */
export interface ClassNodeRendererOpts {
  /** Enable UML visibility icons (+/-/#/~) in body rows. */
  visibilityIcons?: boolean;
}


