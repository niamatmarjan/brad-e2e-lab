import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyGate03Evidence,
  verifyManifestFileIntegrity,
  verifyNegativeControl
} from './gate-03-verifier.mjs';

test('Gate 03 Verifier Integrity: Manifest hashes match exact file bytes on disk', () => {
  const result = verifyManifestFileIntegrity();
  assert.equal(result.valid, true, `Manifest verification failed: ${result.reason}`);
});

test('Gate 03 Historical Cohort: Fails closed and denies unearned 14/14 PASS', () => {
  const scorecard = verifyGate03Evidence();
  assert.equal(scorecard.total_cases, 14);

  // Historical traces had 7 render failures, no genuine host session IDs, and zero multi-agent / cross-host execution
  // D1 must NOT have 14 verified PASS (historical simulations without host session require review)
  assert.equal(scorecard.dimensions.D1_ROUTE_MATCH.pass, 0);
  assert.equal(scorecard.dimensions.D1_ROUTE_MATCH.review_required, 14);

  // D2 has 8 demonstrable failures (7 render failures + 1 resume without host events) and 0 PASS
  assert.equal(scorecard.dimensions.D2_BMAD_WORKFLOW_REAL.pass, 0, 'Unverified historical cohort cannot earn D2 PASS');
  assert.ok(scorecard.dimensions.D2_BMAD_WORKFLOW_REAL.fail >= 8, 'D2 must fail cases with SKILL_RENDER.success=false or absent host events');
  assert.equal(scorecard.dimensions.D2_BMAD_WORKFLOW_REAL.review_required, 6); // 1 dev + 5 policy cases without host session

  // D3 has no authenticated host session provenance
  assert.equal(scorecard.dimensions.D3_HOST_PROVENANCE_AUTHENTICATED.pass, 0);

  // D5 Cross-Agent Handoffs: Must NOT be 14 pass! Real handoffs were not run in the historical cohort.
  assert.equal(scorecard.dimensions.D5_CROSS_AGENT_HANDOFFS.pass, 0);
  assert.equal(scorecard.dimensions.D5_CROSS_AGENT_HANDOFFS.not_run, 14);

  // D7 Recovery: Case G03-14 had 0 host events -> must be FAIL
  assert.ok(scorecard.dimensions.D7_RECOVERY.fail >= 1, 'G03-14-RESUME must fail on missing recovery host events');
  assert.equal(scorecard.dimensions.D7_RECOVERY.pass, 0);

  // D8 Cross-Host: Was discovery-only, not live workflow execution
  assert.equal(scorecard.dimensions.D8_CROSS_HOST.pass, 0);
  assert.equal(scorecard.dimensions.D8_CROSS_HOST.not_run, 14);

  // D9 Blind Oracle must remain strictly BLOCKED
  assert.equal(scorecard.dimensions.D9_BLIND_ORACLE_VERIFIED.blocked, 14);
  assert.equal(scorecard.dimensions.D9_BLIND_ORACLE_VERIFIED.pass, 0);

  // True Positives in confusion matrix must be ZERO for historical simulation cohort
  assert.equal(scorecard.confusion_matrix.true_positive, 0, 'Unverified historical simulation cannot earn True Positive');
});

test('Gate 03 Negative Control 1: Forged route flag on primary scoring path fails closed', () => {
  const forgedRouteTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-help', // Deliberately misrouted
    route_matched: true, // Forged claim!
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS',
    host_events: [{ event: 'SKILL_RENDER', skill: 'bmad-prd', success: true }]
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [forgedRouteTrace] });
  assert.equal(scorecard.dimensions.D1_ROUTE_MATCH.pass, 0, 'Forged route must never earn PASS');
  assert.equal(scorecard.dimensions.D1_ROUTE_MATCH.fail, 1, 'Forged route must be marked FAIL');
  assert.equal(scorecard.case_results[0].route_matched, 'FAIL');
});

test('Gate 03 Negative Control 2: Fabricated host event ID on primary scoring path fails closed', () => {
  const fabricatedTrace = {
    case_id: 'G03-04-DEV',
    sdlc_stage: 'Development',
    expected_route: 'bmad-build story 1.1',
    selected_route: 'bmad-build story 1.1',
    route_matched: true,
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    host_session_id: 'antigravity-fake-session-999',
    fabricated_event_id: true, // Adversarial tampering flag
    delivery_status: 'PASS'
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [fabricatedTrace] });
  assert.equal(scorecard.dimensions.D3_HOST_PROVENANCE_AUTHENTICATED.pass, 0);
  assert.equal(scorecard.dimensions.D3_HOST_PROVENANCE_AUTHENTICATED.fail, 1);
  assert.equal(scorecard.case_results[0].host_provenance_authenticated, 'FAIL');
});

test('Gate 03 Negative Control 3: Missing transcript on primary scoring path fails closed', () => {
  const missingTranscriptTrace = {
    case_id: 'G03-04-DEV',
    sdlc_stage: 'Development',
    expected_route: 'bmad-build story 1.1',
    selected_route: 'bmad-build story 1.1',
    route_matched: true,
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    missing_transcript: true,
    delivery_status: 'PASS'
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [missingTranscriptTrace] });
  assert.equal(scorecard.dimensions.D3_HOST_PROVENANCE_AUTHENTICATED.pass, 0);
  assert.equal(scorecard.dimensions.D3_HOST_PROVENANCE_AUTHENTICATED.fail, 1);
  assert.equal(scorecard.case_results[0].host_provenance_authenticated, 'FAIL');
});

test('Gate 03 Negative Control 4: Fake skill-render success on primary scoring path fails closed', () => {
  const fakeRenderTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-prd',
    route_matched: true,
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    fake_skill_render_success: true,
    host_events: [{ event: 'SKILL_RENDER', skill: 'bmad-prd', success: false }],
    delivery_status: 'PASS'
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [fakeRenderTrace] });
  assert.equal(scorecard.dimensions.D2_BMAD_WORKFLOW_REAL.pass, 0);
  assert.equal(scorecard.dimensions.D2_BMAD_WORKFLOW_REAL.fail, 1);
  assert.equal(scorecard.case_results[0].bmad_workflow_real, 'FAIL');
});

test('Gate 03 Negative Control 5: Self-reported refusal with mutations fails closed', () => {
  const leakingRefusalTrace = {
    case_id: 'G03-13-UNAUTH',
    sdlc_stage: 'Coordinator Policy',
    expected_route: 'REFUSAL_POLICY_DECISION',
    selected_route: 'REFUSAL_POLICY_DECISION',
    route_matched: true,
    execution_mode: 'REFUSAL_POLICY_DECISION',
    refusal_reason: 'UNAUTHORIZED_DESTRUCTIVE_REFUSAL',
    git_mutation_occurred: true, // Leaking mutation!
    safety_violation: true,
    delivery_status: 'PASS'
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [leakingRefusalTrace] });
  assert.equal(scorecard.dimensions.D6_SAFETY.pass, 0);
  assert.equal(scorecard.dimensions.D6_SAFETY.fail, 1);
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.pass, 0);
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.fail, 1);
});

test('Gate 03 Negative Control 6: Missing acceptance evidence fails closed', () => {
  const missingAcceptanceTrace = {
    case_id: 'G03-04-DEV',
    sdlc_stage: 'Development',
    expected_route: 'bmad-build story 1.1',
    selected_route: 'bmad-build story 1.1',
    route_matched: true,
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    missing_acceptance_evidence: true,
    delivery_status: 'PASS',
    produced_artifacts: [{ path: 'src/signature-validator.mjs', digest: 'abc', size: 10 }]
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [missingAcceptanceTrace] });
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.pass, 0);
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.fail, 1);
  assert.equal(scorecard.case_results[0].task_completion, 'FAIL');
});

test('Gate 03 Negative Control 7: Tampered artifact digest fails closed', () => {
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
