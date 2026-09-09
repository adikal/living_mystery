# Living Mystery: System Design

Implementation note: this document describes the longer-term design, including unimplemented systems. See [architecture.md](architecture.md) for current behavior and [../README.md](../README.md) for running the deterministic prototype.

Status: evolving design specification  
Current implementation: vertical slice  
North Star: a replayable procedural murder-mystery text adventure in a causally coherent, socially alive world

## 1. Product vision

Living Mystery is a procedural detective game in which believable NPCs live on schedules, pursue motives, form imperfect beliefs, remember events, spread information, lie, cooperate, panic, and react to the player and one another. Each playthrough generates a different but logically solvable murder mystery.

The player investigates primarily by moving through the world, observing consequences, talking to people, testing statements, and connecting clues. The desired tone draws from classic closed-circle mysteries, Sherlock Holmes, Agatha Christie, and village mysteries such as *Midsomer Murders*. The systemic inspiration includes *Creatures*, *The Sims*, *Outcast*, and the scheduled ambient life of games such as *Red Dead Redemption 2*.

The project is not an unrestricted collection of LLM personas. Its central rule is:

> A deterministic simulation owns reality. Agents propose intentions within it. A narrative governor and symbolic checks preserve causality, solvability, and playability.

The refined governing contract is to preserve physical, temporal and epistemic
constraints and continued solvability as hard invariants, while maximizing
character freedom within the dynamically admissible action space. This is a
target for the full solution, not a guarantee established by the current slice.
A player may miss optional content or pursue a wrong theory, but each admitted
nonterminal state must retain an achievable route to a supported solution.

The World Director first filters parameterized choices using local checks and
applicable symbolic queries, then validates concrete effects again immediately
before commitment. Scripted policies and AI both select within this boundary.
Unknown required results defer the action or select a verified alternative;
private constraints must not leak hidden facts through feedback or menus.
See [the refined contract](symbolic-reasoning.md#governing-contract-autonomy-within-hard-invariants)
for horizons, scheduling obligations, player actions and no-dead-end semantics.

The design must preserve three distinct layers of knowledge:

1. What actually happened.
2. What each character believes happened.
3. What the player currently believes happened.

Mystery arises when those layers diverge; investigation gradually brings them into alignment.

## 2. Design goals

- Produce NPC behavior that is coherent over time, not merely convincing one line at a time.
- Create mysteries from explicit causal histories rather than retroactive prose.
- Allow meaningful emergence without permitting agents to invalidate the story.
- Keep every important state transition inspectable, reproducible, and explainable.
- Let characters possess false beliefs, private knowledge, biases, and beliefs about others.
- Surface off-screen life without giving the player omniscient information.
- Use LLMs for bounded interpretation and expression, not authoritative state mutation.
- Use symbolic reasoning where hard constraints, temporal consistency, or proof obligations matter.
- Support deterministic replay from a seed and event log.

## 3. Non-goals

- Simulating raw human cognition or artificial life at biological fidelity.
- Calling an LLM for every NPC on every simulation tick.
- Allowing generated dialogue to create facts, evidence, inventory, or world state.
- Fully recursive theory of mind; bounded depth is sufficient.
- Maximizing chaos or novelty at the expense of a fair mystery.
- Building graphics before the underlying social and mystery simulation is stable.

## 4. Architectural overview

```text
Player command
      │
      ▼
Command interpreter ───────► Player knowledge / notebook
      │
      ▼
Authoritative world runtime
clock • locations • objects • bodies • inventory • law • event queue
      │
      ├────────► Perception and observation
      │                   │
      │                   ▼
      │             Beliefs and memories
      │                   │
      ▼                   ▼
NPC scheduler ─────► NPC deliberation
                         │
                         ▼
                  Typed action proposal
                         │
                         ▼
              Validation and governance
              schemas • policies • ASP/SMT
                         │
                  accepted / rejected
                         │
                         ▼
                 Deterministic executor
                         │
                         ▼
                    New world events
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
      Narrative director       Player observer
      pacing/contracts         notices/rumors/recaps
```

The major services are:

| Component | Responsibility | Authority |
|---|---|---|
| World runtime | Time, space, objects, physical state, event execution | Canonical truth |
| NPC cognition | Needs, goals, planning, intention selection | Proposals only |
| Perception/belief system | Information acquisition and provenance | NPC-local epistemic state |
| Mystery generator | Hidden crime history, suspects, clues, proof graph | Initial canonical mystery |
| Action validator | Preconditions, permissions, invariants | Accept/reject proposals |
| Narrative director | Pacing, story contracts, permitted nudges | Constrained interventions |
| Mystery verifier | Logical consistency and solvability | Veto unsafe changes |
| Observer | Player-facing selection and prose | Presentation only |
| Language service | Dialogue and bounded social interpretation | No state mutation |
| Persistence/replay | Saves, seeds, event sourcing, diagnostics | Durable record |

## 5. Single-agent model

An NPC is a persistent cognitive and social entity, not a prompt. Its model is divided into stable traits, dynamic state, epistemic state, social state, and current commitments.

### 5.1 Identity and background

Identity includes name, age, occupation, residence, roles, family, education, status, faction memberships, competencies, and physical attributes. Background contains formative events and their structured consequences.

Background prose alone is insufficient. Formative events seed initial values, fears, loyalties, grudges, secrets, competencies, relationships, and beliefs.

### 5.2 Personality

Use broad traits plus game-specific behavioral tendencies:

- Big Five: openness, conscientiousness, extraversion, agreeableness, neuroticism.
- Honesty, secrecy, empathy, curiosity, impulsivity, risk aversion, conformity, vindictiveness, authority deference, and violence aversion.

Traits modify decision functions rather than dictate actions. Conscientiousness increases the cost of abandoning commitments; impulsivity discounts delayed consequences; secrecy increases disclosure thresholds; neuroticism amplifies perceived threat.

### 5.3 Values and norms

Values are stable normative commitments such as family, truth, justice, status, autonomy, duty, loyalty, social order, and avoidance of harm. Norm models represent what an NPC considers permissible, shameful, admirable, or obligatory.

This distinguishes a need from a desire, a desire from a goal, and a goal from an intention. A character can want safety, value truth, desire to avoid arrest, and nevertheless intend to lie to protect a sibling.

### 5.4 Needs and drives

Needs are changing homeostatic variables with rates, set points, and urgency curves. The initial set includes hunger, fatigue, pain, safety, social contact, belonging, status, autonomy, certainty, privacy, and moral coherence.

Following the useful abstraction from *Creatures*, internal drives bias several behaviors at once. They do not directly select a single action.

### 5.5 Affect

Fast emotions are event- or target-directed: fear of a person, anger at an accusation, guilt about an act. Slow mood is diffuse and can use valence, arousal, and dominance.

Emotion affects attention, threat estimates, recall, utility, conversational strategy, and willingness to reconsider intentions. Emotions decay or are reinforced by events; mood changes more slowly.

### 5.6 Beliefs and provenance

Beliefs are structured propositions, not an untraceable prose summary. Each records:

- Proposition and confidence.
- Source type: observation, testimony, inference, memory, or canonical seed.
- Source identity and event ID.
- Acquisition and reinforcement time.
- Privacy, accessibility, and salience.
- Supporting evidence and defeaters.
- Estimated source reliability.

The model must support honest mistakes, uncertain conclusions, incompatible beliefs, deliberate lies, and bounded beliefs about other agents' beliefs. Theory-of-mind depth two is the normal ceiling; depth three should be exceptional.

A lie separates four things:

1. What the speaker believes.
2. What the speaker asserts.
3. What the speaker wants the listener to believe.
4. What the listener actually accepts.

### 5.7 Desires, goals, and intentions

Desires are transient preferences. Goals are persistent desired states with priority, deadlines, success conditions, abandonment conditions, costs, conflicts, and subgoals. Intentions are selected goals with committed plans.

Intentions need reconsideration conditions and hysteresis. An alternative should outperform the current intention by a margin before the NPC switches, preventing erratic oscillation.

### 5.8 Relationships and social models

A relationship is multidimensional: familiarity, affection, trust, fear, respect, obligation, resentment, attraction, perceived power, shared history, and unresolved events. It is directional; Clara's trust in Rowan need not equal Rowan's trust in Clara.

NPCs also maintain fallible models of others: perceived traits, expected behavior, believed loyalties, and suspected motives. These predictions influence disclosure, cooperation, intimidation, and deception.

### 5.9 Memory

The intended memory system has four stores:

- Working memory: current perceptions, dialogue context, active intention, immediate threat.
- Episodic memory: experienced events with time, location, participants, salience, and event provenance.
- Semantic memory: generalized knowledge about people, places, rules, and the world.
- Autobiographical memory: identity-shaping beliefs and self-narrative.

Retrieval is bounded and scored approximately by relevance, recency, salience, accessibility, emotional congruence, and goal congruence. Only a small structured working set enters any LLM context.

### 5.10 Competencies and affordances

Characters can consider only actions they know about, believe possible, can physically attempt, and can afford socially or materially. Competencies include observation, persuasion, deception, medicine, combat, local knowledge, and trade skills.

World objects advertise typed affordances, inspired by the smart-object approach associated with *The Sims*. A fireplace can advertise warm, inspect ashes, burn object, and cook; each affordance declares preconditions, costs, risks, and expected effects.

### 5.11 Schedule and current activity

Schedules are hierarchical:

```text
Role obligation → daily plan → current intention → immediate action
```

They contain obligations, preferences, appointments, time windows, duration, location, priority, and interruptibility. Emergencies, legal compulsion, dependents, urgent needs, and story commitments can override routine according to explicit priority rules.

Off-screen agents use coarse simulation. Fine-grained deliberation occurs only on relevant events.

## 6. Perception, attention, and information flow

NPCs never receive global state. World events emit possible percepts based on location, distance, line of sight, volume, attention, distraction, sensory ability, expectations, and affect.

Attention is a bottleneck scored by novelty, threat, active-goal relevance, emotional relevance, and social salience. Perception can be partial or mistaken: a character may hear an argument but not the words, recognize a coat but not a face, or misremember the time.

Belief updates are source-sensitive and defeasible. Trust, plausibility, corroboration, bias, and prior beliefs affect acceptance. Contradictory evidence may reduce confidence without instantly selecting a single conclusion.

Information can move through direct observation, testimony, rumors, documents, inference, institutional announcements, and persistent environmental consequences. Every transfer remains traceable.

## 7. Decision and action model

NPC decision-making follows this pipeline:

1. Identify agents requiring attention due to an event, schedule transition, blocked goal, player interaction, danger, or urgent need.
2. Retrieve relevant beliefs and memories.
3. Generate candidates from current intention, schedule, goals, affordances, obligations, threats, and social opportunities.
4. Construct a bounded admissible set using known preconditions and private Director checks; use symbolic filtering for compound constraints and viability obligations.
5. Score remaining candidates deterministically.
6. Optionally use an LLM to choose or explain ambiguous social strategies within the bounded set.
7. Revalidate the composed plan and next typed transition against the latest authoritative state, hard invariants and future-opportunity obligations.
8. Execute accepted actions through deterministic action schemas.
9. Emit events, perceptions, belief updates, memories, and delayed consequences.

The conceptual utility function is:

```text
utility(action) =
    need reduction
  + goal progress
  + value alignment
  + relationship effect
  + emotional regulation
  + information gain
  + bounded narrative opportunity
  - physical cost
  - social and legal risk
  - moral cost
  - uncertainty
  - intention-switch cost
```

Personality transforms these terms. Major quantities should be explicit and inspectable; the LLM must not invent the final score.

## 8. Typed actions and causal effects

The action vocabulary is finite and extensible: move, wait, speak, ask, answer, give, take, hide, inspect, work, report, accuse, lie, follow, unlock, use object, attack, flee, and seek help.

Every proposal includes actor, type, target, object/location, intended outcome, reason, expected effects, confidence, and cost. Validation checks schema, physical preconditions, knowledge, access, capabilities, law, policy, and narrative safety.

Effects occur at multiple scopes:

- Internal: needs, emotion, beliefs, goals, memory, self-image.
- Dyadic: trust, affection, fear, obligation, resentment.
- Social: reputation, faction attitudes, rumor propagation.
- Physical: movement, damage, object state, evidence contamination.
- Institutional: crimes, warrants, arrests, testimony, custody.
- Narrative: clue access, proof paths, contracts, pacing.

The deterministic executor, never the LLM, applies effects and creates events.

## 9. Mystery generation

Procedural mysteries begin with a hidden causal history, not generated dialogue. Generation proceeds roughly as follows:

1. Choose victim and culprit from a compatible social graph.
2. Establish motive, means, opportunity, competencies, and constraints.
3. Generate preparation, crime, concealment, and aftermath actions.
4. Place every participant at a feasible time and location.
5. Derive physical traces and persistent consequences.
6. Determine who perceived which parts, including partial and mistaken observations.
7. Seed individual beliefs, secrets, lies, alibis, and rumors.
8. Generate plausible alternate suspects and red herrings.
9. Construct multiple independent proof paths.
10. Verify temporal consistency, uniqueness, accessibility, and solvability.

The canonical history is immutable once play begins. Agents may obscure, reveal, destroy, move, or misinterpret evidence only through permitted actions, but they cannot rewrite what happened.

### 9.1 Proof graph

The culprit should be supportable through independent categories such as motive, means, opportunity, physical evidence, witness evidence, and contradiction of alibi. A valid game requires at least two independent proof paths, with more for longer scenarios.

Red herrings must be distinguishable eventually. Innocent suspects may have genuine secrets, motives for lesser crimes, or misleading opportunity, but should not satisfy all decisive proof obligations.

### 9.2 Dynamic escalation

Secondary crimes, violence, or additional murders are possible only when:

- An agent has sufficient motive, knowledge, capability, and opportunity.
- The plan is physically and temporally feasible.
- The action follows from simulation state rather than an arbitrary drama request.
- It leaves the investigation solvable.
- The narrative value exceeds the disruption risk.
- The governor approves high-impact escalation.

## 10. Emergence and narrative control

Control is divided into three levels.

### Hard invariants

- Exactly one canonical history exists.
- Characters cannot be in two places at once.
- No one acts while dead, detained, incapacitated, or otherwise unable.
- Knowledge requires a traceable acquisition path.
- Objects and evidence cannot appear spontaneously.
- Critical evidence remains reachable through enough independent paths.
- Travel time, access, inventory, and action preconditions hold.
- The final accusation can be evaluated from player knowledge.

### Story contracts

Contracts state required or forbidden narrative conditions without prescribing exact scenes. Example: by a deadline, the guard must learn the murder weapon was missing, but may learn it from a witness, the player, or inspection. Contracts define deadlines, required beliefs or states, forbidden knowledge, and acceptable delivery mechanisms.

### Free emergence

Incidental conversations, grudges, rumors, alliances, missed appointments, opportunistic theft, arguments, and other noncritical social events may evolve freely within action and policy constraints.

## 11. Narrative director

The Narrative Director is deliberately narrow. It monitors contracts, pacing, investigation progress, clue access, escalation, and stalled play. It cannot rewrite canonical history or directly force arbitrary character behavior.

Permitted interventions are causally plausible and pre-authorized:

- Schedule a natural encounter.
- Increase the chance an informed NPC visits a relevant place.
- Make an existing consequence more noticeable.
- Prompt a knowledgeable NPC to spread a rumor.
- Trigger an institutional response.
- Use weather, closures, or obligations to redirect traffic.
- Surface a non-spoiling notebook reminder.

Every intervention is logged and measurable. One quality metric is how rarely the director must intervene.

## 12. Observer and player UX

The Observer is a presentation service, not a world authority. It receives only information the player could plausibly know and selects what to surface.

World evolution reaches the player through:

- Directly observed events.
- Sounds or activity perceived nearby.
- Rumors carrying speaker belief and bias.
- Persistent consequences discovered later.
- Documents, notices, newspapers, and legal records.
- A player-knowledge timeline and clue notebook.
- Non-spoiling ambient summaries or daily recaps.

The Observer scores candidate information by perceptibility, relevance, novelty, emotional interest, foreshadowing, and spoiler risk. It must never reveal hidden canonical truth merely because the simulation knows it.

## 13. Law, institutions, and violence

Law is modeled as agents plus procedures, not a global punishment switch. Institutions possess jurisdictions, evidence stores, suspicion distributions, procedural thresholds, powers, obligations, competence, bias, and possible corruption.

Violence uses explicit action schemas and creates durable consequences: injury, incapacity, death, witnesses, blood or weapon traces, fear, retaliation, legal attention, and schedule disruption. Essential characters and proof paths are protected by the same feasibility and narrative checks as other high-impact actions.

## 14. LLM boundary

The language model is a replaceable cognitive service, not the NPC and not the simulator.

Appropriate uses:

- Interpret natural-language player commands into typed intents.
- Realize approved communicative acts as dialogue.
- Suggest bounded plans or social strategies.
- Appraise an unusual social situation within explicit scales.
- Explain a decision from recorded factors.
- Produce atmospheric descriptions and observer recaps from permitted facts.

Forbidden authority:

- Creating facts, objects, evidence, memories, or world events.
- Directly changing beliefs, relationships, needs, health, or inventory.
- Determining physical or legal possibility.
- Deciding guilt or mystery solvability.
- Returning unrestricted executable actions.
- Accessing hidden world truth when acting as an NPC or Observer.

All model output is schema-validated, checked, and executed deterministically. A deterministic mock remains available for tests, offline play, and reproducibility.

## 15. Symbolic reasoning

Symbolic tools complement, rather than replace, the simulation.

### ASP / Clingo

ASP is suited to generating and rejecting candidate mysteries and enforcing discrete invariants:

- Unique culprit.
- Motive, means, and opportunity.
- Location exclusivity.
- Knowledge provenance.
- Feasible witness observations.
- Multiple independent proof paths.
- Reachability of critical evidence.
- Red-herring and innocent-suspect requirements.

### SMT

SMT is suitable for quantitative constraints such as time windows, travel durations, resource bounds, appointment feasibility, and minimizing director interventions.

### Epistemic and causal reasoning

A bounded epistemic layer answers who knows what, who believes another person knows a secret, and whether a lie remains viable. A causal graph links action, event, observation, belief update, emotion, goal, and later action. This supports explanations and debugging:

> Clara lied because she believed the letter implicated her sister, valued family protection over truth in this context, feared retaliation, and did not trust the player.

## 16. Persistence, replay, and observability

Every run should store:

- Generator seed and version.
- Initial canonical state.
- Accepted and rejected proposals with reasons.
- Executed events and causal parents.
- Perceptions and belief updates.
- Director interventions.
- Player commands and observations.
- Periodic snapshots for efficient loading.

This enables deterministic replay, regression testing, postmortems, balance analysis, and comparison across models or policies.

Useful metrics include behavioral consistency, provenance violations, schedule plausibility, contradiction rate, rumor accuracy, proof-path survival, director intervention rate, player progress, and variation across seeds.

## 17. Current vertical slice

The repository currently implements:

- Pydantic models for identity, background, personality, values, needs, emotions, beliefs and provenance, goals, intentions, relationships, memory, schedules, actions, clues, mystery, player, and world.
- Six locations and six NPCs in Bellweather.
- Three suspects, twelve clues, one hidden culprit, a canonical murder timeline, and multiple proof paths.
- A game clock, event queue, needs drift, and local/public observation filtering.
- Schedule-aware deterministic candidate generation and utility scoring.
- Typed action validation and execution for the initial action vocabulary.
- A terminal interface for looking, travel, conversation, questions, inspection, waiting, clues, accusation, and saving.
- JSON save/load.
- An abstract language service and deterministic implementation.
- An optional symbolic adapter and a small Clingo invariant file.
- Tests covering consistency, persistence, action validation, proof paths, commands, observation, and belief provenance.

The current slice does **not** yet implement procedural mystery generation, dynamic belief propagation, rich memory retrieval, full story contracts, law, violence, a narrative director, a sophisticated Observer, or a live LLM integration. Existing dialogue, scheduling, action choice, and symbolic rules are intentionally minimal scaffolding.

## 18. Implementation roadmap

### Phase 1: trustworthy simulation core

- Adopt event IDs and causal-parent links everywhere.
- Separate immutable canonical facts from mutable world state.
- Add typed objects, affordances, inventory transfers, and action effects.
- Add deterministic seeded randomness and replay.
- Improve travel, schedule interruption, and offline coarse simulation.
- Expand consistency and property-based tests.

### Phase 2: epistemic and social simulation

- Structured propositions rather than string-only beliefs.
- Perception generation and attention.
- Source-sensitive belief updates and contradiction handling.
- Speech acts, assertions, withholding, lying, and rumor propagation.
- Relationship updates and bounded theory of mind.
- Layered memory retrieval and forgetting.

### Phase 3: mystery generation and verification

- Generate canonical crime histories from templates and constraints.
- Derive evidence and witness knowledge from events.
- Construct suspects, red herrings, alibis, and independent proof paths.
- Add ASP generation and solvability checks.
- Add deterministic accusation explanation.

### Phase 4: narrative governance and UX

- Story-contract representation and monitor.
- Minimal intervention policy with audit logs.
- Observer channels, player timeline, rumors, and daily recaps.
- Progress and pacing metrics.
- Law, detention, searches, testimony, injury, and controlled escalation.

### Phase 5: bounded language integration

- Natural-language command parsing into typed player intents.
- Dialogue realization from communicative acts and accessible beliefs.
- Bounded deliberation for unusual social situations.
- Prompt/context provenance, strict schemas, timeouts, caching, and deterministic fallback.
- Model-independent evaluation harness.

## 19. Initial research questions

- How much emergence can be permitted before mystery solvability degrades?
- Which behavior should be utility-based, planned, symbolic, or language-model-assisted?
- What memory retrieval policy best balances coherence, cost, and surprise?
- How can the director intervene minimally while preserving perceived agency?
- How should proof independence be defined when clues share causal ancestry?
- How can false beliefs and rumors remain interesting without becoming arbitrary noise?
- What player-facing channels best communicate an evolving off-screen world without spoilers?
- Which explanations make emergent behavior understandable to designers without exposing hidden truth to players?

## 20. Acceptance criteria for the North Star

A mature run should satisfy all of the following:

- The generated crime has a unique canonical solution.
- At least two causally independent proof paths remain available.
- Every important belief has provenance.
- NPCs act only from accessible knowledge and legal affordances.
- Character behavior is explainable from needs, traits, values, relationships, beliefs, and commitments.
- Off-screen activity produces perceivable traces without omniscient narration.
- The world continues coherently when the player waits or ignores a plot thread.
- Dynamic events can change the investigation without invalidating it.
- The director rarely intervenes and never rewrites history.
- The same seed and policy configuration can be replayed deterministically.
- Different seeds produce materially different but fair mysteries.

The ultimate standard is not merely lifelike dialogue. It is a causally coherent social world in which autonomous characters create believable variation, imperfect information flows through relationships, and every generated crime remains logically solvable.
