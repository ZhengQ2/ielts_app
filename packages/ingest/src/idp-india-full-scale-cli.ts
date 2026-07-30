#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CentreDataset } from '@ielts-map/core';
import { DATA_DIR, REPORT_DIR, REPO_ROOT } from './config.ts';
import {
  IDP_INDIA_TESTS,
  idpIndiaCapture,
  parseIdpIndiaDates,
  parseIdpIndiaOptions,
  type IdpIndiaTarget,
} from './idp-india-api.ts';
import {
  buildIdpIndiaAvailabilitySnapshot,
  idpIndiaAvailabilitySafetyProblems,
  type IdpIndiaBrowserCapture,
} from './idp-india-availability.ts';
import {
  IDP_INDIA_COMPUTER_CENTRES_URL,
  matchIdpIndiaProviderCentre,
  parseIdpIndiaComputerCentresHtml,
} from './idp-india-centres.ts';

const API_ORIGIN = 'https://ieltsidpindia.com';
const REPORT_FILE = path.join(
  REPORT_DIR,
  'provider-availability.idp-india.full-scale.json',
);

interface RequestDiagnostic {
  label: string;
  status: number | null;
  elapsedMs: number;
  challengeSignals: string[];
  error: string | null;
}

class ProviderBoundaryError extends Error {}

async function main(): Promise<void> {
  requireGitHubExperiment();
  const startedAt = new Date().toISOString();
  const diagnostics: RequestDiagnostic[] = [];
  const request = createSerialRequester(
    boundedInteger(
      process.env.IDP_INDIA_MIN_INTERVAL_MS ?? '3000',
      3_000,
      60_000,
      'IDP_INDIA_MIN_INTERVAL_MS',
    ),
    diagnostics,
  );
  const maximumTargets = optionalPositiveInteger(
    process.env.IDP_INDIA_MAX_TARGETS,
    'IDP_INDIA_MAX_TARGETS',
  );
  let progress = { completed: 0, total: 0, label: '' };
  let finalReportWritten = false;

  try {
    const providerCentres = parseIdpIndiaComputerCentresHtml(
      await request.text(
        'computer-centre-inventory',
        new URL(IDP_INDIA_COMPUTER_CENTRES_URL).pathname +
          new URL(IDP_INDIA_COMPUTER_CENTRES_URL).search,
      ),
    );
    const discoveredTargets = await discoverTargets(request);
    const targets =
      maximumTargets === null
        ? discoveredTargets
        : prioritizeKnownAvailable(discoveredTargets).slice(0, maximumTargets);
    const captures: IdpIndiaBrowserCapture[] = [];
    const targetsWithoutSessions: IdpIndiaTarget[] = [];

    for (const [index, target] of targets.entries()) {
      progress = {
        completed: index,
        total: targets.length,
        label:
          `${target.testLabel} / ${target.moduleLabel} / ${target.cityLabel}`,
      };
      console.log(
        `[${index + 1}/${targets.length}] ${progress.label}`,
      );
      const dates = parseIdpIndiaDates(
        await request.form(
          `dates:${target.testId}:${target.moduleId}:${target.cityId}`,
          '/Registration/TestTimeSlotSelection',
          {
            TestTypeId: target.moduleId,
            CityID: target.cityId,
          },
        ),
      );
      if (dates.length) captures.push(idpIndiaCapture(target, dates));
      else targetsWithoutSessions.push(target);
      progress.completed = index + 1;
    }

    const dataset = JSON.parse(
      await fs.readFile(path.join(DATA_DIR, 'centres.all.json'), 'utf8'),
    ) as CentreDataset;
    const checkedAt = new Date().toISOString();
    const snapshot = buildIdpIndiaAvailabilitySnapshot(
      captures,
      dataset.centres,
      checkedAt,
    );
    const centreDiscovery = providerCentres.map((centre) => ({
      ...centre,
      match: matchIdpIndiaProviderCentre(centre, dataset.centres),
    }));
    const problems = idpIndiaAvailabilitySafetyProblems(null, snapshot);
    if (snapshot.diagnostics.explicitlyAvailable < 1) {
      problems.push(
        'no IDP India session had an explicit positive remaining-seat count',
      );
    }
    if (targets.length !== captures.length + targetsWithoutSessions.length) {
      problems.push(
        `accounted for ${captures.length + targetsWithoutSessions.length} ` +
          `of ${targets.length} scanned targets`,
      );
    }
    if (maximumTargets === null && targets.length !== discoveredTargets.length) {
      problems.push(
        `full scan covered ${targets.length} of ` +
          `${discoveredTargets.length} discovered targets`,
      );
    }
    const report = {
      version: 1,
      source: 'idp_india',
      startedAt,
      checkedAt,
      mode: 'full_scale_github_actions',
      publicationEnabled: false,
      coverage: {
        discovery:
          'All test, module and city combinations exposed by the anonymous ' +
          'IDP India registration JSON endpoints.',
        discoveredTargets: discoveredTargets.length,
        scannedTargets: targets.length,
        targetsWithSessions: captures.length,
        targetsWithoutSessions: targetsWithoutSessions.length,
        truncatedByEnvironment: maximumTargets !== null,
        providerCentres: providerCentres.length,
        providerOnlyCentres: centreDiscovery.filter(
          (centre) => centre.match.status === 'unmatched',
        ).length,
        ambiguousProviderCentres: centreDiscovery.filter(
          (centre) => centre.match.status === 'ambiguous',
        ).length,
      },
      safetyGate: {
        passed: problems.length === 0,
        problems,
        stoppedOnProviderBoundary: false,
      },
      requestSummary: request.summary(),
      requestDiagnostics: diagnostics,
      targetsWithoutSessions,
      centreDiscovery,
      snapshot,
    };
    await writeReport(report);
    finalReportWritten = true;
    if (problems.length) {
      throw new Error(
        `IDP India full-scale safety gate failed:\n- ${problems.join('\n- ')}`,
      );
    }
    console.log(`Report: ${path.relative(REPO_ROOT, REPORT_FILE)}`);
    console.log(
      `IDP India scan passed: ${targets.length} target(s), ` +
        `${snapshot.records.length} exact dated session(s), no boundary.`,
    );
  } catch (cause) {
    if (!finalReportWritten) {
      await writeReport({
        version: 1,
        source: 'idp_india',
        startedAt,
        checkedAt: new Date().toISOString(),
        mode: 'full_scale_github_actions',
        publicationEnabled: false,
        progress,
        safetyGate: {
          passed: false,
          problems: [errorMessage(cause)],
          stoppedOnProviderBoundary: cause instanceof ProviderBoundaryError,
        },
        requestSummary: request.summary(),
        requestDiagnostics: diagnostics,
      });
    }
    throw cause;
  }
}

async function discoverTargets(
  request: ReturnType<typeof createSerialRequester>,
): Promise<IdpIndiaTarget[]> {
  const targets: IdpIndiaTarget[] = [];
  const seenModuleIds = new Map<string, string>();

  for (const test of IDP_INDIA_TESTS) {
    const modules = parseIdpIndiaOptions(
      await request.form(
        `modules:${test.id}`,
        '/registration/bindtesttype',
        { TestID: test.id },
      ),
      `IDP India modules for test ${test.id}`,
    );
    if (!modules.length) {
      throw new ProviderBoundaryError(
        `IDP India test ${test.id} returned no modules`,
      );
    }
    for (const module of modules) {
      const priorTest = seenModuleIds.get(module.id);
      if (priorTest && priorTest !== test.id) {
        throw new ProviderBoundaryError(
          `IDP India module ${module.id} appeared under tests ` +
            `${priorTest} and ${test.id}`,
        );
      }
      seenModuleIds.set(module.id, test.id);
      const cities = parseIdpIndiaOptions(
        await request.form(
          `cities:${test.id}:${module.id}`,
          '/Registration/BindExamCity',
          { TestTypeID: module.id },
        ),
        `IDP India cities for module ${module.id}`,
      );
      for (const city of cities) {
        targets.push({
          testId: test.id,
          testLabel: test.label,
          moduleId: module.id,
          moduleLabel: module.label,
          cityId: city.id,
          cityLabel: city.label,
        });
      }
    }
  }

  const unique = new Map<string, IdpIndiaTarget>();
  for (const target of targets) {
    const key = `${target.testId}:${target.moduleId}:${target.cityId}`;
    if (unique.has(key)) {
      throw new ProviderBoundaryError(
        `IDP India discovery returned duplicate target ${key}`,
      );
    }
    unique.set(key, target);
  }
  if (!unique.size) {
    throw new ProviderBoundaryError(
      'IDP India discovery returned no test/module/city targets',
    );
  }
  return [...unique.values()].sort(compareTargets);
}

function prioritizeKnownAvailable(
  targets: readonly IdpIndiaTarget[],
): IdpIndiaTarget[] {
  return [...targets].sort((a, b) => {
    const aPilot =
      a.testId === '4' && a.moduleId === '8' && a.cityId === '60';
    const bPilot =
      b.testId === '4' && b.moduleId === '8' && b.cityId === '60';
    return Number(bPilot) - Number(aPilot) || compareTargets(a, b);
  });
}

function compareTargets(a: IdpIndiaTarget, b: IdpIndiaTarget): number {
  return (
    Number(a.testId) - Number(b.testId) ||
    Number(a.moduleId) - Number(b.moduleId) ||
    a.cityLabel.localeCompare(b.cityLabel) ||
    Number(a.cityId) - Number(b.cityId)
  );
}

function createSerialRequester(
  minimumIntervalMs: number,
  diagnostics: RequestDiagnostic[],
) {
  let lastStartedAt = 0;
  let attempted = 0;
  let successful = 0;

  async function raw(
    label: string,
    pathname: string,
    init?: RequestInit,
  ): Promise<string> {
    const url = new URL(pathname, API_ORIGIN);
    if (
      url.protocol !== 'https:' ||
      url.hostname.replace(/^www\./i, '') !== 'ieltsidpindia.com' ||
      !(
        /^\/registration\//i.test(url.pathname) ||
        url.pathname.toLowerCase() === '/information/contact'
      )
    ) {
      throw new Error(`Refusing unapproved IDP India URL ${url}`);
    }
    const waitMs = Math.max(
      0,
      lastStartedAt + minimumIntervalMs - Date.now(),
    );
    if (waitMs > 0) await delay(waitMs);
    lastStartedAt = Date.now();
    attempted++;
    const diagnostic: RequestDiagnostic = {
      label,
      status: null,
      elapsedMs: 0,
      challengeSignals: [],
      error: null,
    };
    diagnostics.push(diagnostic);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          accept:
            init?.method === 'POST'
              ? 'application/json, text/javascript, */*; q=0.01'
              : 'text/html,application/xhtml+xml',
          'accept-language': 'en-IN,en;q=0.9',
          referer: `${API_ORIGIN}/registration/reg1`,
          'user-agent':
            'ielts-map/0.1 full-scale availability validation ' +
            '(+https://github.com/ZhengQ2/ielts_app)',
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
      diagnostic.status = response.status;
      const text = await response.text();
      diagnostic.elapsedMs = Date.now() - started;
      diagnostic.challengeSignals = challengeSignalsFor(text);
      if (
        response.status === 403 ||
        response.status === 429 ||
        diagnostic.challengeSignals.length
      ) {
        throw new ProviderBoundaryError(
          `${label} hit IDP India provider boundary: HTTP ${response.status}; ` +
            `${diagnostic.challengeSignals.join(', ') || 'no text signal'}`,
        );
      }
      if (!response.ok) {
        throw new ProviderBoundaryError(
          `${label} failed with HTTP ${response.status}`,
        );
      }
      successful++;
      return text;
    } catch (cause) {
      diagnostic.elapsedMs = Date.now() - started;
      diagnostic.error = errorMessage(cause);
      if (cause instanceof ProviderBoundaryError) throw cause;
      throw new ProviderBoundaryError(
        `${label} request failed without retry: ${errorMessage(cause)}`,
      );
    }
  }

  return {
    async form(
      label: string,
      pathname: string,
      body: Record<string, string>,
    ): Promise<unknown> {
      const text = await raw(label, pathname, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          origin: API_ORIGIN,
          'x-requested-with': 'XMLHttpRequest',
        },
        body: new URLSearchParams(body),
      });
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ProviderBoundaryError(`${label} returned non-JSON content`);
      }
    },
    text(label: string, pathname: string): Promise<string> {
      return raw(label, pathname);
    },
    summary: () => ({ attempted, successful, minimumIntervalMs }),
  };
}

function challengeSignalsFor(value: string): string[] {
  return [
    /<title[^>]*>[^<]*(?:captcha|security check|access denied)/i,
    /\bcomplete (?:the|this) (?:captcha|recaptcha)\b/i,
    /verify (?:that )?you are human/i,
    /unusual traffic/i,
    /access denied/i,
    /security check/i,
    /temporarily blocked/i,
    /too many requests/i,
  ]
    .filter((pattern) => pattern.test(value))
    .map((pattern) => pattern.source);
}

function optionalPositiveInteger(
  value: string | undefined,
  label: string,
): number | null {
  if (!value?.trim()) return null;
  return boundedInteger(value, 1, 100_000, label);
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

function requireGitHubExperiment(): void {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.M2_7_LIVE_EXPERIMENT !== 'true'
  ) {
    throw new Error(
      'IDP India scans may run only in GitHub Actions with ' +
        'M2_7_LIVE_EXPERIMENT=true',
    );
  }
}

async function writeReport(report: unknown): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    REPORT_FILE,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
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
