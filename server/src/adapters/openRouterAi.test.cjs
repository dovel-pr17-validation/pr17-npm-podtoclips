const assert = require('node:assert/strict');
const test = require('node:test');
const { _test } = require('./openRouterAi.cjs');

test('global discovery schema can return a broad shortlist from the full transcript', () => {
  const schema = _test.discoverySchema(199);
  const candidates = schema.properties.candidates;
  assert.equal(candidates.maxItems, 16);
  assert.equal(candidates.items.properties.window_index.maximum, 199);
  assert.ok(candidates.items.required.includes('hook_quote'));
  assert.ok(candidates.items.required.includes('lane'));
});

test('global reranker scores engagement, virality, retention, insight, and context', () => {
  const schema = _test.rerankSchema(23);
  const selection = schema.properties.selections.items;
  assert.equal(schema.properties.selections.maxItems, 8);
  assert.equal(selection.properties.candidate_index.maximum, 23);
  for (const field of [
    'engagement_score', 'virality_score', 'retention_score', 'insight_score',
    'surprise_score', 'clarity_score', 'context_score',
  ]) assert.ok(selection.required.includes(field));
});

test('overlapping discoveries are removed before global ranking', () => {
  const selected = _test.dedupeDiscoveredCandidates([
    { id: 'first', start: 10, end: 50 },
    { id: 'duplicate', start: 15, end: 48 },
    { id: 'distinct', start: 80, end: 120 },
  ]);
  assert.deepEqual(selected.map((candidate) => candidate.id), ['first', 'distinct']);
});
