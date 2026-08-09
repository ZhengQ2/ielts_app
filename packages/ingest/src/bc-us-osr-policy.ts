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
  oneSkillRetakeUnavailable: boolean;
  normalizedText: string;
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

  const countryMentions = [...normalizedText.matchAll(/\b(?:usa|united states(?: of america)?)\b/g)];
  const oneSkillRetakeUnavailable = countryMentions.some((mention) => {
    const start = Math.max(0, (mention.index ?? 0) - 300);
    const end = Math.min(normalizedText.length, (mention.index ?? 0) + mention[0].length + 160);
    const context = normalizedText.slice(start, end);
    return (
      context.includes('one skill retake') &&
      /(?:not\s+(?:currently\s+)?available|currently\s+not\s+available|unavailable)/.test(
        context,
      )
    );
  });

  return { oneSkillRetakeUnavailable, normalizedText };
}
