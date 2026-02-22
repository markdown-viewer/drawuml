/**
 * ArchiMate stdlib macro expansion tables.
 *
 * Maps PlantUML ArchiMate stdlib macro names (e.g. Business_Actor)
 * to their expanded archimate declaration fields (layer tag + stereotype).
 *
 * Also maps relation macros (e.g. Rel_Composition) to arrow syntax.
 *
 * Derived from `plantuml -preproc` expansion of all Archimate stdlib macros.
 */

// ---------------------------------------------------------------------------
// Layer color mapping
// ---------------------------------------------------------------------------

const ARCHIMATE_LAYER_COLORS: Record<string, string> = {
  'BUSINESS':       '#FFFFCC',
  'Business':       '#FFFFCC',
  'APPLICATION':    '#C2F0FF',
  'Application':    '#C2F0FF',
  'TECHNOLOGY':     '#C9FFC9',
  'Technology':     '#C9FFC9',
  'MOTIVATION':     '#CCCCFF',
  'Motivation':     '#CCCCFF',
  'STRATEGY':       '#F8E7C0',
  'Strategy':       '#F8E7C0',
  'IMPLEMENTATION': '#FFE0E0',
  'Implementation': '#FFE0E0',
  'PHYSICAL':       '#97FF97',
  'Physical':       '#97FF97',
  'transparent':    'none',
};

/**
 * Resolve an ArchiMate layer tag (e.g. "BUSINESS", "#lightgreen") to a fill color.
 * Returns the mapped hex color or the raw tag if it looks like a CSS color.
 */
export function resolveArchimateLayerColor(tag: string): string | undefined {
  if (!tag) return undefined;
  const mapped = ARCHIMATE_LAYER_COLORS[tag];
  if (mapped) return mapped;
  // Raw CSS color: #xxx or named color
  if (tag.startsWith('#')) return tag;
  return undefined;
}

// ---------------------------------------------------------------------------
// Element macro mapping
// ---------------------------------------------------------------------------

export interface ArchimateMacroInfo {
  layer: string;       // e.g. 'BUSINESS'
  stereotype: string;  // e.g. 'business-actor'
}

const ELEMENT_MACROS: Record<string, ArchimateMacroInfo> = {
  // Business layer
  'Business_Actor':          { layer: 'BUSINESS', stereotype: 'business-actor' },
  'Business_Role':           { layer: 'BUSINESS', stereotype: 'business-role' },
  'Business_Service':        { layer: 'BUSINESS', stereotype: 'business-service' },
  'Business_Process':        { layer: 'BUSINESS', stereotype: 'business-process' },
  'Business_Function':       { layer: 'BUSINESS', stereotype: 'business-function' },
  'Business_Interaction':    { layer: 'BUSINESS', stereotype: 'business-interaction' },
  'Business_Event':          { layer: 'BUSINESS', stereotype: 'business-event' },
  'Business_Interface':      { layer: 'BUSINESS', stereotype: 'business-interface' },
  'Business_Collaboration':  { layer: 'BUSINESS', stereotype: 'business-collaboration' },
  'Business_Object':         { layer: 'BUSINESS', stereotype: 'business-object' },
  'Business_Product':        { layer: 'BUSINESS', stereotype: 'business-product' },
  'Business_Representation': { layer: 'BUSINESS', stereotype: 'business-representation' },
  'Business_Contract':       { layer: 'BUSINESS', stereotype: 'business-contract' },
  'Business_Location':       { layer: 'BUSINESS', stereotype: 'business-location' },

  // Application layer
  'Application_Component':     { layer: 'APPLICATION', stereotype: 'application-component' },
  'Application_Service':       { layer: 'APPLICATION', stereotype: 'application-service' },
  'Application_Function':      { layer: 'APPLICATION', stereotype: 'application-function' },
  'Application_Interaction':   { layer: 'APPLICATION', stereotype: 'application-interaction' },
  'Application_Event':         { layer: 'APPLICATION', stereotype: 'application-event' },
  'Application_Interface':     { layer: 'APPLICATION', stereotype: 'application-interface' },
  'Application_Collaboration': { layer: 'APPLICATION', stereotype: 'application-collaboration' },
  'Application_DataObject':    { layer: 'APPLICATION', stereotype: 'application-dataobject' },
  'Application_Process':       { layer: 'APPLICATION', stereotype: 'application-process' },

  // Technology layer
  'Technology_Device':                { layer: 'TECHNOLOGY', stereotype: 'technology-device' },
  'Technology_Node':                  { layer: 'TECHNOLOGY', stereotype: 'technology-node' },
  'Technology_Artifact':              { layer: 'TECHNOLOGY', stereotype: 'technology-artifact' },
  'Technology_SystemSoftware':        { layer: 'TECHNOLOGY', stereotype: 'technology-systemsoftware' },
  'Technology_CommunicationNetwork':  { layer: 'TECHNOLOGY', stereotype: 'technology-communicationnetwork' },
  'Technology_Path':                  { layer: 'TECHNOLOGY', stereotype: 'technology-path' },
  'Technology_Service':               { layer: 'TECHNOLOGY', stereotype: 'technology-service' },
  'Technology_Process':               { layer: 'TECHNOLOGY', stereotype: 'technology-process' },
  'Technology_Function':              { layer: 'TECHNOLOGY', stereotype: 'technology-function' },
  'Technology_Interaction':           { layer: 'TECHNOLOGY', stereotype: 'technology-interaction' },
  'Technology_Event':                 { layer: 'TECHNOLOGY', stereotype: 'technology-event' },
  'Technology_Interface':             { layer: 'TECHNOLOGY', stereotype: 'technology-interface' },
  'Technology_Collaboration':         { layer: 'TECHNOLOGY', stereotype: 'technology-collaboration' },

  // Motivation layer
  'Motivation_Stakeholder':  { layer: 'MOTIVATION', stereotype: 'motivation-stakeholder' },
  'Motivation_Driver':       { layer: 'MOTIVATION', stereotype: 'motivation-driver' },
  'Motivation_Assessment':   { layer: 'MOTIVATION', stereotype: 'motivation-assessment' },
  'Motivation_Goal':         { layer: 'MOTIVATION', stereotype: 'motivation-goal' },
  'Motivation_Outcome':      { layer: 'MOTIVATION', stereotype: 'motivation-outcome' },
  'Motivation_Principle':    { layer: 'MOTIVATION', stereotype: 'motivation-principle' },
  'Motivation_Requirement':  { layer: 'MOTIVATION', stereotype: 'motivation-requirement' },
  'Motivation_Constraint':   { layer: 'MOTIVATION', stereotype: 'motivation-constraint' },
  'Motivation_Meaning':      { layer: 'MOTIVATION', stereotype: 'motivation-meaning' },
  'Motivation_Value':        { layer: 'MOTIVATION', stereotype: 'motivation-value' },

  // Strategy layer
  'Strategy_Capability':     { layer: 'STRATEGY', stereotype: 'strategy-capability' },
  'Strategy_CourseOfAction':  { layer: 'STRATEGY', stereotype: 'strategy-courseofaction' },
  'Strategy_Resource':        { layer: 'STRATEGY', stereotype: 'strategy-resource' },
  'Strategy_ValueStream':     { layer: 'STRATEGY', stereotype: 'strategy-valuestream' },

  // Implementation layer
  'Implementation_Deliverable':  { layer: 'IMPLEMENTATION', stereotype: 'implementation-deliverable' },
  'Implementation_Event':        { layer: 'IMPLEMENTATION', stereotype: 'implementation-event' },
  'Implementation_Gap':          { layer: 'IMPLEMENTATION', stereotype: 'implementation-gap' },
  'Implementation_Plateau':      { layer: 'IMPLEMENTATION', stereotype: 'implementation-plateau' },
  'Implementation_WorkPackage':  { layer: 'IMPLEMENTATION', stereotype: 'implementation-workpackage' },

  // Physical layer (note: stereotypes use technology- prefix per PlantUML stdlib)
  'Physical_DistributionNetwork': { layer: 'PHYSICAL', stereotype: 'technology-distributionnetwork' },
  'Physical_Equipment':           { layer: 'PHYSICAL', stereotype: 'technology-equipment' },
  'Physical_Facility':            { layer: 'PHYSICAL', stereotype: 'technology-facility' },
  'Physical_Material':            { layer: 'PHYSICAL', stereotype: 'technology-material' },

  // Other
  'Other_Grouping':  { layer: 'transparent', stereotype: 'other-grouping' },
  'Grouping':        { layer: 'transparent', stereotype: 'archimate-grouping' },
  'Other_Location':  { layer: '#efd1e4',     stereotype: 'location' },

  // Special shapes
  'Junction_Or':  { layer: 'transparent', stereotype: 'archimate-junction-or' },
  'Junction_And': { layer: 'transparent', stereotype: 'archimate-junction-and' },
  'Boundary':     { layer: 'transparent', stereotype: 'archimate-boundary' },
  'Group':        { layer: 'transparent', stereotype: 'archimate-group' },
};

/**
 * Look up an element macro name. Returns the layer + stereotype info, or null.
 */
export function lookupArchimateElementMacro(name: string): ArchimateMacroInfo | null {
  return ELEMENT_MACROS[name] || null;
}

// ---------------------------------------------------------------------------
// Relation macro mapping
// ---------------------------------------------------------------------------

export interface RelMacroInfo {
  edgeType: string;     // EdgeType value: 'composition', 'association', etc.
  direction?: string;   // 'up' | 'down' | 'left' | 'right' | null
  arrowMeta: object;    // Structured meta for edgeStyleForArrow()
}

/**
 * Build a structured arrowMeta object consumable by edgeStyleForArrow().
 * startHead/endHead use the tokens defined in arrow.ts headTokenToDrawio().
 * lineStyle: 'solid' | 'dashed' | 'dotted'
 * dashPattern: optional override, e.g. '1 3' or '7 7'
 */
function makeArrowMeta(startHead: string, endHead: string, lineStyle: string, dashPattern?: string): object {
  const bodyToken = (lineStyle === 'dashed' || lineStyle === 'dotted') ? '..' : '--';
  const token = `${startHead}${bodyToken}${endHead}` || bodyToken;
  return {
    structured: true,
    token,
    startHeadToken: startHead,
    endHeadToken: endHead,
    bodyToken,
    lineStyle,
    dashPattern: dashPattern || null,
    middleShape: null,
    direction: null,
    length: 2,
  };
}

/**
 * Direction suffixes for relation macros.
 * Base relation name → direction.
 */
function resolveRelDirection(name: string): { baseName: string; direction: string | null } {
  const m = name.match(/^(.+)_(Up|Down|Left|Right)$/);
  if (m) return { baseName: m[1], direction: m[2].toLowerCase() };
  return { baseName: name, direction: null };
}

/** Base relation type → edge info (without direction). */
const BASE_RELATIONS: Record<string, { edgeType: string; arrowMeta: object }> = {
  // Structural: large diamond at source, no end arrow
  'Rel_Composition':      { edgeType: 'composition', arrowMeta: makeArrowMeta('**', '',   'solid') },
  'Rel_Aggregation':      { edgeType: 'aggregation', arrowMeta: makeArrowMeta('oo', '',   'solid') },
  // Assignment: filled circle at source + filled flat triangle at target
  'Rel_Assignment':       { edgeType: 'association', arrowMeta: makeArrowMeta('@',  '^^', 'solid') },
  // Association: plain solid line; directed uses open upper-half line arrow at end
  'Rel_Association':      { edgeType: 'association', arrowMeta: makeArrowMeta('',   '',   'solid') },
  'Rel_Association_dir':  { edgeType: 'association', arrowMeta: makeArrowMeta('',   '~/', 'solid') },
  // Access variants: dotted line (1 3); classic filled chevron as arrow
  'Rel_Access':           { edgeType: 'dependency',  arrowMeta: makeArrowMeta('',  '',   'dotted', '1 3') },
  'Rel_Access_r':         { edgeType: 'dependency',  arrowMeta: makeArrowMeta('<', '',   'dotted', '1 3') },
  'Rel_Access_w':         { edgeType: 'dependency',  arrowMeta: makeArrowMeta('',  '>',  'dotted', '1 3') },
  'Rel_Access_rw':        { edgeType: 'dependency',  arrowMeta: makeArrowMeta('<', '>',  'dotted', '1 3') },
  // Flow: long-dashed (7 7) + filled flat triangle
  'Rel_Flow':             { edgeType: 'dependency',  arrowMeta: makeArrowMeta('',  '^^', 'dashed', '7 7') },
  // Influence: long-dashed (7 7) + filled classic chevron
  'Rel_Influence':        { edgeType: 'dependency',  arrowMeta: makeArrowMeta('',  '>',  'dashed', '7 7') },
  // Realization: dotted (1 3) + hollow flat triangle
  'Rel_Realization':      { edgeType: 'dependency',  arrowMeta: makeArrowMeta('',  '|>', 'dotted', '1 3') },
  // Serving: solid + filled classic chevron
  'Rel_Serving':          { edgeType: 'association', arrowMeta: makeArrowMeta('',  '>',  'solid') },
  // Specialization: solid + hollow flat triangle
  'Rel_Specialization':   { edgeType: 'inheritance', arrowMeta: makeArrowMeta('',  '|>', 'solid') },
  // Triggering: solid + filled flat triangle
  'Rel_Triggering':       { edgeType: 'association', arrowMeta: makeArrowMeta('',  '^^', 'solid') },
};

/**
 * Look up a relation macro name. Returns edge info or null.
 */
export function lookupArchimateRelMacro(name: string): RelMacroInfo | null {
  const { baseName, direction } = resolveRelDirection(name);
  const base = BASE_RELATIONS[baseName];
  if (!base) return null;
  return {
    edgeType: base.edgeType,
    direction: direction || undefined,
    arrowMeta: base.arrowMeta,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse element macro arguments: `alias, "Label Text"`
 * Returns [alias, label].
 */
export function parseArchimateElementArgs(argsStr: string): [string, string] {
  const args = splitMacroArgs(argsStr);
  const alias = args[0] || '';
  const label = stripQuotes(args[1] || alias);
  return [alias, label];
}

/**
 * Parse relation macro arguments: `from, to, "Label"`
 * Returns [from, to, label].
 */
export function parseArchimateRelArgs(argsStr: string): [string, string, string] {
  const args = splitMacroArgs(argsStr);
  return [args[0] || '', args[1] || '', stripQuotes(args[2] || '')];
}

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

/** Strip surrounding double quotes from a string. */
function stripQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}
