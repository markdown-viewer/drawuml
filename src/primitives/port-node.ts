/**
 * PortNodeRenderer — 12×12 filled square on a group boundary.
 *
 * Used for PlantUML `port`, `portin`, and `portout` keywords.
 *   - portin / port : square straddles the group TOP boundary; label above.
 *   - portout       : square straddles the group BOTTOM boundary; label below.
 *
 * The DOT node size is exactly 12×12 px (the square only).
 * Port snapping in dot-layout.ts moves the square center to the group boundary.
 * The label is rendered as a separate root-level text cell.
 */

import { Renderer } from './renderer.ts';
import { mxVertex } from '../shared/xml-utils.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { ContentBox } from '../shared/content.ts';
import { parseNodeStyle } from '../shared/color-utils.ts';

const LABEL_PAD_DEFAULT = 3;      // gap between square edge and label (fallback)
const DEFAULT_FILL = '#F1F1F1';
const DEFAULT_STROKE = '#181818';

export class PortNodeRenderer extends Renderer {
  private _label: string;
  private _portKind: 'portin' | 'portout';
  private _rawStyle: string | null;

  constructor(desc: RenderDescriptor) {
    super(desc.id, desc.theme);
    this._label = desc.label ?? desc.id;
    this._portKind = (desc.stereotype === 'portout') ? 'portout' : 'portin';
    this._rawStyle = desc.style ?? null;
  }

  override get isPort(): boolean { return true; }
  override get portKind(): 'portin' | 'portout' { return this._portKind; }

  /** Port is a tiny square — isCluster must always be false even if children exist (shouldn't happen). */
  override get isCluster(): boolean { return false; }

  protected doMeasure(): { width: number; height: number } {
    // DOT sees only the square (portSize × portSize); label is rendered outside the bounding box.
    const ps = this.theme.portSize;
    return { width: ps, height: ps };
  }

  render(box: ContentBox): string[] {
    // box: absolute coordinates supplied by drawio-gen.ts (post-snapping).
    // box.x, box.y = top-left of the 12×12 square.
    const cells: string[] = [];

    // Resolve colors from PlantUML inline style (#aliceblue;line:blue;…)
    let fillColor = DEFAULT_FILL;
    let strokeColor = DEFAULT_STROKE;
    let extraStyle = '';
    const parsed = parseNodeStyle(this._rawStyle);
    if (parsed) {
      if (parsed.fillColor) fillColor = parsed.fillColor;
      if (parsed.strokeColor) strokeColor = parsed.strokeColor;
      if (parsed.lineStyle === 'dashed') extraStyle += 'dashed=1;';
      else if (parsed.lineStyle === 'dotted') extraStyle += 'dashed=1;dashPattern=1 2;';
      else if (parsed.lineStyle === 'bold') extraStyle += `strokeWidth=${this.theme.strokeWidth * 3};`;
    }

    const portSize = this.theme.portSize;
    const portHalf = portSize / 2;
    const portLabelH = this.theme.portLabelH;
    const squareStyle =
      `rounded=0;fillColor=${fillColor};strokeColor=${strokeColor};strokeWidth=${this.theme.strokeWidth * 1.5};${extraStyle}`;

    // Square cell — parent='1' (root level) so coordinates are absolute
    cells.push(mxVertex({
      id: this.id,
      value: '',
      style: squareStyle,
      parent: '1',
      x: box.x,
      y: box.y,
      width: portSize,
      height: portSize,
    }));

    // Label cell — positioned above (portin) or below (portout) the square
    if (this._label) {
      const labelPad = this.theme.padXS || LABEL_PAD_DEFAULT;
      const labelWidth = Math.max(this._label.length * 9, portSize + 20);
      const labelX = box.x + portHalf - labelWidth / 2;
      const labelY = this._portKind === 'portout'
        ? box.y + portSize + labelPad       // below the square
        : box.y - portLabelH - labelPad;   // above the square

      const textColor = (parsed?.textColor) ? `fontColor=${parsed.textColor};` : '';
      cells.push(mxVertex({
        id: `${this.id}__lbl`,
        value: this._label,
        style: `text;align=center;verticalAlign=middle;${textColor}fontSize=${this.theme.fontSize};`,
        parent: '1',
        x: labelX,
        y: labelY,
        width: labelWidth,
        height: portLabelH,
      }));
    }

    return cells;
  }
}

export function registerPortNodeRenderer(): void {
  const factory = (desc: RenderDescriptor) => new PortNodeRenderer(desc);
  registerRenderer('portin', factory);
  registerRenderer('portout', factory);
  // 'port' keyword maps to 'portin' stereotype in the parser
}
