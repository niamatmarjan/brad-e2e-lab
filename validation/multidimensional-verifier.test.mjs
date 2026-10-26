import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateMultidimensional, SEMANTIC_ROUTE_RULES, sha256 } from './multidimensional-verifier.mjs';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const COHORT_DIR = join(THIS_DIR, 'cohort');
const RUN_PATH = join(COHORT_DIR, 'run.json');

const loadCleanRun = () => JSON.parse(readFileSync(RUN_PATH, 'utf8'));

test('MD1: Baseline cohort evaluates strictly to REVIEW_REQUIRED across 6 dimensions', () => {
  const run = loadCleanRun();
  const report = evaluateMultidimensional(run, COHORT_DIR);

  assert.equal(report.summary.total, 10);
  assert.equal(report.summary.authenticatedNativePass, 0);
  assert.equal(report.summary.authenticallyBlocked, 1);
  assert.equal(report.summary.reviewRequired, 9);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.overallCohortVerdict, 'REVIEW_REQUIRED / NOT_CERTIFIED');
  assert.equal(report.oracleIntegrity.frozenBeforeExecution, false);
});

test('MD2: Each case produces all 6 independent dimension records', () => {
  const run = loadCleanRun();
  const report = evaluateMultidimensional(run, COHORT_DIR);

  for (const c of report.cases) {
    assert.ok(c.dimensions.structural, `${c.caseId} missing structural dimension`);
    assert.ok(c.dimensions.hostOrigin, `${c.caseId} missing hostOrigin dimension`);
    assert.ok(c.dimensions.routeAccuracy, `${c.caseId} missing routeAccuracy dimension`);
    assert.ok(c.dimensions.workflowExecution, `${c.caseId} missing workflowExecution dimension`);
    assert.ok(c.dimensions.taskCompletion, `${c.caseId} missing taskCompletion dimension`);
    assert.ok(c.dimensions.independentOutcome, `${c.caseId} missing independentOutcome dimension`);
  }
});

test('MD3: Structural dimension passes for baseline but Host Origin fails without native host links', () => {
  const run = loadCleanRun();
  const report = evaluateMultidimensional(run, COHORT_DIR);

  for (const c of report.cases) {
    assert.equal(c.dimensions.structural.pass, true, `${c.caseId} structural should pass`);
    assert.equal(c.dimensions.hostOrigin.pass, false, `${c.caseId} hostOrigin should fail without real host traces`);
    assert.equal(c.dimensions.hostOrigin.status, 'NOT_VERIFIED');
  }
});

test('MD4: Semantic route validation correctly validates stakeholder prompt intent', () => {
  const run = loadCleanRun();
  const report = evaluateMultidimensional(run, COHORT_DIR);

  for (const c of report.cases) {
    assert.equal(c.dimensions.routeAccuracy.pass, true, `${c.caseId} route should be semantically valid`);
    assert.equal(c.dimensions.routeAccuracy.semanticMatch, true);
  }
});

test('MD5: Tampering with route fails Dimension 3 (Route Accuracy)', () => {
  const run = loadCleanRun();
  const c4 = run.cases.find(x => x.caseId === 'CASE-04');
  c4.observedRoute = 'bmad-prd'; // Tamper: build story assigned to PRD

  const report = evaluateMultidimensional(run, COHORT_DIR);
  const evalC4 = report.cases.find(x => x.caseId === 'CASE-04');

  assert.equal(evalC4.dimensions.routeAccuracy.pass, false);
  assert.equal(evalC4.dimensions.routeAccuracy.semanticMatch, false);
});

test('MD6: Mutated file inventory on refusal fails Dimension 5 (Task & State Completion)', () => {
  const run = loadCleanRun();
  const c9 = run.cases.find(x => x.caseId === 'CASE-09');
  c9.after.files['unauthorized-mutation.txt'] = 'a'.repeat(64);

  const report = evaluateMultidimensional(run, COHORT_DIR);
  const evalC9 = report.cases.find(x => x.caseId === 'CASE-09');

  assert.equal(evalC9.dimensions.taskCompletion.pass, false);
  assert.ok(evalC9.dimensions.taskCompletion.details.some(d => d.includes('inventory changed')));
});

test('MD7: Authentic host origin can upgrade disposition if all dimensions pass', () => {
  const run = loadCleanRun();
  const c4 = run.cases.find(x => x.caseId === 'CASE-04');
  c4.rawHost = {
    hostSessionId: 'b3772c92-61af-4afa-b3ba-da7137c94ff1',
    transcriptSha256: 'b'.repeat(64),
    originalEventIds: ['ev-host-001']
  };

  const origBytes = readFileSync(join(COHORT_DIR, c4.transcript.file), 'utf8');
  const origEvents = origBytes.trim().split('\n').map(JSON.parse);
  const newTraceStr = origEvents.map((e, idx) => ({
    ...e,
    sourceEventId: `host-ev-${idx}`,
    timestamp: new Date(1700000000000 + idx * 1000).toISOString()
  })).map(JSON.stringify).join('\n') + '\n';

  c4.transcript.sha256 = sha256(Buffer.from(newTraceStr));

  const report = evaluateMultidimensional(run, COHORT_DIR, (path) => {
    if (path.endsWith('case-04.jsonl')) {
      return Buffer.from(newTraceStr);
    }
    return readFileSync(path);
  });

  const evalC4 = report.cases.find(x => x.caseId === 'CASE-04');
  assert.equal(evalC4.dimensions.hostOrigin.pass, true, evalC4.dimensions.hostOrigin.details.join('; '));
  assert.equal(evalC4.dimensions.independentOutcome, 'PASS');
});
