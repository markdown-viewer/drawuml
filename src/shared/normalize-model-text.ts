import type {
  SemanticModel,
  SemanticNode,
  SemanticEdge,
  SemanticGroup,
  ClassNote,
  ClassLegend,
} from '../model/class-model.ts';
import type { NormalizedRichBlock } from '../model/normalized-rich-text.ts';
import type {
  SequenceModel,
  SequenceParticipant,
  SequenceMessage,
  SequenceFragment,
  SequenceDivider,
  SequenceDurationConstraint,
  SequenceNote,
} from '../model/sequence-model.ts';
import { TextBlock, DEFAULT_FONT } from './text-block.ts';
import { normalizeClassBodyBlocks } from './normalize-class-body.ts';
import type { Theme } from './theme.ts';
import { parseNodeStyle, parseEdgeInlineStyle } from './color-utils.ts';

const RE_SEP_SOLID = /^-{2,}$/;
const RE_SEP_DOUBLE = /^={2,}$/;
const RE_SEP_STRONG = /^_{2,}$/;
const RE_SEP_DOTTED = /^\.{2,}$/;
const RE_SEP_TITLED_SOLID = /^--(.+)--$/;
const RE_SEP_TITLED_DOUBLE = /^==(.+)==$/;
const RE_SEP_TITLED_STRONG = /^__(.+)__$/;
const RE_SEP_TITLED_DOTTED = /^\.\.(.+)\.\.$/;

function fontFromTheme(theme?: Theme) {
  return theme ? { size: theme.fontSize, family: theme.fontFamily } : DEFAULT_FONT;
}

function noteFontFromTheme(theme?: Theme) {
  if (!theme) return DEFAULT_FONT;
  return {
    size: theme.noteFontSize || theme.fontSize,
    family: theme.noteFontFamily || theme.fontFamily,
  };
}

function normalizeInlineHtml(text?: string | null, theme?: Theme, colorOverride?: string): string | undefined {
  if (!text) return undefined;
  const html = TextBlock.inline(text, fontFromTheme(theme)).html;
  const color = colorOverride || theme?.fontColor;
  if (!color) return html;
  return `<span style="color:${color};">${html}</span>`;
}

function normalizeBlockHtml(text?: string | null, theme?: Theme): string | undefined {
  if (!text) return undefined;
  return TextBlock.block(text, fontFromTheme(theme)).html;
}

function classifySeparator(line: string): { variant: string; title?: string } | null {
  if (RE_SEP_SOLID.test(line)) return { variant: 'solid' };
  if (RE_SEP_DOUBLE.test(line)) return { variant: 'double' };
  if (RE_SEP_STRONG.test(line)) return { variant: 'strong' };
  if (RE_SEP_DOTTED.test(line)) return { variant: 'dotted' };
  let m: RegExpMatchArray | null;
  if ((m = line.match(RE_SEP_TITLED_SOLID))) return { variant: 'solid', title: m[1].trim() };
  if ((m = line.match(RE_SEP_TITLED_DOUBLE))) return { variant: 'double', title: m[1].trim() };
  if ((m = line.match(RE_SEP_TITLED_STRONG))) return { variant: 'strong', title: m[1].trim() };
  if ((m = line.match(RE_SEP_TITLED_DOTTED))) return { variant: 'dotted', title: m[1].trim() };
  return null;
}

function normalizeRichBlocks(text?: string | null, theme?: Theme): NormalizedRichBlock[] | undefined {
  if (!text) return undefined;

  const font = fontFromTheme(theme);

  const blocks: NormalizedRichBlock[] = [];
  const buffer: string[] = [];
  let inCode = false;

  function flushBuffer() {
    if (buffer.length === 0) return;
    blocks.push({ kind: 'rich', html: TextBlock.blockFromLines(buffer, font).html });
    buffer.length = 0;
  }

  for (const rawLine of text.split('\n')) {
    const line = TextBlock.decodeEscapes(rawLine);
    const trimmed = line.trim();

    if (!inCode && /^<code>$/i.test(trimmed)) {
      inCode = true;
      buffer.push(line);
      continue;
    }
    if (inCode) {
      buffer.push(line);
      if (/^<\/code>$/i.test(trimmed)) inCode = false;
      continue;
    }

    const sep = classifySeparator(trimmed);
    if (!sep) {
      buffer.push(line);
      continue;
    }

    flushBuffer();
    blocks.push({
      kind: 'separator',
      variant: sep.variant,
      titleHtml: sep.title ? TextBlock.inlineCreole(sep.title, font).html : undefined,
    });
  }

  flushBuffer();
  return blocks;
}

function normalizeClassNode(node: SemanticNode, theme?: Theme, defaultVisibilityIcons?: boolean): SemanticNode {
  const entityType = node.stereotype || node.type || '';
  const autoSeparator = entityType !== 'object' && node.type !== 'state';
  const visibilityIcons = node.visibilityIcons ?? defaultVisibilityIcons;
  const textColor = parseNodeStyle(node.style)?.textColor;
  return {
    ...node,
    labelHtml: normalizeInlineHtml(node.label, theme, textColor),
    bodyBlocks: normalizeClassBodyBlocks({
      nodeId: node.id,
      bodyLines: node.bodyLines,
      visibilityIcons,
      hideFields: node.hideFields,
      hideMethods: node.hideMethods,
      autoSeparator,
      font: fontFromTheme(theme),
    }),
  };
}

function normalizeClassEdge(edge: SemanticEdge, theme?: Theme): SemanticEdge {
  const textColor = parseEdgeInlineStyle(edge.style)?.textColor;
  return {
    ...edge,
    labelHtml: normalizeInlineHtml(edge.label, theme, textColor),
    cardFromHtml: normalizeInlineHtml(edge.cardFrom, theme, textColor),
    cardToHtml: normalizeInlineHtml(edge.cardTo, theme, textColor),
  };
}

function normalizeClassGroup(group: SemanticGroup, theme?: Theme): SemanticGroup {
  const textColor = parseNodeStyle(group.style)?.textColor;
  return {
    ...group,
    labelHtml: normalizeInlineHtml(group.label, theme, textColor),
  };
}

function normalizeClassNote(note: ClassNote, theme?: Theme): ClassNote {
  const noteFont = noteFontFromTheme(theme);
  return {
    ...note,
    textHtml: note.text ? TextBlock.block(note.text, noteFont).html : undefined,
    richBlocks: note.text ? normalizeRichBlocks(note.text, { ...theme, fontSize: noteFont.size, fontFamily: noteFont.family }) : undefined,
  };
}

function normalizeClassLegend(legend?: ClassLegend, theme?: Theme): ClassLegend | undefined {
  if (!legend) return undefined;
  return {
    ...legend,
    textHtml: normalizeBlockHtml(legend.text, theme),
    richBlocks: normalizeRichBlocks(legend.text, theme),
  };
}

export function normalizeClassModelText(model: SemanticModel, theme?: Theme): SemanticModel {
  const visibilityIcons = !(model.skinparams && model.skinparams.classAttributeIconSize === '0');
  return {
    ...model,
    titleHtml: normalizeInlineHtml(model.title, theme),
    nodes: model.nodes.map((node) => normalizeClassNode(node, theme, visibilityIcons)),
    edges: model.edges.map((edge) => normalizeClassEdge(edge, theme)),
    notes: model.notes?.map((note) => normalizeClassNote(note, theme)),
    groups: model.groups?.map((group) => normalizeClassGroup(group, theme)),
    legend: normalizeClassLegend(model.legend, theme),
  };
}

function normalizeSequenceParticipant(participant: SequenceParticipant, theme?: Theme): SequenceParticipant {
  return {
    ...participant,
    labelHtml: normalizeInlineHtml(participant.label, theme),
    bracketBlocks: participant.bracketLines?.length
      ? normalizeRichBlocks(participant.bracketLines.join('\n'), theme)
      : undefined,
  };
}

function normalizeSequenceMessage(message: SequenceMessage, theme?: Theme): SequenceMessage {
  return {
    ...message,
    labelHtml: normalizeInlineHtml(message.label, theme),
    numberPrefixHtml: normalizeInlineHtml(message.numberPrefix, theme),
  };
}

function splitFragmentLabels(type: string, label?: string | null): { tabLabel: string; conditionLabel: string } {
  const rawLabel = label || '';
  const isGroupLike = type === 'group' || type === 'partition';
  if (!isGroupLike) {
    return {
      tabLabel: type,
      conditionLabel: rawLabel,
    };
  }
  const match = rawLabel.match(/^(.*?)\s*\[(.*)\]\s*$/);
  if (!match) {
    return {
      tabLabel: rawLabel,
      conditionLabel: '',
    };
  }
  return {
    tabLabel: match[1].trim(),
    conditionLabel: match[2].trim(),
  };
}

function normalizeSequenceFragment(fragment: SequenceFragment, theme?: Theme): SequenceFragment {
  const { tabLabel, conditionLabel } = splitFragmentLabels(fragment.type, fragment.label);
  return {
    ...fragment,
    labelHtml: normalizeInlineHtml(fragment.label, theme),
    tabLabel,
    tabLabelHtml: normalizeInlineHtml(tabLabel, theme),
    conditionLabel,
    conditionLabelHtml: normalizeInlineHtml(conditionLabel, theme),
    sections: fragment.sections?.map((section) => ({
      ...section,
      labelHtml: normalizeInlineHtml(section.label, theme),
    })),
  };
}

function normalizeSequenceDivider(divider: SequenceDivider, theme?: Theme): SequenceDivider {
  return {
    ...divider,
    labelHtml: normalizeInlineHtml(divider.label, theme),
  };
}

function normalizeSequenceDurationConstraint(dc: SequenceDurationConstraint, theme?: Theme): SequenceDurationConstraint {
  return {
    ...dc,
    labelHtml: normalizeInlineHtml(dc.label, theme),
  };
}

function normalizeSequenceNote(note: SequenceNote, theme?: Theme): SequenceNote {
  const noteFont = noteFontFromTheme(theme);
  return {
    ...note,
    textHtml: note.text ? TextBlock.block(note.text, noteFont).html : undefined,
    richBlocks: note.text ? normalizeRichBlocks(note.text, { ...theme, fontSize: noteFont.size, fontFamily: noteFont.family }) : undefined,
  };
}

export function normalizeSequenceModelText(model: SequenceModel, theme?: Theme): SequenceModel {
  return {
    ...model,
    titleHtml: normalizeInlineHtml(model.title, theme),
    mainframeHtml: normalizeInlineHtml(model.mainframe, theme),
    participants: model.participants.map((participant) => normalizeSequenceParticipant(participant, theme)),
    messages: model.messages.map((message) => normalizeSequenceMessage(message, theme)),
    fragments: model.fragments.map((fragment) => normalizeSequenceFragment(fragment, theme)),
    dividers: model.dividers.map((divider) => normalizeSequenceDivider(divider, theme)),
    durationConstraints: model.durationConstraints.map((dc) => normalizeSequenceDurationConstraint(dc, theme)),
    notes: model.notes.map((note) => normalizeSequenceNote(note, theme)),
  };
}