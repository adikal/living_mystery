#!/usr/bin/env python3
"""Export a blinded, deterministic offline representation-fidelity annotation set.

The inclusion rules are constants below and are applied before any verdict is read.
The exporter performs local file I/O only; it has no network or model dependencies.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
ID_NAMESPACE = "sleuthcraft-representation-fidelity-v1"
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = ROOT / "results"
GENERATED_ROOT = ROOT / "dist" / "cases" / "generated"
RUNS_ROOT = ROOT / "tools" / "refine-c" / "runs"
GAME_LOG = ROOT / "logs" / "game.log"
PLAYTEST_ROOT = ROOT / "tools" / "playtest" / "runs"
RECORD_LISTS = ("events", "attitudes", "signs", "rules", "relations", "holdings")

# Predeclared without reference to code/model verdicts.
INCLUSION_RULES = {
    "case_record": (
        "Include every sign with non-empty primary text from every unique claims_version=2 case payload "
        "referenced by dist/cases/generated/index.json or live/index.json. Do not filter on claim truth, "
        "deception, review status, link type, case difficulty, or any verdict."
    ),
    "generation_candidate": (
        "Include every retained history entry from a claims_version=2 generation run when story, critic "
        "record, exact preceding case snapshot, and exact resulting step snapshot are all persisted. Do "
        "not filter on the code or critic verdict."
    ),
    "dialogue_attempt": (
        "A dialogue attempt is eligible only when its complete candidate and complete preparation ticket "
        "(perspective, offered account statements, claims, sources, and presented evidence) are persisted."
    ),
    "playtest_dialogue": (
        "A playtest dialogue output is eligible only when the trace step retains its complete preparation "
        "ticket and candidate-level code and critic audit."
    ),
}

PROSE_FIELDS = ("title", "text", "reading", "unlock", "unlock_lead")

CODEBOOK = """# Representation-fidelity annotation codebook

## Purpose and blinding

Judge whether each natural-language candidate faithfully represents the supplied structured source. Annotate only the blinded item file. Do not open the key, source repository, model outputs, or critic/code verdicts until annotations are locked. Item order and IDs are deterministic but disclose no case, arm, model, verdict, or source path. The export is not a random sample: it is the complete subset satisfying the predeclared ticket-completeness rules.

Treat the supplied structured record, account, source event, formal claim, and links as the annotation authority. Do not reward prose merely because it sounds plausible. Do not infer missing context. Use `not_assessable` whenever the supplied ticket does not support a decision.

## Annotation unit

One row is either:

- `case_record`: the primary prose bundle for one published sign and its formal source/links; or
- `generation_candidate`: one retained refinement story paired with the exact structured before/after delta it produced.

Read all candidate prose fields together. A title may summarize; `text` is the main surface wording; `reading` is the interpretation unlocked by `needs`; `unlock`/`unlock_lead` explain acquisition gated by `requires`. Linked records are included only to evaluate the stated relation, not as permission to add unrelated facts.

## Required labels

### 1. `claim_fidelity`
Choose one:

- `faithful`: all material identity, predicate, polarity, time, place, quantity, certainty, and attribution in the formal claim are preserved; harmless paraphrase is allowed.
- `partially_faithful`: compatible with the claim but materially underspecified or only part of a compound claim is represented.
- `unfaithful`: contradicts, reverses, overstates, changes, or attributes the formal claim incorrectly.
- `not_applicable`: no formal claim is supplied.
- `not_assessable`: the supplied context is insufficient to compare prose and claim.

### 2. Link correspondence
Annotate each of `requires_correspondence`, `needs_correspondence`, and `defeats_correspondence` separately:

- `faithful`: the prose gives the correct in-world relationship to every supplied link.
- `partial`: at least one supplied relationship is represented correctly but another is omitted or materially vague.
- `mismatch`: the prose gives an incompatible relationship, reverses direction, or substitutes another linked fact.
- `not_applicable`: the source has no link of that type.
- `not_assessable`: the link exists but the supplied prose/context cannot establish correspondence.

Relation meanings:

- `requires`: acquisition/access dependency. The required record must be obtained before this record becomes available; `unlock` should state a coherent in-world access reason.
- `needs`: interpretation dependency. The current record may be found earlier, but its `reading` becomes justified only after the needed record or common rule is known.
- `defeats`: contradiction/correction dependency. The current record is the evidence that overturns the linked account or sign. Do not mark faithful merely because the two texts concern the same person.

### 3. `claimless_unsupported_implication`
Choose one:

- `none`: claimless prose contains no unsupported implication about a case fact.
- `present`: despite having no formal claim, the prose states or clearly implies a case fact not licensed by its source event/account/links (including identity, whereabouts, action, observation, possession, time, motive, corroboration, or certainty).
- `not_applicable`: the item has a formal claim.
- `not_assessable`: the source context is insufficient.

Conversational tone, emotion, refusal, uncertainty, and non-factual colour are not unsupported implications. An implication counts when an ordinary reader would reasonably take it as asserting a case fact.

### 4. `fact_errors`
Select all that apply, or `none`, or `not_assessable`:

- `added_fact`: candidate adds a material fact absent from the licensed source.
- `dropped_fact`: candidate omits a material fact the representation is expected to carry. Concise titles need not repeat the full text; judge the prose bundle and field role.
- `altered_fact`: candidate changes polarity, actor, patient, time, place, quantity, certainty, attribution, causal role, or another material value.
- `none`: no added, dropped, or altered material fact.
- `not_assessable`: supplied context is insufficient. Do not combine this with another value.

### 5. `private_disclosure`
Choose one:

- `none`: no private fact outside the licensed source is disclosed.
- `present`: prose reveals a private belief, memory, motive, secret, hidden relationship, or unobserved event not licensed by the supplied record/account/links.
- `not_applicable`: the unit is not character speech and supplies no character-perspective boundary.
- `not_assessable`: a perspective boundary matters but the complete perspective is unavailable.

A fact being embarrassing is not enough; it is a disclosure error only when it falls outside the supplied license.

### 6. `naturalness_rating`
Rate surface quality independently of fidelity:

1. very unnatural or difficult to read;
2. noticeably awkward, repetitive, or mechanical;
3. understandable and serviceable;
4. natural and fluent with minor issues;
5. highly natural, concise, and appropriate to its stated register.

Do not lower naturalness merely because the content is factually wrong; record that under fidelity labels.

### 7. `relevance_rating`
Rate relevance independently of naturalness and fidelity:

1. unrelated to the source/annotation task;
2. mostly tangential;
3. partly relevant but padded or indirect;
4. directly relevant with minor excess or omission;
5. precisely focused on the source and field role.

A concise refusal can be highly relevant when the licensed account is null; a fluent answer to another question can be natural but irrelevant.

## Recommended annotation record

```json
{
  "id": "RF-…",
  "claim_fidelity": "faithful|partially_faithful|unfaithful|not_applicable|not_assessable",
  "requires_correspondence": "faithful|partial|mismatch|not_applicable|not_assessable",
  "needs_correspondence": "faithful|partial|mismatch|not_applicable|not_assessable",
  "defeats_correspondence": "faithful|partial|mismatch|not_applicable|not_assessable",
  "claimless_unsupported_implication": "none|present|not_applicable|not_assessable",
  "fact_errors": ["none"],
  "private_disclosure": "none|present|not_applicable|not_assessable",
  "naturalness_rating": 1,
  "relevance_rating": 1,
  "notes": "Brief evidence-based rationale"
}
```

## Workflow and adjudication

1. Train annotators on examples not present in this export. Discuss only codebook interpretation, not model identity or expected performance.
2. Assign every item independently to at least two annotators. Randomize display order per annotator while retaining the stable ID.
3. Require a short rationale for every `unfaithful`, `mismatch`, `present`, `added_fact`, `dropped_fact`, `altered_fact`, or `not_assessable` label.
4. Lock first-pass annotations before computing agreement or revealing the key. Report agreement separately for categorical labels and the two ordinal ratings.
5. An adjudicator reviews disagreements using the same blinded item and both rationales. The adjudicator may choose either label or a third codebook-valid label and must record a rationale.
6. If adjudication requires information absent from the item, use `not_assessable`; do not consult a verdict or silently reconstruct context. Log systematic missing-context cases as an export limitation.
7. Reveal the key only after adjudication is frozen. Use verdicts for analysis, never to revise human labels.

For multi-link items, note which alias caused a partial or mismatch decision. Preserve raw independent annotations, adjudicated labels, annotator IDs, timestamps, and the exact item/codebook hashes in the study archive.
"""


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def file_sha256(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def stable_id(locator: str) -> str:
    digest = sha256_text(f"{ID_NAMESPACE}\0{locator}")[:20].upper()
    return f"RF-{digest}"


def display_maps(case: dict[str, Any]) -> dict[str, str]:
    values: dict[str, str] = {}
    for row in case.get("people") or []:
        if isinstance(row, dict) and row.get("id"):
            values[row["id"]] = row.get("name") or row["id"]
    for row in (case.get("setting") or {}).get("places") or []:
        if isinstance(row, dict) and row.get("id"):
            values[row["id"]] = row.get("name") or row["id"]
    for row in case.get("objects") or []:
        if isinstance(row, dict) and row.get("id"):
            values[row["id"]] = row.get("name") or row["id"]
    return values


def render_refs(value: Any, labels: dict[str, str], aliases: dict[str, str]) -> Any:
    if isinstance(value, list):
        return [render_refs(item, labels, aliases) for item in value]
    if isinstance(value, dict):
        return {key: render_refs(item, labels, aliases) for key, item in value.items()}
    if isinstance(value, str):
        return aliases.get(value, labels.get(value, value))
    return value


def prose(record: dict[str, Any]) -> dict[str, str]:
    return {
        field: record[field]
        for field in PROSE_FIELDS
        if isinstance(record.get(field), str) and record[field].strip()
    }


def load_manifest_cases() -> tuple[list[dict[str, Any]], dict[str, Any], list[Path]]:
    archive = GENERATED_ROOT.parent / "archive" / "2026-10" / "index.json"
    manifest_specs = (("stable", GENERATED_ROOT / "index.json"), ("live", GENERATED_ROOT / "live" / "index.json"), ("archive", archive))
    cases: dict[str, dict[str, Any]] = {}
    manifest_paths: list[Path] = []
    entries = 0
    exclusions: list[dict[str, Any]] = []
    for classification, manifest_path in manifest_specs:
        if classification == "archive" and not manifest_path.is_file():
            continue
        manifest_paths.append(manifest_path)
        for entry in load_json(manifest_path):
            # cases generated after the paper's evidence date are not in its corpus
            m = re.search(r"(\d{8}-\d{6})", str(entry.get("id", "")))
            if m and m.group(1) > CORPUS_FREEZE:
                continue
            entries += 1
            case_path = (manifest_path.parent if classification == "archive" else GENERATED_ROOT) / entry["file"]
            payload = load_json(case_path)
            if payload.get("id") != entry.get("id"):
                raise ValueError(f"Manifest/payload ID mismatch for {case_path}")
            if payload.get("claims_version") != 2:
                exclusions.append({"case_id": entry.get("id"), "reason": "claims_version_not_2"})
                continue
            digest = sha256_text(canonical(payload))
            prior = cases.get(payload["id"])
            if prior:
                if prior["semantic_sha256"] != digest:
                    raise ValueError(f"Conflicting payloads for duplicate case {payload['id']}")
                prior["classifications"].append(classification)
                prior["paths"].append(case_path)
                continue
            cases[payload["id"]] = {
                "payload": payload,
                "classifications": [classification],
                "paths": [case_path],
                "semantic_sha256": digest,
            }
    report = {
        "manifest_entries": entries,
        "unique_claims_v2_cases": len(cases),
        "excluded_cases": exclusions,
    }
    return [cases[key] for key in sorted(cases)], report, manifest_paths


def record_aliases(case: dict[str, Any], focus: dict[str, Any]) -> dict[str, str]:
    ids: list[str] = []
    for value in [focus.get("id"), focus.get("source"), *(focus.get("requires") or []), *(focus.get("needs") or []), *(focus.get("defeats") or [])]:
        if isinstance(value, str) and value not in ids:
            ids.append(value)
    return {value: f"R{index}" for index, value in enumerate(ids, start=1)}


def linked_context(case: dict[str, Any], ids: list[str], aliases: dict[str, str], labels: dict[str, str]) -> list[dict[str, Any]]:
    signs = {row.get("id"): row for row in case.get("signs") or [] if isinstance(row, dict)}
    rules = {row.get("id"): row for row in case.get("rules") or [] if isinstance(row, dict)}
    rows: list[dict[str, Any]] = []
    for value in ids:
        record = signs.get(value) or rules.get(value)
        if not record:
            rows.append({"record_alias": aliases.get(value, "unresolved"), "unresolved": True})
            continue
        rows.append({
            "record_alias": aliases.get(value, value),
            "kind": record.get("kind", "rule"),
            "candidate_prose": prose(record),
            "formal_claim": render_refs(record.get("claim"), labels, aliases),
        })
    return rows


def source_event_context(case: dict[str, Any], source_id: Any, aliases: dict[str, str], labels: dict[str, str]) -> Any:
    event = next((row for row in case.get("events") or [] if row.get("id") == source_id), None)
    if not event:
        return None
    keep = {key: event.get(key) for key in ("id", "type", "start", "end", "place", "agent", "others", "summary") if key in event}
    return render_refs(keep, labels, aliases)


def case_record_item(case_info: dict[str, Any], sign: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    case = case_info["payload"]
    locator = f"case-record\0{case['id']}\0{sign['id']}"
    item_id = stable_id(locator)
    labels = display_maps(case)
    aliases = record_aliases(case, sign)
    links = {
        relation: linked_context(case, list(sign.get(relation) or []), aliases, labels)
        for relation in ("requires", "needs", "defeats")
    }
    account = None
    if sign.get("kind") == "testimony":
        account = {
            "speaker": labels.get(sign.get("speaker"), sign.get("speaker")),
            "statement": sign.get("text"),
            "source_event": source_event_context(case, sign.get("source"), aliases, labels),
        }
    source_record = {
        "record_alias": aliases.get(sign["id"], "R1"),
        "kind": sign.get("kind"),
        "speaker": labels.get(sign.get("speaker"), sign.get("speaker")),
        "about": labels.get(sign.get("about"), sign.get("about")),
        "formal_claim": render_refs(sign.get("claim"), labels, aliases),
        "source_event": source_event_context(case, sign.get("source"), aliases, labels),
    }
    source_record = {key: value for key, value in source_record.items() if value is not None}
    item = {
        "id": item_id,
        "item_type": "case_record",
        "annotation_context": {
            "setting": (case.get("setting") or {}).get("era"),
            "field_roles": {
                "text": "primary player-facing representation",
                "reading": "interpretation available after needs links are satisfied",
                "unlock": "in-world access explanation after requires links are satisfied",
                "unlock_lead": "shared access lead, when present",
            },
        },
        "candidate_prose": prose(sign),
        "source": {"record": source_record, "account": account, "links": links},
    }
    source_hashes = {relative(path): file_sha256(path) for path in case_info["paths"]}
    reviewed = set(case.get("reviewed") or [])
    reviewed_fields = sorted(field for field in PROSE_FIELDS if sign["id"] + "|" + field in reviewed)
    reviewed_fields += sorted(value for value in reviewed if value.startswith(sign["id"] + "|reactions|") or value.startswith(sign["id"] + "|concede|"))
    key = {
        "item_type": "case_record",
        "case_id": case["id"],
        "episode_id": None,
        "step": sign["id"],
        "model": None,
        "arm": case_info["classifications"],
        "formal_claim": sign.get("claim"),
        "formal_links": {relation: list(sign.get(relation) or []) for relation in ("requires", "needs", "defeats")},
        "code_verdict": {"claims_version": case.get("claims_version"), "published_manifest": True},
        "model_verdict": {
            "review_version": case.get("review_version"),
            "surface_checked": sign.get("surface_checked"),
            "reviewed_fields": reviewed_fields,
        },
        "source": {"record_id": sign["id"], "paths": sorted(source_hashes)},
        "source_hashes": source_hashes,
        "locator_sha256": sha256_text(locator),
    }
    return item, key


def record_identity(record: dict[str, Any], index: int) -> str:
    value = record.get("id") if isinstance(record, dict) else None
    return str(value) if value is not None else f"index:{index}"


def structured_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    delta: dict[str, list[dict[str, Any]]] = {}
    for collection in RECORD_LISTS:
        old_rows = before.get(collection) or []
        new_rows = after.get(collection) or []
        old = {record_identity(row, index): row for index, row in enumerate(old_rows)}
        new = {record_identity(row, index): row for index, row in enumerate(new_rows)}
        changes: list[dict[str, Any]] = []
        for identity in sorted(set(old) | set(new)):
            if identity not in old:
                changes.append({"change": "added", "record": new[identity]})
            elif identity not in new:
                changes.append({"change": "removed", "record": old[identity]})
            elif canonical(old[identity]) != canonical(new[identity]):
                changes.append({"change": "changed", "before": old[identity], "after": new[identity]})
        if changes:
            delta[collection] = changes
    return delta


CORPUS_FREEZE = "20261024-235959"   # generation runs and cases after this are not in the paper's corpus
# the playtest batches in the paper's corpus, as on its evidence date: batches played later (tools/playtest/runs/<new>)
# are not in it
PLAYTEST_ARMS = frozenset({"e0-heldout", "e0-train", "e0x-heldout", "e1-heldout", "e1-train", "e2a-heldout", "e2b-heldout",
                           "e2c-heldout", "e3-base", "e3a", "e3a-train", "e3c", "e3d", "local-gemma"})
GAME_LOG_FREEZE = "2026-10-13T00:00:00"   # the game log's play sessions in the paper's corpus end on 12 October


def _run_stamp(path: Path) -> str:
    """The timestamp a run directory is named with (live-YYYYMMDD-HHMMSS), or '' for one without."""
    m = re.search(r"(\d{8}-\d{6})", path.parent.name)
    return m.group(1) if m else ""


def generation_candidates() -> tuple[list[tuple[dict[str, Any], dict[str, Any]]], dict[str, Any], list[Path]]:
    exported: list[tuple[dict[str, Any], dict[str, Any]]] = []
    inspected_paths: list[Path] = []
    exclusions = Counter()
    history_entries = 0
    # the corpus is frozen at the paper's evidence date: generation runs made later (regenerated menu cases) are not in it
    result_files = sorted((path for path in RUNS_ROOT.rglob("result.json")
                           if "experiments" not in path.relative_to(RUNS_ROOT).parts and _run_stamp(path) <= CORPUS_FREEZE), key=relative)
    for result_path in result_files:
        inspected_paths.append(result_path)
        result = load_json(result_path)
        run_dir = result_path.parent
        final_path = run_dir / "final-case.json"
        seed_path = run_dir / "00-seed.json"
        version_path = final_path if final_path.is_file() else seed_path
        version = None
        if version_path.is_file():
            try:
                version = load_json(version_path).get("claims_version")
            except (json.JSONDecodeError, AttributeError):
                version = None
        for history in result.get("history") or []:
            history_entries += 1
            if version != 2:
                exclusions["current_claims_schema_unavailable"] += 1
                continue
            if not isinstance(history.get("story"), str) or not history["story"].strip():
                exclusions["candidate_story_not_persisted"] += 1
                continue
            if not history.get("critic"):
                exclusions["critic_record_not_persisted"] += 1
                continue
            step = history.get("step")
            before_path = seed_path if step == 1 else run_dir / f"{step - 1:02d}-case.json"
            after_path = run_dir / f"{step:02d}-case.json"
            if not before_path.is_file() or not after_path.is_file():
                exclusions["exact_stage_snapshot_missing"] += 1
                continue
            before = load_json(before_path)
            after = load_json(after_path)
            delta = structured_delta(before, after)
            if not delta:
                exclusions["empty_structured_delta"] += 1
                continue
            source_paths = [result_path, before_path, after_path]
            inspected_paths.extend([before_path, after_path])
            locator = f"generation-candidate\0{run_dir.relative_to(RUNS_ROOT).as_posix()}\0{step}"
            item_id = stable_id(locator)
            item = {
                "id": item_id,
                "item_type": "generation_candidate",
                "annotation_context": {
                    "representation_target": "The prose should faithfully describe the exact structured case delta.",
                    "delta_collections": sorted(delta),
                },
                "candidate_prose": {"story": history["story"]},
                "source": {"record": {"structured_delta": delta}, "account": None, "links": {"requires": [], "needs": [], "defeats": []}},
            }
            changed_signs: list[dict[str, Any]] = []
            for change in delta.get("signs", []):
                record = change.get("after") or change.get("record") or change.get("before")
                if isinstance(record, dict):
                    changed_signs.append(record)
            critics = history.get("critic") or []
            key = {
                "item_type": "generation_candidate",
                "case_id": after.get("id"),
                "episode_id": run_dir.relative_to(RUNS_ROOT).as_posix(),
                "step": step,
                "model": sorted({critic.get("model") for critic in critics if critic.get("model")}),
                "arm": history.get("mode"),
                "formal_claim": [sign.get("claim") for sign in changed_signs if sign.get("claim") is not None],
                "formal_links": [
                    {"record_id": sign.get("id"), **{relation: list(sign.get(relation) or []) for relation in ("requires", "needs", "defeats")}}
                    for sign in changed_signs
                ],
                "code_verdict": {
                    "accepted": history.get("accepted"),
                    "accepted_candidate_number": next((index for index, reasons in enumerate(history.get("attempts") or [], start=1) if not reasons), None),
                },
                "model_verdict": critics,
                "source": {"paths": [relative(path) for path in source_paths]},
                "source_hashes": {relative(path): file_sha256(path) for path in source_paths},
                "locator_sha256": sha256_text(locator),
            }
            exported.append((item, key))
    report = {
        "result_files": len(result_files),
        "history_entries": history_entries,
        "exported": len(exported),
        "exclusions": dict(sorted(exclusions.items())),
    }
    return exported, report, sorted(set(inspected_paths), key=relative)


def inspect_game_log(retained_case_ids: set[str]) -> tuple[dict[str, Any], list[Path]]:
    rows = 0
    turns = 0
    attempts = 0
    joined_attempts = 0
    spoken_turns = 0
    with_rejections = 0
    for line in GAME_LOG.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if str(row.get("server", "")) > GAME_LOG_FREEZE:   # play after the paper's evidence date is not in its corpus
            continue
        rows += 1
        if row.get("kind") != "character_turn":
            continue
        turns += 1
        count = len(row.get("attempts") or [])
        attempts += count
        if row.get("caseId") in retained_case_ids:
            joined_attempts += count
        if isinstance(row.get("spoken"), str) and row["spoken"].strip():
            spoken_turns += 1
        if isinstance(row.get("rejections"), list):
            with_rejections += 1
    return {
        "log_rows": rows,
        "character_turns": turns,
        "candidate_attempts": attempts,
        "attempts_with_retained_case": joined_attempts,
        "attempts_without_retained_case": attempts - joined_attempts,
        "turns_with_final_spoken_text": spoken_turns,
        "turns_with_rejection_summary": with_rejections,
        "exported": 0,
        "exclusions": {"complete_preparation_ticket_not_persisted": attempts},
        "note": "The final spoken field is selected after validation and is not used as a verdict-independent candidate sample.",
        "sha256": file_sha256(GAME_LOG),
    }, [GAME_LOG]


def inspect_playtests() -> tuple[dict[str, Any], list[Path]]:
    paths: list[Path] = []
    episodes = 0
    steps = 0
    dialogue_steps = 0
    by_arm: Counter[str] = Counter()
    for path in sorted(PLAYTEST_ROOT.glob("**/*.json"), key=relative):
        # Incomplete/new experimental cohorts have their own analyses and must not silently change this historical export.
        parts = path.relative_to(PLAYTEST_ROOT).parts
        if any(part.startswith("e6-aa-") for part in parts) or (len(parts) > 1 and parts[0] not in PLAYTEST_ARMS):
            continue
        try:
            value = load_json(path)
        except json.JSONDecodeError:
            continue
        if not (isinstance(value, dict) and value.get("id") and isinstance((value.get("report") or {}).get("trace"), list)):
            continue
        paths.append(path)
        episodes += 1
        by_arm[path.parent.name] += 1
        for step in value.get("steps") or []:
            steps += 1
            if (step.get("action") or {}).get("type") in {"ask", "say", "show"}:
                dialogue_steps += 1
    digest_lines = "".join(f"{relative(path)}\0{file_sha256(path)}\n" for path in paths)
    return {
        "raw_episodes": episodes,
        "steps": steps,
        "dialogue_steps": dialogue_steps,
        "episodes_by_arm": dict(sorted(by_arm.items())),
        "exported": 0,
        "exclusions": {"complete_ticket_and_candidate_audit_not_persisted": dialogue_steps},
        "aggregate_source_sha256": sha256_text(digest_lines),
    }, paths


def strata(items: list[dict[str, Any]], key: dict[str, Any]) -> dict[str, Any]:
    case_counts: Counter[str] = Counter()
    generation_counts: Counter[str] = Counter()
    for item in items:
        metadata = key[item["id"]]
        if item["item_type"] == "case_record":
            record = item["source"]["record"]
            links = item["source"]["links"]
            label = "|".join((
                f"kind={record.get('kind')}",
                f"claim={record.get('formal_claim') is not None}",
                f"requires={bool(links['requires'])}",
                f"needs={bool(links['needs'])}",
                f"defeats={bool(links['defeats'])}",
            ))
            case_counts[label] += 1
        else:
            generation_counts[f"mode={metadata.get('arm')}"] += 1
    return {"case_record": dict(sorted(case_counts.items())), "generation_candidate": dict(sorted(generation_counts.items()))}


def aggregate_source_hash(paths: list[Path]) -> str:
    unique = sorted(set(paths), key=relative)
    return sha256_text("".join(f"{relative(path)}\0{file_sha256(path)}\n" for path in unique))


def render_report(report: dict[str, Any]) -> str:
    pop = report["population"]
    lines = [
        "# Representation-fidelity export report",
        "",
        "## Result",
        "",
        f"Exported **{report['export']['items']}** blinded items: **{pop['case_records']['exported']}** complete published case-record items and **{pop['generation_candidates']['exported']}** complete retained generation-candidate items. No dialogue or playtest candidate was exported because the compact records do not retain the complete preparation ticket required for independent fidelity annotation.",
        "",
        "## Predeclared inclusion",
        "",
    ]
    lines.extend(f"- **{name}:** {rule}" for name, rule in report["protocol"]["inclusion_rules"].items())
    lines.extend([
        "",
        "No inclusion or sampling decision reads a code verdict, model verdict, case difficulty, model identity, or experimental arm. All eligible retained items are exported; there is no verdict-conditioned sample.",
        "",
        "## Population and exclusions",
        "",
        "| Source | Inspected population | Exported | Excluded | Why |",
        "|---|---:|---:|---:|---|",
        f"| Claims-v2 manifest case signs | {pop['case_records']['sign_records']} | {pop['case_records']['exported']} | {pop['case_records']['excluded']} | Empty primary text or non-v2 payload (none among included cases) |",
        f"| Retained generation history entries | {pop['generation_candidates']['history_entries']} | {pop['generation_candidates']['exported']} | {pop['generation_candidates']['history_entries'] - pop['generation_candidates']['exported']} | {json.dumps(pop['generation_candidates']['exclusions'], sort_keys=True)} |",
        f"| Full game-log candidate attempts | {pop['dialogue_audits']['candidate_attempts']} | 0 | {pop['dialogue_audits']['candidate_attempts']} | Complete preparation ticket not persisted |",
        f"| Compact playtest dialogue steps | {pop['playtest_traces']['dialogue_steps']} | 0 | {pop['playtest_traces']['dialogue_steps']} | Complete ticket and candidate-level audit not persisted |",
        "",
        "## Inspected sources",
        "",
        f"- Generated cases: {pop['case_records']['cases']} unique claims-v2 cases, {pop['case_records']['sign_records']} signs.",
        f"- Full game log: {pop['dialogue_audits']['log_rows']} rows, {pop['dialogue_audits']['character_turns']} character turns, {pop['dialogue_audits']['candidate_attempts']} attempts; {pop['dialogue_audits']['attempts_with_retained_case']} attempts refer to retained cases and {pop['dialogue_audits']['attempts_without_retained_case']} do not.",
        f"- Playtests: {pop['playtest_traces']['raw_episodes']} raw episodes across {len(pop['playtest_traces']['episodes_by_arm'])} directories, {pop['playtest_traces']['steps']} steps, {pop['playtest_traces']['dialogue_steps']} dialogue steps.",
        f"- Generation: {pop['generation_candidates']['result_files']} result files and {pop['generation_candidates']['history_entries']} history entries.",
        "",
        "## Strata",
        "",
        "Case-record strata are the full cross-product of record kind and presence of claim/requires/needs/defeats links. Generation strata use the persisted refinement mode. Exact counts are in the JSON report under `strata`.",
        "",
        "## Hashes",
        "",
    ])
    for name, digest in report["hashes"]["artifacts"].items():
        lines.append(f"- `{name}`: `{digest}`")
    lines.extend([
        f"- Evidence-source aggregate: `{report['hashes']['evidence_source_aggregate_sha256']}`",
        f"- Inspected playtest aggregate: `{pop['playtest_traces']['aggregate_source_sha256']}`",
        f"- Full game log: `{pop['dialogue_audits']['sha256']}`",
        "",
        "## Limitations",
        "",
    ])
    lines.extend(f"- {value}" for value in report["limitations"])
    return "\n".join(lines) + "\n"


def build_export(output_dir: Path = DEFAULT_OUTPUT_DIR) -> dict[str, Any]:
    cases, case_report, manifest_paths = load_manifest_cases()
    items: list[dict[str, Any]] = []
    key_items: dict[str, Any] = {}
    included_paths: list[Path] = list(manifest_paths)
    case_exclusions = Counter()
    sign_records = 0
    for case_info in cases:
        included_paths.extend(case_info["paths"])
        for sign in case_info["payload"].get("signs") or []:
            sign_records += 1
            if not isinstance(sign.get("text"), str) or not sign["text"].strip():
                case_exclusions["empty_primary_text"] += 1
                continue
            item, metadata = case_record_item(case_info, sign)
            items.append(item)
            key_items[item["id"]] = metadata

    generation_rows, generation_report, generation_paths = generation_candidates()
    included_paths.extend(generation_paths)
    for item, metadata in generation_rows:
        items.append(item)
        key_items[item["id"]] = metadata

    if len(items) != len({item["id"] for item in items}):
        raise ValueError("Blinded ID collision")
    items.sort(key=lambda row: row["id"])
    key_items = {item_id: key_items[item_id] for item_id in sorted(key_items)}

    retained_ids = {case_info["payload"]["id"] for case_info in cases}
    dialogue_report, _ = inspect_game_log(retained_ids)
    playtest_report, _ = inspect_playtests()

    output_dir.mkdir(parents=True, exist_ok=True)
    item_path = output_dir / "representation_fidelity_items.jsonl"
    key_path = output_dir / "representation_fidelity_key.json"
    codebook_path = output_dir / "representation_fidelity_codebook.md"
    report_json_path = output_dir / "representation_fidelity_report.json"
    report_md_path = output_dir / "representation_fidelity_report.md"

    item_text = "".join(canonical(item) + "\n" for item in items)
    key_document = {
        "schema_version": SCHEMA_VERSION,
        "id_namespace": ID_NAMESPACE,
        "warning": "Restricted analysis key: do not give to annotators before adjudication is frozen.",
        "items": key_items,
    }
    key_text = json.dumps(key_document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    codebook_text = CODEBOOK
    if not codebook_text.endswith("\n"):
        codebook_text += "\n"
    item_path.write_text(item_text, encoding="utf-8")
    key_path.write_text(key_text, encoding="utf-8")
    codebook_path.write_text(codebook_text, encoding="utf-8")

    case_exported = sign_records - sum(case_exclusions.values())
    report = {
        "schema_version": SCHEMA_VERSION,
        "title": "E4 offline representation-fidelity export",
        "protocol": {
            "selection": "complete eligible subset; no sampling",
            "inclusion_rules": INCLUSION_RULES,
            "verdict_independent": True,
            "network_or_model_calls": False,
        },
        "population": {
            "case_records": {
                **case_report,
                "cases": len(cases),
                "sign_records": sign_records,
                "exported": case_exported,
                "excluded": sum(case_exclusions.values()),
                "exclusions": dict(sorted(case_exclusions.items())),
            },
            "generation_candidates": generation_report,
            "dialogue_audits": dialogue_report,
            "playtest_traces": playtest_report,
        },
        "export": {
            "items": len(items),
            "by_type": dict(sorted(Counter(item["item_type"] for item in items).items())),
            "files": [path.name for path in (item_path, key_path, codebook_path, report_json_path, report_md_path)],
        },
        "strata": strata(items, key_items),
        "hashes": {
            "artifacts": {
                item_path.name: file_sha256(item_path),
                key_path.name: file_sha256(key_path),
                codebook_path.name: file_sha256(codebook_path),
            },
            "evidence_source_aggregate_sha256": aggregate_source_hash(included_paths),
            "evidence_source_files": {relative(path): file_sha256(path) for path in sorted(set(included_paths), key=relative)},
        },
        "limitations": [
            "Published case records are survivors of generation and publication gates; rejected sign prose was not retained, so the export cannot estimate pre-gate failure prevalence.",
            "Retained generation stories exist only for accepted structured candidates. Rejected candidates retain reasons but not candidate prose; all 14 complete current-schema stories are included, but the retention process itself is verdict-selected.",
            "Game-log attempt replies are truncated to 400 characters and the preparation ticket is absent. Even when a final spoken string or critic record is present, using it would either select on verdict or require invented/replayed context, so all 1,460 attempts are excluded.",
            "Compact playtest traces retain player-visible dialogue but not the preparation ticket or candidate-level validation/critic audit, so all dialogue steps are excluded from fidelity annotation.",
            "Four game-log case IDs no longer have retained generated case payloads; these are counted within dialogue exclusions rather than heuristically joined.",
            "The two claims-v2 generation runs are a small convenience corpus and support descriptive annotation only.",
            "Naturalness and relevance are human judgments; the codebook does not make them deterministic.",
        ],
    }
    report_json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    report_md_path.write_text(render_report(report), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()
    report = build_export(args.output_dir.resolve())
    print(canonical({"items": report["export"]["items"], "by_type": report["export"]["by_type"], "output_dir": str(args.output_dir.resolve())}))


if __name__ == "__main__":
    main()
