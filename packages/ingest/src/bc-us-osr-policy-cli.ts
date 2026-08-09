import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, REPO_ROOT } from './config.ts';
import { fetchText } from './fetcher.ts';
import {
  BRITISH_COUNCIL_US_OSR_MONITOR,
  BRITISH_COUNCIL_US_OSR_SOURCE,
  inspectBritishCouncilUsOsrPage,
} from './bc-us-osr-policy.ts';

const POLICY_FILE = path.join(DATA_DIR, 'after-test-policy.json');
const MONITORED_CLAIM =
  'IELTS One Skill Retake is currently not available for tests taken in the USA.';

interface PolicyFile {
  version: number;
  britishCouncilUnitedStates: {
    oneSkillRetakeUnavailable: boolean;
    sourceUrl: string;
    monitorUrl: string;
    monitoredClaim: string;
  };
}

async function main(): Promise<void> {
  // British Council returns 403 to non-browser GitHub-style HTTP clients. Jina
  // Reader is a documented, rate-limited transport for the same public source
  // URL; policy authority remains the British Council page recorded below.
  const response = await fetchText(BRITISH_COUNCIL_US_OSR_MONITOR, { force: true });
  const observation = inspectBritishCouncilUsOsrPage(response.body);
  const next: PolicyFile = {
    version: 1,
    britishCouncilUnitedStates: {
      oneSkillRetakeUnavailable: observation.oneSkillRetakeUnavailable,
      sourceUrl: BRITISH_COUNCIL_US_OSR_SOURCE,
      monitorUrl: BRITISH_COUNCIL_US_OSR_MONITOR,
      monitoredClaim: MONITORED_CLAIM,
    },
  };
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  const previousText = await fs.readFile(POLICY_FILE, 'utf8').catch(() => '');
  const changed = previousText !== nextText;

  if (changed) {
    const temporaryFile = `${POLICY_FILE}.tmp`;
    await fs.writeFile(temporaryFile, nextText, 'utf8');
    await fs.rename(temporaryFile, POLICY_FILE);
    console.log(
      `British Council USA OSR policy changed to ${observation.oneSkillRetakeUnavailable ? 'unavailable' : 'not restricted'}.`,
    );
  } else {
    console.log(
      `British Council USA OSR policy remains ${observation.oneSkillRetakeUnavailable ? 'unavailable' : 'not restricted'}.`,
    );
  }

  const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
  if (GITHUB_OUTPUT) {
    await fs.appendFile(
      GITHUB_OUTPUT,
      `changed=${changed}\nunavailable=${observation.oneSkillRetakeUnavailable}\n`,
      'utf8',
    );
  }
  if (GITHUB_STEP_SUMMARY) {
    await fs.appendFile(
      GITHUB_STEP_SUMMARY,
      [
        '## British Council USA One Skill Retake policy',
        '',
        `- Source: ${BRITISH_COUNCIL_US_OSR_SOURCE}`,
        `- Read via: ${BRITISH_COUNCIL_US_OSR_MONITOR}`,
        `- Warning active: ${observation.oneSkillRetakeUnavailable ? 'yes' : 'no'}`,
        `- Policy file changed: ${changed ? 'yes' : 'no'}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }

  console.log(`Policy file: ${path.relative(REPO_ROOT, POLICY_FILE)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
