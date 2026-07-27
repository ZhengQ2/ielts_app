import type {
  Operator,
  OperatorSource,
  ParsedCentre,
  TestFormat,
  TestKind,
  TestOffering,
} from '@ielts-map/core';
import { CENTRE_URL_PREFIX } from './config.ts';
import { parseAddress } from './address.ts';
import { resolveCountry } from './country.ts';
import { decodeEntities, hrefs, paragraphs, sliceElement, stripTags } from './html.ts';

/**
 * Parse one IELTS.org test-centre page.
 *
 * Operator comes from the booking-link *domain* and nothing else. The slug is
 * not a reliable signal — plenty of centres carry no operator prefix at all
 * (`global-village-calgary`, `ces-exams-calgary`) and the page heading is
 * equally silent for those (DEV_PLAN §5.1).
 */

const BOOKING_DOMAINS: { pattern: RegExp; operator: Operator }[] = [
  { pattern: /(^|\.)bxsearch\.ielts\.idp\.com$/i, operator: 'IDP' },
  { pattern: /(^|\.)idpielts\.cn$/i, operator: 'IDP' },
  // ielts.idp.com bare is also the footer's generic IDP link on every page —
  // but hrefs() is only ever called on a test-row div (extractOfferings),
  // never on the whole page, so the footer's copy is structurally unreachable
  // here and this stays safe. The real per-centre link carries a path
  // (`/book/UKVI?testCentreId=…`); the footer's does not.
  { pattern: /(^|\.)ielts\.idp\.com$/i, operator: 'IDP' },
  // India books through a separate IDP-run site (DEV_PLAN §5.1).
  { pattern: /(^|\.)ieltsidpindia\.com$/i, operator: 'IDP' },
  { pattern: /(^|\.)ieltsregistration\.britishcouncil\.org$/i, operator: 'British Council' },
  // In China the British Council routes bookings through NEEA.
  { pattern: /(^|\.)ielts\.neea\.cn$/i, operator: 'British Council' },
  { pattern: /(^|\.)ieltsusa\.org$/i, operator: 'IELTS USA' },
  // A separate registered domain from ieltsusa.org, not a subdomain of it.
  { pattern: /(^|\.)registration-ieltsusa\.org$/i, operator: 'IELTS USA' },
];

export class ParseError extends Error {}

export function parseCentrePage(slug: string, html: string, fetchedAt: string): ParsedCentre {
  const name = extractName(html);
  if (!name) throw new ParseError(`No centre title found for ${slug}`);

  const address = parseAddress(extractAddressLines(html));
  const phone = extractPhone(html);
  const embeddedGeo = extractEmbeddedGeo(html);
  const { offerings, bookingUrl } = extractOfferings(html);
  const { operator, operatorSource, externalId } = detectOperator(bookingUrl, slug, name);

  // The address parser only recognises CA/US shapes. Outside those markets the
  // booking link's `country=` and the phone's dialling prefix carry the answer.
  // Whatever is still unknown is filled from the geocoder during resolution.
  address.country = resolveCountry(address.country, bookingUrl, phone);

  return {
    slug,
    url: `${CENTRE_URL_PREFIX}${slug}`,
    name,
    operator,
    operatorSource,
    externalId,
    address,
    phone,
    embeddedGeo,
    offerings,
    bookingUrl,
    fetchedAt,
  };
}

function extractName(html: string): string | null {
  const m = /<h1[^>]*class="[^"]*test-center-header__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (m?.[1]) return stripTags(m[1]);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return h1?.[1] ? stripTags(h1[1]) : null;
}

/** The `<p>` lines under the "Address" heading of the header block. */
function extractAddressLines(html: string): string[] {
  const heading = /<h5[^>]*test-center-header__content-column-heading[^>]*>\s*Address\s*<\/h5>/i.exec(
    html,
  );
  if (!heading) return [];
  const start = heading.index + heading[0].length;
  // Lines run to the end of the enclosing column div.
  const rest = html.slice(start, start + 4000);
  const end = rest.search(/<\/div>/i);
  return paragraphs(end === -1 ? rest : rest.slice(0, end));
}

function extractPhone(html: string): string | null {
  const m = /<div[^>]*test-center-header__content-column-contact--phone[^>]*>/i.exec(html);
  if (!m) return null;
  const block = sliceElement(html, m.index, 'div');
  const [first] = paragraphs(block);
  if (!first) return null;
  const digits = first.replace(/[^\d+]/g, '');
  return digits.length >= 6 ? first : null;
}

/**
 * The Google static-map URL embedded on some pages carries the centre's
 * coordinate. Present on most Canadian pages regardless of operator; absent on
 * plenty of others, so it is checked per page, never assumed.
 */
function extractEmbeddedGeo(html: string): { lat: number; lng: number } | null {
  const m = /staticmap\?[^"']*?center=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(
    decodeEntities(html),
  );
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Not just exact (0,0): a real page ("British Council, VTED COETI Hai
  // Phong") embedded the literal placeholder (1,1) — a coordinate in the Gulf
  // of Guinea, nowhere near Vietnam. Any point this close to (0,0) is a
  // sentinel, not a real address, for any centre this dataset will ever cover.
  if (Math.abs(lat) < 1 && Math.abs(lng) < 1) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const PRICE_RE = /\b([A-Z]{3})\s*([\d,]+(?:\.\d{1,2})?)\b/;

function extractOfferings(html: string): { offerings: TestOffering[]; bookingUrl: string | null } {
  const offerings: TestOffering[] = [];
  const bookingUrls: string[] = [];

  const rowRe = /<div[^>]*class="[^"]*ielts-tests-available__test-row[^"]*"[^>]*>/gi;
  for (const m of html.matchAll(rowRe)) {
    const row = sliceElement(html, m.index, 'div');

    const titleMatch = /<h6[^>]*ielts-tests-available__test-row-title[^>]*>([\s\S]*?)<\/h6>/i.exec(
      row,
    );
    const label = titleMatch?.[1] ? stripTags(titleMatch[1]) : '';
    // The right-hand column repeats the word "Fee" as its own title.
    if (!label || /^fee$/i.test(label)) continue;

    const priceMatch = [
      ...row.matchAll(
        /<p[^>]*ielts-tests-available__test-row-price[^>]*>([\s\S]*?)<\/p>/gi,
      ),
    ]
      .map((p) => stripTags(p[1] ?? ''))
      .find((t) => PRICE_RE.test(t));

    let currency: string | null = null;
    let price: number | null = null;
    if (priceMatch) {
      const parsed = PRICE_RE.exec(priceMatch);
      if (parsed) {
        currency = parsed[1]!;
        const n = Number(parsed[2]!.replace(/,/g, ''));
        price = Number.isFinite(n) ? n : null;
      }
    }

    for (const href of hrefs(row)) bookingUrls.push(href);

    offerings.push({
      label,
      kind: classifyKind(label),
      format: classifyFormat(label, row),
      currency,
      price,
    });
  }

  return { offerings, bookingUrl: pickBookingUrl(bookingUrls) };
}

/**
 * Only URLs on a known booking domain count. The page footer links
 * `ielts.idp.com` and `takeielts.britishcouncil.org` on *every* centre, so a
 * naive whole-page scan would label every British Council centre as IDP.
 */
function pickBookingUrl(urls: string[]): string | null {
  for (const url of urls) {
    if (operatorForUrl(url)) return url;
  }
  return null;
}

function operatorForUrl(url: string): Operator | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const { pattern, operator } of BOOKING_DOMAINS) {
    if (pattern.test(host)) return operator;
  }
  return null;
}

function detectOperator(
  bookingUrl: string | null,
  slug: string,
  name: string,
): { operator: Operator; operatorSource: OperatorSource; externalId: string | null } {
  if (bookingUrl) {
    const operator = operatorForUrl(bookingUrl);
    if (operator) {
      return {
        operator,
        operatorSource: 'booking_domain',
        externalId: extractExternalId(bookingUrl, operator),
      };
    }
  }

  // Fall back to weaker signals, recording which one was used so these rows can
  // be audited or down-weighted rather than silently trusted.
  const s = slug.toLowerCase();
  if (s.startsWith('british-council-')) {
    return { operator: 'British Council', operatorSource: 'slug', externalId: null };
  }
  if (s.startsWith('idp-') || s.startsWith('idp-ielts-china-')) {
    return { operator: 'IDP', operatorSource: 'slug', externalId: null };
  }

  const n = name.toLowerCase();
  if (n.includes('british council')) {
    return { operator: 'British Council', operatorSource: 'name', externalId: null };
  }
  if (/\bidp\b/.test(n)) {
    return { operator: 'IDP', operatorSource: 'name', externalId: null };
  }

  return { operator: 'unknown', operatorSource: 'unknown', externalId: null };
}

/**
 * British Council booking links carry a per-centre `location=` id — a real
 * identity key. IDP links are generic (`/wizard?utm_source=ielts.org`,
 * byte-identical across centres), so IDP has no external id here.
 */
function extractExternalId(bookingUrl: string, operator: Operator): string | null {
  if (operator !== 'British Council') return null;
  try {
    const id = new URL(bookingUrl).searchParams.get('location');
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function classifyKind(label: string): TestKind {
  const l = label.toLowerCase();
  if (l.includes('ukvi')) return 'ukvi';
  if (l.includes('one skill retake') || l.includes('osr')) return 'osr';
  if (l.includes('life skills')) return 'life_skills';
  if (l.includes('general training')) return 'general_training';
  if (l.includes('academic')) return 'academic';
  return 'other';
}

/**
 * The format icon's accessible label is the most reliable signal — British
 * Council rows title themselves just "Academic Test" with no format suffix,
 * while IDP rows say "IELTS Academic on computer".
 */
function classifyFormat(label: string, row: string): TestFormat {
  if (/aria-label="Test on paper"/i.test(row)) return 'paper_based';
  if (/aria-label="Test on computer"/i.test(row)) return 'computer_delivered';

  const l = label.toLowerCase();
  if (l.includes('on paper') || l.includes('paper-based')) return 'paper_based';
  if (l.includes('on computer') || l.includes('computer-delivered')) return 'computer_delivered';

  // Paper is being retired worldwide, so computer-delivered is the safe default.
  return 'computer_delivered';
}
