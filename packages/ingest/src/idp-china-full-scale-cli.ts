#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CentreDataset } from '@ielts-map/core';
import {
  buildIdpChinaAvailabilitySnapshot,
  idpChinaAvailabilitySafetyProblems,
  parseIdpChinaSessionPage,
  type IdpChinaSession,
} from './idp-china-availability.ts';
import { decryptIdpChinaEnvelope } from './idp-china-api.ts';
import { DATA_DIR, REPORT_DIR, REPO_ROOT } from './config.ts';

const API_ORIGIN = 'https://sign.idpielts.cn';
const SESSION_SEARCH_PATH =
  '/chinesetestwebapi/common/testCenterSearch';
const REPORT_FILE = path.join(
  REPORT_DIR,
  'provider-availability.idp-china.full-scale.json',
);

class ProviderBoundaryError extends Error {}

async function main(): Promise<void> {
  requireGitHubExperiment();
  const startedAt = new Date().toISOString();
  const request = createSerialRequester(
    boundedInteger(
      process.env.IDP_CHINA_MIN_INTERVAL_MS ?? '3000',
      1_500,
      60_000,
      'IDP_CHINA_MIN_INTERVAL_MS',
    ),
  );
  const pageSize = boundedInteger(
    process.env.IDP_CHINA_PAGE_SIZE ?? '100',
    10,
    1_000,
    'IDP_CHINA_PAGE_SIZE',
  );
  const maximumPages = optionalPositiveInteger(
    process.env.IDP_CHINA_MAX_PAGES,
    'IDP_CHINA_MAX_PAGES',
  );
  let report: Record<string, unknown>;
  let finalReportWritten = false;

  try {
    const projects = decryptIdpChinaEnvelope(
      await request.json(
        'exam-projects',
        '/chinesetestwebapi/common/getExamProject',
      ),
    );
    const projectCodes = parseProjectCodes(projects);
    const sessions: IdpChinaSession[] = [];
    const sessionIds = new Set<string>();
    let providerTotal: number | null = null;
    let pageNumber = 1;

    while (providerTotal === null || sessions.length < providerTotal) {
      if (maximumPages !== null && pageNumber > maximumPages) break;
      console.log(
        `IDP China page ${pageNumber}` +
          (providerTotal === null ? '' : `; ${sessions.length}/${providerTotal}`),
      );
      const decrypted = decryptIdpChinaEnvelope(
        await request.json(
          `session-page-${pageNumber}`,
          SESSION_SEARCH_PATH,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json;charset=UTF-8',
            },
            body: JSON.stringify({
              pageNum: pageNumber,
              pageSize,
              provinceId: null,
              cityId: null,
              sortOrder: 'asc',
            }),
          },
        ),
      );
      const page = parseIdpChinaSessionPage(decrypted);
      if (providerTotal === null) providerTotal = page.total;
      if (page.total !== providerTotal) {
        throw new ProviderBoundaryError(
          `IDP China total changed from ${providerTotal} to ${page.total}`,
        );
      }
      if (!page.sessions.length && sessions.length < providerTotal) {
        throw new ProviderBoundaryError(
          `IDP China page ${pageNumber} was empty before total was reached`,
        );
      }
      for (const session of page.sessions) {
        if (sessionIds.has(session.sessionId)) {
          throw new ProviderBoundaryError(
            `IDP China session ${session.sessionId} appeared on multiple pages`,
          );
        }
        sessionIds.add(session.sessionId);
        sessions.push(session);
      }
      pageNumber++;
      if (pageNumber > 500) {
        throw new ProviderBoundaryError(
          'IDP China pagination exceeded 500 pages',
        );
      }
    }

    const dataset = JSON.parse(
      await fs.readFile(path.join(DATA_DIR, 'centres.all.json'), 'utf8'),
    ) as CentreDataset;
    const checkedAt = new Date().toISOString();
    const snapshot = buildIdpChinaAvailabilitySnapshot(
      sessions,
      dataset.centres,
      checkedAt,
    );
    const problems = idpChinaAvailabilitySafetyProblems(
      snapshot,
      sessions.length,
    );
    const truncated =
      providerTotal !== null && sessions.length < providerTotal;
    if (maximumPages === null && truncated) {
      problems.push(
        `collected ${sessions.length} of ${providerTotal} IDP China sessions`,
      );
    }
    report = {
      version: 1,
      source: 'idp_china',
      startedAt,
      checkedAt,
      mode: 'full_scale_github_actions',
      publicationEnabled: false,
      coverage: {
        projectCodes,
        providerTotal,
        scannedSessions: sessions.length,
        scannedPages: pageNumber - 1,
        pageSize,
        truncatedByEnvironment: truncated,
      },
      safetyGate: {
        passed: problems.length === 0,
        problems,
        stoppedOnProviderBoundary: false,
      },
      requestSummary: request.summary(),
      snapshot,
    };
    await writeReport(report);
    finalReportWritten = true;
    if (problems.length) {
      throw new Error(
        `IDP China full-scale safety gate failed:\n- ${problems.join('\n- ')}`,
      );
    }
    console.log(
      `IDP China scan passed: ${sessions.length} session(s), ` +
        `${snapshot.diagnostics.matchedSessions} matched.`,
    );
  } catch (cause) {
    if (!finalReportWritten) {
      report = {
        version: 1,
        source: 'idp_china',
        startedAt,
        checkedAt: new Date().toISOString(),
        mode: 'full_scale_github_actions',
        publicationEnabled: false,
        safetyGate: {
          passed: false,
          problems: [errorMessage(cause)],
          stoppedOnProviderBoundary: cause instanceof ProviderBoundaryError,
        },
        requestSummary: request.summary(),
      };
      await writeReport(report);
    }
    throw cause;
  }

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
          'ielts-map/0.1 full-scale availability validation ' +
          '(+https://github.com/ZhengQ2/ielts_app)',
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    const challenge = challengeSignal(text);
    if (response.status === 403 || response.status === 429 || challenge) {
      throw new ProviderBoundaryError(
        `${label} hit IDP China provider boundary: HTTP ${response.status}; ` +
          `${challenge ?? 'no text signal'}`,
      );
    }
    if (!response.ok) {
      throw new ProviderBoundaryError(
        `${label} failed with HTTP ${response.status}`,
      );
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      successful++;
      return parsed;
    } catch {
      throw new ProviderBoundaryError(`${label} returned non-JSON content`);
    }
  }

  return {
    json,
    summary: () => ({ attempted, successful, minimumIntervalMs }),
  };
}

function parseProjectCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ProviderBoundaryError(
      'IDP China exam projects response is not an array',
    );
  }
  const codes = value.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new ProviderBoundaryError(
        `IDP China exam project ${index} is not an object`,
      );
    }
    const code = (candidate as Record<string, unknown>).PROJECT_CODE;
    if (typeof code !== 'string' || !code.trim()) {
      throw new ProviderBoundaryError(
        `IDP China exam project ${index} has no code`,
      );
    }
    return code.trim();
  });
  const unique = [...new Set(codes)].sort();
  if (unique.join(',') !== '22,23') {
    throw new ProviderBoundaryError(
      `Unexpected IDP China project codes: ${unique.join(',') || 'none'}`,
    );
  }
  return unique;
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

function optionalPositiveInteger(
  value: string | undefined,
  label: string,
): number | null {
  if (!value?.trim()) return null;
  return boundedInteger(value, 1, 500, label);
}

function boundedInteger(
  value: string,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

async function writeReport(report: unknown): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    REPORT_FILE,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
}

function requireGitHubExperiment(): void {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.M2_7_LIVE_EXPERIMENT !== 'true'
  ) {
    throw new Error(
      'IDP China scans may run only in GitHub Actions with ' +
        'M2_7_LIVE_EXPERIMENT=true',
    );
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).stack ?? error}`);
  process.exit(1);
});
