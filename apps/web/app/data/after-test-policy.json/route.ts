import { afterTestPolicy } from '@ielts-map/core';

export const dynamic = 'force-static';

export function GET() {
  return Response.json(afterTestPolicy);
}
