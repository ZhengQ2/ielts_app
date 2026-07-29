import type {
  CentreContactInformation,
  ParsedCentre,
  TestFormat,
  TestOffering,
} from './types.ts';
import { haversineKm } from './geo.ts';
import { nameKey, nameSimilarity, normalisePostcode, slugBase } from './text.ts';
import { offeringCategory, offeringModule } from './offerings.ts';

/**
 * Deduplication (DEV_PLAN §5.4). The identity key differs by operator:
 *
 *  1. British Council — the booking link's `location=` id is a real per-centre
 *     id. Same id ⇒ same centre, no fuzziness needed.
 *  2. IDP — booking links are generic, so there is no operator-side id. The
 *     IELTS.org slug base is the strongest automatic key.
 *  3. Same-operator exact-address matches may merge automatically. Fuzzy
 *     name/postcode/proximity matches are proposals only and never union rows.
 *
 * Every ambiguous link is retained in the audit queue so it can gain more
 * evidence on a later automated run without corrupting centre identity now.
 */

/** Coordinates this close are the same building for matching purposes. */
const PROXIMITY_KM = 0.15;

export interface MergeLink {
  a: string;
  b: string;
  reason:
    | 'bc_location_id'
    | 'slug_base'
    | 'operator_address'
    | 'name_postcode'
    | 'name_proximity';
  /** 1 for exact-id links; the name similarity otherwise. */
  strength: number;
  decision: 'automatic' | 'pending';
}

export interface DedupResult {
  /** Clusters of slugs, each representing one real centre. */
  clusters: ParsedCentre[][];
  /** Evidence-backed links that were actually merged. */
  links: MergeLink[];
  /** Ambiguous proposals retained for automatic retry or optional review. */
  pendingLinks: MergeLink[];
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

interface Indexed {
  centre: ParsedCentre;
  key: string;
  base: string;
  postcode: string;
  city: string;
  address: string;
}

export function dedupe(centres: ParsedCentre[]): DedupResult {
  const uf = new UnionFind();
  const links: MergeLink[] = [];
  const pendingLinks: MergeLink[] = [];

  const items: Indexed[] = centres.map((centre) => ({
    centre,
    key: nameKey(centre.name),
    base: slugBase(centre.slug),
    postcode: normalisePostcode(centre.address.postcode),
    city: nameKey(centre.address.city ?? ''),
    address: nameKey(centre.address.raw),
  }));

  for (const it of items) uf.find(it.centre.slug);

  // 1. British Council: exact `location=` id.
  const byExternalId = new Map<string, Indexed[]>();
  for (const it of items) {
    const id = it.centre.externalId;
    if (!id) continue;
    const bucket = byExternalId.get(id) ?? [];
    bucket.push(it);
    byExternalId.set(id, bucket);
  }
  for (const bucket of byExternalId.values()) {
    for (let i = 1; i < bucket.length; i++) {
      const a = bucket[0]!.centre.slug;
      const b = bucket[i]!.centre.slug;
      uf.union(a, b);
      links.push({ a, b, reason: 'bc_location_id', strength: 1, decision: 'automatic' });
    }
  }

  // 2. Slug base: catches the `…-ns` / `…-ns-2` duplicate-page pattern.
  const byBase = new Map<string, Indexed[]>();
  for (const it of items) {
    const bucket = byBase.get(it.base) ?? [];
    bucket.push(it);
    byBase.set(it.base, bucket);
  }
  for (const bucket of byBase.values()) {
    for (let i = 1; i < bucket.length; i++) {
      const a = bucket[0]!;
      const b = bucket[i]!;
      // A shared slug base is normally the `…-2` duplicate-page pattern, but a
      // real id or a contradicting operator always beats the slug heuristic.
      if (!mergeable(a.centre, b.centre)) continue;
      uf.union(a.centre.slug, b.centre.slug);
      links.push({
        a: a.centre.slug,
        b: b.centre.slug,
        reason: 'slug_base',
        strength: 1,
        decision: 'automatic',
      });
    }
  }

  // 3. Exact physical address within one operator. This is how separate source
  // pages for computer, paper and Life Skills become offerings under one
  // centre rather than duplicate centres.
  const byAddress = new Map<string, Indexed[]>();
  for (const it of items) {
    if (!it.address || it.address.length < 10) continue;
    const bucket = byAddress.get(it.address) ?? [];
    bucket.push(it);
    byAddress.set(it.address, bucket);
  }
  for (const bucket of byAddress.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        if (uf.find(a.centre.slug) === uf.find(b.centre.slug)) continue;
        if (!mergeable(a.centre, b.centre) || a.centre.operator !== b.centre.operator) continue;
        const sim = nameSimilarity(a.key, b.key);
        if (sim < 0.6) continue;
        uf.union(a.centre.slug, b.centre.slug);
        links.push({
          a: a.centre.slug,
          b: b.centre.slug,
          reason: 'operator_address',
          strength: Number(sim.toFixed(3)),
          decision: 'automatic',
        });
      }
    }
  }

  // 4. Fuzzy fallback. Blocked by postcode or city so this stays near-linear
  // rather than comparing every pair.
  const blocks = new Map<string, Indexed[]>();
  const addToBlock = (k: string, it: Indexed) => {
    if (!k) return;
    const bucket = blocks.get(k) ?? [];
    bucket.push(it);
    blocks.set(k, bucket);
  };
  for (const it of items) {
    addToBlock(`pc:${it.postcode}`, it);
    addToBlock(`city:${it.city}`, it);
  }

  const considered = new Set<string>();
  for (const [blockKey, bucket] of blocks) {
    if (bucket.length < 2 || bucket.length > 400) continue;
    const isPostcodeBlock = blockKey.startsWith('pc:');
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        if (uf.find(a.centre.slug) === uf.find(b.centre.slug)) continue;

        const pairKey =
          a.centre.slug < b.centre.slug
            ? `${a.centre.slug}|${b.centre.slug}`
            : `${b.centre.slug}|${a.centre.slug}`;
        if (considered.has(pairKey)) continue;
        considered.add(pairKey);

        if (!mergeable(a.centre, b.centre)) continue;

        const sim = nameSimilarity(a.key, b.key);
        const link = classify(a, b, sim, isPostcodeBlock);
        if (!link) continue;
        pendingLinks.push({
          a: a.centre.slug,
          b: b.centre.slug,
          reason: link,
          strength: Number(sim.toFixed(3)),
          decision: 'pending',
        });
      }
    }
  }

  const grouped = new Map<string, ParsedCentre[]>();
  for (const it of items) {
    const root = uf.find(it.centre.slug);
    const bucket = grouped.get(root) ?? [];
    bucket.push(it.centre);
    grouped.set(root, bucket);
  }

  return { clusters: [...grouped.values()], links, pendingLinks };
}

/**
 * Hard blocks that no amount of name similarity can override.
 *
 * Both were learned from real false merges: "British Council, ILSC Vancouver
 * Downtown" and "ILAC - Vancouver Downtown" are one edit apart but are
 * different companies at different addresses run by different operators.
 */
function mergeable(a: ParsedCentre, b: ParsedCentre): boolean {
  // Different British Council ids mean definitively different centres.
  if (a.externalId && b.externalId && a.externalId !== b.externalId) return false;

  // A centre has one operator. When both were read from a booking-link domain
  // — the reliable signal — a disagreement means these are not the same place.
  if (
    a.operatorSource === 'booking_domain' &&
    b.operatorSource === 'booking_domain' &&
    a.operator !== b.operator
  ) {
    return false;
  }

  return true;
}

/**
 * Note what is absent: there is no city-level rule. City agreement plus a
 * similar name is not evidence of identity — it merged three distinct pairs of
 * Canadian centres that merely shared a city and a common word like "College".
 * Identity needs a shared postcode or physical proximity.
 */
function classify(
  a: Indexed,
  b: Indexed,
  sim: number,
  isPostcodeBlock: boolean,
): MergeLink['reason'] | null {
  if (isPostcodeBlock && a.postcode && sim >= 0.8) return 'name_postcode';

  const ga = a.centre.embeddedGeo;
  const gb = b.centre.embeddedGeo;
  if (ga && gb && haversineKm(ga, gb) <= PROXIMITY_KM && sim >= 0.75) {
    return 'name_proximity';
  }

  return null;
}

/**
 * Collapse a cluster into the record we keep. Prefers the most complete page,
 * unions the offerings, and keeps the freshest price.
 */
export function pickCanonical(cluster: ParsedCentre[]): ParsedCentre {
  return [...cluster].sort((a, b) => completeness(b) - completeness(a) || a.slug.length - b.slug.length)[0]!;
}

function completeness(c: ParsedCentre): number {
  let score = 0;
  if (c.embeddedGeo) score += 4;
  if (c.address.postcode) score += 2;
  if (c.address.lines.length > 1) score += 1;
  if (c.contact.phones.length || c.contact.emails.length || c.contact.websites.length) score += 1;
  if (c.bookingUrl) score += 1;
  if (c.operatorSource === 'booking_domain') score += 2;
  score += Math.min(c.offerings.length, 6);
  return score;
}

/**
 * Preserve every contact value published by pages in a dedup cluster.
 *
 * Display strings remain untouched. Keys are used only to collapse equivalent
 * spellings such as `+1 (403) 441-4375` and `+1 403 441 4375`.
 */
export function mergeContactInformation(cluster: ParsedCentre[]): CentreContactInformation {
  const phones = uniqueBy(
    cluster.flatMap((centre) => [
      ...centre.contact.phones,
      ...(centre.phone ? [centre.phone] : []),
    ]),
    phoneIdentity,
  );
  const emails = uniqueBy(
    cluster.flatMap((centre) => centre.contact.emails),
    (value) => value.trim().toLocaleLowerCase('en'),
  );
  const websites = uniqueBy(
    cluster.flatMap((centre) => centre.contact.websites),
    websiteIdentity,
  );
  return { phones, emails, websites };
}

function uniqueBy(values: string[], identity: (value: string) => string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = identity(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function phoneIdentity(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

function websiteIdentity(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim().toLocaleLowerCase('en').replace(/\/+$/, '');
  }
}

/**
 * Union of offerings across a cluster.
 *
 * Physical-centre variants are keyed by module, category, delivery format and
 * meaningful subtype. A conflicting published fee is never resolved by
 * silently choosing the cheaper value; both source observations survive.
 */
export function mergeOfferings(cluster: ParsedCentre[]): TestOffering[] {
  const merged: TestOffering[] = [];
  const byIdentity = new Map<string, number[]>();
  for (const c of cluster) {
    for (const o of c.offerings) {
      const identity = offeringIdentity(o);
      const existingIndexes = byIdentity.get(identity) ?? [];
      const identicalPrice = existingIndexes.find(
        (index) => merged[index]!.priceText === o.priceText,
      );
      if (identicalPrice !== undefined) continue;

      const unpriced = existingIndexes.find(
        (index) => merged[index]!.priceText === null,
      );
      if (unpriced !== undefined && o.priceText !== null) {
        merged[unpriced] = o;
        continue;
      }
      if (o.priceText === null && existingIndexes.length > 0) continue;

      // Different non-null source strings are intentionally separate records.
      const index = merged.push(o) - 1;
      existingIndexes.push(index);
      byIdentity.set(identity, existingIndexes);
    }
  }
  return merged.sort(
    (a, b) =>
      offeringModule(a).localeCompare(offeringModule(b)) ||
      offeringCategory(a).localeCompare(offeringCategory(b)) ||
      a.format.localeCompare(b.format) ||
      a.label.localeCompare(b.label) ||
      (a.priceText ?? '').localeCompare(b.priceText ?? ''),
  );
}

function offeringIdentity(offering: TestOffering): string {
  const label = offering.label.toLowerCase();
  const module = offeringModule(offering);
  const category = offeringCategory(offering);
  let subtype = '';
  if (module === 'life_skills') {
    subtype = /\b(?:a1|a2|b1)\b/i.exec(label)?.[0]?.toLowerCase() ?? '';
  } else if (category === 'ukvi_selt') {
    // IELTS.org currently publishes both explicit "UKVI" products and
    // separately named "SELT Online" products at a few centres. They belong
    // to the same reader-facing filter category but must remain distinct
    // source offerings even when their fees happen to agree.
    subtype = /\bselt\b/i.test(label) && !/\bukvi\b/i.test(label)
      ? 'selt_source'
      : 'ukvi';
  } else if (module === 'other') {
    subtype = nameKey(offering.label);
  }
  return `${module}|${category}|${offering.format}|${subtype}`;
}

export function mergeFormats(offerings: TestOffering[]): TestFormat[] {
  const set = new Set<TestFormat>();
  for (const o of offerings) set.add(o.format);
  return [...set];
}
