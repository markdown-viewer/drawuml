/**
 * Mindmap diagram → DrawIO XML generator.
 *
 * Takes a MindmapModel and its layout result, produces a complete
 * DrawIO mxfile XML string. Node style follows PlantUML defaults:
 * rounded rectangles with uniform fill (#F1F1F1), matching the
 * legend renderer style.
 */

import type { MindmapModel, MindmapNode } from '../parsers/mindmap.ts';
import type { MindmapLayoutResult } from '../layout/mindmap-layout.ts';
import { escapeXml, wrapMxfile, cellId } from '../shared/xml-utils.ts';
import type { Theme } from '../shared/theme.ts';
import { createTheme } from '../shared/theme.ts';
import type { Renderer } from '../primitives/renderer.ts';

export function mindmapToDrawioXml(
  model: MindmapModel,
  layout: MindmapLayoutResult,
  renderers: Map<string, Renderer>,
  theme: Theme = createTheme(),
): string {
  const cells: string[] = [];
  cells.push('<mxCell id="0"/>');
  cells.push('<mxCell id="1" parent="0"/>');

  // Render nodes via renderer pipeline
  for (const [id, box] of Object.entries(layout.nodes)) {
    const r = renderers.get(id);
    if (r) {
      cells.push(...r.render(box));
    }
  }

  // Render edges (curved orthogonal connectors — DrawIO handles routing)
  for (let i = 0; i < layout.edges.length; i++) {
    const edge = layout.edges[i];
    const edgeId = `mm_edge_${i}`;

    // Set exit/entry ports based on branch side
    let portStyle: string;
    if (edge.side === 'right') {
      // Parent exits right, child enters left
      portStyle = 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;';
    } else if (edge.side === 'left') {
      // Parent exits left, child enters right
      portStyle = 'exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;';
    } else if (edge.side === 'top') {
      // BT: parent exits top, child enters bottom
      portStyle = 'exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=0.5;entryY=1;entryDx=0;entryDy=0;';
    } else {
      // TB: parent exits bottom, child enters top
      portStyle = 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;';
    }

    const style = 'edgeStyle=orthogonalEdgeStyle;curved=1;'
      + portStyle
      + 'endArrow=none;endFill=0;'
      + `strokeColor=${theme.colorDark};strokeWidth=${theme.strokeWidth};`;

    cells.push(
      `<mxCell id="${escapeXml(cellId(edgeId))}" value="" style="${style}" edge="1" parent="${escapeXml(cellId('1'))}" source="${escapeXml(cellId(edge.fromId))}" target="${escapeXml(cellId(edge.toId))}">`
      + `<mxGeometry relative="1" as="geometry"/>`
      + `</mxCell>`
    );
  }

  return wrapMxfile(cells);
}
