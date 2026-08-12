import rawPolicy from '../data/after-test-policy.json' with { type: 'json' };

export interface AfterTestPolicy {
  version: number;
  britishCouncilUnitedStates: {
    oneSkillRetakeUnavailable: boolean;
    sourceUrl: string;
    monitorUrl: string;
    monitoredClaim: string;
  };
}

export const afterTestPolicy = rawPolicy satisfies AfterTestPolicy;
