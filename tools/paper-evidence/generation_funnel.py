#!/usr/bin/env python3
"""Build deterministic offline evidence for the claims-version-2 generation funnel."""

from __future__ import annotations

import ast
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


CLAIMS_VERSION = 2
FAILED_JOB_ID = "live-20261011-132544"
CATEGORIES = (
    "provider_call",
    "patch_application",
    "model_critic",
    "refinement_law",
    "hard_certification",
)
ROOT = Path(__file__).resolve().parents[2]
RUNS_ROOT = ROOT / "tools" / "refine-c" / "runs"
LIVE_INDEX = ROOT / "dist" / "cases" / "generated" / "live" / "index.json"
OUTPUT_JSON = Path(__file__).resolve().parent / "results" / "generation_funnel.json"
OUTPUT_MD = Path(__file__).resolve().parent / "results" / "generation_funnel.md"

PATCH_PREFIX = "patch could not be applied: "
CRITIC_PREFIX = "plausibility review: "
MODEL_CALL_PREFIX = "model call failed: "
SEED_EXCEPTION_PREFIX = "the case JSON was incomplete or malformed ("
PROVIDER_SIGNATURES = (
    "ServiceUnavailableException",
    "ThrottlingException",
    "ModelTimeoutException",
    "InternalServerException",
    "AccessDeniedException",
    "when calling the Converse operation",
    "Bedrock is unable to process your request",
)
NO_STORY_BEAT = (
    "no story beat: every refinement must add the event or attitude that causes it "
    "(who did what, and why)"
)
REFINEMENT_LAW_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"shortcut: the answer is now settled at depth .+",
        r"the twist was lost: the surface now admits the truth again \(surface survivors .+",
        r"the surface still admits the truth \(surface survivors .+",
        r"the culprit's (?:MOTIVE|MEANS) evidence is no longer reachable and true; .+",
        re.escape(NO_STORY_BEAT),
        r"no new positive evidence: .+",
        r"no surface behaviour sign about '.+' with a deeper explainedBy sign was found",
        r"the (?:motive|means) evidence is no longer reachable; .+",
        r"no progress: the (?:motive|means) is still shown at depth .+",
        r"the target '.+' is no longer obtainable or readable at all; .+",
        r"no progress: the '.+' thread is still settled at depth .+",
    )
)
SEED_LOG_RE = re.compile(
    r"^\d{2}:\d{2}:\d{2} \[live\] seed round (?P<round>\d+) rejected: (?P<reasons>.+)$"
)


def relative(path: Path) -> str:
    """Return a stable repository-relative POSIX path."""
    return path.relative_to(ROOT).as_posix()


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def claims_version(path: Path) -> int | None:
    """Read a case version without inferring it from directory names or current code."""
    try:
        value = read_json(path)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    version = value.get("claims_version")
    return version if isinstance(version, int) and not isinstance(version, bool) else None


def enumerate_run_directories() -> tuple[list[Path], list[Path]]:
    """Enumerate artifact-bearing directories and the strict completed v2 cohort."""
    artifact_directories: list[Path] = []
    completed_v2: list[Path] = []
    for directory in sorted((path for path in RUNS_ROOT.rglob("*") if path.is_dir()), key=relative):
        final_path = directory / "final-case.json"
        seed_path = directory / "00-seed.json"
        result_path = directory / "result.json"
        if not (final_path.exists() or seed_path.exists() or result_path.exists()):
            continue
        artifact_directories.append(directory)
        evidence_path = final_path if final_path.exists() else seed_path
        has_v2_case = evidence_path.exists() and claims_version(evidence_path) == CLAIMS_VERSION
        if has_v2_case and result_path.is_file():
            completed_v2.append(directory)
    return artifact_directories, completed_v2


def classify_reason(raw: str, source: str) -> list[str]:
    """Classify one persisted rejection using current refine.py writer patterns."""
    categories: list[str] = []
    if raw.startswith(MODEL_CALL_PREFIX):
        categories.append("provider_call")
    elif raw.startswith(SEED_EXCEPTION_PREFIX) and any(token in raw for token in PROVIDER_SIGNATURES):
        categories.append("provider_call")
    if raw.startswith(PATCH_PREFIX):
        categories.append("patch_application")
    if raw.startswith(CRITIC_PREFIX):
        categories.append("model_critic")
    if any(pattern.fullmatch(raw) for pattern in REFINEMENT_LAW_PATTERNS):
        categories.append("refinement_law")
    # In refinement history, unmatched strings come from setting/premise/history/certify checks.
    # In seed logs, non-exception strings are likewise deterministic case checks.
    if not categories and source in {"history_attempt", "seed_log"} and not raw.startswith(SEED_EXCEPTION_PREFIX):
        categories.append("hard_certification")
    if not categories:
        raise ValueError(f"Unclassified {source} rejection reason: {raw}")
    return [category for category in CATEGORIES if category in categories]


def reason_row(raw: Any, source: str) -> dict[str, Any]:
    text = str(raw)
    return {"raw": text, "categories": classify_reason(text, source)}


def candidate_outcomes(history: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], Counter[str]]:
    steps: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    for entry in history:
        outcomes: list[dict[str, Any]] = []
        for candidate_number, raw_reasons in enumerate(entry.get("attempts") or [], start=1):
            reasons = [reason_row(raw, "history_attempt") for raw in (raw_reasons or [])]
            categories = [
                category
                for category in CATEGORIES
                if any(category in reason["categories"] for reason in reasons)
            ]
            outcome = "rejected" if reasons else "accepted"
            outcomes.append(
                {
                    "candidate": candidate_number,
                    "outcome": outcome,
                    "categories": categories,
                    "reasons": reasons,
                }
            )
            if reasons:
                counts["rejected_candidates"] += 1
                for reason in reasons:
                    counts.update(reason["categories"])
            else:
                counts["accepted_candidate_outcomes"] += 1
            counts["recorded_candidate_outcomes"] += 1
        critics = entry.get("critic") or []
        counts["critic_calls"] += len(critics)
        counts["critic_rejections"] += sum(item.get("pass") is False for item in critics)
        if entry.get("accepted") is True:
            counts["accepted_steps"] += 1
        counts["history_steps"] += 1
        steps.append(
            {
                "step": entry.get("step"),
                "mode": entry.get("mode"),
                "target": entry.get("target"),
                "thread": entry.get("thread"),
                "accepted": entry.get("accepted") is True,
                "candidate_outcomes": outcomes,
                "critic_calls": len(critics),
                "critic_rejections": sum(item.get("pass") is False for item in critics),
            }
        )
    return steps, counts


def published_rows() -> list[dict[str, Any]]:
    if not LIVE_INDEX.is_file():
        return []
    value = read_json(LIVE_INDEX)
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def published_difficulty(run_id: str, index: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not run_id.startswith("live-"):
        return None
    stamp = run_id.removeprefix("live-")
    expected_id = f"mk-live-{stamp}"
    expected_file = f"live/{expected_id}.json"
    for row in index:
        if row.get("generated") != stamp:
            continue
        if row.get("id") != expected_id or row.get("file") != expected_file:
            continue
        difficulty = row.get("difficulty")
        if not isinstance(difficulty, dict):
            return None
        return {
            "level": difficulty.get("level"),
            "score": difficulty.get("score"),
            "target": difficulty.get("target"),
            "index_path": relative(LIVE_INDEX),
        }
    return None


def completed_row(directory: Path, index: list[dict[str, Any]]) -> tuple[dict[str, Any], Counter[str]]:
    result_path = directory / "result.json"
    final_path = directory / "final-case.json"
    seed_path = directory / "00-seed.json"
    result = read_json(result_path)
    if not isinstance(result, dict):
        raise ValueError(f"Expected an object in {result_path}")
    evidence_path = final_path if claims_version(final_path) == CLAIMS_VERSION else seed_path
    history = [item for item in (result.get("history") or []) if isinstance(item, dict)]
    steps, counts = candidate_outcomes(history)
    metrics = result.get("metrics") if isinstance(result.get("metrics"), dict) else {}
    run_id = directory.relative_to(RUNS_ROOT).as_posix()
    published = published_difficulty(run_id, index)
    target = published.get("target") if published else None
    row = {
        "run_id": run_id,
        "row_type": "completed_v2",
        "status": "completed",
        "classification": "completed_claims_v2",
        "claims_version": CLAIMS_VERSION,
        "case_evidence_path": relative(evidence_path),
        "result_path": relative(result_path),
        "name": result.get("name"),
        "success": result.get("ok"),
        "seconds": result.get("seconds"),
        "final_counts": {
            "signs": result.get("signs"),
            "events": result.get("events"),
            "people": result.get("people"),
        },
        "solve_depth": metrics.get("solve_depth"),
        "max_depth": metrics.get("max_depth"),
        "twist": metrics.get("twist"),
        "threads": metrics.get("threads"),
        "pillars": metrics.get("pillars"),
        "requested_target": target,
        "published_difficulty": published,
        "funnel": {key: counts[key] for key in (
            "history_steps",
            "accepted_steps",
            "recorded_candidate_outcomes",
            "accepted_candidate_outcomes",
            "rejected_candidates",
            "critic_calls",
            "critic_rejections",
        )},
        "history": steps,
        "unavailable": {
            "exact_llm_calls": None,
            "input_tokens": None,
            "output_tokens": None,
            "cost": None,
        },
    }
    return row, counts


def failed_job_row() -> tuple[dict[str, Any], Counter[str]]:
    directory = RUNS_ROOT / FAILED_JOB_ID
    log_path = RUNS_ROOT / f"{FAILED_JOB_ID}.log"
    if not directory.is_dir() or not log_path.is_file():
        raise FileNotFoundError(f"Required failed-job evidence is missing for {FAILED_JOB_ID}")
    attempts: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    with log_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            match = SEED_LOG_RE.fullmatch(line.rstrip("\n"))
            if not match:
                continue
            parsed = ast.literal_eval(match.group("reasons"))
            if not isinstance(parsed, list):
                raise ValueError(f"Expected a reason list in {log_path}")
            reasons = [reason_row(raw, "seed_log") for raw in parsed]
            categories = [
                category
                for category in CATEGORIES
                if any(category in reason["categories"] for reason in reasons)
            ]
            attempts.append(
                {
                    "seed_round": int(match.group("round")),
                    "outcome": "rejected",
                    "categories": categories,
                    "reasons": reasons,
                }
            )
            counts["recorded_seed_attempts"] += 1
            counts["rejected_seed_attempts"] += 1
            for reason in reasons:
                counts.update(reason["categories"])
    if not attempts:
        raise ValueError(f"No seed rejection rows found in {log_path}")
    if any(attempt["categories"] != ["provider_call"] for attempt in attempts):
        raise ValueError(f"Failed job {FAILED_JOB_ID} is no longer solely a provider-call seed failure")
    row = {
        "run_id": FAILED_JOB_ID,
        "row_type": "attempted_job",
        "status": "censored",
        "classification": "external_provider_unavailable",
        "failure_stage": "before_case_artifact",
        "claims_version": None,
        "case_evidence_path": None,
        "result_path": None,
        "log_path": relative(log_path),
        "name": "live",
        "success": None,
        "seconds": None,
        "final_counts": {"signs": None, "events": None, "people": None},
        "solve_depth": None,
        "max_depth": None,
        "twist": None,
        "threads": None,
        "pillars": None,
        "requested_target": None,
        "published_difficulty": None,
        "funnel": {
            "recorded_seed_attempts": counts["recorded_seed_attempts"],
            "rejected_seed_attempts": counts["rejected_seed_attempts"],
        },
        "seed_attempts": attempts,
        "unavailable": {
            "exact_llm_calls": None,
            "input_tokens": None,
            "output_tokens": None,
            "cost": None,
            "failed_job_duration_seconds": None,
        },
    }
    return row, counts


def zero_categories() -> dict[str, int]:
    return {category: 0 for category in CATEGORIES}


def category_dict(counts: Counter[str]) -> dict[str, int]:
    return {category: counts[category] for category in CATEGORIES}


def build_evidence() -> dict[str, Any]:
    artifact_directories, completed_directories = enumerate_run_directories()
    index = published_rows()
    completed_rows: list[dict[str, Any]] = []
    completed_counts: Counter[str] = Counter()
    for directory in completed_directories:
        row, counts = completed_row(directory, index)
        completed_rows.append(row)
        completed_counts.update(counts)
    failed_row, failed_counts = failed_job_row()
    if any(row["run_id"] == FAILED_JOB_ID for row in completed_rows):
        raise ValueError(f"{FAILED_JOB_ID} unexpectedly entered the completed v2 cohort")
    run_rows = completed_rows + [failed_row]
    all_categories = Counter({category: completed_counts[category] + failed_counts[category] for category in CATEGORIES})
    completed_ids = [row["run_id"] for row in completed_rows]
    return {
        "schema_version": 1,
        "corpus_definition": {
            "claims_version": CLAIMS_VERSION,
            "runs_root": relative(RUNS_ROOT),
            "completed_cohort_rule": (
                "A directory must contain final-case.json or 00-seed.json whose parsed object has "
                "claims_version == 2, and it must contain result.json. result.json is joined only after "
                "the case-version check."
            ),
            "attempted_job_scope": (
                "Strict completed claims-version-2 rows plus the explicitly selected provider-censored attempt "
                f"{FAILED_JOB_ID}; no-case directories are not assigned a claims version."
            ),
            "artifact_directories_enumerated": [
                directory.relative_to(RUNS_ROOT).as_posix() for directory in artifact_directories
            ],
            "completed_v2_run_ids": completed_ids,
            "externally_censored_attempt_ids": [FAILED_JOB_ID],
        },
        "run_rows": run_rows,
        "aggregate_funnel": {
            "attempted_jobs": len(run_rows),
            "completed_v2_jobs": len(completed_rows),
            "completed_v2_successes": sum(row["success"] is True for row in completed_rows),
            "algorithmic_generation_failures": 0,
            "externally_censored_provider_jobs": 1,
            "completed_v2_refinement": {
                key: completed_counts[key]
                for key in (
                    "history_steps",
                    "accepted_steps",
                    "recorded_candidate_outcomes",
                    "accepted_candidate_outcomes",
                    "rejected_candidates",
                    "critic_calls",
                    "critic_rejections",
                )
            },
            "provider_censored_seed": {
                "recorded_seed_attempts": failed_counts["recorded_seed_attempts"],
                "rejected_seed_attempts": failed_counts["rejected_seed_attempts"],
            },
            "all_recorded_candidate_or_seed_outcomes": (
                completed_counts["recorded_candidate_outcomes"] + failed_counts["recorded_seed_attempts"]
            ),
            "all_recorded_rejected_candidate_or_seed_outcomes": (
                completed_counts["rejected_candidates"] + failed_counts["rejected_seed_attempts"]
            ),
        },
        "category_counts": {
            "completed_v2_refinement_reasons": category_dict(completed_counts),
            "provider_censored_seed_reasons": category_dict(failed_counts),
            "all_recorded_rejection_reasons": category_dict(all_categories),
        },
        "caveats": [
            "Exact LLM call counts, input/output token counts, and cost were not persisted for these live v2 runs and are unavailable.",
            "The externally censored job has no persisted duration; log timestamps are not promoted to an elapsed-duration measurement.",
            "Requested difficulty target is unavailable unless the live run can be joined to a published index row with difficulty.target.",
            "The provider-censored attempt has no case object, so its claims version is unknown rather than inferred from its directory date or current source code.",
            "Candidate outcomes are persisted evaluation outcomes, not necessarily every parallel model request; cancelled or unfinished requests are not counted.",
            "Rejection categories count raw reason strings. One rejected candidate can carry multiple reasons and categories.",
            "The attempted-job view is curated (strict completed v2 runs plus one explicitly selected provider-censored job), not an exhaustive success-rate denominator.",
            "The sample is too small for reliability claims.",
        ],
    }


def md_value(value: Any) -> str:
    if value is None:
        return "unavailable"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (dict, list)):
        return f"`{json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))}`"
    return str(value)


def render_markdown(evidence: dict[str, Any]) -> str:
    rows = evidence["run_rows"]
    aggregate = evidence["aggregate_funnel"]
    completed = aggregate["completed_v2_refinement"]
    lines = [
        "# Generation funnel evidence",
        "",
        "## Corpus",
        "",
        f"The parser enumerated `{evidence['corpus_definition']['runs_root']}`. The strict completed cohort requires a parsed "
        "`final-case.json` or `00-seed.json` with `claims_version == 2` before joining `result.json`. "
        f"It found {aggregate['completed_v2_jobs']} completed v2 run(s). The curated attempted-job view also includes the explicitly "
        f"selected provider-censored `{FAILED_JOB_ID}`; its claims version is unknown and this is not an exhaustive job cohort.",
        "",
        "## Jobs",
        "",
        "| Run | Row | Status | Success | Seconds | Target | Failure classification |",
        "|---|---|---|---:|---:|---|---|",
    ]
    for row in rows:
        lines.append(
            "| {run_id} | {row_type} | {status} | {success} | {seconds} | {target} | {classification} |".format(
                run_id=row["run_id"],
                row_type=row["row_type"],
                status=row["status"],
                success=md_value(row["success"]),
                seconds=md_value(row["seconds"]),
                target=md_value(row["requested_target"]),
                classification=row["classification"],
            )
        )
    lines.extend(["", "## Completed v2 results", ""])
    lines.extend([
        "| Run | Name | Signs | Events | People | Solve/max depth | Twist | Threads | Pillars |",
        "|---|---|---:|---:|---:|---|---|---|---|",
    ])
    for row in rows:
        if row["row_type"] != "completed_v2":
            continue
        counts = row["final_counts"]
        lines.append(
            f"| {row['run_id']} | {md_value(row['name'])} | {md_value(counts['signs'])} | "
            f"{md_value(counts['events'])} | {md_value(counts['people'])} | "
            f"{md_value(row['solve_depth'])}/{md_value(row['max_depth'])} | {md_value(row['twist'])} | "
            f"{md_value(row['threads'])} | {md_value(row['pillars'])} |"
        )
    lines.extend([
        "",
        "## Funnel",
        "",
        "| Measure | Count |",
        "|---|---:|",
        f"| Attempted jobs | {aggregate['attempted_jobs']} |",
        f"| Completed v2 jobs | {aggregate['completed_v2_jobs']} |",
        f"| Completed v2 successes | {aggregate['completed_v2_successes']} |",
        f"| Externally censored provider jobs | {aggregate['externally_censored_provider_jobs']} |",
        f"| Algorithmic generation failures | {aggregate['algorithmic_generation_failures']} |",
        f"| Completed v2 history steps | {completed['history_steps']} |",
        f"| Accepted steps | {completed['accepted_steps']} |",
        f"| Recorded refinement candidate outcomes | {completed['recorded_candidate_outcomes']} |",
        f"| Accepted refinement candidate outcomes | {completed['accepted_candidate_outcomes']} |",
        f"| Rejected refinement candidates | {completed['rejected_candidates']} |",
        f"| Critic calls | {completed['critic_calls']} |",
        f"| Critic rejections | {completed['critic_rejections']} |",
        f"| Provider-censored seed rounds | {aggregate['provider_censored_seed']['rejected_seed_attempts']} |",
        "",
        "## Rejection reasons",
        "",
        "Counts are raw persisted reason strings; a candidate may have multiple reasons and categories. The JSON report preserves every raw string.",
        "",
        "| Category | Completed v2 refinement | Provider-censored seed attempt | All |",
        "|---|---:|---:|---:|",
    ])
    categories = evidence["category_counts"]
    for category in CATEGORIES:
        lines.append(
            f"| `{category}` | {categories['completed_v2_refinement_reasons'][category]} | "
            f"{categories['provider_censored_seed_reasons'][category]} | "
            f"{categories['all_recorded_rejection_reasons'][category]} |"
        )
    lines.extend([
        "",
        "## Availability and interpretation",
        "",
        "- Exact LLM calls, tokens, and cost are unavailable because the live result artifacts do not persist them.",
        "- The externally censored job has no persisted duration; timestamps in its log are not treated as an elapsed-duration measurement.",
        "- Requested target is reported only when joined to published `difficulty.target`; it is not inferred from computed difficulty.",
        "- The provider-censored attempt has no case object, so no claims version is inferred for it.",
        "- Recorded candidate outcomes do not include cancelled or unfinished parallel model requests.",
        "",
        "## Conclusion",
        "",
        "The sample is too small for reliability claims.",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    evidence = build_evidence()
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    OUTPUT_MD.write_text(render_markdown(evidence), encoding="utf-8")


if __name__ == "__main__":
    main()
