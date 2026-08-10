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
  let source: Awaited<ReturnType<typeof readPolicySource>>;
  try {
    source = await readPolicySource();
  } catch (error) {
    console.warn(
      `Neither the British Council origin nor the advisory proxy could be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    source = {
      body: '',
      trusted: false,
      transport: 'unavailable',
    };
  }
  let observation: ReturnType<typeof inspectBritishCouncilUsOsrPage>;
  let inspectionError: string | null = null;
  try {
    observation = inspectBritishCouncilUsOsrPage(source.body);
  } catch (error) {
    inspectionError = error instanceof Error ? error.message : String(error);
    observation = { status: 'unknown', normalizedText: '' };
    console.warn(inspectionError);
  }
  const previousText = await fs.readFile(POLICY_FILE, 'utf8');
  const previous = JSON.parse(previousText) as PolicyFile;
  if (
    typeof previous.britishCouncilUnitedStates?.oneSkillRetakeUnavailable !== 'boolean'
  ) {
    throw new Error('Existing British Council USA OSR policy is missing or invalid');
  }
  const currentUnavailable =
    previous.britishCouncilUnitedStates.oneSkillRetakeUnavailable;
  // Even an intact proxy rendering is advisory rather than authoritative. The
  // monitor therefore never mutates production policy: it only asks for human
  // review when the observed wording is unknown or disagrees with the current
  // state. A direct origin response is also reviewed manually so the scheduled
  // workflow has one predictable, auditable behaviour.
  const observedUnavailable = resolveBritishCouncilUsOsrWarning(
    currentUnavailable,
    observation,
  );
  const reviewRequired =
    observation.status === 'unknown' || observedUnavailable !== currentUnavailable;

  if (!source.trusted) {
    console.warn('The official page was unavailable; the proxy observation is advisory only.');
  }
  if (reviewRequired) {
    console.warn('The observation requires manual review; the policy file was not changed.');
  } else {
    console.log('The observation agrees with the current policy; no review is required.');
  }

  const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
  if (GITHUB_OUTPUT) {
    await fs.appendFile(
      GITHUB_OUTPUT,
      `review_required=${reviewRequired}\ncurrent_unavailable=${currentUnavailable}\nobservation=${observation.status}\nauthoritative=${source.trusted}\n`,
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
        `- Authoritative response: ${source.trusted ? 'yes' : 'no; proxy observation only'}`,
        `- Source observation: ${observation.status}`,
        ...(inspectionError ? [`- Inspection error: ${inspectionError}`] : []),
        `- Current warning active: ${currentUnavailable ? 'yes' : 'no'}`,
        `- Manual review required: ${reviewRequired ? 'yes' : 'no'}`,
        '- Policy file changed: no (this workflow is advisory only)',
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
