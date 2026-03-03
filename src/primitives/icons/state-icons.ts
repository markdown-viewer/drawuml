/**
 * State pseudo-node icon renderers — small symbol-only nodes for state diagrams.
 *
 * Extends IconRenderer so sizes follow theme.iconSize like all other
 * icon-based nodes (circle, actor, diamond, junction…).
 *
 *   - state_start  : filled black circle (initial pseudo-state)
 *   - state_end    : double circle (bull's eye, final pseudo-state)
 *   - flow_final   : X-in-circle (flow final)
 *   - state_history: circle with H or H* label
 */

import { mxVertex } from '../../shared/xml-utils.ts';
import { IconRenderer } from './icon-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

class StateStartRenderer extends IconRenderer {
  constructor(desc: RenderDescriptor) { super(desc); }

  render(box: ContentBox) {
    const d = this.iconWidth;
    const x = box.x + (box.width - d) / 2;
    const y = box.y + (box.height - d) / 2;
    return [mxVertex({ id: this.id, value: '', style: `shape=startState;whiteSpace=wrap;html=1;aspect=fixed;fillColor=${this.theme.colorDark};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`, parent: this.parentId || '1', x, y, width: d, height: d })];
  }
}

// ---------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------

class StateEndRenderer extends IconRenderer {
  constructor(desc: RenderDescriptor) { super(desc); }

  render(box: ContentBox) {
    const d = this.iconWidth;
    const x = box.x + (box.width - d) / 2;
    const y = box.y + (box.height - d) / 2;
    return [mxVertex({ id: this.id, value: '', style: `shape=endState;whiteSpace=wrap;html=1;aspect=fixed;fillColor=${this.theme.colorDark};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`, parent: this.parentId || '1', x, y, width: d, height: d })];
  }
}

// ---------------------------------------------------------------------------
// Flow Final
// ---------------------------------------------------------------------------

class FlowFinalRenderer extends IconRenderer {
  constructor(desc: RenderDescriptor) { super(desc); }

  render(box: ContentBox) {
    const d = this.iconWidth;
    const x = box.x + (box.width - d) / 2;
    const y = box.y + (box.height - d) / 2;
    return [mxVertex({ id: this.id, value: '', style: `shape=flowFinal;whiteSpace=wrap;html=1;aspect=fixed;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`, parent: this.parentId || '1', x, y, width: d, height: d })];
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

class StateHistoryRenderer extends IconRenderer {
  private historyLabel: string;

  constructor(desc: RenderDescriptor) {
    super(desc);
    this.historyLabel = desc.label || 'H';
  }

  render(box: ContentBox) {
    const d = this.iconWidth;
    const x = box.x + (box.width - d) / 2;
    const y = box.y + (box.height - d) / 2;
    return [mxVertex({
      id: this.id,
      value: this.historyLabel,
      style: `ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontSize=${this.theme.smallFontSize};fontStyle=1;`,
      parent: this.parentId || '1',
      x, y, width: d, height: d,
    })];
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerStateIconRenderers(): void {
  registerRenderer('state_start', (desc: RenderDescriptor) => new StateStartRenderer(desc));
  registerRenderer('state_end', (desc: RenderDescriptor) => new StateEndRenderer(desc));
  registerRenderer('state_flow_final', (desc: RenderDescriptor) => new FlowFinalRenderer(desc));
  registerRenderer('state_history', (desc: RenderDescriptor) => new StateHistoryRenderer(desc));
}
