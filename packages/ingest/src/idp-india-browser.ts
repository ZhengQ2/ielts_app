import fs from 'node:fs';
import type { Locator, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import type { IdpIndiaBrowserCapture } from './idp-india-availability.ts';

const IDP_INDIA_REGISTRATION_URL =
  'https://ieltsidpindia.com/registration/reg1';

export interface IdpIndiaBrowserTarget {
  testId: string;
  moduleLabel: string;
  cityId: string;
  testDate: string;
}

export interface IdpIndiaBrowserOptions {
  executablePath?: string;
  navigationTimeoutMs?: number;
}

export interface IdpIndiaDiscoveredTarget {
  testId: string;
  testLabel: string;
  moduleId: string;
  moduleLabel: string;
  cityId: string;
  cityLabel: string;
}

export interface IdpIndiaFullScaleResult {
  discoveredTargets: IdpIndiaDiscoveredTarget[];
  captures: IdpIndiaBrowserCapture[];
  targetsWithoutSessions: IdpIndiaDiscoveredTarget[];
}

/**
 * Collect exactly one public, pre-login IDP India test/date result.
 *
 * This function never creates an account, enters candidate information or
 * proceeds beyond the public date-selection step.
 */
export async function collectIdpIndiaCapture(
  target: IdpIndiaBrowserTarget,
  options: IdpIndiaBrowserOptions = {},
): Promise<IdpIndiaBrowserCapture> {
  validateTarget(target);
  const executablePath =
    options.executablePath ?? findChromeExecutable(process.platform);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      locale: 'en-IN',
      userAgent:
        'ielts-map/0.1 availability pilot (+https://github.com/ZhengQ2/ielts_app)',
    });
    page.setDefaultTimeout(options.navigationTimeoutMs ?? 30_000);
    return await collectFromPage(page, target);
  } finally {
    await browser.close();
  }
}

/**
 * Exercise every public test/module/city combination exposed by IDP India.
 *
 * The scan remains on the anonymous date-selection step. It stops on the first
 * challenge signal and never retries, logs in, or proceeds toward candidate
 * details.
 */
export async function collectIdpIndiaFullScale(
  options: IdpIndiaBrowserOptions & {
    minimumIntervalMs?: number;
    maximumTargets?: number | null;
    onProgress?: (completed: number, total: number, label: string) => void;
  } = {},
): Promise<IdpIndiaFullScaleResult> {
  const executablePath =
    options.executablePath ?? findChromeExecutable(process.platform);
  const minimumIntervalMs = Math.max(options.minimumIntervalMs ?? 3_000, 3_000);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      locale: 'en-IN',
      userAgent:
        'ielts-map/0.1 full-scale availability validation ' +
        '(+https://github.com/ZhengQ2/ielts_app)',
    });
    page.setDefaultTimeout(options.navigationTimeoutMs ?? 30_000);
    const discovered = await discoverTargets(page);
    const targets =
      options.maximumTargets === null ||
      options.maximumTargets === undefined
        ? discovered
        : discovered.slice(0, options.maximumTargets);
    const captures: IdpIndiaBrowserCapture[] = [];
    const targetsWithoutSessions: IdpIndiaDiscoveredTarget[] = [];
    let lastStartedAt = 0;

    for (const [index, target] of targets.entries()) {
      const waitMs = Math.max(
        0,
        lastStartedAt + minimumIntervalMs - Date.now(),
      );
      if (waitMs > 0) await delay(waitMs);
      lastStartedAt = Date.now();
      options.onProgress?.(
        index + 1,
        targets.length,
        `${target.testLabel} / ${target.moduleLabel} / ${target.cityLabel}`,
      );
      const capture = await collectFirstSessionFromPage(page, target);
      if (capture.sessions.length) captures.push(capture);
      else targetsWithoutSessions.push(target);
    }

    return {
      discoveredTargets: discovered,
      captures,
      targetsWithoutSessions,
    };
  } finally {
    await browser.close();
  }
}

async function collectFromPage(
  page: Page,
  target: IdpIndiaBrowserTarget,
): Promise<IdpIndiaBrowserCapture> {
  await page.goto(IDP_INDIA_REGISTRATION_URL, {
    waitUntil: 'domcontentloaded',
  });

  const selects = page.locator('select');
  if ((await selects.count()) < 3) {
    throw new Error('IDP India registration selects were not found');
  }

  const testSelect = selects.nth(0);
  const moduleSelect = selects.nth(1);
  const citySelect = selects.nth(2);
  await testSelect.selectOption(target.testId);
  await waitForSelectOption(page, 1, target.moduleLabel, null);
  await moduleSelect.selectOption({ label: target.moduleLabel });
  await waitForSelectOption(page, 2, null, target.cityId);
  await citySelect.selectOption(target.cityId);

  const selected = await Promise.all([
    selectedOption(testSelect),
    selectedOption(moduleSelect),
    selectedOption(citySelect),
  ]);
  const bookNow = page
    .getByRole('button', { name: 'Book Now', exact: true })
    .filter({ visible: true })
    .first();
  await bookNow.waitFor({ state: 'visible' });
  await waitUntilEnabled(bookNow);
  await bookNow.click();
  await page
    .getByText('Select your preferred test date below', { exact: true })
    .waitFor({ state: 'visible' });

  const dateLabel = isoDateToAccessibleLabel(target.testDate);
  const dateCandidates = page.locator(`[aria-label="${cssEscape(dateLabel)}"]`);
  if ((await dateCandidates.count()) < 1) {
    throw new Error(`IDP India date ${target.testDate} was not present`);
  }
  await dateCandidates.filter({ visible: true }).first().click();

  const session = await readSelectedSession(page);
  if (!session) {
    throw new Error(
      `IDP India date ${target.testDate} did not expose a selected session`,
    );
  }

  const sourceUrl = new URL(IDP_INDIA_REGISTRATION_URL);
  sourceUrl.searchParams.set(
    'ID',
    `${selected[0].value}^${selected[1].value}^${selected[2].value}`,
  );

  return {
    sourceUrl: sourceUrl.toString(),
    testId: selected[0].value,
    testLabel: selected[0].label,
    moduleId: selected[1].value || null,
    moduleLabel: selected[1].label || null,
    cityId: selected[2].value,
    cityLabel: selected[2].label,
    sessions: [
      {
        testDate: target.testDate,
        timeText: session.timeText,
        explicitlyAvailable: session.explicitlyAvailable,
      },
    ],
  };
}

async function discoverTargets(
  page: Page,
): Promise<IdpIndiaDiscoveredTarget[]> {
  await page.goto(IDP_INDIA_REGISTRATION_URL, {
    waitUntil: 'domcontentloaded',
  });
  await assertNoProviderChallenge(page);
  const selects = page.locator('select');
  if ((await selects.count()) < 3) {
    throw new Error('IDP India registration selects were not found');
  }
  const testSelect = selects.nth(0);
  const moduleSelect = selects.nth(1);
  const citySelect = selects.nth(2);
  const tests = await nonPlaceholderOptions(testSelect);
  const targets: IdpIndiaDiscoveredTarget[] = [];

  for (const test of tests) {
    await testSelect.selectOption(test.value);
    // These are legacy AJAX-bound selects. Their old options remain in the
    // DOM briefly after a parent changes, so a mere "is populated" check can
    // pair stale module/city ids with the new test type.
    await delay(1_000);
    await waitForPopulatedSelect(page, 1);
    for (const module of await nonPlaceholderOptions(moduleSelect)) {
      await moduleSelect.selectOption(module.value);
      await delay(1_000);
      await waitForPopulatedSelect(page, 2);
      for (const city of await nonPlaceholderOptions(citySelect)) {
        targets.push({
          testId: test.value,
          testLabel: test.label,
          moduleId: module.value,
          moduleLabel: module.label,
          cityId: city.value,
          cityLabel: city.label,
        });
      }
    }
  }
  if (!targets.length) {
    throw new Error('IDP India selector discovery returned no targets');
  }
  return targets.sort(
    (a, b) =>
      a.testId.localeCompare(b.testId) ||
      a.moduleId.localeCompare(b.moduleId) ||
      a.cityLabel.localeCompare(b.cityLabel),
  );
}

async function collectFirstSessionFromPage(
  page: Page,
  target: IdpIndiaDiscoveredTarget,
): Promise<IdpIndiaBrowserCapture> {
  await page.goto(IDP_INDIA_REGISTRATION_URL, {
    waitUntil: 'domcontentloaded',
  });
  await assertNoProviderChallenge(page);
  const selects = page.locator('select');
  if ((await selects.count()) < 3) {
    throw new Error('IDP India registration selects were not found');
  }
  const testSelect = selects.nth(0);
  const moduleSelect = selects.nth(1);
  const citySelect = selects.nth(2);
  await atStage('select test', () => testSelect.selectOption(target.testId));
  await atStage('wait for module', () =>
    waitForSelectOption(page, 1, null, target.moduleId),
  );
  await atStage('select module', () =>
    moduleSelect.selectOption(target.moduleId),
  );
  await atStage('wait for city', () =>
    waitForSelectOption(page, 2, null, target.cityId),
  );
  await atStage('select city', () => citySelect.selectOption(target.cityId));
  const bookNow = page
    .getByRole('button', { name: 'Book Now', exact: true })
    .filter({ visible: true })
    .first();
  await atStage('wait for Book Now', () =>
    bookNow.waitFor({ state: 'visible' }),
  );
  await atStage('wait for Book Now enabled', () => waitUntilEnabled(bookNow));
  await atStage('open date selection', () => bookNow.click());
  const dateHeading = page.getByText('Select your preferred test date below', {
    exact: true,
  });
  const dateSelectionOpened = await dateHeading
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  await assertNoProviderChallenge(page);

  const sourceUrl = new URL(IDP_INDIA_REGISTRATION_URL);
  sourceUrl.searchParams.set(
    'ID',
    `${target.testId}^${target.moduleId}^${target.cityId}`,
  );
  if (!dateSelectionOpened) {
    return {
      sourceUrl: sourceUrl.toString(),
      testId: target.testId,
      testLabel: target.testLabel,
      moduleId: target.moduleId,
      moduleLabel: target.moduleLabel,
      cityId: target.cityId,
      cityLabel: target.cityLabel,
      sessions: [],
    };
  }

  const dateLabels = await accessibleDateLabels(page);
  let selected:
    | { testDate: string; timeText: string | null; explicitlyAvailable: boolean }
    | null = null;
  for (const candidate of dateLabels) {
    const locator = page
      .locator(`[aria-label="${cssEscape(candidate.label)}"]`)
      .filter({ visible: true })
      .first();
    if (!(await locator.count())) continue;
    const ariaDisabled = await locator.getAttribute('aria-disabled');
    if (ariaDisabled === 'true') continue;
    await locator.click().catch(() => undefined);
    const session = await readSelectedSession(page);
    if (session) {
      selected = {
        testDate: candidate.isoDate,
        timeText: session.timeText,
        explicitlyAvailable: session.explicitlyAvailable,
      };
      break;
    }
  }

  return {
    sourceUrl: sourceUrl.toString(),
    testId: target.testId,
    testLabel: target.testLabel,
    moduleId: target.moduleId,
    moduleLabel: target.moduleLabel,
    cityId: target.cityId,
    cityLabel: target.cityLabel,
    sessions: selected ? [selected] : [],
  };
}

async function readSelectedSession(
  page: Page,
): Promise<{ timeText: string | null; explicitlyAvailable: boolean } | null> {
  const checked = page.locator('input[type="radio"]:checked').first();
  try {
    await checked.waitFor({ state: 'attached', timeout: 5_000 });
  } catch {
    return null;
  }

  return await checked.evaluate((input) => {
    const timePattern =
      /\b\d{1,2}:\d{2}\s*(?:AM|PM)\s+to\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b/i;
    let node: Element | null = input;
    for (let depth = 0; depth < 7 && node; depth++, node = node.parentElement) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      const time = text.match(timePattern)?.[0] ?? null;
      if (time) {
        return {
          timeText: time,
          // "Available" must occur in the same smallest useful block as the
          // selected radio and time. A page-level legend is insufficient.
          explicitlyAvailable: /\bAvailable\b/i.test(text),
        };
      }
    }
    return {
      timeText: null,
      explicitlyAvailable: false,
    };
  });
}

async function selectedOption(
  locator: Locator,
): Promise<{ value: string; label: string }> {
  return await locator.evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error('Expected an HTML select element');
    }
    return {
      value: element.value,
      label:
        element.selectedOptions
          .item(0)
          ?.textContent?.replace(/\s+/g, ' ')
          .trim() ?? '',
    };
  });
}

async function nonPlaceholderOptions(
  locator: Locator,
): Promise<{ value: string; label: string }[]> {
  return await locator.evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error('Expected an HTML select element');
    }
    return Array.from(element.options)
      .map((option) => ({
        value: option.value.trim(),
        label: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
      }))
      .filter(
        (option) =>
          option.value !== '' &&
          option.value !== '0' &&
          !/^select\b/i.test(option.label) &&
          !/^test (?:module|city)$/i.test(option.label),
      );
  });
}

async function waitForPopulatedSelect(
  page: Page,
  selectIndex: number,
): Promise<void> {
  await page.waitForFunction((index) => {
    const select = document.querySelectorAll('select').item(index);
    if (!(select instanceof HTMLSelectElement)) return false;
    return Array.from(select.options).some(
      (option) =>
        option.value.trim() !== '' &&
        option.value.trim() !== '0' &&
        !/^select\b/i.test(option.textContent?.trim() ?? ''),
    );
  }, selectIndex);
}

async function waitForSelectOption(
  page: Page,
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

async function waitUntilEnabled(locator: Locator): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await locator.isEnabled())) {
    if (Date.now() >= deadline) {
      throw new Error('IDP India Book Now button stayed disabled');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function isoDateToAccessibleLabel(value: string): string {
  if (!isIsoDate(value)) throw new Error(`Invalid ISO date: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

export function findChromeExecutable(platform: NodeJS.Platform): string {
  const candidates =
    platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
        ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      'Chrome was not found; set CHROME_PATH on the isolated worker',
    );
  }
  return found;
}

function validateTarget(target: IdpIndiaBrowserTarget): void {
  if (!target.testId.trim()) throw new Error('testId is required');
  if (!target.moduleLabel.trim()) throw new Error('moduleLabel is required');
  if (!target.cityId.trim()) throw new Error('cityId is required');
  if (!isIsoDate(target.testDate)) {
    throw new Error(`Invalid ISO test date: ${target.testDate}`);
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value;
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function accessibleDateLabels(
  page: Page,
): Promise<{ label: string; isoDate: string }[]> {
  const today = new Date().toISOString().slice(0, 10);
  const labels = await page
    .locator('[aria-label]')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute('aria-label')?.trim() ?? '')
        .filter(Boolean),
    );
  const parsed = new Map<string, string>();
  for (const label of labels) {
    const timestamp = Date.parse(`${label} 00:00:00 UTC`);
    if (
      !/^[A-Za-z]+ \d{1,2}, \d{4}$/.test(label) ||
      !Number.isFinite(timestamp)
    ) {
      continue;
    }
    parsed.set(label, new Date(timestamp).toISOString().slice(0, 10));
  }
  return [...parsed.entries()]
    .map(([label, isoDate]) => ({ label, isoDate }))
    .filter(({ isoDate }) => isoDate >= today)
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

async function assertNoProviderChallenge(page: Page): Promise<void> {
  const text = await page.locator('body').innerText({ timeout: 5_000 });
  const signal = [
    /\bcaptcha\b/i,
    /\brecaptcha\b/i,
    /verify (?:that )?you are human/i,
    /unusual traffic/i,
    /access denied/i,
    /security check/i,
    /temporarily blocked/i,
    /too many requests/i,
  ].find((pattern) => pattern.test(text));
  if (signal) {
    throw new Error(`IDP India provider boundary detected: ${signal.source}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function atStage<T>(
  stage: string,
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`IDP India ${stage}: ${message}`, { cause });
  }
}
