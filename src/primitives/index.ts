/**
 * Barrel export for all rendering primitives.
 *
 * All renderer creation goes through the global registry.
 * Modules register their factories at import time via registerXxx().
 * No classes or custom factory functions are exported from individual modules.
 */

// ── Renderer base class + options types ──────────────────────────────────────
export { Renderer, SwimlaneRenderer } from './renderer.ts';
export type { NodeRenderer, ClassNodeRendererOpts } from './renderer.ts';

// ── Global registry API re-exports ───────────────────────────────────────────
export { createRenderer } from './registry.ts';
export type { RenderDescriptor, NodeDescriptor, ElementDescriptor } from './registry.ts';

// ── Registration calls — import each module to trigger registration ──────────
import { registerCircleRenderer } from './icons/circle.ts';
import { registerDiamondRenderer } from './icons/diamond.ts';
import { registerStateIconRenderers } from './icons/state-icons.ts';
import { registerClassNodeRenderer } from './class-node.ts';
import { registerMapNodeRenderer } from './map-node.ts';
import { registerStateNodeRenderers } from './state-node.ts';
import { registerUsecaseShape } from './shapes/usecase.ts';
import { registerActorRenderer } from './icons/actor.ts';
import { registerActivityNodeRenderer } from './shapes/activity.ts';
import { registerFolderShape } from './shapes/folder.ts';
import { registerRectangleShape } from './shapes/rectangle.ts';
import { registerNodeCubeShape } from './shapes/node-cube.ts';
import { registerFrameShape as registerFrameShapeShape } from './shapes/frame.ts';
import { registerCloudShape } from './shapes/cloud.ts';
import { registerDatabaseShape } from './shapes/database.ts';
import { registerAgentShape } from './shapes/agent.ts';
import { registerStorageShape } from './shapes/storage.ts';
import { registerComponentShape } from './shapes/component.ts';
import { registerArtifactShape } from './shapes/artifact.ts';
import { registerCardShape } from './shapes/card.ts';
import { registerUmlShapes } from './icons/uml-shape.ts';
import { registerFileShape } from './shapes/file.ts';
import { registerHexagonShape } from './shapes/hexagon.ts';
import { registerLabelShape } from './shapes/label.ts';
import { registerPersonShape } from './shapes/person.ts';
import { registerProcessShape } from './shapes/process.ts';
import { registerActionShape } from './shapes/action.ts';
import { registerQueueShape } from './shapes/queue.ts';
import { registerStackShape } from './shapes/stack.ts';
import { registerCollectionsShape } from './shapes/collections.ts';
// entity shape now registered via registerUmlShapes()
import { registerArchimateShapes } from './shapes/archimate.ts';
import { registerNoteRenderer } from './shapes/note.ts';
import { registerLegendRenderer } from './shapes/legend.ts';
import { registerTitleRenderer } from './title.ts';
import { registerBoxRenderer } from './box.ts';
import { registerPortNodeRenderer } from './port-node.ts';
import { MxgraphIconRenderer, registerMxgraphIconRenderer } from './icons/mxgraph-icon.ts';
import { _setWarningsGetter } from './group.ts';

// Execute all registrations
registerCircleRenderer();
registerDiamondRenderer();
registerStateIconRenderers();
registerClassNodeRenderer();
registerMapNodeRenderer();
registerStateNodeRenderers();
registerUsecaseShape();
registerActorRenderer();
registerActivityNodeRenderer();
registerFolderShape();
registerRectangleShape();
registerNodeCubeShape();
registerFrameShapeShape();
registerCloudShape();
registerDatabaseShape();
registerAgentShape();
registerStorageShape();
registerComponentShape();
registerArtifactShape();
registerCardShape();
registerUmlShapes();
registerFileShape();
registerHexagonShape();
registerLabelShape();
registerPersonShape();
registerProcessShape();
registerActionShape();
registerQueueShape();
registerStackShape();
registerCollectionsShape();
// entity registered via registerUmlShapes()
registerArchimateShapes();
registerNoteRenderer();
registerLegendRenderer();
registerTitleRenderer();
registerBoxRenderer();
registerPortNodeRenderer();
registerMxgraphIconRenderer();

// ── Unified node factory (dispatches via registry) ───────────────────────────
import { createRenderer, hasRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { Renderer as RendererType } from './renderer.ts';

// ── Rendering warnings collector ────────────────────────────────────────────

export interface RenderWarning {
  type: 'unimplemented_shape';
  nodeId: string;
  stereotype: string;
  message: string;
}

let _renderWarnings: RenderWarning[] = [];

// Wire up group.ts warnings collector (avoids circular import)
_setWarningsGetter(() => _renderWarnings);

/** Collect warnings generated during rendering (e.g. unimplemented shapes). */
export function getRenderWarnings(): RenderWarning[] {
  return _renderWarnings;
}

/** Clear all collected warnings (call before each render pass). */
export function clearRenderWarnings(): void {
  _renderWarnings = [];
}

/**
 * Create the appropriate Renderer for a semantic node.
 * Dispatches solely via the global registry — no type-specific branching.
 * Lookup order: stereotype → node type → 'class' fallback.
 */
export function createNodeRenderer(desc: RenderDescriptor): RendererType {
  const stype = desc.stereotype || '';
  const ntype = desc.type || '';

  // Stereotype takes priority (specific shape > generic type)
  if (stype && hasRenderer(stype)) {
    return createRenderer(stype, desc);
  }

  // mxgraph icon wildcard: any stereotype starting with 'mxgraph.' routes to MxgraphIconRenderer
  if (stype && stype.startsWith('mxgraph.')) {
    return new MxgraphIconRenderer(desc);
  }

  // Then try by node type
  if (ntype && hasRenderer(ntype)) {
    return createRenderer(ntype, desc);
  }

  // No registered renderer — warn about unimplemented shape
  const key = stype || ntype;
  if (key) {
    _renderWarnings.push({
      type: 'unimplemented_shape',
      nodeId: desc.id,
      stereotype: key,
      message: `Unimplemented shape '${key}' for node '${desc.id}', falling back to class renderer`,
    });
  }

  // Fallback to class renderer
  return createRenderer('class', desc);
}

// Shared label builder
export { buildLabelHtml } from './label.ts';

// Class diagram primitives (non-factory exports still needed by consumers)
export {
  buildTitleHtml,
  computeTitleH,
  classNodeStyle,
} from './class-node.ts';

export { separatorStyle } from '../shared/content.ts';

// Sequence diagram primitives
export {
  PARTICIPANT_CONFIG,
  getScaledParticipantConfig,
  buildParticipantLabel,
  participantCellGeom,
  participantStyle,
  renderParticipant,
  renderFootbox,
} from './participant.ts';

export {
  messageStyle,
} from './message.ts';

export {
  renderDestroyMarker,
  activationBarStyle,
  renderActivationBar,
} from './activation.ts';

export {
  renderFragment,
} from './fragment.ts';

export {
  renderDivider,
} from './divider.ts';

export {
  renderDurationConstraint,
} from './duration-constraint.ts';

// ── Global renderer factory ──────────────────────────────────────────────────
import { createRenderer as createRendererFn } from './registry.ts';
import type { SemanticModel } from '../model/class-model.ts';
import { Renderer as RendererBase } from './renderer.ts';
import { createTheme, type Theme } from '../shared/theme.ts';

/**
 * Create renderers for model-level (global) elements: title, legend.
 * Uses the global registry — no direct factory references.
 */
export function createGlobalRenderers(model: SemanticModel, options?: { theme?: Theme }): Map<string, RendererBase> {
  const theme = options?.theme ?? createTheme();
  const map = new Map<string, RendererBase>();
  if (model.title) {
    map.set('__title__', createRendererFn('title', { id: '__title__', label: model.title, theme }));
  }
  if (model.legend) {
    map.set('__legend__', createRendererFn('legend', { id: '__legend__', lines: model.legend.text.split('\n'), align: model.legend.align, theme }));
  }
  return map;
}
