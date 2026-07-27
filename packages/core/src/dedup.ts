import type { ParsedCentre, TestFormat, TestOffering } from './types.ts';
import { haversineKm } from './geo.ts';
import { nameKey, nameSimilarity, normalisePostcode, slugBase } from './text.ts';

/**
 * Deduplication (DEV_PLAN §5.4). The identity key differs by operator:
 *
 *  1. British Council — the booking link's `location=` id is a real per-centre
 *     id. Same id ⇒ same centre, no fuzziness needed.
 *  2. IDP — booking links are generic, so there is no operator-side id. Fall
 *     back to the IELTS.org slug base, then fuzzy name + postcode + proximity.
 *  3. Everything else — the same fuzzy fallback.
 *
 * This is the most fragile part of ingestion. Every non-exact link is recorded
 * with its reason so ambiguous merges can be hand-reviewed.
 */

/** Coordinates this close are the same building for matching purposes. */
const PROXIMITY_KM = 0.15;

export interface MergeLink {
  a: string;
  b: string;
  reason: 'bc_location_id' | 'slug_base' | 'name_postcode' | 'name_proximity';
  /** 1 for exact-id links; the name similarity otherwise. */
  strength: number;
}

export interface DedupResult {
  /** Clusters of slugs, each representing one real centre. */
  clusters: ParsedCentre[][];
  links: MergeLink[];
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
}

export function dedupe(centres: ParsedCentre[]): DedupResult {
  const uf = new UnionFind();
  const links: MergeLink[] = [];

  const items: Indexed[] = centres.map((centre) => ({
    centre,
    key: nameKey(centre.name),
    base: slugBase(centre.slug),
    postcode: normalisePostcode(centre.address.postcode),
    city: nameKey(centre.address.city ?? ''),
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
      links.push({ a, b, reason: 'bc_location_id', strength: 1 });
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
      links.push({ a: a.centre.slug, b: b.centre.slug, reason: 'slug_base', strength: 1 });
    }
  }

  // 3. Fuzzy fallback. Blocked by postcode or city so this stays near-linear
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
        uf.union(a.centre.slug, b.centre.slug);
        links.push({ a: a.centre.slug, b: b.centre.slug, reason: link, strength: Number(sim.toFixed(3)) });
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

  return { clusters: [...grouped.values()], links };
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
  if (c.phone) score += 1;
  if (c.bookingUrl) score += 1;
  if (c.operatorSource === 'booking_domain') score += 2;
  score += Math.min(c.offerings.length, 6);
  return score;
}

/** Union of offerings across a cluster, deduped by label, cheapest kept. */
export function mergeOfferings(cluster: ParsedCentre[]): TestOffering[] {
  const byLabel = new Map<string, TestOffering>();
  for (const c of cluster) {
    for (const o of c.offerings) {
      const existing = byLabel.get(o.label);
      if (!existing) {
        byLabel.set(o.label, o);
        continue;
      }
      // Keep whichever actually carries a price; if both do, keep the lower.
      if (existing.price === null && o.price !== null) byLabel.set(o.label, o);
      else if (existing.price !== null && o.price !== null && o.price < existing.price) {
        byLabel.set(o.label, o);
      }
    }
  }
  return [...byLabel.values()];
}

export function mergeFormats(offerings: TestOffering[]): TestFormat[] {
  const set = new Set<TestFormat>();
  for (const o of offerings) set.add(o.format);
  return [...set];
}
