import type { TestOffering } from './types.ts';

const CURRENCY_RE = /\b([A-Z]{3})\b/;
const PRICE_NUMBER_RE = /[\p{Number}][\p{Number}\s.,'’٬٫]*/u;

const DIGIT_ZEROES = [
  0x0030, // ASCII
  0x0660, // Arabic-Indic
  0x06f0, // Eastern Arabic-Indic
  0x0966, // Devanagari
  0x09e6, // Bengali
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Oriya
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
  0x0e50, // Thai
  0x0ed0, // Lao
  0x0f20, // Tibetan
  0xff10, // Full-width
];

export interface ParsedPublishedPrice {
  priceText: string | null;
  parsedCurrency: string | null;
  parsedPrice: number | null;
  priceParseStatus: TestOffering['priceParseStatus'];
}

/** Preserve the published string while deriving safe numeric filter/sort fields. */
export function parsePublishedPrice(priceText: string | null): ParsedPublishedPrice {
  if (!priceText?.trim()) {
    return {
      priceText: null,
      parsedCurrency: null,
      parsedPrice: null,
      priceParseStatus: 'missing',
    };
  }

  const source = priceText.trim();
  const currencyMatch = CURRENCY_RE.exec(source);
  if (!currencyMatch) {
    return {
      priceText: source,
      parsedCurrency: null,
      parsedPrice: null,
      priceParseStatus: 'unparsed',
    };
  }

  const parsedCurrency = currencyMatch[1]!;
  const afterCurrency = source.slice(currencyMatch.index + currencyMatch[0].length);
  const numberMatch = PRICE_NUMBER_RE.exec(afterCurrency);
  const normalized = numberMatch ? normalizePriceNumber(numberMatch[0]) : null;
  const parsedPrice = normalized === null ? null : Number(normalized);

  return {
    priceText: source,
    parsedCurrency: Number.isFinite(parsedPrice) ? parsedCurrency : null,
    parsedPrice: Number.isFinite(parsedPrice) ? parsedPrice : null,
    priceParseStatus: Number.isFinite(parsedPrice) ? 'verified' : 'unparsed',
  };
}

function normalizePriceNumber(value: string): string | null {
  let normalizedDigits = '';
  for (const char of value.trim()) {
    if (/\p{Number}/u.test(char)) {
      const digit = unicodeDigit(char);
      if (digit === null) return null;
      normalizedDigits += digit;
    } else {
      normalizedDigits += char;
    }
  }

  const compact = normalizedDigits.replace(/[\s'’]/g, '').replace(/٬/g, ',').replace(/٫/g, '.');
  if (!/^\d[\d,.]*$/.test(compact)) return null;

  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let decimalSeparator: ',' | '.' | null = null;

  if (lastComma !== -1 && lastDot !== -1) {
    decimalSeparator = lastComma > lastDot ? ',' : '.';
  } else {
    const separator = lastComma !== -1 ? ',' : lastDot !== -1 ? '.' : null;
    if (separator) {
      const pieces = compact.split(separator);
      const tailLength = pieces.at(-1)?.length ?? 0;
      const everyGrouped = pieces.length > 1 && pieces.slice(1).every((piece) => piece.length === 3);
      if (!everyGrouped && (tailLength === 1 || tailLength === 2)) {
        decimalSeparator = separator;
      }
    }
  }

  let integerPart = compact;
  let fractionPart = '';
  if (decimalSeparator) {
    const index = compact.lastIndexOf(decimalSeparator);
    integerPart = compact.slice(0, index);
    fractionPart = compact.slice(index + 1);
  }

  integerPart = integerPart.replace(/[,.]/g, '');
  if (!/^\d+$/.test(integerPart) || (fractionPart && !/^\d{1,2}$/.test(fractionPart))) {
    return null;
  }
  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
}

function unicodeDigit(char: string): string | null {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return null;
  for (const zero of DIGIT_ZEROES) {
    const value = codePoint - zero;
    if (value >= 0 && value <= 9) return String(value);
  }
  return null;
}
