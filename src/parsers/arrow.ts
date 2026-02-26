import { EdgeType } from '../model/index.ts';

const KNOWN_HEAD_TOKENS = new Set([
  '',
  '<||', '<|', '<',
  '||>', '|>', '>',
  '*', 'o', 'x', '#',
  // Archimate-specific tokens
  '^^',       // filled flat triangle (block fill=1)
  '**',       // filled large diamond
  'oo',       // hollow large diamond
  '~/',       // open (unfilled) upper-half line arrow (halfBottom fill=0)
  '}|', '}o', '||', '|o', '|{', '{',
  'o|', 'o{', '{|', '}',
  '0)', '(0',
  '@', '+', '^',
  // Circle (standalone 0)
  '0',
  // Lollipop half-circle / socket
  '(', ')',
  // Double-triangle
  '<<', '>>',
  // Half arrows (backslash / slash)
  '\\\\', '\\', '/', '//',
  // Compound: definedBy — triangle with two dots
  ':|>', '<|:',
  // Compound: x/o + arrow
  'x<', 'o<', '>x', '>o',
  // Compound: half + diamond
  'o\\\\', 'x\\\\', '\\\\o', '\\o', '//o', '/o', '>>o',
  // Compound: direction-specific half (start only)
  'o//',
]);

function normalizeMeta(meta, token) {
  if (meta && typeof meta === 'object' && meta.structured) {
    const resolvedToken = String(meta.token || token || '').trim();
    if (!resolvedToken) return null;
    const startHead = String(meta.startHeadToken || meta.startHead || '').trim();
    const endHead = String(meta.endHeadToken || meta.endHead || '').trim();
    const bodyToken = String(meta.bodyToken || '').trim();
    if (!KNOWN_HEAD_TOKENS.has(startHead)) {
      throw new Error(`Unsupported start head token: ${String(startHead)}`);
    }
    if (!KNOWN_HEAD_TOKENS.has(endHead)) {
      throw new Error(`Unsupported end head token: ${String(endHead)}`);
    }
    const raw = String(meta.lineStyle || 'solid');
    const lineStyle = (raw === 'dashed' || raw === 'dotted' || raw === 'bold') ? raw : 'solid';
    // Compute length: count of line-segment chars (-, ., =, ~) in body
    const length = bodyToken.replace(/[^-.=~]/g, '').length || 1;
    // Direction: only from explicit PEG-parsed direction hint
    const direction = meta.direction || null;
    return {
      token: resolvedToken,
      startHead,
      endHead,
      startHeadToken: startHead,
      endHeadToken: endHead,
      bodyToken,
      lineStyle,
      dashPattern: meta.dashPattern || null,
      middleShape: meta.middleShape || null,
      direction,
      length,
    };
  }
  // Fallback: parse the raw arrow token string (e.g. "#--", "<|..", "-left->")
  return parseRawArrowToken(String(token || '').trim());
}

/**
 * Public wrapper for normalizeMeta — resolves direction/length from arrow metadata.
 */
export function normalizeArrowMeta(meta, token) {
  return normalizeMeta(meta, token);
}

/** Head characters that can appear at the leading / trailing position of an arrow. */
const HEAD_CHARS = /^([<>|*o#x{}+^@/\\]*)(-+|\.+|~+|=+|(?:-+[a-z]+-+))([<>|*o#x{}+^@/\\]*)$/i;

function parseRawArrowToken(token) {
  if (!token) return null;

  // Extract direction hint before stripping: -left-> has direction 'left'
  const dirMatch = token.match(/-(left|right|up|down)-/i);
  const direction = dirMatch ? dirMatch[1].toLowerCase() : null;
  // Strip directional hints to normalise body: -left-> becomes -->
  const stripped = token.replace(/-(left|right|up|down)-/i, '--');
  const m = HEAD_CHARS.exec(stripped);
  if (!m) return null;
  const startHead = m[1] || '';
  const bodyRaw = m[2] || '';
  const endHead = m[3] || '';
  const lineStyle = /^\.+$/.test(bodyRaw) ? 'dashed' : /^~+$/.test(bodyRaw) ? 'dotted' : /^=+$/.test(bodyRaw) ? 'bold' : 'solid';
  // Compute length from body segment chars
  const length = bodyRaw.replace(/[^-.=~]/g, '').length || 1;
  return {
    token,
    startHead,
    endHead,
    startHeadToken: startHead,
    endHeadToken: endHead,
    bodyToken: bodyRaw,
    lineStyle,
    dashPattern: null,
    middleShape: null,
    direction,
    length,
  };
}

function isInheritanceToken(token) {
  return token === '<||' || token === '<|' || token === '||>' || token === '|>';
}

function isCompositionToken(token) {
  return token === '*';
}

function isAggregationToken(token) {
  return token === 'o';
}

function headTokenToDrawio(token, isStart = false) {
  if (token === '<|' || token === '|>') return { arrow: 'block', fill: 0 };
  if (token === '<||' || token === '||>') return { arrow: 'blockBar', fill: 0 };
  if (token === '<' || token === '>') return { arrow: 'classic', fill: 1 };
  if (token === '*') return { arrow: 'diamondThin', fill: 1 };
  if (token === 'o') return { arrow: 'diamondThin', fill: 0 };
  if (token === 'x') return { arrow: 'cross', fill: 0 };
  if (token === '#') return { arrow: 'square', fill: 0 };
  if (token === '0)' || token === '(0') return { arrow: 'ovalHalfCircle', fill: 0 };
  if (token === '0') return { arrow: 'oval', fill: 0 };
  if (token === '(') return { arrow: 'halfCircle', fill: 0 };
  if (token === ')') return { arrow: 'halfCircle', fill: 0 };
  if (token === '^') return { arrow: 'block', fill: 0 };
  if (token === '+') return { arrow: 'circlePlus', fill: 0 };
  if (token === '}') return { arrow: 'ERmany', fill: 0 };
  if (token === '{') return { arrow: 'ERmany', fill: 0 };
  // IE (crow's foot) compound tokens — map to DrawIO ER arrow types
  if (token === '||') return { arrow: 'ERmandOne', fill: 0 };
  if (token === '}|' || token === '|{') return { arrow: 'ERoneToMany', fill: 0 };
  if (token === '}o' || token === 'o{') return { arrow: 'ERzeroToMany', fill: 0 };
  if (token === '|o' || token === 'o|') return { arrow: 'ERzeroToOne', fill: 0 };
  if (token === '{|') return { arrow: 'ERoneToMany', fill: 0 };
  // Double-angle (<<, >>) — filled triangle, similar to classic
  if (token === '<<' || token === '>>') return { arrow: 'classic', fill: 1 };
  // Half arrows — token represents user's visual shape.
  // endArrow (isStart=false): \ → halfBottom (visual \), / → halfTop (visual /)
  // startArrow (isStart=true): inverted because renderer rotates startArrow by 180°
  // PlantUML renders half arrows as open lines, not filled triangles.
  if (token === '\\\\' || token === '\\') return { arrow: isStart ? 'halfTop' : 'halfBottom', fill: 0 };
  if (token === '//' || token === '/') return { arrow: isStart ? 'halfBottom' : 'halfTop', fill: 0 };
  // Compound: :|> / <|: — hollow triangle with two dots behind (definedBy)
  if (token === ':|>' || token === '<|:') return { arrow: 'blockTwoDots', fill: 0 };
  // Compound: x/o + arrow — dominant decorator wins
  if (token === 'x<' || token === '>x') return { arrow: 'cross', fill: 0 };
  if (token === 'o<' || token === '>o') return { arrow: 'diamondThin', fill: 0 };
  // Compound: half + diamond — diamond dominates
  if (token === '\\\\o' || token === '\\o' || token === '//o' || token === '/o') return { arrow: 'diamondThin', fill: 0 };
  if (token === 'o\\\\' || token === 'o//') return { arrow: 'diamondThin', fill: 0 };
  // Compound: x + half — cross dominates
  if (token === 'x\\\\') return { arrow: 'cross', fill: 0 };
  // Compound: >> + diamond
  if (token === '>>o') return { arrow: 'block', fill: 0 };
  if (token === '@') return { arrow: 'oval', fill: 1 };
  // Archimate-specific tokens
  if (token === '^^') return { arrow: 'block', fill: 1 };      // filled flat triangle
  if (token === '**') return { arrow: 'diamond', fill: 1 };    // filled large diamond
  if (token === 'oo') return { arrow: 'diamond', fill: 0 };    // hollow large diamond
  if (token === '~/') return { arrow: isStart ? 'halfTop' : 'halfBottom', fill: 0 }; // open upper-half line
  if (token === '') {
    return { arrow: 'none', fill: null };
  }
  throw new Error(`Unsupported arrow head token: ${String(token)}`);
}

export function arrowToEdgeType(arrow, meta = null) {
  const parsedMeta = normalizeMeta(meta, arrow);
  if (!parsedMeta) {
    throw new Error(`Missing structured arrow metadata for token: ${String(arrow || '')}`);
  }

  if (isInheritanceToken(parsedMeta.startHeadToken) || isInheritanceToken(parsedMeta.endHeadToken)) {
    return EdgeType.Inheritance;
  }
  if (isCompositionToken(parsedMeta.startHeadToken) || isCompositionToken(parsedMeta.endHeadToken)) {
    return EdgeType.Composition;
  }
  if (isAggregationToken(parsedMeta.startHeadToken) || isAggregationToken(parsedMeta.endHeadToken)) {
    return EdgeType.Aggregation;
  }
  if (parsedMeta.lineStyle === 'dashed') {
    return EdgeType.Dependency;
  }
  return EdgeType.Association;
}

export function edgeStyleForArrow(arrow, meta = null) {
  const parsedMeta = normalizeMeta(meta, arrow);
  if (!parsedMeta) {
    throw new Error(`Missing structured arrow metadata for token: ${String(arrow || '')}`);
  }

  const start = headTokenToDrawio(parsedMeta.startHeadToken, true);
  const end = headTokenToDrawio(parsedMeta.endHeadToken, false);
  const dashed = (parsedMeta.lineStyle === 'dashed' || parsedMeta.lineStyle === 'dotted') ? 1 : 0;

  const parts = [`dashed=${dashed}`];
  // Use explicit dashPattern from meta (e.g. archimate '1 3' or '7 7'),
  // otherwise fall back to the dotted default '1 2'.
  const dashPat = parsedMeta.dashPattern || (parsedMeta.lineStyle === 'dotted' ? '1 2' : null);
  if (dashPat) parts.push(`dashPattern=${dashPat}`);
  if (parsedMeta.lineStyle === 'bold') parts.push('strokeWidth=2');
  parts.push(`startArrow=${start.arrow}`);
  parts.push(`endArrow=${end.arrow}`);
  if (start.fill !== null) parts.push(`startFill=${start.fill}`);
  if (end.fill !== null) parts.push(`endFill=${end.fill}`);
  if (parsedMeta.middleShape) parts.push(`middleShape=${parsedMeta.middleShape}`);
  return parts.join(';') + ';';
}

export function edgeStyleForType(edgeType) {
  switch (edgeType) {
    case EdgeType.Inheritance:
      return 'endArrow=block;endFill=0;';
    case EdgeType.Implementation:
      return 'dashed=1;endArrow=block;endFill=0;';
    case EdgeType.Composition:
      return 'startArrow=diamondThin;startFill=1;endArrow=open;';
    case EdgeType.Aggregation:
      return 'startArrow=diamondThin;startFill=0;endArrow=open;';
    case EdgeType.Dependency:
      return 'dashed=1;endArrow=open;';
    case EdgeType.Association:
      return 'endArrow=open;';
    default:
      throw new Error(`Unsupported edge type: ${String(edgeType)}`);
  }
}
