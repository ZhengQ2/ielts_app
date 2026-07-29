import { dataset } from '@ielts-map/core/dataset';

/**
 * Static JSON feed of the directory.
 *
 * The web client fetches this only after its shell is visible, so the complete
 * dataset is no longer embedded in index.html. A mobile client can fetch the
 * same file and apply @ielts-map/core's filters locally.
 */
export const dynamic = 'force-static';

export function GET() {
  return Response.json({
    version: dataset.version,
    country: dataset.country,
    generatedAt: dataset.generatedAt,
    count: dataset.centres.length,
    centres: dataset.centres,
  });
}
