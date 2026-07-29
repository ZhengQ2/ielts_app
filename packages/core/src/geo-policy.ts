import type {
  Centre,
  CentreGeoPolicy,
  CentreMapExport,
  Geo,
  GeoProvenance,
  GeoSource,
  MapDisplayTarget,
} from './types.ts';

/**
 * Legacy rows predate explicit provenance. This table deliberately fails
 * closed: an unaudited provider is not treated as portable merely because its
 * response happens to contain WGS-84 coordinates.
 */
const LEGACY_PROVENANCE: Record<GeoSource, GeoProvenance> = {
  google: {
    origin: 'google_maps_platform',
    displayRights: 'google_maps_only',
    license: 'Google Maps Platform Terms',
    attribution: 'Google Maps',
    sourceRecordId: null,
  },
  google_places: {
    origin: 'google_maps_platform',
    displayRights: 'google_maps_only',
    license: 'Google Maps Platform Terms',
    attribution: 'Google Maps',
    sourceRecordId: null,
  },
  overture: {
    origin: 'overture_maps',
    // Overture records can carry different source licences. A migrated row
    // must persist its audited record-level provenance explicitly.
    displayRights: 'provider_review_required',
    license: null,
    attribution: 'Overture Maps Foundation',
    sourceRecordId: null,
  },
  nominatim: {
    origin: 'openstreetmap',
    displayRights: 'any_basemap',
    license: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors',
    sourceRecordId: null,
  },
  admin: {
    origin: 'administrator',
    displayRights: 'any_basemap',
    license: null,
    attribution: null,
    sourceRecordId: null,
  },
  crowd: {
    origin: 'community_submission',
    displayRights: 'provider_review_required',
    license: null,
    attribution: null,
    sourceRecordId: null,
  },
  page_embed: {
    origin: 'ielts_org',
    displayRights: 'provider_review_required',
    license: null,
    attribution: null,
    sourceRecordId: null,
  },
  amap_places: providerReview(),
  amap: providerReview(),
  mapbox: providerReview(),
  mappls: providerReview(),
  kakao: providerReview(),
  naver: providerReview(),
};

function providerReview(): GeoProvenance {
  return {
    origin: 'third_party_provider',
    displayRights: 'provider_review_required',
    license: null,
    attribution: null,
    sourceRecordId: null,
  };
}

export function geoProvenance(geo: Geo): GeoProvenance {
  return geo.provenance ?? LEGACY_PROVENANCE[geo.source];
}

export function geoPolicyFor(
  geo: Geo | null,
  target: MapDisplayTarget,
): CentreGeoPolicy {
  if (!geo) {
    return {
      target,
      status: 'missing',
      provenance: null,
      reason: 'No coordinate is available.',
    };
  }

  const provenance = geoProvenance(geo);
  if (
    provenance.displayRights === 'any_basemap' ||
    (target === 'google' &&
      provenance.displayRights === 'google_maps_only')
  ) {
    return {
      target,
      status: 'displayable',
      provenance,
      reason:
        provenance.displayRights === 'any_basemap'
          ? 'The coordinate is licensed for this basemap.'
          : 'The coordinate is restricted to a Google map.',
    };
  }

  return {
    target,
    status: 'suppressed',
    provenance,
    reason:
      provenance.displayRights === 'google_maps_only'
        ? 'Google-derived coordinates are not exported to non-Google maps.'
        : 'The source terms have not been approved for this basemap.',
  };
}

/**
 * Build the only centre shape mobile/map clients should receive. Provider
 * identifiers are intentionally omitted and an ineligible point becomes null.
 */
export function centreForMap(
  centre: Centre,
  target: MapDisplayTarget,
): CentreMapExport {
  const { googlePlaceId: _googlePlaceId, ...withoutProviderId } = centre;
  const geoPolicy = geoPolicyFor(centre.geo, target);
  return {
    ...withoutProviderId,
    geo: geoPolicy.status === 'displayable' ? centre.geo : null,
    geoPolicy,
  };
}

export interface MapExportSummary {
  target: MapDisplayTarget;
  total: number;
  displayable: number;
  suppressed: number;
  missing: number;
}

export function mapExportSummary(
  centres: CentreMapExport[],
  target: MapDisplayTarget,
): MapExportSummary {
  const summary: MapExportSummary = {
    target,
    total: centres.length,
    displayable: 0,
    suppressed: 0,
    missing: 0,
  };
  for (const centre of centres) summary[centre.geoPolicy.status]++;
  return summary;
}
