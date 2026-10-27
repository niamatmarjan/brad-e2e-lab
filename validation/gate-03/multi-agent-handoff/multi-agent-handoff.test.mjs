import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeFullMultiAgentHandoff,
  testInterruptedSessionRecovery,
  testDuplicateTaskPrevention,
  testConcurrentBranchCollision
} from './multi-agent-handoff.mjs';

test('Gate 03 Handoff 1: Full multi-agent lifecycle handoff (PM -> BA -> Arch -> Dev -> QA -> Reviewer -> Governance)', () => {
  const audit = executeFullMultiAgentHandoff();
  assert.equal(audit.length, 10);
  for (const step of audit) {
    assert.equal(step.verified, true, `Step ${step.step} should be verified true`);
  }
  const govStep = audit.find(s => s.step === '10_GOVERNANCE_GATE');
  assert.equal(govStep.disposition, 'RELEASE_AUTHORIZED');
});

test('Gate 03 Handoff 2: Reviewer rejection loop on QA defect DEFECT-G03-001 enforces remediation before approval', () => {
  const audit = executeFullMultiAgentHandoff();
  const rejStep = audit.find(s => s.step === '6_REVIEWER_REJECTION');
  assert.equal(rejStep.disposition, 'REJECTED');

  const remStep = audit.find(s => s.step === '7_DEV_REMEDIATION');
  assert.equal(remStep.verified, true);

  const closureStep = audit.find(s => s.step === '8_QA_DEFECT_CLOSED');
  assert.equal(closureStep.defectId, 'DEFECT-G03-001');

  const appStep = audit.find(s => s.step === '9_REVIEWER_APPROVAL');
  assert.equal(appStep.disposition, 'APPROVED');
});

test('Gate 03 Resilience 1: Interrupted-session recovery restores active work without duplicate branch creation', () => {
  const recovery = testInterruptedSessionRecovery();
  assert.equal(recovery.interruption_detected, true);
  assert.equal(recovery.branch_preserved, true);
  assert.equal(recovery.duplicate_branch_prevented, true);
  assert.equal(recovery.recovery_completed, true);
  assert.equal(recovery.recovery_classification, 'NODE_WORKER_SIGKILL_FIXTURE_PASS');
});

test('Gate 03 Resilience 2: Duplicate task request is handled idempotently without re-execution or duplicate PR', () => {
  const result = testDuplicateTaskPrevention();
  assert.equal(result.duplicate_prevented, true);
  assert.equal(result.action, 'NO_OP_IDEMPOTENT');
});

test('Gate 03 Resilience 3: Concurrent branch collision is caught and cleanly rolled back', () => {
  const collision = testConcurrentBranchCollision();
  assert.equal(collision.conflict_detected, true);
  assert.equal(collision.safe_rollback_performed, true);
  assert.equal(collision.concurrency_classification, 'GIT_MERGE_CONFLICT_FIXTURE_PASS');
});
