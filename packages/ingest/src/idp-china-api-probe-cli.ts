#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import { REPORT_DIR, REPO_ROOT } from './config.ts';
import { decryptIdpChinaEnvelope } from './idp-china-api.ts';

const API_ORIGIN = 'https://sign.idpielts.cn';
const REPORT_FILE = path.join(
  REPORT_DIR,
  'provider-availability.idp-china.api-probe.json',
);

async function main(): Promise<void> {
  requireGitHubExperiment();
  const request = createSerialRequester(5_000);
  const examProjects = decryptIdpChinaEnvelope(
    await request.json(
      'exam-projects',
      '/chinesetestwebapi/common/getExamProject',
    ),
  );
  const firstPage = decryptIdpChinaEnvelope(
    await request.json(
      'first-session-page',
      '/chinesetestwebapi/common/testCenterSearch',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json;charset=UTF-8',
        },
        body: JSON.stringify({
          pageNum: 1,
          pageSize: 10,
          provinceId: null,
          cityId: null,
          sortOrder: 'asc',
        }),
      },
    ),
  );

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    REPORT_FILE,
    `${JSON.stringify(
      {
        version: 1,
        source: 'idp_china',
        checkedAt: new Date().toISOString(),
        publicationEnabled: false,
        requestSummary: request.summary(),
        examProjects,
        firstPage,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`Report: ${path.relative(REPO_ROOT, REPORT_FILE)}`);
}

function createSerialRequester(minimumIntervalMs: number) {
  let lastStartedAt = 0;
  let attempted = 0;
  let successful = 0;

  async function json(
    label: string,
    pathname: string,
    init?: RequestInit,
  ): Promise<unknown> {
    const url = new URL(pathname, API_ORIGIN);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'sign.idpielts.cn' ||
      !url.pathname.startsWith('/chinesetestwebapi/common/')
    ) {
      throw new Error(`Refusing unapproved IDP China URL ${url}`);
    }
    const waitMs = Math.max(
      0,
      lastStartedAt + minimumIntervalMs - Date.now(),
    );
    if (waitMs > 0) await delay(waitMs);
    lastStartedAt = Date.now();
    attempted++;
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        referer: 'https://www.idpielts.cn/test-dates',
        'user-agent':
          'ielts-map/0.1 availability validation ' +
          '(+https://github.com/ZhengQ2/ielts_app)',
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    const challenge = challengeSignal(text);
    if (response.status === 403 || response.status === 429 || challenge) {
      throw new Error(
        `${label} hit IDP China provider boundary: HTTP ${response.status}; ` +
          `${challenge ?? 'no text signal'}`,
      );
    }
    if (!response.ok) {
      throw new Error(`${label} failed with HTTP ${response.status}`);
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      successful++;
      return parsed;
    } catch {
      throw new Error(`${label} returned non-JSON content`);
    }
  }

  return {
    json,
    summary: () => ({ attempted, successful, minimumIntervalMs }),
  };
}

function challengeSignal(value: string): string | null {
  return [
    /\bcaptcha\b/i,
    /\brecaptcha\b/i,
    /verify (?:that )?you are human/i,
    /unusual traffic/i,
    /access denied/i,
    /security check/i,
    /temporarily blocked/i,
    /too many requests/i,
  ].find((pattern) => pattern.test(value))?.source ?? null;
}

function requireGitHubExperiment(): void {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.M2_7_LIVE_EXPERIMENT !== 'true'
  ) {
    throw new Error(
      'IDP China API probes may run only in GitHub Actions with ' +
        'M2_7_LIVE_EXPERIMENT=true',
    );
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).stack ?? error}`);
  process.exit(1);
});
