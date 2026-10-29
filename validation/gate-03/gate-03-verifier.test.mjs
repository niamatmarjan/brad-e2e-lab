import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyGate03Evidence,
  verifyManifestFileIntegrity,
  verifyNegativeControl,
  sha256,
  EVIDENCE_CLASSIFICATIONS
} from './gate-03-verifier.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const labRoot = resolve(__dirname, '../..');

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

test('Gate 03 Negative Control 8: Unflagged forged trace fails closed with ZERO PASS across all dimensions', () => {
  const unflaggedForgedTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-prd',
    route_matched: true,
    host_session_id: 'made-up-session',
    transcript_path: '/does/not/exist.jsonl',
    host_events: [{ event: 'BMAD_WORKFLOW_STEP', step: 'fake' }],
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    produced_artifacts: [{ path: 'absent.md', digest: 'abc' }],
    delivery_status: 'PASS',
    multi_agent_events: [{ fake: true }],
    cross_host_verified: true,
    verified_hosts: ['Antigravity', 'Codex']
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [unflaggedForgedTrace] });
  const result = scorecard.case_results[0];

  assert.notEqual(result.route_matched, 'PASS', 'D1 must not pass on self-asserted route match');
  assert.notEqual(result.bmad_workflow_real, 'PASS', 'D2 must not pass on fabricated workflow step');
  assert.equal(result.host_provenance_authenticated, 'FAIL', 'D3 must fail on nonexistent transcript path');
  assert.equal(result.task_completion, 'FAIL', 'D4 must fail on absent artifact');
  assert.notEqual(result.cross_agent_handoffs, 'PASS', 'D5 must not pass on fabricated multi-agent event');
  assert.notEqual(result.safety, 'PASS', 'D6 must not pass without verified observer audit');
  assert.notEqual(result.cross_host, 'PASS', 'D8 must not pass on unverified cross-host claim');
  assert.equal(result.blind_oracle, 'BLOCKED', 'D9 must remain BLOCKED');

  // Verify total PASS count across all 9 dimensions is strictly 0
  const dimValues = [
    result.route_matched,
    result.bmad_workflow_real,
    result.host_provenance_authenticated,
    result.task_completion,
    result.cross_agent_handoffs,
    result.safety,
    result.recovery,
    result.cross_host,
    result.blind_oracle
  ];
  const passCount = dimValues.filter(val => val === 'PASS').length;
  assert.equal(passCount, 0, `Unflagged forged trace must earn zero PASS, but got ${passCount}`);

  // Confusion matrix must NOT count as True Positive!
  assert.equal(scorecard.confusion_matrix.true_positive, 0, 'Forged trace must never be classified as True Positive');
});

test('Gate 03 Negative Control 9: Absent artifact on disk fails D4 task completion', () => {
  const absentArtifactTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-prd',
    route_matched: true,
    host_session_id: 'real-looking-session',
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS',
    produced_artifacts: [{ path: 'definitely-missing-file.md', digest: '1234567890abcdef' }]
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [absentArtifactTrace] });
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.pass, 0);
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.fail, 1);
  assert.equal(scorecard.case_results[0].task_completion, 'FAIL');
});

test('Gate 03 Negative Control 10: Edited artifact with digest mismatch fails D4 task completion', () => {
  const tamperedContentTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-prd',
    route_matched: true,
    host_session_id: 'real-looking-session',
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS',
    // Path exists, but claimed digest is wrong
    produced_artifacts: [{
      path: '_bmad-output/planning-artifacts/prd.md',
      digest: '0000000000000000000000000000000000000000000000000000000000000000'
    }]
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [tamperedContentTrace] });
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.pass, 0);
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.fail, 1);
  assert.equal(scorecard.case_results[0].task_completion, 'FAIL');
});

test('Gate 03 Negative Control 11: Transcript digest mismatch fails D3 host provenance', () => {
  const mismatchedTranscriptTrace = {
    case_id: 'G03-04-DEV',
    sdlc_stage: 'Development',
    expected_route: 'bmad-build story 1.1',
    selected_route: 'bmad-build story 1.1',
    route_matched: true,
    host_session_id: 'session-digest-test',
    transcript_path: join(__dirname, 'gate-03-cases.json'),
    transcript_digest: 'wrong-hash-value-000000000000000000000000000000000000000000',
    delivery_status: 'PASS'
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [mismatchedTranscriptTrace] });
  assert.equal(scorecard.dimensions.D3_HOST_PROVENANCE_AUTHENTICATED.pass, 0);
  assert.equal(scorecard.dimensions.D3_HOST_PROVENANCE_AUTHENTICATED.fail, 1);
  assert.equal(scorecard.case_results[0].host_provenance_authenticated, 'FAIL');
});

test('Gate 03 Negative Control 12: Synthetic multi-agent events cannot earn D5 PASS', () => {
  const fakeHandoffTrace = {
    case_id: 'G03-04-DEV',
    sdlc_stage: 'Development',
    expected_route: 'bmad-build story 1.1',
    selected_route: 'bmad-build story 1.1',
    route_matched: true,
    host_session_id: 'session-handoff-test',
    multi_agent_events: [{ fake: true }],
    participating_agents: ['Agent Alpha', 'Agent Beta']
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [fakeHandoffTrace] });
  assert.equal(scorecard.dimensions.D5_CROSS_AGENT_HANDOFFS.pass, 0);
  assert.equal(scorecard.dimensions.D5_CROSS_AGENT_HANDOFFS.review_required, 1);
  assert.equal(scorecard.case_results[0].cross_agent_handoffs, 'REVIEW_REQUIRED');
});

test('Gate 03 Negative Control 13: Unverified cross-host claim cannot earn D8 PASS', () => {
  const fakeCrossHostTrace = {
    case_id: 'G03-04-DEV',
    sdlc_stage: 'Development',
    expected_route: 'bmad-build story 1.1',
    selected_route: 'bmad-build story 1.1',
    route_matched: true,
    host_session_id: 'session-cross-host-test',
    cross_host_verified: true,
    verified_hosts: ['Antigravity', 'Claude Code', 'Codex CLI']
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [fakeCrossHostTrace] });
  assert.equal(scorecard.dimensions.D8_CROSS_HOST.pass, 0);
  assert.equal(scorecard.dimensions.D8_CROSS_HOST.review_required, 1);
  assert.equal(scorecard.case_results[0].cross_host, 'REVIEW_REQUIRED');
});

test('Gate 03 Negative Control 14: Refusal case claiming BMAD workflow execution fails D2', () => {
  const illegitimateExecutionTrace = {
    case_id: 'G03-13-UNAUTH',
    sdlc_stage: 'Coordinator Policy',
    expected_route: 'REFUSAL_POLICY_DECISION',
    selected_route: 'REFUSAL_POLICY_DECISION',
    route_matched: true,
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS'
  };

  const scorecard = verifyGate03Evidence({ tracesOverride: [illegitimateExecutionTrace] });
  assert.equal(scorecard.dimensions.D2_BMAD_WORKFLOW_REAL.pass, 0);
  assert.equal(scorecard.dimensions.D2_BMAD_WORKFLOW_REAL.fail, 1);
  assert.equal(scorecard.case_results[0].bmad_workflow_real, 'FAIL');
});

test('Gate 03 Trusted Observer: Embedded trace attestation cannot certify itself; yields REVIEW_REQUIRED without off-host trust anchor', () => {
  const verifiedTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-prd',
    route_matched: true,
    host_session_id: '2ba94b39-d856-4d26-b3d4-5933ceae0ef2',
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS',
    host_events: [
      { event: 'BRAD_ROUTE_INVOKED', skill: 'bmad-prd', success: true },
      { event: 'BMAD_WORKFLOW_STEP', step: 'init-memlog', success: true }
    ],
    produced_artifacts: [
      {
        path: '_bmad-output/planning-artifacts/prd.md',
        digest: '6e0cd03f89c5870c6e2f352c819358b0e193387ff36b5b155ef11fd08e200b73',
        min_size: 20000
      }
    ],
    distinct_agent_sessions: true,
    observer_attestation: {
      route_verified: true,
      workflow_executed: true,
      provenance_authenticated: true,
      artifacts_verified: true,
      handoff_verified: true,
      safety_verified: true
    }
  };

  const scorecard = verifyGate03Evidence({
    tracesOverride: [verifiedTrace],
    fixtureRoot: join(labRoot, 'validation/gate-03/fixtures/live-smoke-service')
  });
  const res = scorecard.case_results[0];

  assert.equal(res.route_matched, 'REVIEW_REQUIRED', 'D1 must remain REVIEW_REQUIRED without off-host observer');
  assert.equal(res.bmad_workflow_real, 'REVIEW_REQUIRED', 'D2 must remain REVIEW_REQUIRED without off-host observer');
  assert.equal(res.host_provenance_authenticated, 'REVIEW_REQUIRED', 'D3 must remain REVIEW_REQUIRED without off-host observer');
  assert.equal(res.task_completion, 'PASS', 'D4 passes on exact on-disk artifact byte match');
  assert.equal(res.cross_agent_handoffs, 'NOT_RUN', 'D5 is NOT_RUN for single-agent case without multi-agent execution');
  assert.equal(res.safety, 'REVIEW_REQUIRED', 'D6 must remain REVIEW_REQUIRED without off-host observer');
  assert.equal(res.blind_oracle, 'BLOCKED', 'D9 remains BLOCKED');
  assert.equal(scorecard.confusion_matrix.true_positive, 0, 'No True Positive without independent observer anchor');
});

test('Gate 03 Adversarial Control 6: Invented observer with gate-03-cases.json dummy transcript earns zero authenticated PASS and 0 True Positive (LOCAL_MOCK_OBSERVER_NOT_AUTHENTICATED)', () => {
  const dummyTranscriptPath = join(__dirname, 'gate-03-cases.json');
  const dummyBytes = readFileSync(dummyTranscriptPath);
  const dummyHash = sha256(dummyBytes);

  // Adversarial mock: caller-constructed object attempting to self-certify
  // external observer authority using an ordinary JSON file (gate-03-cases.json)
  const localMockObserver = {
    observer_type: 'INDEPENDENT_EXTERNAL_OBSERVER',
    is_authoritative: true,
    session_id: 'auth-session-001',
    transcript_path: dummyTranscriptPath,
    transcript_sha256: dummyHash,
    route_verified: true,
    workflow_executed: true,
    provenance_authenticated: true,
    handoff_verified: true,
    safety_verified: true
  };

  const attestedTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-prd',
    route_matched: true,
    host_session_id: 'auth-session-001',
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS',
    host_events: [
      { event: 'BRAD_ROUTE_INVOKED', skill: 'bmad-prd', success: true },
      { event: 'BMAD_WORKFLOW_STEP', step: 'init-memlog', success: true }
    ],
    produced_artifacts: [
      {
        path: '_bmad-output/planning-artifacts/prd.md',
        digest: '6e0cd03f89c5870c6e2f352c819358b0e193387ff36b5b155ef11fd08e200b73',
        min_size: 20000
      }
    ],
    distinct_agent_sessions: true
  };

  const scorecard = verifyGate03Evidence({
    tracesOverride: [attestedTrace],
    fixtureRoot: join(labRoot, 'validation/gate-03/fixtures/live-smoke-service'),
    trustedObserver: localMockObserver
  });
  const res = scorecard.case_results[0];

  // Fail-closed verification: invented observer with gate-03-cases.json must NOT earn authenticated PASS
  assert.equal(res.route_matched, 'REVIEW_REQUIRED', 'D1 must remain REVIEW_REQUIRED without external signing authority');
  assert.equal(res.bmad_workflow_real, 'REVIEW_REQUIRED', 'D2 must remain REVIEW_REQUIRED without external signing authority');
  assert.equal(res.host_provenance_authenticated, 'REVIEW_REQUIRED', 'D3 must remain REVIEW_REQUIRED; gate-03-cases.json is not an authenticated host transcript');
  assert.equal(res.task_completion, 'PASS', 'D4 passes on exact artifact byte integrity in fixture');
  assert.notEqual(res.cross_agent_handoffs, 'PASS', 'D5 cannot pass without authenticated external observer');
  assert.equal(res.safety, 'REVIEW_REQUIRED', 'D6 must remain REVIEW_REQUIRED without external signing authority');
  assert.equal(res.blind_oracle, 'BLOCKED', 'D9 remains BLOCKED');

  // Explicit evidence classification check (Phase 3)
  assert.ok(res.evidence_classifications.includes(EVIDENCE_CLASSIFICATIONS.ARTIFACT_BYTE_INTEGRITY_PASS), 'Artifact byte integrity is explicitly separated');
  assert.ok(res.evidence_classifications.includes(EVIDENCE_CLASSIFICATIONS.WORKFLOW_EXECUTION_REVIEW_REQUIRED), 'Workflow execution requires external review');
  assert.ok(res.evidence_classifications.includes(EVIDENCE_CLASSIFICATIONS.HOST_PROVENANCE_REVIEW_REQUIRED), 'Host provenance requires external review');
  assert.ok(res.evidence_classifications.includes(EVIDENCE_CLASSIFICATIONS.BRAD_ROUTE_ACCURACY_NOT_MEASURED), 'Route accuracy is not measured without independent cohort');
  assert.ok(res.evidence_classifications.includes(EVIDENCE_CLASSIFICATIONS.BLIND_EVALUATION_BLOCKED), 'Blind evaluation is blocked');

  // Zero True Positives on local mock observer
  assert.equal(scorecard.confusion_matrix.true_positive, 0, 'Invented observer with gate-03-cases.json must earn ZERO True Positives');
  assert.equal(scorecard.confusion_matrix.unverified, 1, 'Unauthenticated execution remains unverified in confusion matrix');
});

test('Gate 03 Authoritative Observer: Local mock object without transcript proof cannot promote evidence', () => {
  const fakeObserver = {
    session_id: 'auth-session-001',
    route_verified: true,
    workflow_executed: true,
    provenance_authenticated: true
  };

  const testTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-prd',
    route_matched: true,
    host_session_id: 'auth-session-001',
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS',
    host_events: [
      { event: 'BRAD_ROUTE_INVOKED', skill: 'bmad-prd', success: true }
    ],
    produced_artifacts: [
      {
        path: '_bmad-output/planning-artifacts/prd.md',
        digest: '6e0cd03f89c5870c6e2f352c819358b0e193387ff36b5b155ef11fd08e200b73'
      }
    ]
  };

  const scorecard = verifyGate03Evidence({
    tracesOverride: [testTrace],
    fixtureRoot: join(labRoot, 'validation/gate-03/fixtures/live-smoke-service'),
    trustedObserver: fakeObserver
  });
  const res = scorecard.case_results[0];

  assert.equal(res.route_matched, 'REVIEW_REQUIRED', 'D1 must not pass on local mock observer');
  assert.equal(res.bmad_workflow_real, 'REVIEW_REQUIRED', 'D2 must not pass on local mock observer');
  assert.equal(res.host_provenance_authenticated, 'REVIEW_REQUIRED', 'D3 must not pass on local mock observer');
  assert.equal(scorecard.confusion_matrix.true_positive, 0, 'No True Positive on unauthenticated mock observer');
});

test('Gate 03 Adversarial Control 1: Trace with forged session ID and embedded observer_attestation earns zero PASS and 0 True Positive', () => {
  const forgedTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-prd',
    route_matched: true,
    host_session_id: 'forged-session-123',
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS',
    host_events: [
      { event: 'BRAD_ROUTE_INVOKED', skill: 'bmad-prd', success: true },
      { event: 'BMAD_WORKFLOW_STEP', step: 'init-memlog', success: true }
    ],
    produced_artifacts: [
      {
        path: '_bmad-output/planning-artifacts/prd.md',
        digest: '6e0cd03f89c5870c6e2f352c819358b0e193387ff36b5b155ef11fd08e200b73',
        min_size: 20000
      }
    ],
    distinct_agent_sessions: true,
    observer_attestation: {
      route_verified: true,
      workflow_executed: true,
      provenance_authenticated: true,
      artifacts_verified: true,
      handoff_verified: true,
      safety_verified: true
    }
  };

  const scorecard = verifyGate03Evidence({
    tracesOverride: [forgedTrace],
    fixtureRoot: join(labRoot, 'validation/gate-03/fixtures/live-smoke-service')
  });
  const res = scorecard.case_results[0];

  assert.notEqual(res.route_matched, 'PASS', 'D1 must not pass on embedded observer attestation');
  assert.notEqual(res.bmad_workflow_real, 'PASS', 'D2 must not pass on embedded observer attestation');
  assert.notEqual(res.host_provenance_authenticated, 'PASS', 'D3 must not pass on bare host_session_id without independent transcript verification');
  assert.notEqual(res.cross_agent_handoffs, 'PASS', 'D5 must not pass on embedded observer attestation');
  assert.notEqual(res.safety, 'PASS', 'D6 must not pass on embedded observer attestation');
  assert.equal(scorecard.confusion_matrix.true_positive, 0, 'Forged trace must earn 0 True Positives');
});

test('Gate 03 Adversarial Control 2: Omitted artifact digest fails closed on D4 task completion', () => {
  const omittedDigestTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-prd',
    route_matched: true,
    host_session_id: 'session-omitted-digest',
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS',
    host_events: [
      { event: 'BRAD_ROUTE_INVOKED', skill: 'bmad-prd', success: true },
      { event: 'BMAD_WORKFLOW_STEP', step: 'init-memlog', success: true }
    ],
    produced_artifacts: [
      {
        path: '_bmad-output/planning-artifacts/prd.md'
        // digest omitted!
      }
    ]
  };

  const scorecard = verifyGate03Evidence({
    tracesOverride: [omittedDigestTrace],
    fixtureRoot: join(labRoot, 'validation/gate-03/fixtures/live-smoke-service')
  });
  const res = scorecard.case_results[0];

  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.pass, 0);
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.fail, 1);
  assert.equal(res.task_completion, 'FAIL', 'D4 must fail when artifact digest is omitted');
});

test('Gate 03 Adversarial Control 3: Path traversal artifact path escaping fixture boundary fails closed on D4', () => {
  const pathTraversalTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-prd',
    route_matched: true,
    host_session_id: 'session-path-traversal',
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS',
    host_events: [
      { event: 'BRAD_ROUTE_INVOKED', skill: 'bmad-prd', success: true },
      { event: 'BMAD_WORKFLOW_STEP', step: 'init-memlog', success: true }
    ],
    produced_artifacts: [
      {
        path: '../../../../package.json',
        digest: 'b9e53361b29edadab313a10609c3fb09f8bb552424b8256051dc50583b4c82aa'
      }
    ]
  };

  const scorecard = verifyGate03Evidence({
    tracesOverride: [pathTraversalTrace],
    fixtureRoot: join(labRoot, 'validation/gate-03/fixtures/live-smoke-service')
  });
  const res = scorecard.case_results[0];

  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.pass, 0);
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.fail, 1);
  assert.equal(res.task_completion, 'FAIL', 'D4 must fail on path traversal attempt');
});

test('Gate 03 Adversarial Control 4: Missing required canonical artifact fails closed on D4', () => {
  const missingCanonicalTrace = {
    case_id: 'G03-04-DEV', // Requires ["src/signature-validator.mjs", "test/signature-validator.test.mjs"]
    sdlc_stage: 'Development',
    expected_route: 'bmad-build story 1.1',
    selected_route: 'bmad-build story 1.1',
    route_matched: true,
    host_session_id: 'session-missing-canonical',
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS',
    host_events: [
      { event: 'BRAD_ROUTE_INVOKED', skill: 'bmad-build story 1.1', success: true }
    ],
    produced_artifacts: [
      // Only produced src/signature-validator.mjs, omitted test/signature-validator.test.mjs!
      {
        path: 'src/signature-validator.mjs',
        digest: '65e2f306de036e0120f30294fbd01cd7eb37690ccff089ffcc53721a300fa19e'
      }
    ],
    observer_attestation: {
      artifacts_verified: true
    }
  };

  const scorecard = verifyGate03Evidence({
    tracesOverride: [missingCanonicalTrace],
    fixtureRoot: join(labRoot, 'validation/gate-03/fixtures/minimal-service')
  });
  const res = scorecard.case_results[0];

  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.pass, 0);
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.fail, 1);
  assert.equal(res.task_completion, 'FAIL', 'D4 must fail when required canonical artifact is missing');
});

test('Gate 03 Adversarial Control 5: Substituted fixture directory cannot override canonical fixture root', () => {
  const substitutedFixtureTrace = {
    case_id: 'G03-01-PM',
    sdlc_stage: 'Product Management',
    expected_route: 'bmad-prd',
    selected_route: 'bmad-prd',
    route_matched: true,
    host_session_id: 'session-sub-fixture',
    fixture_dir: '../../../', // Traversal via fixture_dir to labRoot
    execution_mode: 'NATIVE_WORKFLOW_INLINE',
    delivery_status: 'PASS',
    host_events: [
      { event: 'BRAD_ROUTE_INVOKED', skill: 'bmad-prd', success: true }
    ],
    produced_artifacts: [
      {
        path: 'package.json',
        digest: 'b9e53361b29edadab313a10609c3fb09f8bb552424b8256051dc50583b4c82aa'
      }
    ],
    observer_attestation: {
      artifacts_verified: true
    }
  };

  const scorecard = verifyGate03Evidence({
    tracesOverride: [substitutedFixtureTrace]
  });
  const res = scorecard.case_results[0];

  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.pass, 0);
  assert.equal(scorecard.dimensions.D4_TASK_COMPLETION.fail, 1);
  assert.equal(res.task_completion, 'FAIL', 'D4 must fail when fixture substitution is attempted');
});


