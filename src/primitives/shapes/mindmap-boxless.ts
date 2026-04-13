/**
 * Mindmap boxless node renderer.
 *
 * Renders as plain text with no border or background, but supports
 * full rich text (Creole block-level processing via desc.lines),
 * same as MindmapNodeRenderer.
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class MindmapBoxlessRenderer extends RichRenderer {
  // Always use rich body mode (desc.lines as content)
  protected detectRichBody(): boolean { return true; }
  protected getRichBodyLines(): string[] { return this.desc.lines || []; }

  // No internal padding — text only
  protected get contentPad(): number { return 0; }

  // No color override needed — always transparent
  protected applyColorOverride(style: string): string { return style; }

  protected buildStyle(): string {
    return `text;html=1;align=center;verticalAlign=middle;fillColor=none;strokeColor=none;strokeWidth=0;fontSize=${this.theme.fontSize};fontFamily=${this.theme.fontFamily};`;
  }
}

/** Register mindmap-boxless renderer into global registry. */
export function registerMindmapBoxlessRenderer(): void {
  registerRenderer('mindmap-boxless', (desc: RenderDescriptor) => new MindmapBoxlessRenderer(desc));
}
