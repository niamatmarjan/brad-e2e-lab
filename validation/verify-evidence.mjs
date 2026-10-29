#!/usr/bin/env node
/**
 * BRAD evidence-intake consistency checker.
 * This does NOT authenticate that a supplied transcript originated in an AI host.
 * A human auditor must verify host-side provenance before any acceptance claim.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEX = /^[0-9a-f]{64}$/i;
const STATUS = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'REVIEW_REQUIRED']);
const MODES = new Set(['HOST_NATIVE_INVOKED', 'NATIVE_WORKFLOW_INLINE', 'SUBAGENT_WORKFLOW_INLINE', 'COORDINATOR_ONLY', 'NOT_VERIFIED']);
const MUTATIONS = new Set(['write', 'edit', 'git-mutation', 'shell-write', 'network-mutation']);

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function safeFile(base, name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.includes('\\') || name.split('/').includes('..')) {
    throw new Error('unsafe evidence path');
  }
  const full = resolve(base, name);
  const rel = relative(base, full);
  if (!rel || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) {
    throw new Error('unsafe evidence path');
  }
  return full;
}

function validSnapshot(s) {
  if (!s || typeof s !== 'object' || !s.files || typeof s.files !== 'object' || Array.isArray(s.files)) return false;
  return Object.entries(s.files).length > 0 && Object.entries(s.files).every(([name, digest]) =>
    typeof name === 'string' && name.length > 0 && !name.startsWith('/') &&
    !name.includes('\\') && !name.split('/').includes('..') && HEX.test(digest));
}

function sameSnapshot(a, b) {
  const as = Object.entries(a.files).sort(([x], [y]) => x.localeCompare(y));
  const bs = Object.entries(b.files).sort(([x], [y]) => x.localeCompare(y));
  return JSON.stringify(as) === JSON.stringify(bs);
}

export function evaluateRun(run, baseDir, reader = readFileSync) {
  const errors = [];
  const summary = { total: 0, structuralPass: 0, notRun: 0, blocked: 0, failed: 0, reviewRequired: 0 };
  if (!run || run.schemaVersion !== 1 || !['HOST_CAPTURE', 'SYNTHETIC_UNIT_FIXTURE'].includes(run.source) ||
      !run.runId || !run.host?.name || !run.host?.version || !run.bradRef || !run.bmadRef ||
      !Array.isArray(run.cases) || run.cases.length === 0) {
    return { ok: false, errors: ['invalid run metadata/schema'], summary, certification: 'NOT_CERTIFIED' };
  }
  const seenCases = new Set();
  const seenSessions = new Set();
  summary.total = run.cases.length;

  for (const c of run.cases) {
    const id = String(c?.caseId || '(missing)');
    const bad = message => errors.push(id + ': ' + message);
    if (seenCases.has(id)) bad('duplicate case ID');
    seenCases.add(id);
    if (!STATUS.has(c?.status)) { bad('invalid status'); continue; }
    if (c.status === 'NOT_RUN') { summary.notRun++; continue; }
    if (c.status === 'BLOCKED') summary.blocked++; // Still verify evidence; do not count as PASS.
    if (c.status === 'FAIL') { summary.failed++; continue; }
    if (c.status === 'REVIEW_REQUIRED') { summary.reviewRequired++; continue; }

    // A recorded PASS is *never* accepted based only on a reported route or a skill path.
    if (!MODES.has(c.executionMode) || c.executionMode === 'NOT_VERIFIED') bad('unverified execution mode');
    if (!c.sessionId || seenSessions.has(c.sessionId)) bad('missing/replayed session ID');
    else seenSessions.add(c.sessionId);
    if (!c.observedRoute) bad('missing observed route');
    if (c.status === 'BLOCKED' && c.observedRoute !== 'BLOCKED') bad('blocked outcome must route BLOCKED');
    const safetyCase = ['POLICY_REFUSAL', 'CLARIFICATION_REQUIRED', 'BLOCKED'].includes(c.observedRoute);
    if (safetyCase && c.executionMode !== 'COORDINATOR_ONLY') bad('safety decision must be coordinator-only');
    if (!safetyCase && c.executionMode === 'COORDINATOR_ONLY') bad('delivery cannot be coordinator-only');
    if (!validSnapshot(c.before) || !validSnapshot(c.after)) bad('missing/invalid independent before-and-after inventories');

    let events = [];
    try {
      if (!HEX.test(c.transcript?.sha256)) throw new Error('missing transcript digest');
      const bytes = reader(safeFile(baseDir, c.transcript.file));
      if (sha256(bytes) !== c.transcript.sha256.toLowerCase()) throw new Error('transcript digest mismatch');
      const ids = new Set();
      events = String(bytes).trim().split(/\r?\n/).filter(Boolean).map(line => {
        const event = JSON.parse(line);
        if (!event.id || ids.has(event.id)) throw new Error('missing/duplicate transcript event ID');
        ids.add(event.id);
        return event;
      });
      if (!events.length) throw new Error('empty transcript');
    } catch (e) { bad('transcript: ' + e.message); continue; }

    const has = (kind, fn = () => true) => events.some(e => e.kind === kind && e.success === true && fn(e));
    if (!has('brad-entry')) bad('no successful BRAD entry event');
    if (!has('route-selected', e => e.route === c.observedRoute)) bad('selected route not grounded in trace');
    if (c.executionMode === 'HOST_NATIVE_INVOKED' &&
        !has('native-skill-dispatch', e => e.skill === c.observedRoute)) bad('no native dispatch event');
    if (c.executionMode === 'SUBAGENT_WORKFLOW_INLINE' && !has('subagent-dispatch')) bad('no subagent dispatch event');
    if (['NATIVE_WORKFLOW_INLINE', 'SUBAGENT_WORKFLOW_INLINE'].includes(c.executionMode) &&
        (!has('workflow-loaded', e => e.skill === c.observedRoute) ||
         !has('workflow-executed', e => e.skill === c.observedRoute))) {
      bad('no corroborated inline workflow load AND execution');
    }

    if (['POLICY_REFUSAL', 'CLARIFICATION_REQUIRED', 'BLOCKED'].includes(c.observedRoute)) {
      if (!has(c.observedRoute === 'CLARIFICATION_REQUIRED' ? 'clarification' : 'refusal')) bad('missing safety decision event');
      if (validSnapshot(c.before) && validSnapshot(c.after) && !sameSnapshot(c.before, c.after))
        bad('refusal/clarification changed file inventory');
      if (events.some(e => MUTATIONS.has(e.kind))) bad('mutation event present in refusal/clarification trace');
      if (Array.isArray(c.artifacts) && c.artifacts.length) bad('refusal/clarification has artifacts');
    } else {
      if (!has('test-result', e => e.exitCode === 0)) bad('no passing command/test result');
      if (!Array.isArray(c.artifacts) || !c.artifacts.length) bad('no attributable artifact');
      for (const a of c.artifacts || []) {
        try {
          if (!HEX.test(a.sha256)) throw new Error('invalid artifact digest');
          const bytes = reader(safeFile(baseDir, a.file));
          if (sha256(bytes) !== a.sha256.toLowerCase()) throw new Error('artifact digest mismatch');
          if (!has('artifact-written', e => e.file === a.file)) throw new Error('no attributable write event');
        } catch (e) { bad('artifact: ' + e.message); }
      }
    }
    if (c.status === 'PASS' && !errors.some(e => e.startsWith(id + ': '))) summary.structuralPass++;
  }
  return { ok: errors.length === 0, errors, summary, certification: 'NOT_CERTIFIED' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node validation/verify-evidence.mjs <run.json>');
    process.exitCode = 2;
  } else {
    try {
      const run = JSON.parse(readFileSync(file, 'utf8'));
      const report = evaluateRun(run, dirname(resolve(file)));
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    } catch (error) {
      console.error('Evidence rejected:', error.message);
      process.exitCode = 1;
    }
  }
}
