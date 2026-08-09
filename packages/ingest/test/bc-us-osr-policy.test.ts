import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectBritishCouncilUsOsrPage } from '../src/bc-us-osr-policy.ts';

const intactPage = (policySentence: string) => `
  <main>
    <h1>IELTS One Skill Retake</h1>
    <h2>What is IELTS One Skill Retake, and how does it work?</h2>
    <p>IELTS Academic and General Training on computer</p>
    <p>IELTS for UKVI</p>
    <p>${policySentence}</p>
    <h2>Conditions to book IELTS One Skill Retake</h2>
    <p>You can only retake one skill once per original test.</p>
  </main>
`;

test('detects the current USA OSR restriction', () => {
  const observation = inspectBritishCouncilUsOsrPage(
    intactPage(
      'IELTS for Academic and General Training on computer One Skill Retake is currently not available for tests taken in the USA.',
    ),
  );
  assert.equal(observation.oneSkillRetakeUnavailable, true);
});

test('accepts an intact page after the USA restriction is removed', () => {
  const observation = inspectBritishCouncilUsOsrPage(
    intactPage('One Skill Retake is available where shown in the Test Taker Portal.'),
  );
  assert.equal(observation.oneSkillRetakeUnavailable, false);
});

test('recognises equivalent United States unavailability wording', () => {
  const observation = inspectBritishCouncilUsOsrPage(
    intactPage('In the United States, IELTS One Skill Retake remains unavailable.'),
  );
  assert.equal(observation.oneSkillRetakeUnavailable, true);
});

test('a challenge or redesigned page cannot clear the warning', () => {
  assert.throws(
    () => inspectBritishCouncilUsOsrPage('<html><title>Please wait</title></html>'),
    /failed structural validation/,
  );
});
