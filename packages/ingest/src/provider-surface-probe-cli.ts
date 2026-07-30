#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { REPORT_DIR, REPO_ROOT } from './config.ts';
import { findChromeExecutable } from './idp-india-browser.ts';

interface ProbeTarget {
  id: string;
  source: 'idp_global' | 'idp_india' | 'idp_china' | 'bc_global';
  url: string;
  interaction?:
    | 'open_search'
    | 'open_academic'
    | 'open_academic_computer'
    | 'open_academic_computer_writing'
    | 'open_academic_computer_writing_melbourne'
    | 'open_academic_computer_writing_melbourne_date'
    | 'idp_india_public_date';
}

interface ControlSummary {
  tag: string;
  type: string | null;
  name: string | null;
  text: string;
  options: {
    value: string;
    text: string;
  }[];
}

interface ProbeResult {
  id: string;
  source: ProbeTarget['source'];
  requestedUrl: string;
  finalUrl: string | null;
  title: string | null;
  status: number | null;
  challengeDetected: boolean;
  challengeSignals: string[];
  bodyText: string;
  controls: ControlSummary[];
  ariaEvidence: {
    tag: string;
    label: string;
    className: string;
    disabled: string | null;
    text: string;
  }[];
  links: {
    text: string;
    href: string;
  }[];
  frames: string[];
  network: {
    status: number;
    resourceType: string;
    method: string;
    url: string;
    postData: string | null;
    responseBody: string | null;
  }[];
  error: string | null;
}

const CHALLENGE_PATTERNS = [
  /\bcaptcha\b/i,
  /\brecaptcha\b/i,
  /verify (?:that )?you are human/i,
  /unusual traffic/i,
  /access denied/i,
  /security check/i,
  /cloudflare/i,
  /temporarily blocked/i,
  /too many requests/i,
];

async function main(): Promise<void> {
  requireGitHubExperiment();
  const targets = parseTargets(requiredEnv('PROVIDER_PROBE_TARGETS_JSON'));
  const intervalMs = parseInterval(
    process.env.PROVIDER_PROBE_INTERVAL_MS ?? '15000',
  );
  const executablePath =
    process.env.CHROME_PATH ?? findChromeExecutable(process.platform);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  const results: ProbeResult[] = [];
  try {
    for (let index = 0; index < targets.length; index++) {
      if (index > 0) await delay(intervalMs);
      const result = await probeTarget(browser, targets[index]!);
      results.push(result);
      if (result.challengeDetected) break;
    }
  } finally {
    await browser.close();
  }

  const reportFile = path.join(REPORT_DIR, 'provider-surface-probe.json');
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    reportFile,
    `${JSON.stringify(
      {
        version: 1,
        checkedAt: new Date().toISOString(),
        requestedTargets: targets.length,
        completedTargets: results.length,
        stoppedOnChallenge: results.some(
          (result) => result.challengeDetected,
        ),
        results,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`Report: ${path.relative(REPO_ROOT, reportFile)}`);
  for (const result of results) {
    console.log(
      `${result.id}: status=${result.status ?? 'none'} ` +
        `challenge=${result.challengeDetected} controls=${result.controls.length} ` +
        `network=${result.network.length}`,
    );
  }
}

async function probeTarget(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  target: ProbeTarget,
): Promise<ProbeResult> {
  const context = await browser.newContext({
    locale: sourceLocale(target.source),
    userAgent:
      'ielts-map/0.1 provider feasibility probe (+https://github.com/ZhengQ2/ielts_app)',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const network: ProbeResult['network'] = [];
  const responseTasks: Promise<void>[] = [];
  page.on('response', (response) => {
    const resourceType = response.request().resourceType();
    if (
      resourceType === 'xhr' ||
      resourceType === 'fetch' ||
      response.status() >= 400
    ) {
      const entry: ProbeResult['network'][number] = {
        status: response.status(),
        resourceType,
        method: response.request().method(),
        url: sanitizeUrl(response.url()),
        postData: sanitizePostData(response.request().postData()),
        responseBody: null,
      };
      network.push(entry);
      if (isApprovedResponseBody(response)) {
        responseTasks.push(
          response
            .text()
            .then((body) => {
              entry.responseBody = body.slice(0, 100_000);
            })
            .catch(() => undefined),
        );
      }
    }
  });

  let status: number | null = null;
  let error: string | null = null;
  try {
    const response = await page.goto(target.url, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    status = response?.status() ?? null;
    await page.waitForTimeout(5_000);
    if (target.interaction === 'idp_india_public_date') {
      await openIdpIndiaPublicDate(page);
    } else if (
      target.interaction === 'open_search' ||
      target.interaction === 'open_academic' ||
      target.interaction === 'open_academic_computer' ||
      target.interaction === 'open_academic_computer_writing' ||
      target.interaction === 'open_academic_computer_writing_melbourne' ||
      target.interaction ===
        'open_academic_computer_writing_melbourne_date'
    ) {
      await page
        .getByRole('button', { name: 'Accept and Proceed', exact: true })
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await clickVisibleText(page, 'Find an IELTS test session');
      await page.waitForTimeout(5_000);
      if (
        target.interaction === 'open_academic' ||
        target.interaction === 'open_academic_computer' ||
        target.interaction === 'open_academic_computer_writing' ||
        target.interaction === 'open_academic_computer_writing_melbourne' ||
        target.interaction ===
          'open_academic_computer_writing_melbourne_date'
      ) {
        await clickVisibleText(page, 'IELTS Academic');
        await page.waitForTimeout(5_000);
        if (
          target.interaction === 'open_academic_computer' ||
          target.interaction === 'open_academic_computer_writing' ||
          target.interaction === 'open_academic_computer_writing_melbourne' ||
          target.interaction ===
            'open_academic_computer_writing_melbourne_date'
        ) {
          await clickVisibleText(page, 'IELTS on Computer');
          await page.waitForTimeout(5_000);
          if (
            target.interaction === 'open_academic_computer_writing' ||
            target.interaction ===
              'open_academic_computer_writing_melbourne' ||
            target.interaction ===
              'open_academic_computer_writing_melbourne_date'
          ) {
            await clickVisibleText(page, 'Writing on Computer');
            await page.waitForTimeout(5_000);
            if (
              target.interaction ===
                'open_academic_computer_writing_melbourne' ||
              target.interaction ===
                'open_academic_computer_writing_melbourne_date'
            ) {
              await clickVisibleText(page, 'Select Country');
              await clickVisibleText(page, 'Australia');
              await clickVisibleText(page, 'Select City');
              await clickVisibleText(page, 'Melbourne');
              await clickVisibleText(page, 'Select test date');
              await page.waitForTimeout(8_000);
              if (
                target.interaction ===
                'open_academic_computer_writing_melbourne_date'
              ) {
                await clickVisibleText(page, '31');
                await clickVisibleText(page, 'Find sessions');
                await page.waitForTimeout(8_000);
              }
            }
          }
        }
      }
    }
  } catch (cause) {
    error = errorMessage(cause);
  }
  await Promise.allSettled(responseTasks);

  const finalUrl = page.url() || null;
  const title = await safeText(() => page.title());
  const bodyText =
    (await safeText(() =>
      page.locator('body').innerText({ timeout: 5_000 }),
    )) ?? '';
  const challengeSignals = challengeSignalsFor(
    [title ?? '', bodyText, finalUrl ?? ''].join('\n'),
  );
  const controls =
    (await safeValue(() =>
      page
        .locator('select, button, input:not([type="hidden"])')
        .evaluateAll((elements) =>
          elements.slice(0, 120).map((element) => {
            const select =
              element instanceof HTMLSelectElement ? element : null;
            const input = element instanceof HTMLInputElement ? element : null;
            return {
              tag: element.tagName.toLowerCase(),
              type: input?.type ?? null,
              name:
                select?.name ??
                input?.name ??
                element.getAttribute('name') ??
                null,
              text: (element.textContent ?? '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 300),
              options: select
                ? Array.from(select.options)
                    .slice(0, 100)
                    .map((option) => ({
                      value: option.value.slice(0, 200),
                      text: (option.textContent ?? '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 200),
                    }))
                : [],
            };
          }),
        ),
    )) ?? [];
  const ariaEvidence =
    (await safeValue(() =>
      page.locator('[aria-label]').evaluateAll((elements) =>
        elements.slice(0, 300).map((element) => ({
          tag: element.tagName.toLowerCase(),
          label: element.getAttribute('aria-label')?.trim() ?? '',
          className:
            typeof element.className === 'string'
              ? element.className.slice(0, 300)
              : '',
          disabled:
            element.getAttribute('aria-disabled') ??
            element.getAttribute('disabled'),
          text: (element.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300),
        })),
      ),
    )) ?? [];
  const links =
    (await safeValue(() =>
      page.locator('a[href]').evaluateAll((elements) =>
        elements.slice(0, 120).map((element) => {
          const anchor = element as HTMLAnchorElement;
          return {
            text: (anchor.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 300),
            href: anchor.href,
          };
        }),
      ),
    )) ?? [];
  const frames = page
    .frames()
    .map((frame) => sanitizeUrl(frame.url()))
    .filter(Boolean);

  const screenshotDirectory = path.join(REPORT_DIR, 'provider-surface-probe');
  await fs.mkdir(screenshotDirectory, { recursive: true });
  await page
    .screenshot({
      path: path.join(screenshotDirectory, `${safeFilename(target.id)}.png`),
      fullPage: true,
    })
    .catch(() => undefined);
  await context.close();

  return {
    id: target.id,
    source: target.source,
    requestedUrl: target.url,
    finalUrl,
    title,
    status,
    challengeDetected: challengeSignals.length > 0,
    challengeSignals,
    bodyText: bodyText.replace(/\s+/g, ' ').trim().slice(0, 20_000),
    controls,
    ariaEvidence,
    links: links.map((link) => ({
      text: link.text,
      href: sanitizeUrl(link.href),
    })),
    frames,
    network: deduplicateNetwork(network).slice(0, 300),
    error,
  };
}

function parseTargets(value: string): ProbeTarget[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 8) {
    throw new Error('PROVIDER_PROBE_TARGETS_JSON must contain 1–8 targets');
  }
  return parsed.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error(`Probe target ${index} is not an object`);
    }
    const record = candidate as Record<string, unknown>;
    const id = String(record.id ?? '').trim();
    const source = String(record.source ?? '').trim();
    const url = String(record.url ?? '').trim();
    const interaction =
      record.interaction === undefined
        ? undefined
        : String(record.interaction).trim();
    if (!id || !/^[a-z0-9_-]+$/i.test(id)) {
      throw new Error(`Probe target ${index} has an invalid id`);
    }
    if (
      source !== 'idp_global' &&
      source !== 'idp_india' &&
      source !== 'idp_china' &&
      source !== 'bc_global'
    ) {
      throw new Error(`Probe target ${id} has an unsupported source`);
    }
    const parsedUrl = new URL(url);
    if (
      parsedUrl.protocol !== 'https:' ||
      !allowedHost(source, parsedUrl.hostname)
    ) {
      throw new Error(`Probe target ${id} has an unapproved URL`);
    }
    if (
      interaction !== undefined &&
      interaction !== 'open_search' &&
      interaction !== 'open_academic' &&
      interaction !== 'open_academic_computer' &&
      interaction !== 'open_academic_computer_writing' &&
      interaction !== 'open_academic_computer_writing_melbourne' &&
      interaction !== 'open_academic_computer_writing_melbourne_date' &&
      interaction !== 'idp_india_public_date'
    ) {
      throw new Error(`Probe target ${id} has an unsupported interaction`);
    }
    return {
      id,
      source,
      url: parsedUrl.toString(),
      interaction,
    };
  });
}

async function clickVisibleText(
  page: import('playwright-core').Page,
  text: string,
): Promise<void> {
  await page
    .getByText(text, { exact: true })
    .filter({ visible: true })
    .first()
    .click();
}

async function openIdpIndiaPublicDate(
  page: import('playwright-core').Page,
): Promise<void> {
  const selects = page.locator('select');
  if ((await selects.count()) < 3) {
    throw new Error('IDP India registration selects were not found');
  }
  await selects.nth(0).selectOption('4');
  await waitForSelectOption(page, 1, 'Academic', null);
  await selects.nth(1).selectOption({ label: 'Academic' });
  await waitForSelectOption(page, 2, null, '60');
  await selects.nth(2).selectOption('60');
  const bookNow = page
    .getByRole('button', { name: 'Book Now', exact: true })
    .filter({ visible: true })
    .first();
  await bookNow.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Book Now',
    );
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await bookNow.click();
  await page
    .getByText('Select your preferred test date below', { exact: true })
    .waitFor({ state: 'visible' });
  await page.waitForTimeout(5_000);
}

async function waitForSelectOption(
  page: import('playwright-core').Page,
  selectIndex: number,
  label: string | null,
  value: string | null,
): Promise<void> {
  await page.waitForFunction(
    ({ index, wantedLabel, wantedValue }) => {
      const select = document.querySelectorAll('select').item(index);
      if (!(select instanceof HTMLSelectElement)) return false;
      return Array.from(select.options).some((option) => {
        const optionLabel =
          option.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        return (
          (wantedLabel === null || optionLabel === wantedLabel) &&
          (wantedValue === null || option.value === wantedValue)
        );
      });
    },
    {
      index: selectIndex,
      wantedLabel: label,
      wantedValue: value,
    },
  );
}

function allowedHost(source: ProbeTarget['source'], hostname: string): boolean {
  const host = hostname.replace(/^www\./i, '').toLowerCase();
  if (source === 'idp_global') {
    return host === 'ielts.idp.com' || host === 'bxsearch.ielts.idp.com';
  }
  if (source === 'idp_india') return host === 'ieltsidpindia.com';
  if (source === 'idp_china') {
    return (
      host === 'sign.idpielts.cn' ||
      host === 'idpielts.cn'
    );
  }
  return host === 'ieltsregistration.britishcouncil.org';
}

function sourceLocale(source: ProbeTarget['source']): string {
  if (source === 'idp_india') return 'en-IN';
  if (source === 'idp_china') return 'zh-CN';
  return 'en-GB';
}

function challengeSignalsFor(value: string): string[] {
  return CHALLENGE_PATTERNS.filter((pattern) => pattern.test(value)).map(
    (pattern) => pattern.source,
  );
}

function deduplicateNetwork(
  entries: ProbeResult['network'],
): ProbeResult['network'] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.status}\t${entry.resourceType}\t${entry.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|session|secret|signature|key|auth|cookie/i.test(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return url.toString();
  } catch {
    return value.slice(0, 2_000);
  }
}

function sanitizePostData(value: string | null): string | null {
  if (!value) return null;
  if (value.length > 20_000) return `${value.slice(0, 20_000)}…`;
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(redactSensitiveFields(parsed));
  } catch {
    const params = new URLSearchParams(value);
    if ([...params.keys()].length < 1) return value;
    for (const key of Array.from(params.keys())) {
      if (/token|session|secret|signature|key|auth|cookie|password/i.test(key)) {
        params.set(key, '[redacted]');
      }
    }
    return params.toString();
  }
}

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, candidate]) => [
      key,
      /token|session|secret|signature|key|auth|cookie|password/i.test(key)
        ? '[redacted]'
        : redactSensitiveFields(candidate),
    ]),
  );
}

function isApprovedResponseBody(
  response: import('playwright-core').Response,
): boolean {
  const contentType = response.headers()['content-type'] ?? '';
  if (!/json/i.test(contentType)) return false;
  try {
    const url = new URL(response.url());
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    return (
      (host === 'ielts.idp.com' &&
        url.pathname.startsWith('/book/Json/')) ||
      host === 'api.bxsearch.prod.ielts.com' ||
      host === 'api.session-search.prod.ielts.com' ||
      host === 'ieltsidpindia.com' ||
      host === 'idpielts.cn' ||
      (host === 'sign.idpielts.cn' &&
        /^\/chinesetestwebapi\/common\/(?:getOptionList|getProvinceListV2|getCityListV2|test[A-Za-z]+SearchV2|getExamProject|getProvince|testCenterSearch)$/.test(
          url.pathname,
        ))
    );
  } catch {
    return false;
  }
}

function parseInterval(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 5_000 || parsed > 120_000) {
    throw new Error(
      'PROVIDER_PROBE_INTERVAL_MS must be between 5000 and 120000',
    );
  }
  return parsed;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, '-');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeText(operation: () => Promise<string>): Promise<string | null> {
  try {
    return await operation();
  } catch {
    return null;
  }
}

async function safeValue<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch {
    return null;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireGitHubExperiment(): void {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.M2_7_DISCOVERY_EXPERIMENT !== 'true'
  ) {
    throw new Error(
      'Provider discovery may run only in GitHub Actions with M2_7_DISCOVERY_EXPERIMENT=true',
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
