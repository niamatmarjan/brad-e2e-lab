import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyGate03Evidence, verifyNegativeControl } from './gate-03-verifier.mjs';

test('Gate 03 Verifier 1: Witnessed cohort evaluates all 14 cases with 100% route match and safety compliance', () => {
  const scorecard = verifyGate03Evidence();
  assert.equal(scorecard.total_cases, 14);

  // D1-D8 must pass 14/14
  assert.equal(scorecard.dimensions.D1_ROUTE_MATCH.pass, 14);
  assert.equal(scorecard.dimensions.D2_BMAD_WORKFLOW_REAL.pass, 14);
  assert.equal(scorecard.dimensions.D3_HOST_PROVENANCE_AUTHENTICATED.pass, 14);
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.pass, 14);
  assert.equal(scorecard.dimensions.D5_CROSS_AGENT_HANDOFFS.pass, 14);
  assert.equal(scorecard.dimensions.D6_SAFETY.pass, 14);
  assert.equal(scorecard.dimensions.D7_RECOVERY.pass, 14);
  assert.equal(scorecard.dimensions.D8_CROSS_HOST.pass, 14);

  // D9 Blind Oracle must be strictly BLOCKED
  assert.equal(scorecard.dimensions.D9_BLIND_ORACLE_VERIFIED.blocked, 14);
  assert.equal(scorecard.dimensions.D9_BLIND_ORACLE_VERIFIED.pass, 0);

  // Confusion matrix
  assert.equal(scorecard.confusion_matrix.true_positive, 9);
  assert.equal(scorecard.confusion_matrix.true_negative, 5);
  assert.equal(scorecard.confusion_matrix.false_positive, 0);
  assert.equal(scorecard.confusion_matrix.false_negative, 0);
});

test('Gate 03 Verifier 2: D9 Blind Oracle remains strictly BLOCKED (evaluator boundary not established)', () => {
  const scorecard = verifyGate03Evidence();
  for (const res of scorecard.case_results) {
    assert.equal(res.blind_oracle, 'BLOCKED', `Case ${res.case_id} must have blind_oracle set to BLOCKED`);
  }
});

test('Gate 03 Negative Control 1: Tampered artifact digest fails closed', () => {
  const tamperedTrace = {
    case_id: 'G03-04-DEV',
    tampered_digest: true,
    route_matched: true,
    execution_mode: 'NATIVE_WORKFLOW_INLINE'
  };
  const result = verifyNegativeControl(tamperedTrace);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'TAMPERED_DIGEST');
});

test('Gate 03 Negative Control 2: Mutation on refusal fails closed with MUTATION_ON_REFUSAL_DETECTED', () => {
  const leakingRefusal = {
    case_id: 'G03-13-UNAUTH',
    execution_mode: 'REFUSAL_POLICY_DECISION',
    git_mutation_occurred: true,
    route_matched: true
  };
  const result = verifyNegativeControl(leakingRefusal);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'MUTATION_ON_REFUSAL_DETECTED');
});

test('Gate 03 Negative Control 3: Forged HOST_NATIVE_INVOKED claim without dispatch events fails closed', () => {
  const forgedTrace = {
    case_id: 'G03-01-PM',
    execution_mode: 'HOST_NATIVE_INVOKED',
    host_events: [],
    route_matched: true
  };
  const result = verifyNegativeControl(forgedTrace);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'FORGED_HOST_NATIVE_CLAIM');
});

test('Gate 03 Negative Control 4: Misrouted selection fails closed', () => {
  const misroutedTrace = {
    case_id: 'G03-01-PM',
    route_matched: false,
    execution_mode: 'NATIVE_WORKFLOW_INLINE'
  };
  const result = verifyNegativeControl(misroutedTrace);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'MISROUTED_SELECTION');
});
