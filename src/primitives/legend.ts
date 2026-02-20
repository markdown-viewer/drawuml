/**
 * Legend primitive — sizing and rendering for class-diagram legends.
 * Processes raw PlantUML Creole lines internally via Content.richBody().
 */

import { Content, richTextStyle } from '../shared/content.ts';
import { RichBodyRenderer } from './renderer.ts';
import { COLOR_DARK, LEGEND_FILL, TITLE_PAD_X } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { ContentBox } from '../shared/content.ts';

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

class LegendRenderer extends RichBodyRenderer {
  constructor(
    id: string,
    rawLines: string[],
    opts?: { align?: string },
  ) {
    super(id);
    this.style = legendStyle();
    this.fillColor = LEGEND_FILL;
    this.strokeColor = COLOR_DARK;
    this.content = Content.richBody(rawLines, {
      paddingX: LEGEND_PADDING_X,
      paddingY: LEGEND_PADDING_Y,
      minWidth: LEGEND_MIN_WIDTH,
    });
  }

  protected getRowStyle() { return legendTextStyle(); }
  protected getSeparatorStyle() { return legendSepStyle(); }
}

/** Register legend renderer into global registry. */
export function registerLegendRenderer(): void {
  registerRenderer('legend', (desc: RenderDescriptor) => {
    return new LegendRenderer(desc.id, desc.lines || []);
  });
}
