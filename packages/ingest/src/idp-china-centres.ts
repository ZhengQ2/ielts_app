import type { Centre } from '@ielts-map/core';
import { nameKey, nameSimilarity } from '@ielts-map/core';

export interface IdpChinaProviderCentre {
  providerCentreId: string;
  providerCentreCode: string;
  englishName: string;
  localName: string;
  englishAddress: string;
  localAddress: string;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  provinceId: string;
  cityId: string;
  projectCodes: string[];
}

export function parseIdpChinaCentrePage(
  value: unknown,
  projectCode: string,
): {
  total: number;
  centres: IdpChinaProviderCentre[];
} {
  if (projectCode !== '22' && projectCode !== '23') {
    throw new Error(`Unsupported IDP China centre project ${projectCode}`);
  }
  const root = record(value, 'IDP China centre page');
  if (root.code !== 200) {
    throw new Error(
      `IDP China centre page code was ${String(root.code ?? 'missing')}`,
    );
  }
  const total = nonNegativeInteger(
    root.total,
    'IDP China centre page total',
  );
  if (!Array.isArray(root.rows)) {
    throw new Error('IDP China centre page rows is not an array');
  }
  const centres = root.rows.map((candidate, index) => {
    const row = record(candidate, `IDP China centre row ${index}`);
    return {
      providerCentreId: requiredText(
        row.kdId,
        `IDP China centre row ${index} kdId`,
      ),
      providerCentreCode: requiredText(
        row.kdCode,
        `IDP China centre row ${index} kdCode`,
      ),
      englishName: requiredText(
        row.kdEName,
        `IDP China centre row ${index} kdEName`,
      ),
      localName: requiredText(
        row.kdName,
        `IDP China centre row ${index} kdName`,
      ),
      englishAddress: requiredText(
        row.addressEn,
        `IDP China centre row ${index} addressEn`,
      ),
      localAddress: requiredText(
        row.address,
        `IDP China centre row ${index} address`,
      ),
      postcode: optionalText(row.postalCode),
      phone: optionalText(row.phone),
      email: optionalEmail(row.email, `IDP China centre row ${index} email`),
      provinceId: requiredNumericText(
        row.proId,
        `IDP China centre row ${index} proId`,
      ),
      cityId: requiredNumericText(
        row.cityId,
        `IDP China centre row ${index} cityId`,
      ),
      projectCodes: [projectCode],
    };
  });
  if (centres.length > total) {
    throw new Error(
      `IDP China centre page returned ${centres.length} rows for total ${total}`,
    );
  }
  return { total, centres };
}

export function mergeIdpChinaProviderCentres(
  pages: readonly {
    total: number;
    centres: readonly IdpChinaProviderCentre[];
  }[],
): IdpChinaProviderCentre[] {
  const merged = new Map<string, IdpChinaProviderCentre>();
  for (const page of pages) {
    if (page.centres.length !== page.total) {
      throw new Error(
        `IDP China centre inventory returned ${page.centres.length} ` +
          `of ${page.total} centres`,
      );
    }
    for (const centre of page.centres) {
      const previous = merged.get(centre.providerCentreId);
      if (!previous) {
        merged.set(centre.providerCentreId, {
          ...centre,
          projectCodes: [...centre.projectCodes],
        });
        continue;
      }
      if (
        comparableCentre(previous) !== comparableCentre(centre)
      ) {
        throw new Error(
          `IDP China centre ${centre.providerCentreId} metadata changed ` +
            'between project inventories',
        );
      }
      previous.projectCodes = [
        ...new Set([...previous.projectCodes, ...centre.projectCodes]),
      ].sort();
    }
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.englishName.localeCompare(b.englishName) ||
      a.providerCentreId.localeCompare(b.providerCentreId),
  );
}

export function matchIdpChinaProviderCentre(
  provider: IdpChinaProviderCentre,
  centres: readonly Pick<
    Centre,
    'id' | 'name' | 'operator' | 'address' | 'bookingUrl'
  >[],
): {
  status: 'matched' | 'ambiguous' | 'unmatched';
  centreId: string | null;
  candidateCentreIds: string[];
} {
  const providerName = centreKey(provider.englishName);
  const candidates = centres
    .filter(
      (centre) =>
        centre.operator === 'IDP' &&
        centre.address.country === 'CN' &&
        isIdpChinaBookingUrl(centre.bookingUrl),
    )
    .map((centre) => ({
      centre,
      score: nameSimilarity(providerName, centreKey(centre.name)),
    }))
    .filter(({ score }) => score >= 0.5)
    .sort(
      (a, b) =>
        b.score - a.score || a.centre.id.localeCompare(b.centre.id),
    );
  if (!candidates.length) {
    return { status: 'unmatched', centreId: null, candidateCentreIds: [] };
  }
  const best = candidates[0]!;
  const second = candidates[1];
  const candidateCentreIds = candidates.map(({ centre }) => centre.id);
  if (
    best.score >= 0.82 &&
    (!second || best.score - second.score >= 0.2)
  ) {
    return {
      status: 'matched',
      centreId: best.centre.id,
      candidateCentreIds,
    };
  }
  return { status: 'ambiguous', centreId: null, candidateCentreIds };
}

function comparableCentre(centre: IdpChinaProviderCentre): string {
  return JSON.stringify({
    ...centre,
    projectCodes: undefined,
  });
}

function centreKey(value: string): string {
  return nameKey(value)
    .split(' ')
    .filter(
      (token) =>
        token !== 'idp' &&
        token !== 'ielts' &&
        token !== 'china' &&
        token !== 'test' &&
        token !== 'center' &&
        token !== 'centre',
    )
    .join(' ');
}

function isIdpChinaBookingUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    return new URL(value).hostname.toLowerCase() === 'sign.idpielts.cn';
  } catch {
    return false;
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing`);
  }
  return value.replace(/\s+/g, ' ').trim();
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim() || null
    : null;
}

function optionalEmail(value: unknown, label: string): string | null {
  const result = optionalText(value);
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new Error(`${label} is invalid`);
  }
  return result;
}

function requiredNumericText(value: unknown, label: string): string {
  const result = requiredText(value, label);
  if (!/^\d+$/.test(result)) throw new Error(`${label} is not numeric`);
  return result;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${label} is not a non-negative integer`);
  }
  return Number(value);
}
