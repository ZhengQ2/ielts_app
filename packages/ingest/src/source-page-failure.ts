import { ParseError } from './parse.ts';

export type SourcePageDisposition = 'removed' | 'retryable' | 'failed';

export interface SourcePageFailure {
  slug: string;
  error: string;
  disposition: SourcePageDisposition;
}

/**
 * Distinguish confirmed source removal from an inconclusive crawl failure.
 * HTTP 410 is an explicit permanent-removal signal. A 404 conflicts with the
 * current sitemap/listing that supplied the slug and remains unresolved until
 * later discovery sources corroborate its disappearance.
 */
export function classifySourcePageFailure(
  slug: string,
  error: unknown,
): SourcePageFailure {
  const parseFailure = error instanceof ParseError;
  const status = (error as { status?: number } | undefined)?.status;
  const message = error instanceof Error ? error.message : String(error);

  if (status === 410) {
    return { slug, error: message, disposition: 'removed' };
  }

  const retryable =
    !parseFailure &&
    (status === undefined ||
      status === 408 ||
      status === 425 ||
      status === 404 ||
      status === 429 ||
      status >= 500);

  return {
    slug,
    error: parseFailure ? `parse: ${message}` : message,
    disposition: retryable ? 'retryable' : 'failed',
  };
}
