/**
 * RichRenderer — standardised base class for deployment / component shapes.
 *
 * Subclasses ONLY define the visual frame:
 *   - buildStyle()           — DrawIO shape style string
 *   - extraPadX / extraPadY  — padding added by shape decoration
 *   - contentXOffset / contentYOffset — content area origin offset
 *   - contentWidthReduction  — width consumed by frame decoration
 *
 * Base class handles ALL content logic:
 *   - Label + stereotype (default mode)
 *   - Bracket body with separators (when desc.bodyLines present)
 *   - doMeasure() via Content.measure() + frame padding
 *   - render() with frame cell + content label / separator children / container children
 *   - DOT subgraph / node generation
 *   - Color / inline-style application
 */

import { Content, richTextStyle } from '../../shared/content.ts';
import { mxVertex, mxContentLabel, escapeXml } from '../../shared/xml-utils.ts';
import { Renderer } from '../renderer.ts';
import { buildClusterDotBlock } from '../group.ts';
import { buildLabelHtml } from '../label.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { COLOR_DARK, DEFAULT_FILL, DEFAULT_FONT_SIZE, TITLE_MIN_WIDTH, TITLE_PAD_X, TITLE_PAD_Y } from '../../shared/theme.ts';
import type { DotContext } from '../renderer.ts';
import type { ContentBox } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

/** Style keys that belong to container layout, not shape identity. */
const LAYOUT_STYLE_KEYS = new Set([
  'whiteSpace', 'html', 'fontStyle', 'fontSize', 'align', 'verticalAlign',
  'spacingTop', 'spacingLeft', 'spacingRight', 'spacingBottom',
  'fillColor', 'strokeColor', 'strokeWidth', 'fontColor',
  'collapsible', 'container', 'overflow', 'swimlaneHead', 'swimlaneBody',
]);

/**
 * Extract shape-identity fragment from a full style string.
 * Strips common layout properties, keeping only shape-specific keys
 * (e.g. 'shape=cube;size=10;').
 */
function extractShapeFragment(fullStyle: string): string {
  const parts = fullStyle.split(';').filter(p => {
    if (!p) return false;
    const key = p.split('=')[0];
    return !LAYOUT_STYLE_KEYS.has(key);
  });
  return parts.length > 0 ? parts.join(';') + ';' : 'rounded=0;';
}

/** DrawIO style for rich text row child mxCells. */
function bracketRowStyle(): string {
  return richTextStyle(10, 10);
}

/** DrawIO style for separator child mxCells. */
function bracketSepStyle(): string {
  return [
    'line', 'strokeWidth=1', 'align=left', 'verticalAlign=middle',
    'spacingTop=-1', 'spacingLeft=3', 'spacingRight=3',
    'rotatable=0', 'labelPosition=right', 'points=[]',
  ].join(';') + ';';
}

export abstract class RichRenderer extends Renderer {
  protected desc: RenderDescriptor;
  /** Measured content (label + stereotype HTML or rich body lines). */
  protected content: Content;
  /** Whether this node uses rich body content (bracket body or raw lines). */
  protected readonly hasRichBody: boolean;

  constructor(desc: RenderDescriptor) {
    super(desc.id);
    this.desc = desc;
    this.hasRichBody = this.detectRichBody();
    this.content = this.buildContent();
  }

  protected get label(): string { return this.desc.label ?? ''; }
  protected get color(): string | undefined { return this.desc.color; }

  // ── Subclass: frame-only concerns ─────────────────────────────────────────

  /** DrawIO style string for the shape frame. */
  protected abstract buildStyle(): string;

  /** Extra horizontal padding for shape decoration (e.g. hexagon sides). */
  protected get extraPadX(): number { return 0; }

  /** Extra vertical padding for shape decoration (e.g. database caps). */
  protected get extraPadY(): number { return 0; }

  /** Horizontal offset for content area within frame. */
  protected get contentXOffset(): number { return 0; }

  /** Vertical offset for content area within frame (e.g. folder tab). */
  protected get contentYOffset(): number { return 0; }

  /** Width consumed by frame decoration (e.g. artifact icon on right). */
  protected get contentWidthReduction(): number { return 0; }

  // ── Content construction ──────────────────────────────────────────────────

  /**
   * Detect whether this node uses rich body content.
   * Default: true when desc.bodyLines present. Override for note/legend
   * which use desc.lines as rich body.
   */
  protected detectRichBody(): boolean {
    return !!(this.desc.bodyLines && this.desc.bodyLines.length > 0);
  }

  /**
   * Return raw text lines for rich body content.
   * Default: desc.bodyLines. Override for note/legend which use desc.lines.
   */
  protected getRichBodyLines(): string[] {
    return (this.desc.bodyLines || []).map(
      (l: any) => typeof l === 'string' ? l : l.text
    );
  }

  /**
   * Return custom Content.richBody metrics for rich body mode.
   * Default: undefined (use RICH_BODY_METRICS defaults).
   * Override for shapes like note/legend with custom padding.
   */
  protected getRichBodyMetrics(): Record<string, number> | undefined {
    return undefined;
  }

  /**
   * Build Content from label + stereotype HTML, or rich body lines.
   * Override for custom label patterns (e.g. package shows stereo in body).
   */
  protected buildContent(): Content {
    if (this.hasRichBody) {
      return Content.richBody(this.getRichBodyLines(), this.getRichBodyMetrics());
    }
    const labelHtml = Content.inline(this.label).html;
    return Content.rich(buildLabelHtml({
      label: labelHtml,
      stereotypeLabel: this.desc.stereotypeLabel || undefined,
    }));
  }

  /**
   * Whether the rich body frame style is a complete container style (true)
   * or needs to be decomposed into shape fragment + layout (false).
   * Default: false (deployment shapes need fragment extraction).
   * Override to true for note/legend whose buildStyle() is already complete.
   */
  protected get richBodyStyleComplete(): boolean { return false; }

  /** DrawIO style for rich body text row child mxCells. */
  protected getRichBodyRowStyle(): string { return bracketRowStyle(); }

  /** DrawIO style for rich body separator child mxCells. */
  protected getRichBodySepStyle(): string { return bracketSepStyle(); }

  /**
   * HTML value placed directly on the frame mxVertex.
   * Default: full content for clusters, empty for leaves (content goes in child label).
   * Override for shapes with a title area (e.g. folder tab always shows label).
   */
  protected getFrameValue(): string {
    return this.isCluster ? this.content.html : '';
  }

  /**
   * HTML for the body content label (mxContentLabel child).
   * Default: full content.html.
   * Override for shapes where body differs from frame value (e.g. package body = stereo only).
   */
  protected getBodyHtml(): string {
    return this.content.html;
  }

  /**
   * Apply color override to the style string.
   * Default: replace fillColor. Override for shapes like label that use fontColor.
   */
  protected applyColorOverride(style: string): string {
    if (this.color) return style.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    return style;
  }

  /**
   * Post-process the fully resolved style string.
   * Called after applyColorOverride and applyInlineStyle.
   * Override for shapes like frame that convert fillColor → swimlaneFillColor.
   */
  protected postProcessStyle(style: string): string { return style; }

  /**
   * Compute the actual frame rectangle within the layout box.
   * Default: same as box. Override for shapes like collections with shadow offset.
   */
  protected frameBox(box: ContentBox): ContentBox { return box; }

  /**
   * Extra cells for frame decoration, rendered before the main frame cell.
   * Default: none. Override for shapes like collections (back shadow rect).
   */
  protected renderExtraCells(_box: ContentBox): string[] { return []; }

  // ── Base class: measurement, DOT, render ──────────────────────────────────

  protected doMeasure() {
    if (this.isCluster) return { width: 0, height: 0 };
    const size = this.content.measure();
    if (this.hasRichBody) {
      // Content.richBody metrics already include all padding;
      // extraPadX/Y from subclass account for shape decoration.
      return {
        width: size.width + this.extraPadX,
        height: size.height + this.extraPadY,
      };
    }
    return {
      width: Math.max(TITLE_MIN_WIDTH, size.width + TITLE_PAD_X + this.extraPadX),
      height: size.height + TITLE_PAD_Y + this.extraPadY,
    };
  }

  buildDotBlock(ctx: DotContext, indent: string): string[] {
    if (this.isCluster) return buildClusterDotBlock(this.id, this.label, this.children, ctx, indent);
    return [`${indent}"${this.id}" [${this.buildDotAttributes(false)}]`];
  }

  render(box: ContentBox): string[] {
    // Rich body mode: shape frame + rich body content with separators
    if (this.hasRichBody) return this.renderRichBody(box);

    const fb = this.frameBox(box);
    const frameValue = this.getFrameValue();
    const bodyHtml = this.getBodyHtml();

    let s = this.buildStyle();

    // Apply color override (subclass hook)
    s = this.applyColorOverride(s);

    // Non-cluster: remove container marking
    if (!this.isCluster) s = s.replace('container=1;', '');

    // Cluster: title at top instead of middle
    if (this.isCluster) s = s.replace('verticalAlign=middle', 'verticalAlign=top');

    // Apply inline style overrides
    const { style: styledS, fontColorOverride } = Renderer.applyInlineStyle(s, this.desc.style);
    s = styledS;
    // Apply text color override to frame fontColor (e.g. package tab text)
    if (fontColorOverride) s = s.replace(/fontColor=[^;]*;/, fontColorOverride);

    // Post-process style (subclass hook, e.g. frame swimlaneFillColor)
    s = this.postProcessStyle(s);

    // Extra frame decoration cells (e.g. collections back rect)
    const cells = this.renderExtraCells(box);

    // Frame cell
    cells.push(mxVertex({
      id: this.id,
      value: frameValue,
      style: s,
      parent: this.parentId || '1',
      x: fb.x, y: fb.y, width: fb.width, height: fb.height,
    }));

    if (this.isCluster) {
      // Body content as decorative child when it differs from frame value
      // (e.g. package: frame=label, body=stereotype)
      if (bodyHtml && bodyHtml !== frameValue) {
        const stereoStyle = `text;html=1;align=center;verticalAlign=middle;`
          + `resizable=0;points=[];autosize=0;strokeColor=none;fillColor=none;`
          + `fontSize=12;fontColor=${COLOR_DARK};`;
        cells.push(mxVertex({
          id: `${this.id}__body`,
          value: bodyHtml,
          style: stereoStyle,
          parent: this.id,
          x: 0, y: this.contentYOffset,
          width: fb.width, height: 20,
        }));
      }
      cells.push(...this.renderChildren());
    } else if (bodyHtml) {
      // Content label as child cell
      const labelStyle = `fontSize=${DEFAULT_FONT_SIZE};${fontColorOverride || `fontColor=${COLOR_DARK};`}`;
      cells.push(mxContentLabel(
        this.id, bodyHtml,
        fb.width - this.contentWidthReduction, fb.height,
        labelStyle,
        this.contentYOffset, this.contentXOffset,
      ));
    }

    return cells;
  }

  // ── Rich body rendering ────────────────────────────────────────────────────

  /**
   * Build container style for rich body mode.
   * When richBodyStyleComplete is true, uses buildStyle() directly.
   * Otherwise extracts shape fragment and builds container layout style.
   */
  private buildRichBodyContainerStyle(): string {
    if (this.richBodyStyleComplete) return this.buildStyle();
    const shapeFragment = extractShapeFragment(this.buildStyle());
    const base = [
      'html=1', 'whiteSpace=wrap', 'container=1',
      shapeFragment.replace(/;$/, ''),
      `fillColor=${DEFAULT_FILL}`, `strokeColor=${COLOR_DARK}`, 'strokeWidth=0.5',
      'align=left', 'verticalAlign=top',
      'spacingLeft=10', 'spacingRight=10', `spacingTop=${6 + this.contentYOffset}`, 'spacingBottom=6',
      'overflow=hidden',
    ];
    return base.join(';') + ';';
  }

  /**
   * Render in rich body mode: shape frame container + rich body children.
   */
  private renderRichBody(box: ContentBox): string[] {
    let s = this.buildRichBodyContainerStyle();
    s = this.applyColorOverride(s);
    const { style: styledS } = Renderer.applyInlineStyle(s, this.desc.style);
    s = styledS;
    s = this.postProcessStyle(s);

    const fillColor = s.match(/fillColor=([^;]*)/)?.[1] || DEFAULT_FILL;
    const strokeColor = s.match(/strokeColor=([^;]*)/)?.[1] || COLOR_DARK;

    const cells: string[] = [];
    if (this.content.hasSeparators) {
      cells.push(mxVertex({
        id: this.id, value: '', style: s,
        parent: this.parentId || '1',
        x: box.x, y: box.y, width: box.width, height: box.height,
      }));
      cells.push(...this.content.renderChildren(this.id, box.width, {
        rowStyle: this.getRichBodyRowStyle(),
        separatorStyle: this.getRichBodySepStyle(),
        fillColor,
        strokeColor,
      }, this.contentYOffset));
    } else {
      cells.push(mxVertex({
        id: this.id, value: this.content.html, style: s,
        parent: this.parentId || '1',
        x: box.x, y: box.y, width: box.width, height: box.height,
      }));
    }
    return cells;
  }
}
