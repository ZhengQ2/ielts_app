import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectBritishCouncilUsOsrPage,
  resolveBritishCouncilUsOsrWarning,
} from '../src/bc-us-osr-policy.ts';

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
  assert.equal(observation.status, 'unavailable');
});

test('an intact page without explicit USA wording remains unknown', () => {
  const observation = inspectBritishCouncilUsOsrPage(
    intactPage('One Skill Retake is available where shown in the Test Taker Portal.'),
  );
  assert.equal(observation.status, 'unknown');
});

test('explicit USA availability can remove the warning', () => {
  const observation = inspectBritishCouncilUsOsrPage(
    intactPage('IELTS One Skill Retake is now available for tests taken in the USA.'),
  );
  assert.equal(observation.status, 'available');
});

test('recognises equivalent United States unavailability wording', () => {
  const observation = inspectBritishCouncilUsOsrPage(
    intactPage('In the United States, IELTS One Skill Retake remains unavailable.'),
  );
  assert.equal(observation.status, 'unavailable');
});

test('cannot be booked is recognised as a USA restriction', () => {
  const observation = inspectBritishCouncilUsOsrPage(
    intactPage('IELTS One Skill Retake cannot be booked for tests in the USA.'),
  );
  assert.equal(observation.status, 'unavailable');
});

test('unrecognized USA wording preserves the previous warning state', () => {
  const observation = inspectBritishCouncilUsOsrPage(
    intactPage('IELTS One Skill Retake arrangements for the USA have changed.'),
  );
  assert.equal(observation.status, 'unknown');
  assert.equal(resolveBritishCouncilUsOsrWarning(true, observation), true);
  assert.equal(resolveBritishCouncilUsOsrWarning(false, observation), false);
});

test('a challenge or redesigned page cannot clear the warning', () => {
  assert.throws(
    () => inspectBritishCouncilUsOsrPage('<html><title>Please wait</title></html>'),
    /failed structural validation/,
  );
});
