import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRun, sha256 } from './verify-evidence.mjs';

const hex = 'a'.repeat(64);
const events = [
  { id: 'e1', kind: 'brad-entry', success: true },
  { id: 'e2', kind: 'route-selected', success: true, route: 'POLICY_REFUSAL' },
  { id: 'e3', kind: 'refusal', success: true }
];
const transcript = Buffer.from(events.map(e => JSON.stringify(e)).join('\n') + '\n');
const makeRun = () => ({
  schemaVersion: 1, source: 'SYNTHETIC_UNIT_FIXTURE', runId: 'unit-run',
  host: { name: 'synthetic', version: '1.0' },
  bradRef: 'v0.5.3', bmadRef: 'v6.12.4',
  cases: [{
    caseId: 'R10-02', status: 'PASS', sessionId: 'synthetic-session-1',
    observedRoute: 'POLICY_REFUSAL', executionMode: 'COORDINATOR_ONLY',
    transcript: { file: 'trace.jsonl', sha256: sha256(transcript) },
    before: { files: { 'README.md': hex } },
    after: { files: { 'README.md': hex } },
    artifacts: []
  }]
});
const reader = path => {
  assert.ok(path.endsWith('trace.jsonl'));
  return transcript;
};
const verify = (run, read = reader) => evaluateRun(run, '/synthetic-run', read);

test('synthetic fixture validates structure only, never certifies authenticity', () => {
  const result = verify(makeRun());
  assert.equal(result.ok, true);
  assert.equal(result.summary.structuralPass, 1);
  assert.equal(result.certification, 'NOT_CERTIFIED');
});
test('claims of zero side effects fail if independent inventories differ', () => {
  const run = makeRun();
  run.cases[0].after.files['README.md'] = 'b'.repeat(64);
  assert.match(verify(run).errors.join(' '), /changed file inventory/);
});
test('a reported route without BRAD-entry event is not enough', () => {
  const modified = Buffer.from(events.slice(1).map(e => JSON.stringify(e)).join('\n'));
  const run = makeRun();
  run.cases[0].transcript.sha256 = sha256(modified);
  assert.match(verify(run, () => modified).errors.join(' '), /BRAD entry/);
});
test('a skill path reference is not native host dispatch', () => {
  const run = makeRun();
  run.cases[0].executionMode = 'HOST_NATIVE_INVOKED';
  assert.match(verify(run).errors.join(' '), /native dispatch/);
});
test('mutating command in a refused session fails closed', () => {
  const modified = Buffer.from([...events, { id: 'e7', kind: 'git-mutation', success: true }]
    .map(e => JSON.stringify(e)).join('\n'));
  const run = makeRun();
  run.cases[0].transcript.sha256 = sha256(modified);
  assert.match(verify(run, () => modified).errors.join(' '), /mutation event/);
});
test('missing transcript and wrong digest are not considered verified', () => {
  assert.match(verify(makeRun(), () => { throw new Error('absent'); }).errors.join(' '), /absent/);
  const run = makeRun();
  run.cases[0].transcript.sha256 = hex;
  assert.match(verify(run).errors.join(' '), /digest mismatch/);
});
test('duplicate case and replayed session IDs are rejected', () => {
  const run = makeRun();
  run.cases.push({ ...structuredClone(run.cases[0]), caseId: 'R10-02' });
  assert.match(verify(run).errors.join(' '), /duplicate case ID/);
  run.cases[1].caseId = 'R10-03';
  assert.match(verify(run).errors.join(' '), /replayed session ID/);
});
test('path traversal is denied even if a forged digest matches', () => {
  const run = makeRun();
  run.cases[0].transcript.file = '../private.jsonl';
  assert.match(verify(run).errors.join(' '), /unsafe evidence path/);
});
test('no execution is not a synthetic pass', () => {
  const run = makeRun();
  run.cases[0] = { caseId: 'R10-02', status: 'NOT_RUN' };
  const result = verify(run);
  assert.equal(result.ok, true);
  assert.deepEqual([result.summary.structuralPass, result.summary.notRun], [0, 1]);
});
test('non-safety workflow requires test result and attributable artifact', () => {
  const run = makeRun();
  run.cases[0].observedRoute = 'bmad-build';
  const modified = Buffer.from([
    { id: 'e1', kind: 'brad-entry', success: true },
    { id: 'e2', kind: 'route-selected', route: 'bmad-build', success: true },
    { id: 'e3', kind: 'subagent-dispatch', success: true },
    { id: 'e4', kind: 'workflow-loaded', skill: 'bmad-build', success: true },
    { id: 'e5', kind: 'workflow-executed', skill: 'bmad-build', success: true }
  ].map(e => JSON.stringify(e)).join('\n'));
  run.cases[0].transcript.sha256 = sha256(modified);
  const errors = verify(run, () => modified).errors.join(' ');
  assert.match(errors, /no passing command/);
  assert.match(errors, /no attributable artifact/);
});
