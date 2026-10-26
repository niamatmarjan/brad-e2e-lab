import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditProvenance } from './provenance-gate.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cohort = join(root, 'cohort');
const fixture = () => JSON.parse(readFileSync(join(cohort, 'run.json'), 'utf8'));
const fetchTrace = name => readFileSync(join(cohort, name), 'utf8');

test('reported nine structural passes and one BLOCKED are not independent certifications', () => {
  const result = auditProvenance(fixture(), fetchTrace);
  assert.equal(result.verdict, 'REVIEW_REQUIRED');
  assert.equal(result.releaseCertified, false);
  assert.equal(result.cohort.reportedPass, 9);
  assert.equal(result.cohort.reportedBlocked, 1);
  assert.equal(result.cohort.executedValidatedByThisTool, 0);
});

test('cohort is missing independently attributable native host event IDs', () => {
  const result = auditProvenance(fixture(), fetchTrace);
  assert.ok(result.findings.some(x => x.code === 'TRACE_NOT_HOST_LINKED'));
  assert.ok(result.findings.some(x => x.code === 'RAW_HOST_LINK_MISSING'));
});

test('a BLOCKED result must receive an independent blocker and no-effect audit', () => {
  const result = auditProvenance(fixture(), fetchTrace);
  assert.ok(result.findings.some(x => x.scope === 'CASE-10' && x.code === 'BLOCKED_UNVALIDATED'));
});

test('self-asserted oracle hash does not substitute for an external pre-execution freeze', () => {
  const result = auditProvenance(fixture(), fetchTrace);
  assert.ok(result.findings.some(x => x.code === 'UNVERIFIED_ORACLE_FREEZE'));
});

test('missing independent before/after capture prevents no-side-effects certification', () => {
  const result = auditProvenance(fixture(), fetchTrace);
  assert.ok(result.findings.some(x => x.scope === 'CASE-09' && x.code === 'SNAPSHOT_PROVENANCE_MISSING'));
});

test('a fake perfect summary with no original host event references remains review required', () => {
  const run = fixture();
  run.oracleFreeze = { independentWitnessId:'test', manifestSha256:'a'.repeat(64), frozenBeforeExecutionAt:'2026-10-26T14:00:00Z' };
  run.hostCapture = { auditorId: 'test', captureMethod: 'self-report' };
  const result = auditProvenance(run, fetchTrace);
  assert.equal(result.releaseCertified, false);
  assert.equal(result.verdict, 'REVIEW_REQUIRED');
});

test('not-run cases do not become verified completed cases', () => {
  const run = fixture();
  run.cases[0].status = 'NOT_RUN';
  const result = auditProvenance(run, fetchTrace);
  assert.equal(result.cohort.reportedPass, 8);
  assert.equal(result.cohort.executedValidatedByThisTool, 0);
});
