import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, REPO_ROOT } from './config.ts';
import { fetchText } from './fetcher.ts';
import {
  BRITISH_COUNCIL_US_OSR_MONITOR,
  BRITISH_COUNCIL_US_OSR_SOURCE,
  inspectBritishCouncilUsOsrPage,
  resolveBritishCouncilUsOsrWarning,
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
  const source = await readPolicySource();
  const observation = inspectBritishCouncilUsOsrPage(source.body);
  const previousText = await fs.readFile(POLICY_FILE, 'utf8');
  const previous = JSON.parse(previousText) as PolicyFile;
  if (
    typeof previous.britishCouncilUnitedStates?.oneSkillRetakeUnavailable !== 'boolean'
  ) {
    throw new Error('Existing British Council USA OSR policy is missing or invalid');
  }
  const oneSkillRetakeUnavailable = resolveBritishCouncilUsOsrWarning(
    previous.britishCouncilUnitedStates.oneSkillRetakeUnavailable,
    observation,
    source.trusted,
  );
  const next: PolicyFile = {
    version: 1,
    britishCouncilUnitedStates: {
      oneSkillRetakeUnavailable,
      sourceUrl: BRITISH_COUNCIL_US_OSR_SOURCE,
      monitorUrl: BRITISH_COUNCIL_US_OSR_MONITOR,
      monitoredClaim: MONITORED_CLAIM,
    },
  };
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  const changed = previousText !== nextText;

  if (!source.trusted) {
    console.warn(
      `The official page was unavailable. The proxy observation is advisory only; preserving the previous ${oneSkillRetakeUnavailable ? 'unavailable' : 'not restricted'} state.`,
    );
  } else if (observation.status === 'unknown') {
    console.warn(
      `British Council USA OSR wording was not recognized; preserving the previous ${oneSkillRetakeUnavailable ? 'unavailable' : 'not restricted'} state.`,
    );
  }

  if (changed) {
    const temporaryFile = `${POLICY_FILE}.tmp`;
    await fs.writeFile(temporaryFile, nextText, 'utf8');
    await fs.rename(temporaryFile, POLICY_FILE);
    console.log(
      `British Council USA OSR policy changed to ${oneSkillRetakeUnavailable ? 'unavailable' : 'not restricted'}.`,
    );
  } else {
    console.log(
      `British Council USA OSR policy remains ${oneSkillRetakeUnavailable ? 'unavailable' : 'not restricted'}.`,
    );
  }

  const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
  if (GITHUB_OUTPUT) {
    await fs.appendFile(
      GITHUB_OUTPUT,
      `changed=${changed}\nunavailable=${oneSkillRetakeUnavailable}\nobservation=${observation.status}\ntrusted=${source.trusted}\n`,
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
        `- Read via: ${source.transport}`,
        `- Authoritative response: ${source.trusted ? 'yes' : 'no; prior state preserved'}`,
        `- Source observation: ${observation.status}`,
        `- Warning active: ${oneSkillRetakeUnavailable ? 'yes' : 'no'}`,
        `- Policy file changed: ${changed ? 'yes' : 'no'}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }

  console.log(`Policy file: ${path.relative(REPO_ROOT, POLICY_FILE)}`);
}

async function readPolicySource(): Promise<{
  body: string;
  trusted: boolean;
  transport: string;
}> {
  try {
    const response = await fetch(BRITISH_COUNCIL_US_OSR_SOURCE, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent':
          'Mozilla/5.0 (compatible; IELTSDirectoryPolicyMonitor/1.0; +https://ielts.zhengqiu.net)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    const finalUrl = new URL(response.url);
    if (
      !response.ok ||
      finalUrl.protocol !== 'https:' ||
      finalUrl.hostname !== 'takeielts.britishcouncil.org' ||
      finalUrl.username !== '' ||
      finalUrl.password !== ''
    ) {
      throw new Error(`official response was HTTP ${response.status}`);
    }
    return {
      body: await response.text(),
      trusted: true,
      transport: 'British Council origin',
    };
  } catch (error) {
    console.warn(
      `Direct British Council fetch failed (${error instanceof Error ? error.message : String(error)}); checking the proxy for advisory monitoring only.`,
    );
    const response = await fetchText(BRITISH_COUNCIL_US_OSR_MONITOR, { force: true });
    return {
      body: response.body,
      trusted: false,
      transport: BRITISH_COUNCIL_US_OSR_MONITOR,
    };
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
