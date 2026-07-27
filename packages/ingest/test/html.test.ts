import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sliceElement } from '../src/html.ts';

/**
 * sliceElement is what scopes href/paragraph extraction to a single test-row
 * div rather than the whole page — that scoping is the only thing that makes
 * it safe to recognise a domain (like bare `ielts.idp.com`) that also appears
 * in every page's shared footer. These pin the boundary it must stop at.
 */

test('stops at the matching close, not the first close encountered', () => {
  const html = '<div class="row"><div class="inner">x</div></div><p>after</p>';
  const start = html.indexOf('<div class="row"');
  assert.equal(sliceElement(html, start, 'div'), '<div class="row"><div class="inner">x</div></div>');
});

test('does not leak trailing content when nothing else follows to bound it', () => {
  // The real failure mode: a row with no further nested structure, followed
  // immediately by unrelated markup (here, a footer link) with no other
  // </div> anywhere later in the document to accidentally stop the old,
  // buggy scan. The genuine fix must stop at the row's own close regardless.
  const html = '<div class="row"><span>no nested div here</span></div><footer><a href="LEAK">x</a></footer>';
  const start = html.indexOf('<div class="row"');
  const fragment = sliceElement(html, start, 'div');
  assert.equal(fragment, '<div class="row"><span>no nested div here</span></div>');
  assert.ok(!fragment.includes('LEAK'), 'the footer must not appear in the sliced fragment');
});

test('handles several levels of nesting', () => {
  const html = '<div id="root"><div><div>x</div></div><div>y</div></div><div id="sibling">z</div>';
  const start = html.indexOf('<div id="root"');
  const fragment = sliceElement(html, start, 'div');
  assert.ok(fragment.includes('x') && fragment.includes('y'));
  assert.ok(!fragment.includes('sibling'));
});

test('an element with no closing tag at all returns to end of string', () => {
  const html = '<div class="broken">unterminated';
  assert.equal(sliceElement(html, 0, 'div'), html);
});
