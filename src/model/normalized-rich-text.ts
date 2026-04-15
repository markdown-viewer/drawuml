export type NormalizedRichBlock =
  | { kind: 'rich'; html: string }
  | { kind: 'separator'; variant: string; titleHtml?: string };

export type NormalizedBodyBlock =
  | { kind: 'row'; html: string; id?: string }
  | { kind: 'rich'; html: string }
  | { kind: 'separator'; variant: string; titleHtml?: string };