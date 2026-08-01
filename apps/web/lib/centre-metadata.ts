import type { Centre } from '@ielts-map/core';

export function centrePageTitle(centre: Centre): string {
  const where = centre.address.city ? ` in ${centre.address.city}` : '';
  return `${centre.name} — IELTS test centre${where}`;
}

export function centrePageDescription(centre: Centre): string {
  const where = centre.address.city ? ` in ${centre.address.city}` : '';
  return `${centre.name}${where}: address, test formats, published fees and how to book. Operated by ${centre.operator}.`;
}

export function centreDocumentTitle(centre: Centre): string {
  return `${centrePageTitle(centre)} · IELTS Test Centre Finder`;
}
