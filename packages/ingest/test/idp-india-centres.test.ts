import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchIdpIndiaProviderCentre,
  parseIdpIndiaComputerCentresHtml,
} from '../src/idp-india-centres.ts';

function card(index: number): string {
  const city =
    index === 0
      ? 'Bengaluru (Whitefield) Karnataka'
      : `Example City ${index} Gujarat`;
  return `
    <div class="centre-card">
      <h4>${city}</h4>
      <p><strong>Address</strong>
        ${index + 1}, Example Road, Example City ${index}, India
      </p>
      <p><strong>Phone</strong> +91-80-4400-${String(index).padStart(4, '0')}</p>
    </div>
  `;
}

function fixtureHtml(): string {
  return `
    <h1>IELTS on Computer Test Centres</h1>
    ${Array.from({ length: 20 }, (_, index) => card(index)).join('\n')}
    <h1>IDP's Student Placement Branches In India</h1>
  `;
}

test('extracts the bounded official IDP India computer-centre section', () => {
  const centres = parseIdpIndiaComputerCentresHtml(fixtureHtml());
  assert.equal(centres.length, 20);
  assert.deepEqual(
    {
      name: centres.find((centre) =>
        centre.name.startsWith('Bengaluru'),
      )?.name,
      region: centres.find((centre) =>
        centre.name.startsWith('Bengaluru'),
      )?.region,
      address: centres.find((centre) =>
        centre.name.startsWith('Bengaluru'),
      )?.address,
    },
    {
      name: 'Bengaluru (Whitefield)',
      region: 'Karnataka',
      address: '1, Example Road, Example City 0, India',
    },
  );
});

test('matches provider centres by branch name and remains fail-closed', () => {
  const provider = parseIdpIndiaComputerCentresHtml(fixtureHtml()).find(
    (centre) => centre.name.startsWith('Bengaluru'),
  )!;
  const centre = {
    id: 'bengaluru-whitefield',
    name: 'IDP Education India - Bengaluru - Whitefield',
    operator: 'IDP' as const,
    address: {
      raw: '1, Example Road, Example City 0, India',
      lines: ['1, Example Road', 'Example City 0', 'India'],
      city: 'Bengaluru',
      region: 'Karnataka',
      postcode: null,
      country: 'IN',
    },
    bookingUrl: 'https://ieltsidpindia.com/registration/reg1',
  };
  assert.equal(
    matchIdpIndiaProviderCentre(provider, [centre]).centreId,
    'bengaluru-whitefield',
  );
  assert.equal(
    matchIdpIndiaProviderCentre(provider, []).status,
    'unmatched',
  );
});

test('rejects truncated official centre sections', () => {
  assert.throws(
    () =>
      parseIdpIndiaComputerCentresHtml(
        '<h1>IELTS on Computer Test Centres</h1>' +
          card(1) +
          "<h1>IDP's Student Placement Branches In India</h1>",
      ),
    /yielded only 1 centres/,
  );
});
