import type {
  CentreQualityAnalysis,
  CentreQualityReport,
  QualityDecision,
  QualitySeverity,
} from './quality.ts';

export interface QualityBaselineEntry {
  id: string;
  country: string;
  decision: QualityDecision;
  pinnable: boolean;
  /** Stable `severity:code` tokens; messages are deliberately excluded. */
  issues: string[];
}

export interface CountryQualityBaseline {
  centres: number;
  ready: number;
  needsReview: number;
  quarantined: number;
  nonPinnable: number;
  issues: Record<string, number>;
}

/**
 * Compact, deterministic state used for comparisons between unattended runs.
 * Healthy centres need no entry: their counts remain in `byCountry`, and any
 * later issue causes them to appear in `affected`.
 */
export interface QualityBaseline {
  version: 1;
  country: string;
  centreCount: number;
  affected: QualityBaselineEntry[];
  unresolvedSourceSlugs: string[];
  byCountry: Record<string, CountryQualityBaseline>;
}

export interface QualityIssueDelta {
  id: string;
  name: string;
  country: string;
  code: string;
  severity: QualitySeverity;
}

export interface QualityDecisionDelta {
  id: string;
  name: string;
  country: string;
  before: QualityDecision;
  after: QualityDecision;
}

export interface CountryQualityDelta {
  country: string;
  centres: number;
  ready: number;
  needsReview: number;
  quarantined: number;
  nonPinnable: number;
  issueChanges: Record<string, number>;
}

export interface QualityDelta {
  initialized: boolean;
  summary: {
    newIssues: number;
    resolvedIssues: number;
    newCentreIssues: number;
    decisionRegressions: number;
    decisionImprovements: number;
    newlyNonPinnable: number;
    restoredPinnable: number;
  };
  newIssues: QualityIssueDelta[];
  resolvedIssues: QualityIssueDelta[];
  newCentreIssues: QualityIssueDelta[];
  decisionRegressions: QualityDecisionDelta[];
  decisionImprovements: QualityDecisionDelta[];
  newlyNonPinnable: Array<{ id: string; name: string; country: string }>;
  restoredPinnable: Array<{ id: string; name: string; country: string }>;
  byCountry: CountryQualityDelta[];
}

const DECISION_RANK: Record<QualityDecision, number> = {
  ready: 0,
  needs_review: 1,
  quarantined: 2,
};

function countryKey(value: string | null): string {
  return value ?? 'UNASSIGNED';
}

function issueToken(severity: QualitySeverity, code: string): string {
  return `${severity}:${code}`;
}

function parseIssueToken(token: string): {
  severity: QualitySeverity;
  code: string;
} {
  const separator = token.indexOf(':');
  const severity = token.slice(0, separator) as QualitySeverity;
  return { severity, code: token.slice(separator + 1) };
}

export function buildQualityBaseline(
  analyses: CentreQualityAnalysis[],
  report: CentreQualityReport,
): QualityBaseline {
  const byCountry = new Map<string, CountryQualityBaseline>();
  const affected: QualityBaselineEntry[] = [];

  for (const analysis of analyses) {
    const country = countryKey(analysis.signals.country);
    const aggregate = byCountry.get(country) ?? {
      centres: 0,
      ready: 0,
      needsReview: 0,
      quarantined: 0,
      nonPinnable: 0,
      issues: {},
    };
    aggregate.centres++;
    if (analysis.decision === 'ready') aggregate.ready++;
    else if (analysis.decision === 'needs_review') aggregate.needsReview++;
    else aggregate.quarantined++;
    if (!analysis.signals.location.pinnable) aggregate.nonPinnable++;

    const issues = analysis.issues
      .map((issue) => issueToken(issue.severity, issue.code))
      .sort();
    for (const issue of analysis.issues) {
      aggregate.issues[issue.code] =
        (aggregate.issues[issue.code] ?? 0) + 1;
    }
    byCountry.set(country, aggregate);

    if (
      issues.length ||
      analysis.decision !== 'ready' ||
      !analysis.signals.location.pinnable
    ) {
      affected.push({
        id: analysis.id,
        country,
        decision: analysis.decision,
        pinnable: analysis.signals.location.pinnable,
        issues,
      });
    }
  }

  const normalizedCountries = Object.fromEntries(
    [...byCountry.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([country, value]) => [
        country,
        {
          ...value,
          issues: Object.fromEntries(
            Object.entries(value.issues).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
        },
      ]),
  );

  return {
    version: 1,
    country: report.country,
    centreCount: analyses.length,
    affected: affected.sort((left, right) => left.id.localeCompare(right.id)),
    unresolvedSourceSlugs: [
      ...new Set(
        report.discovery.unresolvedNewSourcePages
          .concat(report.discovery.ongoingUnresolvedSourcePages)
          .map((failure) => failure.slug),
      ),
    ].sort(),
    byCountry: normalizedCountries,
  };
}

export function qualityBaselineChanged(
  previous: QualityBaseline | null,
  next: QualityBaseline,
): boolean {
  return JSON.stringify(previous) !== JSON.stringify(next);
}

export function diffQualityBaselines(
  previous: QualityBaseline | null,
  next: QualityBaseline,
  analyses: CentreQualityAnalysis[],
): QualityDelta {
  if (!previous) return emptyDelta(true);

  const currentById = new Map(analyses.map((analysis) => [analysis.id, analysis]));
  const previousById = new Map(
    previous.affected.map((entry) => [entry.id, entry]),
  );
  const nextById = new Map(next.affected.map((entry) => [entry.id, entry]));
  const newIssues: QualityIssueDelta[] = [];
  const resolvedIssues: QualityIssueDelta[] = [];
  const newCentreIssues: QualityIssueDelta[] = [];
  const decisionRegressions: QualityDecisionDelta[] = [];
  const decisionImprovements: QualityDecisionDelta[] = [];
  const newlyNonPinnable: QualityDelta['newlyNonPinnable'] = [];
  const restoredPinnable: QualityDelta['restoredPinnable'] = [];

  for (const analysis of analyses) {
    const previousEntry = previousById.get(analysis.id);
    const nextEntry = nextById.get(analysis.id);
    const priorIssues = new Set(previousEntry?.issues ?? []);
    const currentIssues = new Set(nextEntry?.issues ?? []);
    const country = countryKey(analysis.signals.country);

    for (const token of currentIssues) {
      if (priorIssues.has(token)) continue;
      const parsed = parseIssueToken(token);
      const item = {
        id: analysis.id,
        name: analysis.name,
        country,
        ...parsed,
      };
      if (analysis.isNew) newCentreIssues.push(item);
      else newIssues.push(item);
    }
    for (const token of priorIssues) {
      if (currentIssues.has(token)) continue;
      resolvedIssues.push({
        id: analysis.id,
        name: analysis.name,
        country,
        ...parseIssueToken(token),
      });
    }

    if (!analysis.isNew) {
      const beforeDecision = previousEntry?.decision ?? 'ready';
      if (DECISION_RANK[analysis.decision] > DECISION_RANK[beforeDecision]) {
        decisionRegressions.push({
          id: analysis.id,
          name: analysis.name,
          country,
          before: beforeDecision,
          after: analysis.decision,
        });
      } else if (
        DECISION_RANK[analysis.decision] < DECISION_RANK[beforeDecision]
      ) {
        decisionImprovements.push({
          id: analysis.id,
          name: analysis.name,
          country,
          before: beforeDecision,
          after: analysis.decision,
        });
      }

      const wasPinnable = previousEntry?.pinnable ?? true;
      if (wasPinnable && !analysis.signals.location.pinnable) {
        newlyNonPinnable.push({ id: analysis.id, name: analysis.name, country });
      } else if (!wasPinnable && analysis.signals.location.pinnable) {
        restoredPinnable.push({ id: analysis.id, name: analysis.name, country });
      }
    }
  }

  const byCountry = countryDeltas(previous, next);
  const sortIssues = (left: QualityIssueDelta, right: QualityIssueDelta) =>
    left.country.localeCompare(right.country) ||
    left.id.localeCompare(right.id) ||
    left.code.localeCompare(right.code);
  newIssues.sort(sortIssues);
  resolvedIssues.sort(sortIssues);
  newCentreIssues.sort(sortIssues);

  return {
    initialized: false,
    summary: {
      newIssues: newIssues.length,
      resolvedIssues: resolvedIssues.length,
      newCentreIssues: newCentreIssues.length,
      decisionRegressions: decisionRegressions.length,
      decisionImprovements: decisionImprovements.length,
      newlyNonPinnable: newlyNonPinnable.length,
      restoredPinnable: restoredPinnable.length,
    },
    newIssues,
    resolvedIssues,
    newCentreIssues,
    decisionRegressions,
    decisionImprovements,
    newlyNonPinnable,
    restoredPinnable,
    byCountry,
  };
}

function emptyDelta(initialized: boolean): QualityDelta {
  return {
    initialized,
    summary: {
      newIssues: 0,
      resolvedIssues: 0,
      newCentreIssues: 0,
      decisionRegressions: 0,
      decisionImprovements: 0,
      newlyNonPinnable: 0,
      restoredPinnable: 0,
    },
    newIssues: [],
    resolvedIssues: [],
    newCentreIssues: [],
    decisionRegressions: [],
    decisionImprovements: [],
    newlyNonPinnable: [],
    restoredPinnable: [],
    byCountry: [],
  };
}

function countryDeltas(
  previous: QualityBaseline,
  next: QualityBaseline,
): CountryQualityDelta[] {
  const countries = new Set([
    ...Object.keys(previous.byCountry),
    ...Object.keys(next.byCountry),
  ]);
  const deltas: CountryQualityDelta[] = [];
  for (const country of [...countries].sort()) {
    const before = previous.byCountry[country];
    const after = next.byCountry[country];
    if (!before || !after) continue;
    const issueCodes = new Set([
      ...Object.keys(before.issues),
      ...Object.keys(after.issues),
    ]);
    const issueChanges = Object.fromEntries(
      [...issueCodes]
        .sort()
        .flatMap((code) => {
          const change = (after.issues[code] ?? 0) - (before.issues[code] ?? 0);
          return change === 0 ? [] : [[code, change]];
        }),
    );
    const delta = {
      country,
      centres: after.centres - before.centres,
      ready: after.ready - before.ready,
      needsReview: after.needsReview - before.needsReview,
      quarantined: after.quarantined - before.quarantined,
      nonPinnable: after.nonPinnable - before.nonPinnable,
      issueChanges,
    };
    if (
      delta.centres ||
      delta.ready ||
      delta.needsReview ||
      delta.quarantined ||
      delta.nonPinnable ||
      Object.keys(delta.issueChanges).length
    ) {
      deltas.push(delta);
    }
  }
  return deltas;
}

/**
 * Block systemic regressions, not ordinary source changes. Smaller deltas are
 * still visible in CI but can flow through unattended.
 */
export function qualityRegressionProblems(
  previous: QualityBaseline | null,
  delta: QualityDelta,
): string[] {
  if (!previous || delta.initialized) return [];
  const problems: string[] = [];
  const warningOrError = delta.newIssues.filter(
    (issue) => issue.severity !== 'info',
  ).length;
  const issueLimit = Math.max(25, Math.ceil(previous.centreCount * 0.03));
  const pinLimit = Math.max(20, Math.ceil(previous.centreCount * 0.02));
  const quarantineLimit = Math.max(5, Math.ceil(previous.centreCount * 0.005));

  if (warningOrError > issueLimit) {
    problems.push(
      `${warningOrError} existing-centre quality issues appeared; automatic limit is ${issueLimit}`,
    );
  }
  if (delta.newlyNonPinnable.length > pinLimit) {
    problems.push(
      `${delta.newlyNonPinnable.length} existing map pins became unsafe; automatic limit is ${pinLimit}`,
    );
  }
  if (delta.decisionRegressions.filter(
    (item) => item.after === 'quarantined',
  ).length > quarantineLimit) {
    problems.push(
      `${delta.decisionRegressions.filter((item) => item.after === 'quarantined').length} existing centres became quarantined; automatic limit is ${quarantineLimit}`,
    );
  }

  for (const change of delta.byCountry) {
    const before = previous.byCountry[change.country];
    if (!before || before.centres < 10) continue;
    const countryPinLimit = Math.max(5, Math.ceil(before.centres * 0.1));
    const countryQuarantineLimit = Math.max(
      3,
      Math.ceil(before.centres * 0.05),
    );
    const existingPinRegression =
      delta.newlyNonPinnable.filter(
        (item) => item.country === change.country,
      ).length -
      delta.restoredPinnable.filter(
        (item) => item.country === change.country,
      ).length;
    const existingQuarantineRegression =
      delta.decisionRegressions.filter(
        (item) =>
          item.country === change.country && item.after === 'quarantined',
      ).length -
      delta.decisionImprovements.filter(
        (item) =>
          item.country === change.country && item.before === 'quarantined',
      ).length;
    if (existingPinRegression > countryPinLimit) {
      problems.push(
        `${change.country}: existing non-pinnable locations increased by ${existingPinRegression}; automatic limit is ${countryPinLimit}`,
      );
    }
    if (existingQuarantineRegression > countryQuarantineLimit) {
      problems.push(
        `${change.country}: existing quarantined centres increased by ${existingQuarantineRegression}; automatic limit is ${countryQuarantineLimit}`,
      );
    }
  }
  return problems;
}

export function renderQualityDelta(delta: QualityDelta): string {
  if (delta.initialized) {
    return [
      '## Quality trend',
      '',
      '_Initialized the persistent quality baseline; no regression is inferred from the first snapshot._',
    ].join('\n');
  }

  const lines = [
    '## Quality trend',
    '',
    `Existing centres: ${delta.summary.newIssues} new issue(s), ${delta.summary.resolvedIssues} resolved issue(s), ` +
      `${delta.summary.newlyNonPinnable} newly unsafe pin(s), ${delta.summary.restoredPinnable} restored pin(s).`,
    '',
  ];
  if (delta.newIssues.length) {
    lines.push('### New issues on existing centres', '');
    for (const issue of delta.newIssues.slice(0, 50)) {
      lines.push(
        `- ${issue.name} (${issue.country}) — \`${issue.code}\` (${issue.severity})`,
      );
    }
    if (delta.newIssues.length > 50) {
      lines.push(`- …and ${delta.newIssues.length - 50} more`);
    }
    lines.push('');
  }
  if (delta.resolvedIssues.length) {
    lines.push(
      `_${delta.resolvedIssues.length} existing-centre issue(s) were resolved._`,
      '',
    );
  }
  if (delta.byCountry.length) {
    lines.push('| Country | Centres | Ready | Review | Quarantined | Unsafe pins |', '|---|---:|---:|---:|---:|---:|');
    for (const item of delta.byCountry.slice(0, 50)) {
      lines.push(
        `| ${item.country} | ${signed(item.centres)} | ${signed(item.ready)} | ${signed(item.needsReview)} | ${signed(item.quarantined)} | ${signed(item.nonPinnable)} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
