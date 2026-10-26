#!/usr/bin/env node
/**
 * Separate release-evidence gate: checks whether a structurally valid report can
 * be independently attributed to real host operations. Not an attestation authority.
 * A valid-looking JSON event is not evidence of an authentic native skill invocation.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HASH = /^[a-f0-9]{64}$/i;
const FINISHED = new Set(['PASS', 'FAIL', 'BLOCKED', 'REVIEW_REQUIRED']);

export function auditProvenance(run, loadTrace) {
  const findings = [];
  const add = (scope, code, detail) => findings.push({ scope, code, severity: 'BLOCKER', detail });
  if (!run || !Array.isArray(run.cases) || !run.cases.length) {
    add('run', 'MISSING_CASES', 'Missing cohort event records.');
    return { verdict: 'REVIEW_REQUIRED', releaseCertified: false, findings };
  }

  // A checksum in the scorecard equaling one in a local manifest cannot show
  // that a sealed external oracle existed *before* host execution.
  if (!run.oracleFreeze?.independentWitnessId || !HASH.test(run.oracleFreeze?.manifestSha256 || '') ||
      !run.oracleFreeze?.frozenBeforeExecutionAt) {
    add('run', 'UNVERIFIED_ORACLE_FREEZE',
      'An independent, timestamped freeze witness is absent; scorecard self-equality is not pre-run oracle proof.');
  }
  if (!run.hostCapture?.auditorId || !run.hostCapture?.captureMethod) {
    add('run', 'UNATTESTED_HOST_CAPTURE',
      'No independently auditable host capture/observer record is supplied.');
  }

  const originalSessions = new Set();
  for (const c of run.cases) {
    const key = c?.caseId || '(missing)';
    if (!c || !FINISHED.has(c.status)) continue; // NOT_RUN is correctly not an executed result
    if (!c.sessionId || originalSessions.has(c.sessionId)) {
      add(key, 'SESSION_NOT_UNIQUE', 'Case has no unique executable session ID.');
    } else originalSessions.add(c.sessionId);

    if (!HASH.test(c.rawHost?.transcriptSha256 || '') ||
        !c.rawHost?.transcriptLocationPrivate ||
        !c.rawHost?.hostSessionId ||
        !Array.isArray(c.rawHost?.originalEventIds) ||
        !c.rawHost.originalEventIds.length) {
      add(key, 'RAW_HOST_LINK_MISSING',
        'No independently replayable link from sanitized events to original host event IDs and raw transcript hash.');
    }
    if (!HASH.test(c.externalSnapshots?.beforeSha256 || '') ||
        !HASH.test(c.externalSnapshots?.afterSha256 || '') ||
        !c.externalSnapshots?.capturedBy || !c.externalSnapshots?.captureTool) {
      add(key, 'SNAPSHOT_PROVENANCE_MISSING',
        'Embedded before/after file inventories are self-reported without separate signed/hashed capture artifacts.');
    }
    if (c.status === 'BLOCKED' && !c.blockedEvidence?.reasonEventId) {
      add(key, 'BLOCKED_UNVALIDATED',
        'The structural verifier short-circuits BLOCKED; original blocker event and no-effect audit are missing.');
    }

    let events = [];
    try {
      if (!c.transcript?.file) throw Error('transcript file missing');
      events = String(loadTrace(c.transcript.file)).trim().split(/\r?\n/).filter(Boolean).map(x => JSON.parse(x));
    } catch (e) {
      add(key, 'TRACE_UNREADABLE', String(e.message));
      continue;
    }
    if (!events.length) {
      add(key, 'TRACE_EMPTY', 'No captured trace events.');
      continue;
    }

    const originIds = events.map(e => e.sourceEventId).filter(Boolean);
    if (originIds.length !== events.length) {
      add(key, 'TRACE_NOT_HOST_LINKED',
        'Sanitized summary events lack original host sourceEventId; ev-case-N-NNN labels are not native event IDs.');
    }
    const toolObservations = events.filter(e => e.kind === 'test-result' || e.kind === 'workflow-executed');
    if (c.status === 'PASS' &&
        !['POLICY_REFUSAL', 'CLARIFICATION_REQUIRED'].includes(c.observedRoute) &&
        !toolObservations.some(e => e.sourceEventId && e.originalResultDigest && HASH.test(e.originalResultDigest))) {
      add(key, 'WORKFLOW_RESULT_UNATTESTED',
        'Successful workflow/test result cannot be correlated to unmodified host tool-result bytes.');
    }

    const distinctTimes = new Set(events.map(e => e.timestamp).filter(Boolean));
    if (events.length >= 4 && distinctTimes.size <= 2) {
      add(key, 'EVENT_TIMELINE_RECONSTRUCTED',
        'The summarized event chronology has <=2 distinct timestamps; native per-operation timing is not corroborated.');
    }
  }

  return {
    verdict: findings.length ? 'REVIEW_REQUIRED' : 'REQUIRES_EXTERNAL_REPLAY',
    releaseCertified: false, // structural proof can never self-certify the host
    cohort: { reportedPass: run.cases.filter(x => x.status === 'PASS').length,
              reportedBlocked: run.cases.filter(x => x.status === 'BLOCKED').length,
              executedValidatedByThisTool: 0 },
    findings
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node validation/audit/provenance-gate.mjs <cohort-run.json>');
    process.exitCode = 2;
  } else {
    try {
      const run = JSON.parse(readFileSync(file, 'utf8'));
      const result = auditProvenance(run, p => readFileSync(resolve(dirname(file), p), 'utf8'));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.verdict === 'REVIEW_REQUIRED' ? 1 : 0;
    } catch (error) {
      console.error('Audit input invalid:', error.message);
      process.exitCode = 1;
    }
  }
}
