from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPOSITORY = "StreamScapeTV/agent-state-dashboard"
ISSUE_NUMBER = 55
RELEASE_TAG = "0.1.2"
RELEASE_SOURCE_SHA = "3187db893f5629d8703897a83245df46b62b6f7d"
PHASE1_REF = "orchestrator/issue-55-retire-release-helpers"
PHASE1_TITLE = "[#55] Retire temporary release helpers after 0.1.2"
PHASE2_REF = "orchestrator/issue-55-retire-finalizer"
PHASE2_TITLE = "[#55] Remove final 0.1.2 release finalizer"

PHASE1_FILES = {
    ".github/workflows/cut-release-0.1.1-arc.yml",
    ".github/workflows/cut-release-0.1.1-pr.yml",
    ".github/workflows/cut-release-0.1.1-tag.yml",
    ".github/workflows/release-existing-tag-0.1.1.yml",
    ".github/workflows/cut-release-0.1.2.yml",
    "tests/release-tag-cut.test.mjs",
    "tests/release-0.1.2-cut.test.mjs",
}
PHASE2_FILES = {
    ".github/workflows/finalize-release-0.1.2.yml",
    ".github/scripts/finalize_release_0_1_2.py",
    "tests/finalize-release-0.1.2.test.mjs",
}
SHA_RE = re.compile(r"[0-9a-f]{40}")


def require_env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise SystemExit(f"missing_env:{name}")
    return value


def checked_sha(name: str, value: str) -> str:
    if SHA_RE.fullmatch(value) is None:
        raise SystemExit(f"invalid_sha:{name}")
    return value


def api_request(
    token: str,
    method: str,
    path: str,
    payload: dict[str, object] | None = None,
    *,
    missing_ok: bool = False,
) -> object | None:
    if not token or any(character in token for character in "\x00\r\n"):
        raise SystemExit("invalid_github_token")
    body = None
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "StreamScapeTV-agent-state-dashboard-0.1.2-finalizer",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}{path}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(2_000_001)
    except urllib.error.HTTPError as error:
        if missing_ok and error.code == 404:
            return None
        raise SystemExit(f"github_http_{error.code}:{method}:{path}") from None
    except OSError:
        raise SystemExit(f"github_request_failed:{method}:{path}") from None
    if len(raw) > 2_000_000:
        raise SystemExit("github_response_too_large")
    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise SystemExit("github_response_invalid") from None


def write_output(name: str, value: object) -> None:
    output_path = require_env("GITHUB_OUTPUT")
    with open(output_path, "a", encoding="utf-8") as output:
        output.write(f"{name}={value}\n")


def post_comment(token: str, marker: str, text: str) -> None:
    body = f"<!-- {marker} -->\n{text}"
    api_request(token, "POST", f"/issues/{ISSUE_NUMBER}/comments", {"body": body})


def current_main_sha(token: str) -> str:
    payload = api_request(token, "GET", "/git/ref/heads/main")
    if not isinstance(payload, dict):
        raise SystemExit("main_ref_invalid")
    sha = payload.get("object", {}).get("sha")
    if not isinstance(sha, str):
        raise SystemExit("main_ref_missing_sha")
    return checked_sha("main", sha)


def assert_deleted_file_set(token: str, pr_number: int, expected: set[str], label: str) -> None:
    files = api_request(token, "GET", f"/pulls/{pr_number}/files?per_page=100")
    if not isinstance(files, list):
        raise SystemExit(f"{label}_files_invalid")
    filenames = {row.get("filename") for row in files if isinstance(row, dict)}
    if filenames != expected or len(files) != len(expected):
        raise SystemExit(f"{label}_file_set_mismatch:{sorted(filenames)}")
    if any(row.get("status") != "removed" for row in files if isinstance(row, dict)):
        raise SystemExit(f"{label}_requires_deletions_only")


def wait_validation(
    token: str,
    sha: str,
    event: str,
    branch: str,
    *,
    attempts: int = 180,
) -> int:
    checked_sha("validation", sha)
    last_completed: dict[str, object] | None = None
    for attempt in range(attempts):
        query = urllib.parse.urlencode(
            {
                "event": event,
                "status": "completed",
                "head_sha": sha,
                "per_page": "20",
            }
        )
        payload = api_request(token, "GET", f"/actions/workflows/validation.yml/runs?{query}")
        runs = payload.get("workflow_runs", []) if isinstance(payload, dict) else []
        completed = [
            run
            for run in runs
            if isinstance(run, dict)
            and run.get("event") == event
            and run.get("head_sha") == sha
            and run.get("head_branch") == branch
            and run.get("name") == "Node validation"
            and run.get("status") == "completed"
            and isinstance(run.get("id"), int)
        ]
        if completed:
            last_completed = max(completed, key=lambda item: int(item["id"]))
            if last_completed.get("conclusion") == "success":
                run_id = int(last_completed["id"])
                artifacts = api_request(token, "GET", f"/actions/runs/{run_id}/artifacts?per_page=100")
                if not isinstance(artifacts, dict) or artifacts.get("total_count") != 0:
                    raise SystemExit(f"validation_artifacts_present:{run_id}")
                return run_id
        if attempt < attempts - 1:
            time.sleep(2)
    if last_completed is not None:
        raise SystemExit(
            f"validation_not_green:{last_completed.get('id')}:{last_completed.get('conclusion')}"
        )
    raise SystemExit(f"validation_missing:{event}:{branch}:{sha}")


def release_identity_is_aligned(token: str) -> None:
    source = api_request(token, "GET", f"/git/commits/{RELEASE_SOURCE_SHA}")
    if not isinstance(source, dict) or source.get("sha") != RELEASE_SOURCE_SHA:
        raise SystemExit("release_source_missing")

    main_sha = current_main_sha(token)
    comparison = api_request(token, "GET", f"/compare/{RELEASE_SOURCE_SHA}...{main_sha}")
    if not isinstance(comparison, dict):
        raise SystemExit("release_source_comparison_invalid")
    if comparison.get("status") not in {"ahead", "identical"}:
        raise SystemExit("release_source_not_ancestor")
    if comparison.get("merge_base_commit", {}).get("sha") != RELEASE_SOURCE_SHA:
        raise SystemExit("release_source_merge_base_mismatch")

    package_payload = api_request(token, "GET", f"/contents/package.json?ref={RELEASE_SOURCE_SHA}")
    chart_payload = api_request(
        token,
        "GET",
        f"/contents/charts/agent-state-dashboard/Chart.yaml?ref={RELEASE_SOURCE_SHA}",
    )
    for label, payload in (("package", package_payload), ("chart", chart_payload)):
        if not isinstance(payload, dict) or payload.get("encoding") != "base64":
            raise SystemExit(f"release_{label}_contents_invalid")

    import base64

    try:
        package = json.loads(base64.b64decode(str(package_payload["content"])).decode("utf-8"))
        chart = base64.b64decode(str(chart_payload["content"])).decode("utf-8")
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError, KeyError):
        raise SystemExit("release_identity_decode_failed") from None
    if not isinstance(package, dict) or package.get("version") != RELEASE_TAG:
        raise SystemExit("release_package_version_mismatch")
    if re.search(r"^version:\s*0\.1\.2\s*$", chart, re.MULTILINE) is None:
        raise SystemExit("release_chart_version_mismatch")
    if re.search(r"^appVersion:\s*[\"']?0\.1\.2[\"']?\s*$", chart, re.MULTILINE) is None:
        raise SystemExit("release_chart_app_version_mismatch")


def mode_start() -> None:
    token = require_env("GH_TOKEN")
    post_comment(
        token,
        "agent-state-dashboard-finalize-release-0.1.2-start",
        (
            f"Finalizer run `{require_env('GITHUB_RUN_ID')}` started for phase-1 cleanup PR "
            f"`#{require_env('PHASE1_PR_NUMBER')}` with base `{require_env('PHASE1_BASE_SHA')}` "
            f"and head `{require_env('PHASE1_HEAD_SHA')}`."
        ),
    )


def mode_admit() -> None:
    token = require_env("GH_TOKEN")
    if require_env("GITHUB_REPOSITORY") != REPOSITORY or require_env("GITHUB_EVENT_NAME") != "pull_request":
        raise SystemExit("phase1_event_not_trusted")
    pr_number_raw = require_env("PHASE1_PR_NUMBER")
    if not pr_number_raw.isdigit() or int(pr_number_raw) <= 0:
        raise SystemExit("phase1_pr_number_invalid")
    pr_number = int(pr_number_raw)
    base_sha = checked_sha("phase1_base", require_env("PHASE1_BASE_SHA"))
    head_sha = checked_sha("phase1_head", require_env("PHASE1_HEAD_SHA"))
    if current_main_sha(token) != base_sha:
        raise SystemExit("phase1_main_drifted")

    pull = api_request(token, "GET", f"/pulls/{pr_number}")
    if not isinstance(pull, dict) or pull.get("state") != "open" or pull.get("draft") is not False:
        raise SystemExit("phase1_pr_not_merge_candidate")
    if pull.get("base", {}).get("ref") != "main" or pull.get("base", {}).get("sha") != base_sha:
        raise SystemExit("phase1_base_mismatch")
    head = pull.get("head", {})
    if head.get("ref") != PHASE1_REF or head.get("sha") != head_sha:
        raise SystemExit("phase1_head_mismatch")
    if head.get("repo", {}).get("full_name") != REPOSITORY:
        raise SystemExit("phase1_repository_mismatch")
    if pull.get("user", {}).get("login") != "mimranfaruqi" or pull.get("title") != PHASE1_TITLE:
        raise SystemExit("phase1_owner_metadata_mismatch")
    assert_deleted_file_set(token, pr_number, PHASE1_FILES, "phase1")

    release_identity_is_aligned(token)
    source_validation = wait_validation(token, RELEASE_SOURCE_SHA, "push", "main")
    base_validation = wait_validation(token, base_sha, "push", "main")

    encoded_tag = urllib.parse.quote(RELEASE_TAG, safe="")
    existing = api_request(token, "GET", f"/git/ref/tags/{encoded_tag}", missing_ok=True)
    preexisting = False
    if existing is not None:
        if not isinstance(existing, dict):
            raise SystemExit("existing_tag_invalid")
        ref_object = existing.get("object", {})
        if ref_object.get("type") != "commit" or ref_object.get("sha") != RELEASE_SOURCE_SHA:
            raise SystemExit("existing_tag_conflict")
        preexisting = True

    write_output("source_validation_run", source_validation)
    write_output("base_validation_run", base_validation)
    write_output("tag_preexisting", "true" if preexisting else "false")


def mode_tag() -> None:
    token = require_env("MAINTENANCE_TOKEN")
    if any(character in token for character in "\x00\r\n"):
        raise SystemExit("organization_maintenance_token_invalid")
    preexisting = require_env("TAG_PREEXISTING") == "true"
    encoded_tag = urllib.parse.quote(RELEASE_TAG, safe="")
    tag_path = f"/git/ref/tags/{encoded_tag}"
    action = "verified-existing"
    if not preexisting:
        if api_request(token, "GET", tag_path, missing_ok=True) is not None:
            raise SystemExit("tag_raced_before_create")
        api_request(
            token,
            "POST",
            "/git/refs",
            {"ref": f"refs/tags/{RELEASE_TAG}", "sha": RELEASE_SOURCE_SHA},
        )
        action = "created"
    readback = api_request(token, "GET", tag_path)
    if not isinstance(readback, dict):
        raise SystemExit("tag_readback_invalid")
    ref_object = readback.get("object", {})
    if ref_object.get("type") != "commit" or ref_object.get("sha") != RELEASE_SOURCE_SHA:
        raise SystemExit("tag_readback_mismatch")
    write_output("tag_action", action)


def wait_release(token: str, *, attempts: int = 240) -> int:
    last: dict[str, object] | None = None
    for attempt in range(attempts):
        query = urllib.parse.urlencode(
            {"event": "push", "head_sha": RELEASE_SOURCE_SHA, "per_page": "20"}
        )
        payload = api_request(token, "GET", f"/actions/workflows/release.yml/runs?{query}")
        runs = payload.get("workflow_runs", []) if isinstance(payload, dict) else []
        matches = [
            run
            for run in runs
            if isinstance(run, dict)
            and run.get("event") == "push"
            and run.get("head_sha") == RELEASE_SOURCE_SHA
            and run.get("name") == "Publish tagged dashboard image and chart"
            and isinstance(run.get("id"), int)
        ]
        if matches:
            last = max(matches, key=lambda item: int(item["id"]))
            if last.get("status") == "completed":
                run_id = int(last["id"])
                if last.get("conclusion") != "success":
                    raise SystemExit(f"release_failed:{run_id}:{last.get('conclusion')}")
                artifacts = api_request(token, "GET", f"/actions/runs/{run_id}/artifacts?per_page=100")
                if not isinstance(artifacts, dict) or artifacts.get("total_count") != 0:
                    raise SystemExit(f"release_artifacts_present:{run_id}")
                return run_id
        if attempt < attempts - 1:
            time.sleep(2)
    if last is not None:
        raise SystemExit(f"release_not_completed:{last.get('id')}:{last.get('status')}")
    raise SystemExit("release_run_not_observed")


def wait_merged_pr(token: str, pr_number: int, label: str, *, attempts: int = 900) -> str:
    for attempt in range(attempts):
        pull = api_request(token, "GET", f"/pulls/{pr_number}")
        if isinstance(pull, dict) and pull.get("merged") is True:
            sha = pull.get("merge_commit_sha")
            if not isinstance(sha, str):
                raise SystemExit(f"{label}_merge_sha_missing")
            return checked_sha(f"{label}_merge", sha)
        if attempt < attempts - 1:
            time.sleep(2)
    raise SystemExit(f"{label}_merge_not_observed")


def wait_phase2_pr(token: str, phase1_merge_sha: str, *, attempts: int = 900) -> tuple[int, str]:
    for attempt in range(attempts):
        query = urllib.parse.urlencode(
            {"state": "open", "head": f"StreamScapeTV:{PHASE2_REF}", "base": "main", "per_page": "20"}
        )
        pulls = api_request(token, "GET", f"/pulls?{query}")
        candidates = [
            pull
            for pull in pulls
            if isinstance(pull, dict)
            and pull.get("title") == PHASE2_TITLE
            and pull.get("draft") is False
            and pull.get("user", {}).get("login") == "mimranfaruqi"
            and pull.get("base", {}).get("sha") == phase1_merge_sha
            and pull.get("head", {}).get("repo", {}).get("full_name") == REPOSITORY
            and pull.get("head", {}).get("ref") == PHASE2_REF
        ] if isinstance(pulls, list) else []
        if len(candidates) > 1:
            raise SystemExit("phase2_multiple_candidates")
        if len(candidates) == 1:
            pr = candidates[0]
            number = pr.get("number")
            sha = pr.get("head", {}).get("sha")
            if not isinstance(number, int) or number <= 0 or not isinstance(sha, str):
                raise SystemExit("phase2_identity_invalid")
            head_sha = checked_sha("phase2_head", sha)
            assert_deleted_file_set(token, number, PHASE2_FILES, "phase2")
            return number, head_sha
        if attempt < attempts - 1:
            time.sleep(2)
    raise SystemExit("phase2_pr_not_observed")


def mode_orchestrate() -> None:
    token = require_env("GH_TOKEN")
    phase1_pr = int(require_env("PHASE1_PR_NUMBER"))
    tag_action = require_env("TAG_ACTION")
    release_run = wait_release(token)
    post_comment(
        token,
        "agent-state-dashboard-finalize-release-0.1.2-phase1-ready",
        (
            f"Finalizer run `{require_env('GITHUB_RUN_ID')}` proved release-source validation "
            f"`{require_env('SOURCE_VALIDATION_RUN')}`, current-main validation "
            f"`{require_env('BASE_VALIDATION_RUN')}`, tag action `{tag_action}`, and successful "
            f"normal tag-push release run `{release_run}`. Phase-1 cleanup PR `#{phase1_pr}` is "
            "release-ready to merge."
        ),
    )

    phase1_merge = wait_merged_pr(token, phase1_pr, "phase1")
    if current_main_sha(token) != phase1_merge:
        raise SystemExit("phase1_merge_not_current_main")
    phase1_validation = wait_validation(token, phase1_merge, "push", "main")
    post_comment(
        token,
        "agent-state-dashboard-finalize-release-0.1.2-phase1-complete",
        (
            f"Phase-1 cleanup merged at `{phase1_merge}` with green zero-artifact main validation "
            f"`{phase1_validation}`. Create the finalized phase-2 PR from `{PHASE2_REF}` titled "
            f"`{PHASE2_TITLE}` to remove only the finalizer workflow, script, and contract test."
        ),
    )

    phase2_pr, phase2_head = wait_phase2_pr(token, phase1_merge)
    phase2_validation = wait_validation(token, phase2_head, "pull_request", PHASE2_REF)
    post_comment(
        token,
        "agent-state-dashboard-finalize-release-0.1.2-phase2-ready",
        (
            f"Phase-2 PR `#{phase2_pr}` exact head `{phase2_head}` passed Node validation "
            f"`{phase2_validation}` with zero Actions artifacts and is ready to merge."
        ),
    )

    final_merge = wait_merged_pr(token, phase2_pr, "phase2")
    if current_main_sha(token) != final_merge:
        raise SystemExit("phase2_merge_not_current_main")
    final_validation = wait_validation(token, final_merge, "push", "main")
    post_comment(
        token,
        "agent-state-dashboard-finalize-release-0.1.2-complete",
        (
            f"Finalizer run `{require_env('GITHUB_RUN_ID')}` completed: normal 0.1.2 release run "
            f"`{release_run}` is green with zero Actions artifacts; all temporary release helpers "
            f"are removed at final main `{final_merge}` and protected-main validation "
            f"`{final_validation}` is green with zero Actions artifacts."
        ),
    )
    write_output("release_run_id", release_run)
    write_output("final_merge_sha", final_merge)
    write_output("final_validation_run", final_validation)


def mode_failure() -> None:
    token = require_env("GH_TOKEN")
    post_comment(
        token,
        "agent-state-dashboard-finalize-release-0.1.2-failure",
        (
            f"Finalizer run `{require_env('GITHUB_RUN_ID')}` failed: "
            f"admission=`{os.environ.get('ADMISSION_OUTCOME', '')}`, "
            f"tag=`{os.environ.get('TAG_OUTCOME', '')}`, "
            f"orchestration=`{os.environ.get('ORCHESTRATE_OUTCOME', '')}`."
        ),
    )


def main() -> None:
    if Path(__file__).name != "finalize_release_0_1_2.py":
        raise SystemExit("unexpected_script_identity")
    mode = sys.argv[1] if len(sys.argv) == 2 else ""
    actions = {
        "start": mode_start,
        "admit": mode_admit,
        "tag": mode_tag,
        "orchestrate": mode_orchestrate,
        "failure": mode_failure,
    }
    action = actions.get(mode)
    if action is None:
        raise SystemExit("unknown_mode")
    action()


if __name__ == "__main__":
    main()
