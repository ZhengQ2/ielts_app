import {
  centreForMap,
  mapExportSummary,
} from '@ielts-map/core';
import { dataset } from '@ielts-map/core/dataset';

/**
 * Provider-safe mobile feed for an Apple MapKit client.
 *
 * This route intentionally removes non-portable coordinates and Google Place
 * IDs server-side. The iOS app therefore cannot accidentally draw restricted
 * data on Apple Maps, even if a future UI forgets to check provenance.
 */
export const dynamic = 'force-static';

export function GET() {
  const centres = dataset.centres.map((centre) =>
    centreForMap(centre, 'apple'),
  );
  return Response.json({
    version: dataset.version,
    coordinatePolicyVersion: 1,
    target: 'apple',
    country: dataset.country,
    generatedAt: dataset.generatedAt,
    count: centres.length,
    mapCoverage: mapExportSummary(centres, 'apple'),
    centres,
  });
}
