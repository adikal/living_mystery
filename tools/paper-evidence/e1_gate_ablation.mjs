#!/usr/bin/env node

// E1: deterministic local mechanism ablation. No model, network, UI, persistence, or save APIs are used.

import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {caseTables, createSession, registerKernelCase} from '../../dist/engine.mjs';
import * as Morning from '../../dist/morning.mjs';
import {addNormalizedSha256, ascii, canonicalJson, collectProvenance, sha256, sortedUnique} from './paper_evidence_helpers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CASE_PATH = resolve(ROOT, 'dist/cases/archive/2026-10/mk-live-20261002-235614.json');
const RESULTS_DIR = resolve(ROOT, 'tools/paper-evidence/results');
const JSON_OUTPUT = resolve(RESULTS_DIR, 'e1_gate_ablation.json');
const MARKDOWN_OUTPUT = resolve(RESULTS_DIR, 'e1_gate_ablation.md');
const MODES = [
  {id: 'planning_execution', planningGate: true, executionGate: true},
  {id: 'planning_only', planningGate: true, executionGate: false},
  {id: 'no_kernel_gate', planningGate: false, executionGate: false},
];
const PHASE_DESCRIPTION = {
  planning_execution: 'Strict kernel certification is enforced during planning and immediately before execution.',
  planning_only: 'Strict kernel certification is enforced during planning but only observed, not enforced, at execution.',
  no_kernel_gate: 'Strict kernel certification is observed for measurement but enforced at neither planning nor execution.',
};

const loadBase = () => JSON.parse(readFileSync(CASE_PATH, 'utf8'));
const clone = value => structuredClone(value);
const att = (actor, id) => `k_att_${id}`;
const conceal = (clue, because) => ({kind: 'conceal', clue, because: [because]});

function createStart(records, seed = 1) {
  registerKernelCase(records);
  return createSession(seed, records.id);
}

function redundantMeansCase(id) {
  const records = loadBase();
  records.id = id;
  records.title = 'Synthetic redundant-means mechanism fixture';
  const source = records.signs.find(sign => sign.id === 's_hound');
  const backup = clone(source);
  Object.assign(backup, {
    id: 's_hound_backup',
    title: 'Synthetic backup means trace',
    source: 'e_ada_post',
    at: 'post',
    about: 'ada',
  });
  records.signs.push(backup);
  return records;
}

function cancellationRaceCase() {
  const records = loadBase();
  records.id = 'mk-e1-synthetic-cancellation-race';
  records.title = 'Synthetic false-sign/defeater race fixture';
  const defeater = records.signs.find(sign => sign.id === 's_rowan_retract');
  defeater.kind = 'record';
  defeater.at = 'greenhouse';
  delete defeater.speaker;
  return records;
}

function scenarioDefinitions() {
  const safeRecords = loadBase();
  const safeStart = createStart(safeRecords);
  const unsafeRecords = loadBase();
  const unsafeStart = createStart(unsafeRecords);
  const pairRecords = redundantMeansCase('mk-e1-synthetic-cumulative-pair');
  const pairStart = createStart(pairRecords);
  const raceRecords = cancellationRaceCase();
  const raceStart = createStart(raceRecords);
  raceStart.world.flags.morning = {...(raceStart.world.flags.morning ?? {}), concealed: ['s_rowan_test'], agendas: {}};
  const acquiredRecords = loadBase();
  const acquiredStart = createStart(acquiredRecords);
  const retainedRecords = redundantMeansCase('mk-e1-synthetic-retained-pending');
  const retainedStart = createStart(retainedRecords);
  retainedStart.world.flags.morning = {...(retainedStart.world.flags.morning ?? {}), agendas: {
    clara: [{...conceal('s_hound', att('clara', 'a_clara_fear')), state: 'pending'}],
  }};
  const lineRecords = loadBase();
  const lineStart = createStart(lineRecords);
  lineStart.world.npcs.clara.location = 'manor';
  lineStart.world.npcs.ada.location = 'manor';
  lineStart.events.push({id: 'e_experiment_line', kind: 'speech', actor: 'clara', minute: lineStart.world.minute,
    title: 'Synthetic captured line premise', data: {listener: 'player', assertion: 'The detective asked after the household.'}, changes: [], parents: []});
  const codeRecords = loadBase();
  const codeStart = createStart(codeRecords);
  return [
    {
      id: 'safe_concealment',
      mechanism: 'A concealment whose direct strict certificate remains safe.',
      records: safeRecords,
      start: safeStart,
      proposal: {agendas: {clara: [conceal('s_telegram', att('clara', 'a_clara_fear'))]}},
      lineVerdicts: {}, beforeExecution: null,
    },
    {
      id: 'individually_unsafe_clue',
      mechanism: 'One code-valid clue is individually required by the strict certificate.',
      records: unsafeRecords,
      start: unsafeStart,
      proposal: {agendas: {clara: [conceal('s_letter', att('clara', 'a_clara_fear'))]}},
      lineVerdicts: {}, beforeExecution: null,
    },
    {
      id: 'cumulative_pair_unsafe_only_together',
      mechanism: 'Two synthetic redundant means traces are safe individually but unsafe when both commitments coexist.',
      records: pairRecords,
      start: pairStart,
      proposal: {agendas: {
        clara: [conceal('s_hound', att('clara', 'a_clara_fear'))],
        ada: [conceal('s_hound_backup', att('ada', 'a_ada_work'))],
      }},
      lineVerdicts: {}, beforeExecution: null,
    },
    {
      id: 'false_sign_defeater_cancellation_race',
      mechanism: 'The false sign and defeater are initially both hidden; acquisition retains the false sign immediately before execution.',
      records: raceRecords,
      start: raceStart,
      proposal: {agendas: {rowan: [conceal('s_rowan_retract', att('rowan', 'a_rowan_duty'))]}},
      lineVerdicts: {}, beforeExecution: {kind: 'acquire', clue: 's_rowan_test'},
    },
    {
      id: 'acquired_clue_cancellation',
      mechanism: 'The proposed clue is acquired after planning, so identical non-kernel execution validation cancels every arm.',
      records: acquiredRecords,
      start: acquiredStart,
      proposal: {agendas: {iris: [conceal('s_medical', att('iris', 'a_iris_duty'))]}},
      lineVerdicts: {}, beforeExecution: {kind: 'acquire', clue: 's_medical'},
    },
    {
      id: 'retained_pending_concealment',
      mechanism: 'A retained pending means concealment combines unsafely with a newly proposed redundant means concealment.',
      records: retainedRecords,
      start: retainedStart,
      proposal: {agendas: {ada: [conceal('s_hound_backup', att('ada', 'a_ada_work'))]}},
      lineVerdicts: {}, beforeExecution: null,
    },
    {
      id: 'line_validation_control',
      mechanism: 'A fixed local line refusal truncates a later concealment identically in every arm.',
      records: lineRecords,
      start: lineStart,
      proposal: {agendas: {clara: [
        {kind: 'meet', with: 'ada', place: 'manor', say: 'The detective asked after the household.', because: ['k_said_e_experiment_line']},
        conceal('s_hound', att('clara', 'a_clara_fear')),
      ]}},
      lineVerdicts: {'clara:0': {ok: false, why: 'fixed synthetic line refusal'}}, beforeExecution: null,
    },
    {
      id: 'code_validation_control',
      mechanism: 'An unknown clue remains code-invalid in every arm before any kernel gate.',
      records: codeRecords,
      start: codeStart,
      proposal: {agendas: {clara: [conceal('s_not_a_clue', att('clara', 'a_clara_fear'))]}},
      lineVerdicts: {}, beforeExecution: null,
    },
  ];
}

function lineItems(session, records, plan) {
  const ctx = caseTables(session).behavior.morningCtx;
  const items = {};
  for (const [actor, steps] of Object.entries(plan)) for (const [index, step] of steps.entries()) if (step.kind === 'meet') {
    const knowledge = Morning.knowledge(session, records, actor, ctx.people, ctx.places);
    const all = [...knowledge.private, ...knowledge.sayable];
    items[`${actor}:${index}`] = {
      speaker: ctx.people[actor].name,
      says: step.say,
      to: ctx.people[step.with].name,
      knowledge: step.because.map(id => all.find(item => item.id === id)?.text).filter(Boolean),
      private: knowledge.private.map(item => item.text),
    };
  }
  return items;
}

export function validateProposal(session, records, proposal, lineVerdicts = {}) {
  const ctx = caseTables(session).behavior.morningCtx;
  const code = Morning.check(session, records, ctx, proposal);
  const plan = clone(code.plan);
  const free = new Set(Morning.actors(session, records, ctx.roles, ctx.victim));
  const replanned = Object.keys(proposal?.agendas && typeof proposal.agendas === 'object' ? proposal.agendas : {}).filter(actor => free.has(actor));
  const items = lineItems(session, records, plan);
  const lines = {};
  for (const key of Object.keys(items).sort(ascii)) {
    const verdict = lineVerdicts[key];
    const ok = verdict?.ok === true;
    lines[key] = ok ? 'ok' : (verdict?.why ?? 'no fixed verdict');
    if (!ok) {
      const separator = key.lastIndexOf(':');
      const actor = key.slice(0, separator), index = Number(key.slice(separator + 1));
      plan[actor] = plan[actor].slice(0, index);
    }
  }
  for (const actor of Object.keys(plan)) if (!plan[actor].length) delete plan[actor];
  return {
    plan,
    replanned,
    audit: {code: code.errors, lines},
    lineItems: items,
    proposalOpportunities: Object.values(plan).flat().filter(step => step.kind === 'conceal').length,
  };
}

function applyPlanningGate(session, records, validated, mode) {
  const plan = clone(validated.plan);
  const decisions = [];
  const admitted = [];
  for (const [actor, steps] of Object.entries(plan)) {
    for (const [stepIndex, step] of steps.entries()) {
      if (step.kind !== 'conceal') continue;
      const certificate = Morning.certifyConcealments(session, records, {
        phase: 'planning', actor, stepIndex, clue: step.clue, replanned: validated.replanned,
        additionalConcealments: [...admitted, step.clue],
      });
      const enforcedRefusal = mode.planningGate && !certificate.ok;
      decisions.push({actor, stepIndex, clue: step.clue, certificate, enforcedRefusal});
      if (enforcedRefusal) { plan[actor] = steps.slice(0, stepIndex); break; }
      admitted.push(step.clue);
    }
  }
  for (const actor of Object.keys(plan)) if (!plan[actor].length) delete plan[actor];
  return {plan, decisions};
}

function installInMemory(session, plan, replanned) {
  const morning = session.world.flags.morning ?? {agendas: {}, concealed: []};
  const agendas = clone(morning.agendas ?? {});
  for (const actor of replanned) if (agendas[actor]) agendas[actor] = agendas[actor].filter(step => !['pending', 'active'].includes(step.state));
  for (const [actor, steps] of Object.entries(plan)) agendas[actor] = steps.map(step => ({...step, state: 'pending'}));
  session.world.flags.morning = {...morning, agendas, concealed: sortedUnique(morning.concealed ?? [])};
}

function applyBeforeExecution(session, mutation) {
  if (!mutation) return;
  if (mutation.kind !== 'acquire') throw new Error(`unknown pre-execution mutation ${mutation.kind}`);
  if (!session.world.player.evidence.some(item => item.clue === mutation.clue)) session.world.player.evidence.push({clue: mutation.clue});
}

function executionCertificate(session, records, actor, stepIndex, clue) {
  const checkOptions = {phase: 'execution', actor, stepIndex, clue, additionalConcealments: [clue]};
  const actualPostCommit = Morning.certifyConcealments(session, records, {...checkOptions, includeCommitments: false});
  const allCommitmentsProjection = Morning.certifyConcealments(session, records, checkOptions);
  return {
    ...allCommitmentsProjection,
    ok: actualPostCommit.ok && allCommitmentsProjection.ok,
    errors: [
      ...(actualPostCommit.ok ? [] : actualPostCommit.errors.map(error => `actual post-commit state: ${error}`)),
      ...(allCommitmentsProjection.ok ? [] : allCommitmentsProjection.errors.map(error => `all commitments projection: ${error}`)),
    ],
    checks: {actualPostCommit, allCommitmentsProjection},
  };
}

function executeInMemory(session, records, plan, mode) {
  const decisions = [], committedUnsafeStates = [];
  for (const actor of Object.keys(plan)) {
    const agenda = session.world.flags.morning.agendas[actor] ?? [];
    for (const [stepIndex, planned] of plan[actor].entries()) {
      if (planned.kind !== 'conceal') continue;
      const step = agenda[stepIndex];
      if (session.world.player.evidence.some(item => item.clue === step.clue)) {
        step.state = 'missed'; step.why = 'already found';
        decisions.push({actor, stepIndex, clue: step.clue, refusal: 'acquired clue cancellation', kernelCertificate: null});
        continue;
      }
      const kernelCertificate = executionCertificate(session, records, actor, stepIndex, step.clue);
      if (mode.executionGate && !kernelCertificate.ok) {
        step.state = 'missed'; step.why = 'kernel execution refusal';
        decisions.push({actor, stepIndex, clue: step.clue, refusal: 'kernel execution refusal', kernelCertificate});
        continue;
      }
      step.state = 'done';
      session.world.flags.morning.concealed = sortedUnique([...(session.world.flags.morning.concealed ?? []), step.clue]);
      const postCommitCertificate = Morning.certifyConcealments(session, records, {
        phase: 'post_commit', actor, stepIndex, clue: step.clue, includeCommitments: false,
      });
      if (!postCommitCertificate.ok) committedUnsafeStates.push({actor, stepIndex, clue: step.clue, certificate: postCommitCertificate});
      decisions.push({actor, stepIndex, clue: step.clue, refusal: null, kernelCertificate, postCommitCertificate});
    }
  }
  return {decisions, committedUnsafeStates};
}

function runArm(definition, mode) {
  const session = clone(definition.start);
  const startingSessionSha256 = sha256(canonicalJson(session));
  const validated = validateProposal(session, definition.records, definition.proposal, definition.lineVerdicts);
  const validationSignature = sha256(canonicalJson({plan: validated.plan, replanned: validated.replanned, audit: validated.audit, lineItems: validated.lineItems}));
  const planning = applyPlanningGate(session, definition.records, validated, mode);
  installInMemory(session, planning.plan, validated.replanned);
  applyBeforeExecution(session, definition.beforeExecution);
  const execution = executeInMemory(session, definition.records, planning.plan, mode);
  const finalStrictCertificate = Morning.certifyConcealments(session, definition.records, {phase: 'final', includeCommitments: false});
  const executionRefusals = execution.decisions.filter(decision => decision.refusal);
  return {
    mode: mode.id,
    gatePolicy: PHASE_DESCRIPTION[mode.id],
    startingSessionSha256,
    validationSignature,
    validation: {
      codeErrors: validated.audit.code,
      lineItems: validated.lineItems,
      lineVerdicts: validated.audit.lines,
      survivingPlan: validated.plan,
    },
    proposalOpportunities: validated.proposalOpportunities,
    planning: {decisions: planning.decisions, enforcedRefusals: planning.decisions.filter(decision => decision.enforcedRefusal).length, admittedPlan: planning.plan},
    execution: {
      decisions: execution.decisions,
      refusals: executionRefusals.length,
      kernelRefusals: executionRefusals.filter(decision => decision.refusal === 'kernel execution refusal').length,
      acquiredClueCancellations: executionRefusals.filter(decision => decision.refusal === 'acquired clue cancellation').length,
    },
    committedUnsafeStates: execution.committedUnsafeStates,
    finalStrictCertificate,
    finalConcealedRoots: sortedUnique(session.world.flags.morning?.concealed ?? []),
  };
}

function aggregate(scenarios, modeId) {
  const arms = scenarios.map(scenario => scenario.arms.find(arm => arm.mode === modeId));
  return {
    proposalOpportunities: arms.reduce((sum, arm) => sum + arm.proposalOpportunities, 0),
    planningRefusals: arms.reduce((sum, arm) => sum + arm.planning.enforcedRefusals, 0),
    executionRefusals: arms.reduce((sum, arm) => sum + arm.execution.refusals, 0),
    kernelExecutionRefusals: arms.reduce((sum, arm) => sum + arm.execution.kernelRefusals, 0),
    acquiredClueCancellations: arms.reduce((sum, arm) => sum + arm.execution.acquiredClueCancellations, 0),
    committedUnsafeStates: arms.reduce((sum, arm) => sum + arm.committedUnsafeStates.length, 0),
    finalStrictCertificatesPassed: arms.filter(arm => arm.finalStrictCertificate.ok).length,
    finalStrictCertificatesFailed: arms.filter(arm => !arm.finalStrictCertificate.ok).length,
  };
}

export function buildExperiment() {
  // the experiment's recorded proposals ran when the doctor could still hide her own records in the morning
  const rules = {...Morning.CONCEALMENT_RULES};
  Morning.CONCEALMENT_RULES.examinerMayConceal = true;
  try { return buildExperimentUnderRecordedRules(); } finally { Object.assign(Morning.CONCEALMENT_RULES, rules); }
}

function buildExperimentUnderRecordedRules() {
  const definitions = scenarioDefinitions();
  const scenarios = definitions.map(definition => {
    const arms = MODES.map(mode => runArm(definition, mode));
    const starts = new Set(arms.map(arm => arm.startingSessionSha256));
    const validations = new Set(arms.map(arm => arm.validationSignature));
    if (starts.size !== 1) throw new Error(`${definition.id}: arms did not start from identical sessions`);
    if (validations.size !== 1) throw new Error(`${definition.id}: code/line validation changed between arms`);
    return {
      id: definition.id,
      mechanism: definition.mechanism,
      caseId: definition.records.id,
      syntheticCase: definition.records.id.startsWith('mk-e1-synthetic-'),
      proposal: definition.proposal,
      beforeExecution: definition.beforeExecution,
      identicalStartingSessionSha256: arms[0].startingSessionSha256,
      identicalCodeLineValidationSha256: arms[0].validationSignature,
      arms,
    };
  });
  const aggregates = Object.fromEntries(MODES.map(mode => [mode.id, aggregate(scenarios, mode.id)]));
  if (aggregates.planning_execution.committedUnsafeStates !== 0 || aggregates.planning_execution.finalStrictCertificatesFailed !== 0) {
    throw new Error('planning+execution arm committed or retained an unsafe final state');
  }
  if (aggregates.no_kernel_gate.committedUnsafeStates === 0 || aggregates.planning_only.committedUnsafeStates === 0) {
    throw new Error('ablation did not expose the expected unsafe mechanism states');
  }
  return {
    format: 'living-mystery-e1-local-gate-ablation-v1',
    title: 'E1 offline/local kernel-gate mechanism ablation',
    scope: {
      classification: 'Mechanism experiment, not model-policy frequency.',
      interpretation: 'Fixed captured/synthetic proposals test causal enforcement differences. Counts do not estimate how often a model proposes any behavior.',
      identicalInputs: 'Within each scenario, all arms clone one starting session and share byte-identical code and fixed local line validation. Only strict kernel-gate enforcement differs.',
      isolation: 'In-memory experiment only: no directMorning, model, fetch, UI, persistence, import/export, or save path is called; unsafe arms cannot enter ordinary game state or saves.',
      offline: true,
    },
    modes: MODES.map(mode => ({...mode, description: PHASE_DESCRIPTION[mode.id]})),
    scenarioCount: scenarios.length,
    aggregates,
    scenarios,
  };
}

function markdown(result) {
  const lines = [
    '# E1 offline/local kernel-gate mechanism ablation', '',
    `Normalized SHA-256: \`${result.normalizedSha256}\``, '',
    `Status: **${result.provenance.repository.archivalStatus}**.`, '',
    '**Scope: mechanism experiment, not model-policy frequency.** Fixed captured/synthetic proposals establish causal mechanism behavior; these counts do not estimate proposal frequency from any model.', '',
    '## Aggregate outcomes', '',
    '| Mode | Opportunities | Planning refusals | Execution refusals | Kernel execution refusals | Acquired cancellations | Unsafe committed states | Final strict pass |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const mode of result.modes) {
    const row = result.aggregates[mode.id];
    lines.push(`| ${mode.id} | ${row.proposalOpportunities} | ${row.planningRefusals} | ${row.executionRefusals} | ${row.kernelExecutionRefusals} | ${row.acquiredClueCancellations} | ${row.committedUnsafeStates} | ${row.finalStrictCertificatesPassed}/${result.scenarioCount} |`);
  }
  lines.push('', '## Scenario outcomes', '',
    '| Scenario | Mode | Code errors | Line refusals | Planning refusals | Execution refusals | Unsafe commits | Final strict | Concealed roots |',
    '|---|---|---:|---:|---:|---:|---:|---|---|');
  for (const scenario of result.scenarios) for (const arm of scenario.arms) {
    const lineRefusals = Object.values(arm.validation.lineVerdicts).filter(value => value !== 'ok').length;
    const roots = arm.finalConcealedRoots.map(root => `\`${root}\``).join(', ') || 'none';
    lines.push(`| ${scenario.id} | ${arm.mode} | ${arm.validation.codeErrors.length} | ${lineRefusals} | ${arm.planning.enforcedRefusals} | ${arm.execution.refusals} | ${arm.committedUnsafeStates.length} | ${arm.finalStrictCertificate.ok ? 'pass' : 'fail'} | ${roots} |`);
  }
  lines.push('', '## Isolation and interpretation', '',
    '- Every arm in a scenario starts from the same canonical session hash and has the same code/line validation hash.',
    '- The line critic is a fixed local verdict map; no model or network call occurs.',
    '- Unsafe modes exist only inside this process and never call UI, persistence, import/export, or save APIs.',
    '- Strict certificates are still computed observationally in ablated arms so unsafe commits are measured directly.', '',
    '## Provenance', '',
    `- Commit: \`${result.provenance.repository.commit}\``,
    `- Branch: \`${result.provenance.repository.branch ?? '(detached)'}\``,
    `- Node: \`${result.provenance.environment.node}\``,
    `- Worktree dirty: \`${result.provenance.repository.worktreeDirty}\``,
    `- Hashed manifests: ${result.provenance.manifests.length}; hashed inputs: ${result.provenance.inputs.length}`, '');
  return `${lines.join('\n')}\n`;
}

function main() {
  globalThis.fetch = () => { throw new Error('network disabled in E1 gate ablation'); };
  mkdirSync(RESULTS_DIR, {recursive: true});
  const first = buildExperiment();
  const second = buildExperiment();
  if (canonicalJson(first) !== canonicalJson(second)) throw new Error('E1 semantic result was not deterministic across local reruns');
  const result = first;
  result.repeatability = {independentLocalBuilds: 2, exactSemanticEquality: true, semanticSha256: sha256(canonicalJson(first))};
  result.provenance = collectProvenance(ROOT, {
    commands: ['node tools/paper-evidence/e1_gate_ablation.mjs'],
    manifests: [resolve(ROOT, 'dist/cases/generated/index.json')],
    inputs: [
      fileURLToPath(import.meta.url),
      resolve(ROOT, 'tools/paper-evidence/paper_evidence_helpers.mjs'),
      CASE_PATH,
      resolve(ROOT, 'dist/morning.mjs'),
      resolve(ROOT, 'dist/mk/kernel.mjs'),
      resolve(ROOT, 'dist/engine.mjs'),
    ],
    evidenceOutputs: [JSON_OUTPUT, MARKDOWN_OUTPUT],
  });
  addNormalizedSha256(result);
  writeFileSync(JSON_OUTPUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  writeFileSync(MARKDOWN_OUTPUT, markdown(result), 'utf8');
  console.log(`PASS ${result.scenarioCount} scenarios, unsafe commits planning+execution=${result.aggregates.planning_execution.committedUnsafeStates}, planning-only=${result.aggregates.planning_only.committedUnsafeStates}, no-gate=${result.aggregates.no_kernel_gate.committedUnsafeStates}, normalized ${result.normalizedSha256}, ${result.provenance.repository.archivalStatus}`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
