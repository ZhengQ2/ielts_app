/**
 * Encode scraped text as hex before placing it in generated GoogleSQL. The
 * resulting literal contains no source quote, backslash, comment or statement
 * characters and therefore cannot alter the query grammar.
 */
export function googleSqlString(value: string): string {
  return `CAST(FROM_HEX('${Buffer.from(value, 'utf8').toString('hex')}') AS STRING)`;
}
