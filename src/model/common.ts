/**
 * Common/shared type definitions used across all diagram types.
 */

export const DiagramType = {
  UML: 'uml',
  Sequence: 'sequence',
} as const;

export type DiagramTypeName = (typeof DiagramType)[keyof typeof DiagramType];

export const NodeType = {
  Class: 'class',
  Interface: 'interface',
  Enum: 'enum',
  // State diagram node types
  State: 'state',
  StateStart: 'state_start',
  StateEnd: 'state_end',
  StateFork: 'state_fork',
  StateJoin: 'state_join',
  StateChoice: 'state_choice',
  // Use-case diagram node types
  Usecase: 'usecase',
  UsecaseActor: 'usecase_actor',
  // Sequence diagram participant types
  Participant: 'participant',
  Actor: 'actor',
  Boundary: 'boundary',
  Control: 'control',
  Entity: 'entity',
  Database: 'database',
  Collections: 'collections',
  Queue: 'queue',
} as const;

export type NodeTypeName = (typeof NodeType)[keyof typeof NodeType];

export const EdgeType = {
  Inheritance: 'inheritance',
  Implementation: 'implementation',
  Association: 'association',
  Dependency: 'dependency',
  Aggregation: 'aggregation',
  Composition: 'composition',
  // Sequence diagram message types
  SyncMessage: 'sync_message',         // ->
  AsyncMessage: 'async_message',       // ->>
  ReturnMessage: 'return_message',     // -->
  SelfMessage: 'self_message',         // A -> A
} as const;

export type EdgeTypeName = (typeof EdgeType)[keyof typeof EdgeType];

export interface ArrowMetaParts {
  token: string;
  startHead: string;
  endHead: string;
  startHeadToken?: string;
  endHeadToken?: string;
  bodyToken?: string;
  lineStyle: 'solid' | 'dashed';
  direction?: 'left' | 'right' | 'up' | 'down' | null;
  /** Arrow length — number of line chars (-, ., =). Affects DOT minlen. */
  length?: number;
  structured?: boolean;
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Center position of external xlabel label in DrawIO coordinates (from viz.js xlp). */
  xlabelPos?: { x: number; y: number };
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  points?: Array<{ x: number; y: number }>;
  /** When `from` is a group id, this records which group it refers to */
  fromGroup?: string;
  /** When `to` is a group id, this records which group it refers to */
  toGroup?: string;
  /** Absolute position of the edge center label, if laid out by ELK or Graphviz */
  labelPos?: { x: number; y: number };
  /** Size of the edge center label */
  labelSize?: { width: number; height: number };
  /** DrawIO-coordinate center of the taillabel (cardFrom), if laid out by Graphviz */
  cardFromPos?: { x: number; y: number };
  /** DrawIO-coordinate center of the headlabel (cardTo), if laid out by Graphviz */
  cardToPos?: { x: number; y: number };
}

export interface LayoutGroup {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  nodes: Record<string, LayoutNode>;
  edges: LayoutEdge[];
  groups?: Record<string, LayoutGroup>;
}

// ---------------------------------------------------------------------------
// Shared primitive element interfaces (layout-ready, used by all renderers)
// ---------------------------------------------------------------------------

/**
 * A note element ready for rendering. Produced by layout engines,
 * consumed by DrawIO generators.
 * Used by: class-diagram (dot-layout), sequence-diagram (table-layout).
 */
export interface LayoutNote {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  noteType?: string;         // 'note' | 'hnote' | 'rnote' (default: 'note')
  color?: string | null;     // fill color override (default: #FEFFDD)
  parentId?: string | null;  // parent cell id for relative positioning
}
