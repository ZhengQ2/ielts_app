import type { IdpIndiaBrowserCapture } from './idp-india-availability.ts';

export interface IdpIndiaOption {
  id: string;
  label: string;
}

export interface IdpIndiaDate {
  testDate: string;
  seatsAvailable: number;
}

export interface IdpIndiaTarget {
  testId: string;
  testLabel: string;
  moduleId: string;
  moduleLabel: string;
  cityId: string;
  cityLabel: string;
}

export const IDP_INDIA_TESTS: readonly {
  id: string;
  label: string;
}[] = [
  { id: '1', label: 'IELTS on Paper' },
  { id: '3', label: 'Life Skills' },
  { id: '4', label: 'IELTS on Computer' },
  { id: '5', label: 'Computer-delivered IELTS for UKVI' },
  {
    id: '16',
    label: 'Listening/Reading on computer, Writing on paper',
  },
];

export function parseIdpIndiaOptions(
  value: unknown,
  label: string,
): IdpIndiaOption[] {
  return firstDataList(value, label).map((candidate, index) => {
    const row = record(candidate, `${label}[${index}]`);
    return {
      id: identifier(row.ddlID, `${label}[${index}].ddlID`),
      label: requiredText(row.ddlValue, `${label}[${index}].ddlValue`),
    };
  });
}

export function parseIdpIndiaDates(value: unknown): IdpIndiaDate[] {
  return firstDataList(value, 'IDP India dates').map((candidate, index) => {
    const row = record(candidate, `IDP India dates[${index}]`);
    const sourceDate = requiredText(
      row.ddlValue,
      `IDP India dates[${index}].ddlValue`,
    );
    return {
      testDate: indiaDateToIso(sourceDate),
      seatsAvailable: nonNegativeInteger(
        row.SeatAvailable,
        `IDP India dates[${index}].SeatAvailable`,
      ),
    };
  });
}

export function idpIndiaCapture(
  target: IdpIndiaTarget,
  dates: readonly IdpIndiaDate[],
): IdpIndiaBrowserCapture {
  const sourceUrl = new URL(
    'https://ieltsidpindia.com/registration/reg1',
  );
  sourceUrl.searchParams.set(
    'ID',
    `${target.testId}^${target.moduleId}^${target.cityId}`,
  );
  return {
    sourceUrl: sourceUrl.toString(),
    testId: target.testId,
    testLabel: target.testLabel,
    moduleId: target.moduleId,
    moduleLabel: target.moduleLabel,
    cityId: target.cityId,
    cityLabel: target.cityLabel,
    sessions: dates.map((date) => ({
      testDate: date.testDate,
      timeText: null,
      explicitlyAvailable: date.seatsAvailable > 0,
    })),
  };
}

function firstDataList(value: unknown, label: string): unknown[] {
  const root = record(value, `${label} response`);
  const data = root.Data;
  if (!Array.isArray(data)) {
    throw new Error(`${label} response Data is not an array`);
  }
  const first = data[0];
  if (first === null) return [];
  if (!Array.isArray(first)) {
    throw new Error(`${label} response Data[0] is not an array`);
  }
  return first;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown, label: string): string {
  const result =
    typeof value === 'number' && Number.isInteger(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';
  if (!result || !/^\d+$/.test(result)) {
    throw new Error(`${label} is not a numeric identifier`);
  }
  return result;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing`);
  }
  return value.replace(/\s+/g, ' ').trim();
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is not a non-negative integer`);
  }
  return parsed;
}

function indiaDateToIso(value: string): string {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`Invalid IDP India date ${value}`);
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== iso
  ) {
    throw new Error(`Invalid IDP India date ${value}`);
  }
  return iso;
}
