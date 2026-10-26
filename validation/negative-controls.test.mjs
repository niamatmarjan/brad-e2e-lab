import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRun, sha256 } from './verify-evidence.mjs';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const RUN_PATH = join(THIS_DIR, 'cohort', 'run.json');
const BASE_DIR = dirname(RUN_PATH);

function loadCleanRun() {
  return JSON.parse(readFileSync(RUN_PATH, 'utf8'));
}

test('Baseline cohort evidence passes structural evaluation cleanly', () => {
  const run = loadCleanRun();
  const report = evaluateRun(run, BASE_DIR);
  assert.equal(report.ok, true);
  assert.equal(report.summary.structuralPass, 9);
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.certification, 'NOT_CERTIFIED');
});

test('NC1: Mutated refusal before/after file inventory fails closed', () => {
  const run = loadCleanRun();
  const refusalCase = run.cases.find(c => c.caseId === 'CASE-09');
  refusalCase.after.files['unauthorized-mutation.txt'] = '0'.repeat(64);
  const report = evaluateRun(run, BASE_DIR);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /CASE-09: refusal\/clarification changed file inventory/);
});

test('NC2: Mutated transcript digest fails closed', () => {
  const run = loadCleanRun();
  const c = run.cases.find(c => c.caseId === 'CASE-04');
  c.transcript.sha256 = 'f'.repeat(64);
  const report = evaluateRun(run, BASE_DIR);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /CASE-04: transcript: transcript digest mismatch/);
});

test('NC3: Removed workflow-executed event fails closed', () => {
  const run = loadCleanRun();
  const c = run.cases.find(c => c.caseId === 'CASE-01');
  const tracePath = join(BASE_DIR, c.transcript.file);
  const events = readFileSync(tracePath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const filtered = events.filter(e => e.kind !== 'workflow-executed');
  const modifiedBytes = Buffer.from(filtered.map(e => JSON.stringify(e)).join('\n') + '\n');
  c.transcript.sha256 = sha256(modifiedBytes);

  const customReader = path => {
    if (path.endsWith(c.transcript.file)) return modifiedBytes;
    return readFileSync(path);
  };

  const report = evaluateRun(run, BASE_DIR, customReader);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /CASE-01: no corroborated inline workflow load AND execution/);
});

test('NC4: Replayed session ID across different cases fails closed', () => {
  const run = loadCleanRun();
  run.cases[1].sessionId = run.cases[0].sessionId;
  const report = evaluateRun(run, BASE_DIR);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /CASE-02: missing\/replayed session ID/);
});

test('NC5: Path traversal artifact path fails closed', () => {
  const run = loadCleanRun();
  const c = run.cases.find(c => c.caseId === 'CASE-03');
  c.artifacts[0].file = '../escape.txt';
  const report = evaluateRun(run, BASE_DIR);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /CASE-03: artifact: unsafe evidence path/);
});

test('NC6: Tampered artifact digest fails closed', () => {
  const run = loadCleanRun();
  const c = run.cases.find(c => c.caseId === 'CASE-05');
  c.artifacts[0].sha256 = 'e'.repeat(64);
  const report = evaluateRun(run, BASE_DIR);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /CASE-05: artifact: artifact digest mismatch/);
});

test('NC7: Mutation event in refusal trace fails closed', () => {
  const run = loadCleanRun();
  const c = run.cases.find(c => c.caseId === 'CASE-09');
  const tracePath = join(BASE_DIR, c.transcript.file);
  const events = readFileSync(tracePath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  events.push({ id: 'ev-tamper-01', kind: 'shell-write', success: true });
  const modifiedBytes = Buffer.from(events.map(e => JSON.stringify(e)).join('\n') + '\n');
  c.transcript.sha256 = sha256(modifiedBytes);

  const customReader = path => {
    if (path.endsWith(c.transcript.file)) return modifiedBytes;
    return readFileSync(path);
  };

  const report = evaluateRun(run, BASE_DIR, customReader);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /CASE-09: mutation event present in refusal\/clarification trace/);
});

test('NC8: False HOST_NATIVE_INVOKED claim without dispatch event fails closed', () => {
  const run = loadCleanRun();
  const c = run.cases.find(c => c.caseId === 'CASE-04');
  c.executionMode = 'HOST_NATIVE_INVOKED';
  const report = evaluateRun(run, BASE_DIR);
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /CASE-04: no native dispatch event/);
});
