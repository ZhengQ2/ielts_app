function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value.normalize('NFKC').toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function manualCentreId(input: {
  countryOrRegion: string;
  operator: string;
  city: string;
  name: string;
  address: string;
  postcode?: string | null;
}): string {
  const country = input.countryOrRegion.trim().toLowerCase();
  const operator = slugify(input.operator);
  const cityInput = input.city.trim();
  const nameInput = input.name.trim();
  const city = slugify(cityInput) || `city-${stableHash(cityInput)}`;
  const name = slugify(nameInput) || `centre-${stableHash(nameInput)}`;
  if (!country || !operator || !cityInput || !nameInput) {
    throw new Error('Country or region, operator, city and centre name are required.');
  }
  const locationIdentity = [input.address, input.postcode ?? '']
    .map((value) => value.trim())
    .join('|');
  return `manual-${country}-${operator}-${city}-${name}-${stableHash(locationIdentity)}`;
}
