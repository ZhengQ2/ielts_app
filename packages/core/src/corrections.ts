import type { Centre } from './types.ts';

const DIRECTORY_ORIGIN = 'https://ielts.zhengqiu.net';
const NEW_ISSUE_URL = 'https://github.com/ZhengQ2/ielts_app/issues/new';

export interface CorrectionReportOptions {
  location?: {
    lat: number;
    lng: number;
  };
}

/**
 * Open a structured, centre-specific GitHub report without adding a database
 * or public write endpoint to the static site. The issue remains a proposal
 * until a maintainer verifies its evidence and commits an override.
 */
export function correctionReportUrl(
  centre: Pick<Centre, 'id' | 'name' | 'ieltsOrgSlug' | 'sources'>,
  options?: CorrectionReportOptions,
): string {
  const listingUrl =
    centre.ieltsOrgSlug === 'added'
      ? `${DIRECTORY_ORIGIN}/centres/added/?id=${encodeURIComponent(centre.id)}`
      : `${DIRECTORY_ORIGIN}/centres/${encodeURIComponent(centre.ieltsOrgSlug)}/`;
  const sourceUrl = centre.sources[0]?.url ?? 'Not available';
  const location = options?.location;
  const latitude = location?.lat.toFixed(6);
  const longitude = location?.lng.toFixed(6);
  const exactLocationSection = location
    ? [
        '### Exact location selected on map',
        '',
        `- Latitude: ${latitude}`,
        `- Longitude: ${longitude}`,
        `- Google Maps: https://www.google.com/maps/search/?api=1&query=${latitude}%2C${longitude}`,
        '',
      ]
    : [];
  const body = [
    '### Centre',
    '',
    `- Name: ${centre.name}`,
    `- Directory listing: ${listingUrl}`,
    `- Source listing: ${sourceUrl}`,
    '',
    '### What needs correcting?',
    '',
    ...(location ? ['- [x] Map location'] : ['- [ ] Address text']),
    '- [ ] Opening status',
    '- [ ] Contact details',
    '- [ ] Tests, fees or booking link',
    '- [ ] Other',
    '',
    ...exactLocationSection,
    '### Correct information',
    '',
    '<!-- Describe exactly what should change. -->',
    '',
    '### Evidence',
    '',
    '<!-- Link to the operator, venue, map listing, announcement, or another reliable source. -->',
  ].join('\n');

  const url = new URL(NEW_ISSUE_URL);
  url.searchParams.set(
    'title',
    location
      ? `Centre location correction: ${centre.name}`
      : `Centre correction: ${centre.name}`,
  );
  url.searchParams.set('body', body);
  return url.toString();
}

export function genericCorrectionReportUrl(): string {
  const url = new URL(NEW_ISSUE_URL);
  url.searchParams.set('title', 'Centre correction: ');
  url.searchParams.set(
    'body',
    [
      '### Centre',
      '',
      '<!-- Add the centre name and directory link. -->',
      '',
      '### What needs correcting?',
      '',
      '- [ ] Address text',
      '- [ ] Opening status',
      '- [ ] Contact details',
      '- [ ] Tests, fees or booking link',
      '- [ ] Other',
      '',
      '<!-- For a map-location correction, open the centre in the directory and use its exact-location picker. -->',
      '',
      '### Correct information',
      '',
      '<!-- Describe exactly what should change. -->',
      '',
      '### Evidence',
      '',
      '<!-- Link to the operator, venue, map listing, announcement, or another reliable source. -->',
    ].join('\n'),
  );
  return url.toString();
}
