/**
 * RichRenderer — standardised base class for deployment / component shapes.
 *
 * Subclasses ONLY define the visual frame:
 *   - buildStyle()     — DrawIO shape style string
 *   - shapePadding      — { top, bottom, left, right, titlebar } for shape decoration
 *
 * Base class handles ALL content logic:
 *   - Label + stereotype (default mode)
 *   - Bracket body with separators (when desc.bodyLines present)
 *   - doMeasure() via Content.measure() + shapePadding + titlebar
 *   - render() with frame cell + content label / separator children / container children
 *   - DOT subgraph / node generation
 *   - Color / inline-style application
 */

import { BlockLayout } from '../../shared/block-layout.ts';
import { TextBlock, DEFAULT_FONT } from '../../shared/text-block.ts';
import { mxVertex, mxContentLabel, escapeXml, n4 } from '../../shared/xml-utils.ts';
import { Renderer } from '../renderer.ts';
import { buildLabelHtml } from '../label.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import type { ContentBox } from '../../shared/content-types.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { Theme } from '../../shared/theme.ts';
import { fontFamilyStyle } from '../../shared/theme.ts';

/**
 * Shape decoration padding returned by each subclass.
 * All values default to 0 when omitted.
 *   - top/bottom/left/right: extra space consumed by shape decoration
 */
export interface ShapePadding {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

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


export abstract class RichRenderer extends Renderer {
  protected desc: RenderDescriptor;
  /** Measured content (label + stereotype HTML or rich body lines). */
  protected content: BlockLayout;
  /** Whether this node uses rich body content (bracket body or raw lines). */
  protected readonly hasRichBody: boolean;

  constructor(desc: RenderDescriptor) {
    super(desc.id, desc.theme);
    this.desc = desc;
    this.hasRichBody = this.detectRichBody();
    this.content = this.buildContent();
  }

  protected get label(): string { return this.desc.label ?? ''; }
  protected get color(): string | undefined { return this.desc.color; }

  // ── Subclass: frame-only concerns ─────────────────────────────────────────

  /** DrawIO style string for the shape frame. */
  protected abstract buildStyle(): string;

  /**
   * Shape decoration padding.
   * Subclasses override to declare extra space consumed by shape decoration.
   * @param contentSize — measured content dimensions including contentPad, strokeWidth and titlebar
   */
  protected shapePadding(_contentSize?: { width: number; height: number }): ShapePadding { return {}; }

  /** Whether the shape has a titlebar area. Override to true in subclasses like folder/database. */
  protected get hasTitlebar(): boolean { return false; }

  /**
   * Height of the title/header area.
   * Only hasTitlebar shapes (folder, database, card, frame) have a title area;
   * non-titlebar shapes render label in the content area.
   */
  protected get titleAreaHeight(): number {
    return this.hasTitlebar ? this.theme.sizeS : 0;
  }

  /**
   * Unified four-side content padding (text breathing space inside shape).
   * Applied by base class in doMeasure() and buildRichBodyContainerStyle().
   * The mxGraph +2 horizontal compensation is handled transparently.
   */
  protected get contentPad(): number { return this.theme.padXS; }

  /** Content rect including contentPad, strokeWidth, and title area height. */
  private computeContentRect(): { width: number; height: number } {
    const size = this.content.measure();
    const cp = this.contentPad;
    const sw = this.theme.strokeWidth;
    return {
      width: size.width + cp * 2 + sw * 2,
      height: size.height + cp * 2 + sw * 2 + this.titleAreaHeight,
    };
  }

  /** Resolved top pad: shapePadding.top + titleAreaHeight. */
  private get resolvedTopPad(): number {
    const pad = this.shapePadding(this.computeContentRect());
    const shapeTop = pad.top ?? 0;
    return shapeTop + this.titleAreaHeight;
  }

  // Unified group top padding from shapePadding declaration.
  // Clusters with label need title space even if hasTitlebar is false.
  override get groupTopPadding(): number {
    const pad = this.shapePadding(this.computeContentRect());
    const shapeTop = pad.top ?? 0;
    const titleH = this.hasTitlebar ? this.theme.sizeS
      : this.label ? this.theme.sizeXS : 0;
    return this.theme.padXL + titleH + shapeTop;
  }

  // ── Content construction ──────────────────────────────────────────────────

  /**
   * Detect whether this node uses rich body content.
   * True when bodyLines or multi-line label contain at least one separator (----/====/..).
   * Plain multi-line bodies without separators are rendered as label content.
   */
  protected detectRichBody(): boolean {
    if (this.desc.bodyLines && this.desc.bodyLines.length > 0) {
      const lines = (this.desc.bodyLines as any[]).map(l => typeof l === 'string' ? l : l.text);
      return BlockLayout.richBody(lines).hasSeparators;
    }
    // Fallback: multi-line label (from "as" syntax) may contain separators
    if (this.label && this.label.includes('\n')) {
      return BlockLayout.richBody(this.label.split('\n')).hasSeparators;
    }
    return false;
  }

  /**
   * Return raw text lines for rich body content.
   * Default: desc.bodyLines. Override for note/legend which use desc.lines.
   */
  protected getRichBodyLines(): string[] {
    if (this.desc.bodyLines && this.desc.bodyLines.length > 0) {
      return (this.desc.bodyLines as any[]).map(
        (l: any) => typeof l === 'string' ? l : l.text
      );
    }
    // Fallback: split multi-line label into lines
    if (this.label && this.label.includes('\n')) {
      return this.label.split('\n');
    }
    return [];
  }

  /**
   * Build Content from label + stereotype HTML, or rich body lines.
   * Override for custom label patterns (e.g. package shows stereo in body).
   */
  protected buildContent(): BlockLayout {
    const fontSize = this.theme.fontSize;
    const fontFamily = this.theme.fontFamily;
    if (this.hasRichBody) {
      return BlockLayout.richBody(this.getRichBodyLines(), { bodyFontSize: fontSize, fontFamily }, this.theme);
    }
    // bodyLines without separators: render lines as the node's display content
    if (this.desc.bodyLines && this.desc.bodyLines.length > 0) {
      const lines = this.getRichBodyLines();
      const html = lines.map(l => TextBlock.inline(l, DEFAULT_FONT).html).join('<br />');
      return BlockLayout.rich(html, { bodyFontSize: fontSize, fontFamily });
    }
    const labelHtml = TextBlock.inline(this.label, DEFAULT_FONT).html;
    return BlockLayout.rich(buildLabelHtml({
      label: labelHtml,
      stereotypeLabel: this.desc.stereotypeLabel || undefined,
      fontSize,
    }), { bodyFontSize: fontSize, fontFamily });
  }

  /**
   * Whether the rich body frame style is a complete container style (true)
   * or needs to be decomposed into shape fragment + layout (false).
   * Default: false (deployment shapes need fragment extraction).
   * Override to true for note/legend whose buildStyle() is already complete.
   */
  protected get richBodyStyleComplete(): boolean { return false; }



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
   * When user specifies a color, replace fillColor with that color.
   * Otherwise, replace fillColor=none with theme.defaultFill as fallback.
   * Override for shapes like label that use fontColor.
   */
  protected applyColorOverride(style: string): string {
    if (this.color) return style.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    const fill = this.isCluster ? this.theme.groupFill : this.theme.defaultFill;
    return style.replace('fillColor=none', `fillColor=${fill}`);
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
    const contentRect = this.computeContentRect();
    const pad = this.shapePadding(contentRect);
    const padLeft = pad.left ?? 0;
    const padRight = pad.right ?? 0;
    const padTop = pad.top ?? 0;
    const padBottom = pad.bottom ?? 0;
    if (this.hasRichBody) {
      // contentRect already includes contentPad, strokeWidth, and title area;
      // shapePadding adds shape decoration space.
      return {
        width: contentRect.width + padLeft + padRight,
        height: contentRect.height + padTop + padBottom,
      };
    }
    return {
      width: Math.max(this.theme.sizeXL, size.width + this.theme.padS * 2 + padLeft + padRight),
      height: size.height + this.theme.padS * 2 + padTop + padBottom + this.titleAreaHeight,
    };
  }

  get clusterLabel(): string { return this.label; }

  render(box: ContentBox): string[] {
    // Rich body mode: shape frame + rich body content with separators
    if (this.hasRichBody) return this.renderRichBody(box);

    const fb = this.frameBox(box);
    const frameValue = this.getFrameValue();
    const bodyHtml = this.getBodyHtml();

    let s = this.buildStyle();

    // Inject custom fontFamily when user overrides the default
    s += fontFamilyStyle(this.theme);

    // Apply color override (subclass hook)
    s = this.applyColorOverride(s);

    // Non-cluster: remove container marking
    if (!this.isCluster) s = s.replace('container=1;', '');

    // Apply inline style overrides
    const { style: styledS, fontColorOverride } = Renderer.applyInlineStyle(s, this.desc.style, this.theme.boldStrokeWidth);
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
          + `fontSize=${this.theme.fontSize};fontColor=${this.theme.colorDark};`
          + fontFamilyStyle(this.theme);
        cells.push(mxVertex({
          id: `${this.id}__body`,
          value: bodyHtml,
          style: stereoStyle,
          parent: this.id,
          x: 0, y: this.resolvedTopPad,
          width: fb.width, height: this.theme.sizeS,
        }));
      }
      cells.push(...this.renderChildren());
    } else if (bodyHtml) {
      // Content label as child cell
      const labelStyle = `fontSize=${this.theme.fontSize};${fontColorOverride || `fontColor=${this.theme.colorDark};`}${fontFamilyStyle(this.theme)}`;
      const pad = this.shapePadding(this.computeContentRect());
      cells.push(mxContentLabel(
        this.id, bodyHtml,
        fb.width, fb.height,
        labelStyle,
        this.resolvedTopPad, pad.left ?? 0,
        pad.right ?? 0, pad.bottom ?? 0,
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
    const fullStyle = this.buildStyle();
    const shapeFragment = extractShapeFragment(fullStyle);
    const cp = this.contentPad;
    // Preserve original fillColor/strokeColor from buildStyle if present
    const fill = fullStyle.match(/fillColor=([^;]*)/)?.[1] ?? this.theme.defaultFill;
    const stroke = fullStyle.match(/strokeColor=([^;]*)/)?.[1] ?? this.theme.colorDark;
    const base = [
      'html=1', 'whiteSpace=wrap', 'container=1',
      shapeFragment.replace(/;$/, ''),
      `fillColor=${fill}`, `strokeColor=${stroke}`, `strokeWidth=${this.theme.strokeWidth}`,
      'align=left', 'verticalAlign=top',
      `spacingLeft=${cp}`, `spacingRight=${cp}`, `spacingTop=${n4(cp + this.resolvedTopPad)}`, `spacingBottom=${cp}`,
      'overflow=hidden',
      `fontSize=${this.theme.fontSize}`, `fontFamily=${this.theme.fontFamily}`,
    ];
    return base.join(';') + ';';
  }

  /**
   * Render in rich body mode: shape frame container + rich body children.
   */
  private renderRichBody(box: ContentBox): string[] {
    let s = this.buildRichBodyContainerStyle();
    s = this.applyColorOverride(s);
    const { style: styledS } = Renderer.applyInlineStyle(s, this.desc.style, this.theme.boldStrokeWidth);
    s = styledS;
    s = this.postProcessStyle(s);

    const fillColor = s.match(/fillColor=([^;]*)/)?.[1] || this.theme.defaultFill;
    const strokeColor = s.match(/strokeColor=([^;]*)/)?.[1] || this.theme.colorDark;

    const cells: string[] = [];
    // Always use child cells for content positioning.
    // Putting content directly as container value with verticalAlign=top causes
    // drawio2svg to add a fixed +7px baseOffset, making top padding unstable
    // across font sizes.  Child cells with verticalAlign=middle and precise
    // heights avoid this offset entirely.
    cells.push(mxVertex({
      id: this.id, value: '', style: s,
      parent: this.parentId || '1',
      x: box.x, y: box.y, width: box.width, height: box.height,
    }));
    // Compute content inset for child positioning (e.g. ellipse geometry)
    const contentRect = this.computeContentRect();
    const pad = this.shapePadding(contentRect);
    const padLeft = pad.left ?? 0;
    const padRight = pad.right ?? 0;
    const padTop = pad.top ?? 0;
    const childWidth = box.width - padLeft - padRight;
    const childStartY = this.titleAreaHeight + this.contentPad + padTop;
    cells.push(...this.content.renderChildren(this.id, childWidth, {
      fillColor,
      strokeColor,
    }, childStartY, padLeft));
    return cells;
  }
}
