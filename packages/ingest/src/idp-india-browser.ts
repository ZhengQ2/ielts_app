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
