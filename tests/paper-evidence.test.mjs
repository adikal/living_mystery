import test from 'node:test';
import assert from 'node:assert/strict';

import {buildAudit, selectE3cEpisodes} from '../tools/paper-evidence/committed_concealment_audit.mjs';
import {buildExperiment} from '../tools/paper-evidence/e1_gate_ablation.mjs';
import {addNormalizedSha256, canonicalJson} from '../tools/paper-evidence/paper_evidence_helpers.mjs';

test('E0 selects the same 27 e3c episodes and directly certifies every observed committed set', () => {
  const cohort = selectE3cEpisodes();
  assert.equal(cohort.selected.length, 27);
  const result = buildAudit();
  assert.equal(result.aggregates.episodeCount, 27);
  assert.equal(result.aggregates.episodeCommittedSetStates, 42);
  assert.equal(result.aggregates.nonEmptyStates, 15);
  assert.equal(result.aggregates.strictCertificatesPassed, 42);
  assert.equal(result.aggregates.strictCertificatesFailed, 0);
  for (const episode of result.episodes) for (const state of episode.states) {
    assert.equal(state.certificate.phase, 'post_commit');
    assert.deepEqual(state.roots, state.certificate.hiddenRoots);
    assert.deepEqual(state.dependencyClosureRemoved, state.certificate.removed);
    if (state.roots.length) assert.equal(state.priorPlanningAssociation.hasSameOrPriorAcceptedAuditForEveryRoot, true);
  }
});

test('E1 keeps code and line validation identical while only gate enforcement changes', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('the offline E1 mechanism experiment attempted a network call');
  try {
    const first = buildExperiment();
    const second = buildExperiment();
    assert.equal(canonicalJson(first), canonicalJson(second));
    assert.equal(first.scenarioCount, 8);
    assert.deepEqual(first.scenarios.map(scenario => scenario.id), [
      'safe_concealment',
      'individually_unsafe_clue',
      'cumulative_pair_unsafe_only_together',
      'false_sign_defeater_cancellation_race',
      'acquired_clue_cancellation',
      'retained_pending_concealment',
      'line_validation_control',
      'code_validation_control',
    ]);
    for (const scenario of first.scenarios) {
      assert.equal(new Set(scenario.arms.map(arm => arm.startingSessionSha256)).size, 1);
      assert.equal(new Set(scenario.arms.map(arm => arm.validationSignature)).size, 1);
    }
    assert.deepEqual(first.aggregates, {
      planning_execution: {
        proposalOpportunities: 7, planningRefusals: 3, executionRefusals: 2,
        kernelExecutionRefusals: 1, acquiredClueCancellations: 1, committedUnsafeStates: 0,
        finalStrictCertificatesPassed: 8, finalStrictCertificatesFailed: 0,
      },
      planning_only: {
        proposalOpportunities: 7, planningRefusals: 3, executionRefusals: 1,
        kernelExecutionRefusals: 0, acquiredClueCancellations: 1, committedUnsafeStates: 1,
        finalStrictCertificatesPassed: 7, finalStrictCertificatesFailed: 1,
      },
      no_kernel_gate: {
        proposalOpportunities: 7, planningRefusals: 0, executionRefusals: 1,
        kernelExecutionRefusals: 0, acquiredClueCancellations: 1, committedUnsafeStates: 3,
        finalStrictCertificatesPassed: 5, finalStrictCertificatesFailed: 3,
      },
    });

    const arm = (scenarioId, mode) => first.scenarios.find(scenario => scenario.id === scenarioId).arms.find(candidate => candidate.mode === mode);
    for (const scenario of first.scenarios) for (const candidate of scenario.arms) {
      for (const decision of candidate.execution.decisions.filter(item => item.kernelCertificate)) {
        const certificate = decision.kernelCertificate;
        const {actualPostCommit, allCommitmentsProjection} = certificate.checks;
        assert.deepEqual(JSON.parse(JSON.stringify(certificate.checks)), certificate.checks);
        assert.equal(certificate.ok, actualPostCommit.ok && allCommitmentsProjection.ok);
        if (candidate.mode === 'planning_execution') {
          assert.equal(decision.refusal === 'kernel execution refusal', !certificate.ok);
        }
      }
      assert.equal(candidate.finalStrictCertificate.remainingCommitted.length, 0);
    }

    const enforcedRace = arm('false_sign_defeater_cancellation_race', 'planning_execution').execution.decisions[0];
    assert.equal(enforcedRace.kernelCertificate.checks.actualPostCommit.ok, false);
    assert.equal(enforcedRace.kernelCertificate.checks.allCommitmentsProjection.ok, false);
    assert.equal(enforcedRace.refusal, 'kernel execution refusal');

    const observedRace = arm('false_sign_defeater_cancellation_race', 'planning_only').execution.decisions[0];
    assert.equal(observedRace.kernelCertificate.ok, false);
    assert.equal(observedRace.refusal, null);
    assert.equal(observedRace.postCommitCertificate.ok, false);

    for (const [scenarioId, clue] of [
      ['cumulative_pair_unsafe_only_together', 's_hound'],
      ['retained_pending_concealment', 's_hound_backup'],
    ]) {
      const noGateArm = arm(scenarioId, 'no_kernel_gate');
      const decision = noGateArm.execution.decisions.find(item => item.clue === clue);
      assert.equal(decision.kernelCertificate.checks.actualPostCommit.ok, true);
      assert.equal(decision.kernelCertificate.checks.allCommitmentsProjection.ok, false);
      assert.equal(decision.refusal, null);
      assert.equal(decision.postCommitCertificate.ok, true);
      assert.equal(noGateArm.committedUnsafeStates.some(item => item.clue === clue), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normalized SHA-256 is independent of object key insertion order', () => {
  const left = addNormalizedSha256({b: 2, a: {d: 4, c: 3}});
  const right = addNormalizedSha256({a: {c: 3, d: 4}, b: 2});
  assert.equal(left.normalizedSha256, right.normalizedSha256);
});
