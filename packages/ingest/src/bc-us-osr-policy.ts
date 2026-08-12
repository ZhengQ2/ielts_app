import { stripTags } from './html.ts';

export const BRITISH_COUNCIL_US_OSR_SOURCE =
  'https://takeielts.britishcouncil.org/take-ielts/one-skill-retake';
export const BRITISH_COUNCIL_US_OSR_MONITOR =
  `https://r.jina.ai/${BRITISH_COUNCIL_US_OSR_SOURCE}`;

const REQUIRED_PAGE_ANCHORS = [
  'ielts one skill retake',
  'ielts academic and general training on computer',
  'ielts for ukvi',
  'conditions to book ielts one skill retake',
  'you can only retake one skill once per original test',
] as const;

export interface BritishCouncilUsOsrObservation {
  status: 'unavailable' | 'available' | 'unknown';
  normalizedText: string;
}

export function resolveBritishCouncilUsOsrWarning(
  previous: boolean,
  observation: BritishCouncilUsOsrObservation,
  trusted = true,
): boolean {
  if (!trusted) return previous;
  if (observation.status === 'unavailable') return true;
  if (observation.status === 'available') return false;
  return previous;
}

/**
 * Classify only an intact official OSR page. A challenge page, partial response,
 * or redesign must fail closed so it cannot silently remove a candidate warning.
 */
export function inspectBritishCouncilUsOsrPage(
  html: string,
): BritishCouncilUsOsrObservation {
  const normalizedText = stripTags(html).toLowerCase().replace(/\s+/g, ' ').trim();
  const missing = REQUIRED_PAGE_ANCHORS.filter(
    (anchor) => !normalizedText.includes(anchor),
  );
  if (missing.length > 0) {
    throw new Error(
      `British Council OSR page failed structural validation; missing: ${missing.join(', ')}`,
    );
  }

  // Bind the policy wording to the country in the same grammatical clause.
  // A broad character window can accidentally attach Canada's restriction to
  // an explicit USA availability statement on the same line.
  const clauseText = stripTags(
    html.replace(
      /(?:<\/?(?:p|li|div|section|article|h[1-6])\b[^>]*>|\r?\n+)/gi,
      '. ',
    ),
  );
  const contexts = clauseText
    .toLowerCase()
    .split(/(?:[.!?;]+|,\s*(?:but|while|whereas|however)\b|\b(?:but|while|whereas|however)\b)/)
    .map((clause) => clause.replace(/\s+/g, ' ').trim())
    .filter(
      (clause) =>
        clause.includes('one skill retake') &&
        /\b(?:usa|united states(?: of america)?)\b/.test(clause),
    );

  const unavailable = contexts.some((context) =>
    /(?:not\s+(?:currently\s+)?available|currently\s+not\s+available|unavailable|cannot\s+be\s+booked|can't\s+be\s+booked|not\s+eligible|ineligible|not\s+offered|does\s+not\s+offer|not\s+supported)/.test(
      context,
    ),
  );
  if (unavailable) return { status: 'unavailable', normalizedText };

  const available = contexts.some((context) =>
    /(?:is\s+(?:now\s+|currently\s+)?available|can\s+be\s+booked|(?:is\s+)?eligible|(?:is\s+)?offered)/.test(
      context,
    ),
  );
  if (available) return { status: 'available', normalizedText };

  return { status: 'unknown', normalizedText };
}
