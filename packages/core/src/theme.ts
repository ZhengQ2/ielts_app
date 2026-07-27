import type { Operator } from './types.ts';

/**
 * Operator colours, kept in core so the web map, the badges and a future React
 * Native client all key off one definition rather than three.
 *
 * The hues are chosen to evoke each operator's own identity — British Council
 * is recognisably purple, IDP recognisably orange-red — but these are our own
 * values tuned for legibility on a light map, not the operators' official brand
 * specifications. We are an independent directory and don't claim their assets.
 */
export interface OperatorStyle {
  /**
   * Solid fill for map pins and swatches — graphical objects, which need 3:1
   * against their surroundings (WCAG 1.4.11), not the 4.5:1 body-text bar.
   *
   * Do NOT use as a background behind white text: IDP's orange is 4.30:1
   * against white, which fails AA at body size. Primary buttons deliberately
   * keep the neutral action colour, so operator colour means identity and
   * never doubles as an affordance.
   */
  base: string;
  /** Tinted background for badges and chips. */
  soft: string;
  /** Text colour on `soft`. All pairings verified at 6:1 or better. */
  text: string;
}

export const OPERATOR_STYLES: Record<Operator, OperatorStyle> = {
  'British Council': { base: '#5F259F', soft: '#F2EAFA', text: '#4A1D7E' },
  IDP: { base: '#D9480F', soft: '#FDEDE5', text: '#9C3412' },
  'IELTS USA': { base: '#1D4ED8', soft: '#E8EEFD', text: '#1E40AF' },
  unknown: { base: '#64748B', soft: '#F1F5F9', text: '#475569' },
};

export function operatorStyle(operator: Operator): OperatorStyle {
  return OPERATOR_STYLES[operator] ?? OPERATOR_STYLES.unknown;
}

/**
 * A second, non-colour channel for the same distinction. Colour alone is a
 * weak key on a map: it fails for colour-blind users (purple and orange
 * converge under tritanopia) and disappears entirely in print or greyscale.
 */
export type OperatorShape = 'circle' | 'diamond' | 'square';

export const OPERATOR_SHAPES: Record<Operator, OperatorShape> = {
  'British Council': 'circle',
  IDP: 'diamond',
  'IELTS USA': 'square',
  unknown: 'circle',
};

export function operatorShape(operator: Operator): OperatorShape {
  return OPERATOR_SHAPES[operator] ?? 'circle';
}
