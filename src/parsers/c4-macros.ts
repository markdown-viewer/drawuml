/**
 * C4 stdlib macro expansion tables.
 *
 * Maps PlantUML C4 stdlib macro names (e.g. Person, Container, System_Boundary)
 * to their expanded element/boundary/relation fields.
 *
 * Derived from C4-PlantUML stdlib macro definitions.
 */

// ---------------------------------------------------------------------------
// Element macro mapping
// ---------------------------------------------------------------------------

export interface C4ElementMacroInfo {
  renderer: string;   // renderer key: 'person', 'rectangle', 'database', 'queue'
  bgColor: string;    // fill color hex (without #)
  fontColor: string;  // font color hex (without #)
  typeLabel: string;  // e.g. "Software System", "Container"
  stereotypeTag: string; // displayed in «…» e.g. 'person', 'external_system', 'container'
}

const ELEMENT_MACROS: Record<string, C4ElementMacroInfo> = {
  'Person':          { renderer: 'person',    bgColor: '08427B', fontColor: 'ffffff', typeLabel: 'Person',            stereotypeTag: 'person' },
  'Person_Ext':      { renderer: 'person',    bgColor: '999999', fontColor: 'ffffff', typeLabel: 'External Person',   stereotypeTag: 'external_person' },

  'System':          { renderer: 'rectangle', bgColor: '1168BD', fontColor: 'ffffff', typeLabel: 'Software System',   stereotypeTag: 'system' },
  'System_Ext':      { renderer: 'rectangle', bgColor: '999999', fontColor: 'ffffff', typeLabel: 'External System',   stereotypeTag: 'external_system' },
  'SystemDb':        { renderer: 'database',  bgColor: '1168BD', fontColor: 'ffffff', typeLabel: 'Software System',   stereotypeTag: 'system' },
  'SystemDb_Ext':    { renderer: 'database',  bgColor: '999999', fontColor: 'ffffff', typeLabel: 'External System',   stereotypeTag: 'external_system' },
  'SystemQueue':     { renderer: 'queue',     bgColor: '1168BD', fontColor: 'ffffff', typeLabel: 'Software System',   stereotypeTag: 'system' },
  'SystemQueue_Ext': { renderer: 'queue',     bgColor: '999999', fontColor: 'ffffff', typeLabel: 'External System',   stereotypeTag: 'external_system' },

  'Container':       { renderer: 'rectangle', bgColor: '438DD5', fontColor: 'ffffff', typeLabel: 'Container',         stereotypeTag: 'container' },
  'Container_Ext':   { renderer: 'rectangle', bgColor: '999999', fontColor: 'ffffff', typeLabel: 'External Container', stereotypeTag: 'external_container' },
  'ContainerDb':     { renderer: 'database',  bgColor: '438DD5', fontColor: 'ffffff', typeLabel: 'Container',         stereotypeTag: 'container' },
  'ContainerDb_Ext': { renderer: 'database',  bgColor: '999999', fontColor: 'ffffff', typeLabel: 'External Container', stereotypeTag: 'external_container' },
  'ContainerQueue':     { renderer: 'queue',  bgColor: '438DD5', fontColor: 'ffffff', typeLabel: 'Container',         stereotypeTag: 'container' },
  'ContainerQueue_Ext': { renderer: 'queue',  bgColor: '999999', fontColor: 'ffffff', typeLabel: 'External Container', stereotypeTag: 'external_container' },

  'Component':       { renderer: 'rectangle', bgColor: '85BBF0', fontColor: '000000', typeLabel: 'Component',         stereotypeTag: 'component' },
  'Component_Ext':   { renderer: 'rectangle', bgColor: '999999', fontColor: 'ffffff', typeLabel: 'External Component', stereotypeTag: 'external_component' },
  'ComponentDb':     { renderer: 'database',  bgColor: '85BBF0', fontColor: '000000', typeLabel: 'Component',         stereotypeTag: 'component' },
  'ComponentDb_Ext': { renderer: 'database',  bgColor: '999999', fontColor: 'ffffff', typeLabel: 'External Component', stereotypeTag: 'external_component' },
  'ComponentQueue':     { renderer: 'queue',  bgColor: '85BBF0', fontColor: '000000', typeLabel: 'Component',         stereotypeTag: 'component' },
  'ComponentQueue_Ext': { renderer: 'queue',  bgColor: '999999', fontColor: 'ffffff', typeLabel: 'External Component', stereotypeTag: 'external_component' },
};

/**
 * Look up a C4 element macro name. Returns renderer info or null.
 */
export function lookupC4ElementMacro(name: string): C4ElementMacroInfo | null {
  return ELEMENT_MACROS[name] || null;
}

// ---------------------------------------------------------------------------
// Boundary macro mapping
// ---------------------------------------------------------------------------

export interface C4BoundaryMacroInfo {
  borderColor: string;  // stroke color hex (without #)
  typeLabel: string;     // e.g. "System", "Enterprise"
}

const BOUNDARY_MACROS: Record<string, C4BoundaryMacroInfo> = {
  'System_Boundary':    { borderColor: '1168BD', typeLabel: 'System' },
  'Container_Boundary': { borderColor: '438DD5', typeLabel: 'Container' },
  'Enterprise_Boundary': { borderColor: '444444', typeLabel: 'Enterprise' },
  'Boundary':           { borderColor: '444444', typeLabel: 'Boundary' },
  'Deployment_Node':    { borderColor: '888888', typeLabel: 'Deployment Node' },
};

/**
 * Look up a C4 boundary macro name. Returns info or null.
 */
export function lookupC4BoundaryMacro(name: string): C4BoundaryMacroInfo | null {
  return BOUNDARY_MACROS[name] || null;
}

// ---------------------------------------------------------------------------
// Relation macro mapping
// ---------------------------------------------------------------------------

export interface C4RelMacroInfo {
  direction: string | null;   // 'up' | 'down' | 'left' | 'right' | null
  back: boolean;
  biDirectional: boolean;
}

const REL_MACROS: Record<string, C4RelMacroInfo> = {
  'Rel':           { direction: null,    back: false, biDirectional: false },
  'Rel_D':         { direction: 'down',  back: false, biDirectional: false },
  'Rel_Down':      { direction: 'down',  back: false, biDirectional: false },
  'Rel_U':         { direction: 'up',    back: false, biDirectional: false },
  'Rel_Up':        { direction: 'up',    back: false, biDirectional: false },
  'Rel_L':         { direction: 'left',  back: false, biDirectional: false },
  'Rel_Left':      { direction: 'left',  back: false, biDirectional: false },
  'Rel_R':         { direction: 'right', back: false, biDirectional: false },
  'Rel_Right':     { direction: 'right', back: false, biDirectional: false },
  'Rel_Back':      { direction: null,    back: true,  biDirectional: false },
  'Rel_Back_Down': { direction: 'down',  back: true,  biDirectional: false },
  'Rel_Back_Up':   { direction: 'up',    back: true,  biDirectional: false },
  'Rel_Back_Left': { direction: 'left',  back: true,  biDirectional: false },
  'Rel_Back_Right':{ direction: 'right', back: true,  biDirectional: false },
  'Rel_Neighbor':  { direction: 'right', back: false, biDirectional: false },
  'BiRel':         { direction: null,    back: false, biDirectional: true },
  'BiRel_D':       { direction: 'down',  back: false, biDirectional: true },
  'BiRel_Down':    { direction: 'down',  back: false, biDirectional: true },
  'BiRel_U':       { direction: 'up',    back: false, biDirectional: true },
  'BiRel_Up':      { direction: 'up',    back: false, biDirectional: true },
  'BiRel_L':       { direction: 'left',  back: false, biDirectional: true },
  'BiRel_Left':    { direction: 'left',  back: false, biDirectional: true },
  'BiRel_R':       { direction: 'right', back: false, biDirectional: true },
  'BiRel_Right':   { direction: 'right', back: false, biDirectional: true },
};

/**
 * Look up a C4 relation macro name. Returns info or null.
 */
export function lookupC4RelMacro(name: string): C4RelMacroInfo | null {
  return REL_MACROS[name] || null;
}

// ---------------------------------------------------------------------------
// Argument parsing (reuse splitMacroArgs / stripQuotes pattern)
// ---------------------------------------------------------------------------

/**
 * Split comma-separated macro arguments, respecting quoted strings.
 */
function splitMacroArgs(str: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === ',' && !inQuote) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function stripQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

/**
 * Parse C4 element macro arguments.
 *
 * Formats:
 *   Person(alias, "label")
 *   Person(alias, "label", "description")
 *   Container(alias, "label", "technology", "description")
 *
 * Returns [alias, label, technology, description].
 */
export function parseC4ElementArgs(argsStr: string, macroInfo: C4ElementMacroInfo): {
  alias: string; label: string; technology: string; description: string;
} {
  const args = splitMacroArgs(argsStr);
  const alias = args[0] || '';
  const label = stripQuotes(args[1] || alias);

  // Person/System variants: (alias, label, description)
  // Container/Component variants: (alias, label, technology, description)
  const isContainer = macroInfo.typeLabel.includes('Container') || macroInfo.typeLabel.includes('Component');
  let technology = '';
  let description = '';
  if (isContainer) {
    technology = stripQuotes(args[2] || '');
    description = stripQuotes(args[3] || '');
  } else {
    description = stripQuotes(args[2] || '');
  }
  return { alias, label, technology, description };
}

/**
 * Parse C4 boundary macro arguments.
 *
 * Formats:
 *   System_Boundary(alias, "label")
 *   Boundary(alias, "label", "type")
 *   Deployment_Node(alias, "label", "technology")
 *
 * Returns [alias, label].
 */
export function parseC4BoundaryArgs(argsStr: string): { alias: string; label: string } {
  const args = splitMacroArgs(argsStr);
  const alias = args[0] || '';
  const label = stripQuotes(args[1] || alias);
  return { alias, label };
}

/**
 * Parse C4 relation macro arguments.
 *
 * Formats:
 *   Rel(from, to, "label")
 *   Rel(from, to, "label", "technology")
 *
 * Returns [from, to, label].
 */
export function parseC4RelArgs(argsStr: string): { from: string; to: string; label: string } {
  const args = splitMacroArgs(argsStr);
  return {
    from: args[0] || '',
    to: args[1] || '',
    label: stripQuotes(args[2] || ''),
  };
}
