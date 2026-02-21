/**
 * Renderer — abstract base class for all visual element renderers.
 *
 * A renderer is stateful: constructed once with semantic data,
 * then reused for both layout (measure) and generation (render).
 *
 * Subclasses implement doMeasure() and render(). The base class
 * provides cached measure() and a default buildPortLabel() hook.
 *
 * One intermediate base class extracts common patterns:
 *   - SwimlaneRenderer  — for titled swimlane containers (Class, State)
 *
 * Usage:
 *   const r = createNodeRenderer(node, opts);
 *   const size = r.measure();        // for layout (cached)
 *   const cells = r.render(box);     // after layout
 */

import { Content } from '../shared/content.ts';
import { mxVertex } from '../shared/xml-utils.ts';
import type { LayoutResult } from '../model/index.ts';
import { parseNodeStyle, darkenColor } from '../shared/color-utils.ts';
import type { ContentBox, FinalizeBodyCtx, ContentBlock } from '../shared/content.ts';
import type { BodyLine } from '../model/class-model.ts';

// ─── Base class ──────────────────────────────────────────────────────────────

/** Context passed to buildDotBlock() for shared global state. */
export interface DotContext {
  /** Whether a node has edges connected to specific ports. */
  hasPortEdges(nodeId: string): boolean;
  /** Whether a group needs an invisible proxy node for compound edges. */
  needsProxy(groupId: string): boolean;
  /** Whether a node participates in any edge (for row-packing orphan detection). */
  isConnected(nodeId: string): boolean;
  /** Get a renderer by id. */
  getRenderer(id: string): Renderer | undefined;
  /** Pack orphan node IDs into rows, returning DOT rank constraints + invis edges. */
  buildRowPacking(nodeIds: string[], indent: string, maxRowWidth?: number, maxPerRow?: number): string[];
  /**
   * Whether a group has edges connecting it (or its children) to an external sibling node.
   * Used to expand cluster margin so the group has enough space for external routing.
   */
  hasExternalEdge(groupId: string): boolean;
}

export abstract class Renderer {
  readonly id: string;
  private _size: { width: number; height: number } | null = null;
  /** Child renderers managed by this container (empty for leaf nodes). */
  readonly children: Renderer[] = [];
  /** Parent cell id for nested containers. */
  parentId?: string;
  /** Layout data reference for recursive child rendering. */
  private _layoutRef: LayoutResult | null = null;

  constructor(id: string) {
    this.id = id;
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

  /** Whether this renderer is a port node (port/portin/portout). */
  get isPort(): boolean { return false; }

  /** Port direction for port nodes. null for non-port nodes. */
  get portKind(): 'portin' | 'portout' | null { return null; }

  /**
   * Offset from geometic center to visual graphic center (in pixels).
   * For nodes whose visual shape (e.g. icon) is not centered within the
   * full bounding box (e.g. actor with label below), override this so DOT
   * layout can align edge routing with the actual graphic center.
   * Positive dy = graphic center is below geometric center.
   * Negative dy = graphic center is above geometric center.
   */
  graphicCenterOffset(): { dx: number; dy: number } { return { dx: 0, dy: 0 }; }

  /**
   * Build a DOT HTML-label with PORT rows for edge routing.
   * Subclasses with field-level ports override this to return an
   * HTML-label string; base returns null (no ports).
   */
  buildPortLabel(_widthPx: number): string | null {
    return null;
  }

  /**
   * Build DOT node attribute string for this node.
   * When hasPortEdges is true and buildPortLabel() returns a label,
   * uses shape=none with the HTML port label for field-level routing.
   * Otherwise: `shape=rect,fixedsize=true,width=W,height=H,label=""`.
   */
  buildDotAttributes(hasPortEdges: boolean): string {
    const PX_PER_INCH = 72;
    const sz = this.measure();
    const wInch = (sz.width / PX_PER_INCH).toFixed(6);
    const hInch = (sz.height / PX_PER_INCH).toFixed(6);
    if (hasPortEdges) {
      const htmlLabel = this.buildPortLabel(sz.width);
      if (htmlLabel) {
        return `shape=none,fixedsize=true,width=${wInch},height=${hInch},label=${htmlLabel}`;
      }
    }
    return `shape=rect,fixedsize=true,width=${wInch},height=${hInch},label=""`;
  }

  /**
   * Build DOT block lines for this renderer.
   * Leaf nodes produce a single node declaration;
   * container renderers (groups) override to produce subgraph clusters.
   */
  buildDotBlock(ctx: DotContext, indent: string): string[] {
    const attrs = this.buildDotAttributes(ctx.hasPortEdges(this.id));
    return [`${indent}"${this.id}" [${attrs}]`];
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
  static applyInlineStyle(drawioStyle: string, rawStyle: string | null | undefined): { style: string; fontColorOverride: string } {
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
      else if (parsed.lineStyle === 'bold') s += 'strokeWidth=2;';
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

  constructor(nodeId: string) {
    super(nodeId);
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
  /** DrawIO style for body text row child mxCells. */
  protected abstract getRowStyle(): string;
  /** DrawIO style for separator child mxCells. */
  protected abstract getSeparatorStyle(): string;

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
    cells.push(...this.content.renderChildren(this.id, box.width, {
      rowStyle: this.getRowStyle(),
      separatorStyle: this.getSeparatorStyle(),
    }, size.titleHeight));

    return cells;
  }
}

// ─── Renderer options ────────────────────────────────────────────────────────

/** Options for class-diagram node renderers. */
export interface ClassNodeRendererOpts {
  /** Enable UML visibility icons (+/-/#/~) in body rows. */
  visibilityIcons?: boolean;
}


