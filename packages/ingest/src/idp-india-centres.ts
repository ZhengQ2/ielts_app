import type { Centre } from '@ielts-map/core';
import { nameKey, nameSimilarity } from '@ielts-map/core';
import { decodeEntities, stripTags } from './html.ts';

export const IDP_INDIA_COMPUTER_CENTRES_URL =
  'https://ieltsidpindia.com/information/contact?id=XjtgUbo%2B2SE%3D';

export interface IdpIndiaProviderCentre {
  providerCentreId: string;
  name: string;
  region: string | null;
  address: string;
  phone: string | null;
  sourceUrl: string;
}

const REGIONS = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
].sort((a, b) => b.length - a.length);

export function parseIdpIndiaComputerCentresHtml(
  html: string,
): IdpIndiaProviderCentre[] {
  const start = headingIndex(html, /IELTS on Computer Test Centres/i);
  const end = headingIndex(
    html,
    /IDP(?:'|&#39;|&apos;|’|s)?s? Student Placement Branches In India/i,
    start + 1,
  );
  if (start < 0 || end <= start) {
    throw new Error(
      'IDP India computer-centre section boundaries were not found',
    );
  }
  const section = html.slice(start, end);
  const headings = [
    ...section.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi),
  ];
  const centres: IdpIndiaProviderCentre[] = [];
  for (const [index, heading] of headings.entries()) {
    const cardStart = (heading.index ?? 0) + heading[0].length;
    const cardEnd =
      headings[index + 1]?.index ?? section.length;
    const cardText = text(section.slice(cardStart, cardEnd));
    const addressMatch =
      /\bAddress\s+(.+?)(?=\s+Phone\b|$)/i.exec(cardText);
    if (!addressMatch?.[1]) continue;
    const phoneMatch = /\bPhone\s*([+()\d][+\d()\s./-]{5,})/i.exec(
      cardText,
    );
    const labelledName = text(heading[1] ?? '');
    const { name, region } = splitRegion(labelledName);
    if (!name) continue;
    const address = addressMatch[1].trim();
    const providerCentreId = providerId(name, address);
    centres.push({
      providerCentreId,
      name,
      region,
      address,
      phone: phoneMatch?.[1]?.trim() ?? null,
      sourceUrl: IDP_INDIA_COMPUTER_CENTRES_URL,
    });
  }
  const unique = new Map<string, IdpIndiaProviderCentre>();
  for (const centre of centres) {
    if (unique.has(centre.providerCentreId)) {
      throw new Error(
        `Duplicate IDP India provider centre ${centre.providerCentreId}`,
      );
    }
    unique.set(centre.providerCentreId, centre);
  }
  if (unique.size < 20) {
    throw new Error(
      `IDP India computer-centre page yielded only ${unique.size} centres`,
    );
  }
  return [...unique.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.providerCentreId.localeCompare(b.providerCentreId),
  );
}

export function matchIdpIndiaProviderCentre(
  provider: IdpIndiaProviderCentre,
  centres: readonly Pick<
    Centre,
    'id' | 'name' | 'operator' | 'address' | 'bookingUrl'
  >[],
): {
  status: 'matched' | 'ambiguous' | 'unmatched';
  centreId: string | null;
  candidateCentreIds: string[];
} {
  const providerName = locationKey(provider.name);
  const providerQualifier = locationQualifier(providerName);
  const candidates = centres
    .filter(
      (centre) =>
        centre.operator === 'IDP' &&
        centre.address.country === 'IN' &&
        isIndiaBookingUrl(centre.bookingUrl),
    )
    .map((centre) => {
      const centreName = locationKey(centre.name);
      const nameScore = nameSimilarity(
        providerName,
        centreName,
      );
      const addressScore = nameSimilarity(
        nameKey(provider.address),
        nameKey(centre.address.raw),
      );
      return {
        centre,
        nameScore:
          providerQualifier &&
          !new Set(centreName.split(' ')).has(providerQualifier)
            ? 0
            : nameScore,
        addressScore,
      };
    })
    .filter(
      ({ nameScore, addressScore }) =>
        nameScore >= 0.45 || addressScore >= 0.55,
    )
    .sort(
      (a, b) =>
        b.addressScore - a.addressScore ||
        b.nameScore - a.nameScore ||
        a.centre.id.localeCompare(b.centre.id),
    );
  if (!candidates.length) {
    return { status: 'unmatched', centreId: null, candidateCentreIds: [] };
  }
  const best = candidates[0]!;
  const second = candidates[1];
  const candidateCentreIds = candidates.map(({ centre }) => centre.id);
  const uniqueAddress =
    best.addressScore >= 0.76 &&
    (!second || best.addressScore - second.addressScore >= 0.12);
  const uniqueName =
    best.nameScore >= 0.78 &&
    (!second || best.nameScore - second.nameScore >= 0.18);
  if (
    uniqueAddress ||
    uniqueName
  ) {
    return {
      status: 'matched',
      centreId: best.centre.id,
      candidateCentreIds,
    };
  }
  return { status: 'ambiguous', centreId: null, candidateCentreIds };
}

function headingIndex(
  html: string,
  textPattern: RegExp,
  fromIndex = 0,
): number {
  const rest = html.slice(fromIndex);
  for (const match of rest.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    if (textPattern.test(text(match[1] ?? ''))) {
      return fromIndex + (match.index ?? 0);
    }
  }
  return -1;
}

function splitRegion(value: string): {
  name: string;
  region: string | null;
} {
  for (const region of REGIONS) {
    const pattern = new RegExp(`\\s+${escapeRegExp(region)}\\s*$`, 'i');
    if (pattern.test(value)) {
      return {
        name: value.replace(pattern, '').trim(),
        region,
      };
    }
  }
  return { name: value.trim(), region: null };
}

function providerId(name: string, address: string): string {
  const namePart = nameKey(name).replace(/\s+/g, '-');
  const numbers = address.match(/\b\d+[A-Za-z]?\b/g)?.slice(0, 2) ?? [];
  return [namePart, ...numbers].filter(Boolean).join('-');
}

function locationKey(value: string): string {
  return nameKey(value)
    .split(' ')
    .filter(
      (token) =>
        token !== 'idp' &&
        token !== 'education' &&
        token !== 'india' &&
        token !== 'pvt' &&
        token !== 'private' &&
        token !== 'test' &&
        token !== 'centre' &&
        token !== 'center',
    )
    .join(' ');
}

function locationQualifier(value: string): string | null {
  const tokens = value.split(' ').filter(Boolean);
  return tokens.length > 1 ? tokens[tokens.length - 1]! : null;
}

function isIndiaBookingUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    return (
      new URL(value).hostname.replace(/^www\./i, '').toLowerCase() ===
      'ieltsidpindia.com'
    );
  } catch {
    return false;
  }
}

function text(value: string): string {
  return stripTags(decodeEntities(value)).replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
