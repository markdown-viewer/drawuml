/**
 * Legend primitive — sizing and rendering for class-diagram legends.
 * Extends RichRenderer with rich body mode (desc.lines as content).
 */

import { richTextStyle } from '../../shared/content.ts';
import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, LEGEND_FILL, TITLE_PAD_X } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEGEND_PADDING_X = TITLE_PAD_X;
const LEGEND_PADDING_Y = 16;
const LEGEND_MIN_WIDTH = 40;

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

function legendStyle(): string {
  return `rounded=1;absoluteArcSize=1;arcSize=15;whiteSpace=wrap;html=1;align=left;verticalAlign=middle;spacingLeft=5;spacingRight=5;fillColor=${LEGEND_FILL};strokeColor=${COLOR_DARK};`;
}

/** Text row style inside legend. */
function legendTextStyle(): string {
  return richTextStyle(5, 5);
}

/** Separator style inside legend. */
function legendSepStyle(): string {
  return [
    'line', 'strokeWidth=1', 'align=left', 'verticalAlign=middle',
    'spacingTop=-1', 'spacingLeft=3', 'spacingRight=3',
    'rotatable=0', 'labelPosition=right', 'points=[]',
  ].join(';') + ';';
}

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class LegendRenderer extends RichRenderer {
  constructor(desc: RenderDescriptor) {
    super(desc);
  }

  get isCluster(): boolean { return false; }

  // Legend always uses rich body mode (desc.lines as content)
  protected detectRichBody(): boolean { return true; }
  protected getRichBodyLines(): string[] { return this.desc.lines || []; }

  protected getRichBodyMetrics(): Record<string, number> {
    return {
      paddingX: LEGEND_PADDING_X,
      paddingY: LEGEND_PADDING_Y,
      minWidth: LEGEND_MIN_WIDTH,
    };
  }

  // Legend style is a complete container style (no fragment extraction needed)
  protected get richBodyStyleComplete(): boolean { return true; }

  protected buildStyle(): string {
    return legendStyle();
  }

  // Legend doesn't use deployment shape color override — colors are fixed
  protected applyColorOverride(s: string): string { return s; }

  protected getRichBodyRowStyle(): string { return legendTextStyle(); }
  protected getRichBodySepStyle(): string { return legendSepStyle(); }
}

/** Register legend renderer into global registry. */
export function registerLegendRenderer(): void {
  registerRenderer('legend', (desc: RenderDescriptor) => new LegendRenderer(desc));
}
