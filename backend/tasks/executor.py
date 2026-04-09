"""Task executor — runs scan tasks and processes results."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from typing import Any, Optional

from backend.config import AppSettings, TaskConfig, AstRule, AstNodePattern
from backend.scanner.github import GitHubClient, GitHubFile, filter_files
from backend.scanner.pattern import Finding, scan_file_content
from backend.scanner.llm_review import review_files
from backend.scanner.doc_coverage import scan_doc_coverage
from backend.storage import config_loader, db
from backend.actions import email_report, github_issue, generate_prompt, in_app_notify

logger = logging.getLogger(__name__)

_running_runs: dict[str, asyncio.Task] = {}
_language_failures: set[str] = set()

try:
    import tree_sitter_languages as _tsl
    LIB_PATH = os.path.join(os.path.dirname(_tsl.__file__), "languages.so")
except ImportError:
    _tsl = None
    LIB_PATH = ""

LANGUAGE_NAMES = {
    ".py": "python",
    ".js": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
}


def _language_for_file(file_path: str) -> Optional[str]:
    ext = os.path.splitext(file_path)[1].lower()
    return LANGUAGE_NAMES.get(ext)


def _slice_text(lines: list[str], srow: int, scol: int, erow: int, ecol: int) -> str:
    if srow >= len(lines) or erow >= len(lines) or srow < 0 or erow < 0:
        return ""
    if srow == erow:
        return lines[srow][scol:ecol]
    parts = [lines[srow][scol:]]
    parts.extend(lines[srow + 1 : erow])
    parts.append(lines[erow][:ecol])
    return "\n".join(parts)


def _build_node(elem: ET.Element, lines: list[str]) -> Optional[dict[str, Any]]:
    if elem.tag in ("sources", "source"):
        return None
    srow = elem.attrib.get("srow")
    scol = elem.attrib.get("scol")
    erow = elem.attrib.get("erow")
    ecol = elem.attrib.get("ecol")
    if srow is None or scol is None or erow is None or ecol is None:
        return None
    try:
        srow_i = int(srow)
        scol_i = int(scol)
        erow_i = int(erow)
        ecol_i = int(ecol)
    except ValueError:
        return None
    node: dict[str, Any] = {
        "type": elem.tag,
        "srow": srow_i,
        "scol": scol_i,
        "erow": erow_i,
        "ecol": ecol_i,
        "text": _slice_text(lines, srow_i, scol_i, erow_i, ecol_i),
        "children": [],
        "fields": {},
    }
    for child in list(elem):
        child_node = _build_node(child, lines)
        if not child_node:
            continue
        node["children"].append(child_node)
        field_name = child.attrib.get("field")
        if field_name:
            node["fields"].setdefault(field_name, []).append(child_node)
    return node


def _flatten_nodes(root: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = [root]
    for child in root.get("children", []):
        nodes.extend(_flatten_nodes(child))
    return nodes


def _parse_cli_nodes(content: str, language_name: str, ext: str) -> list[dict[str, Any]]:
    if _tsl is None:
        logger.warning("tree_sitter_languages not installed — AST scanning unavailable")
        return []
    if language_name in _language_failures:
        return []

    lines = content.splitlines()
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext, mode="w", encoding="utf8") as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        result = subprocess.run(
            [
                "tree-sitter",
                "parse",
                "--lang-name",
                language_name,
                "--lib-path",
                LIB_PATH,
                "--xml",
                tmp_path,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )

        if result.returncode != 0:
            stderr = result.stderr or ""
            if "No language found" in stderr or "parser directories" in stderr:
                _language_failures.add(language_name)
                logger.warning(
                    "Tree-sitter CLI language '%s' unavailable. Skipping further %s files.",
                    language_name,
                    language_name,
                )
                return []
            logger.error(
                "Tree-sitter CLI failed to parse %s (lang: %s): %s",
                tmp_path,
                language_name,
                stderr,
            )
            return []

        if not result.stdout.strip():
            return []

        root = ET.fromstring(result.stdout)
        nodes: list[dict[str, Any]] = []
        for source in root.findall(".//source"):
            for child in list(source):
                node = _build_node(child, lines)
                if node:
                    nodes.extend(_flatten_nodes(node))
        return nodes
    except subprocess.TimeoutExpired:
        logger.error("Tree-sitter CLI timed out for %s (lang: %s)", tmp_path, language_name)
        return []
    except Exception as e:
        logger.error("Unexpected error calling tree-sitter CLI: %s", e)
        return []
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


def _descendants(node: dict[str, Any]) -> list[dict[str, Any]]:
    found = []
    for child in node.get("children", []):
        found.append(child)
        found.extend(_descendants(child))
    return found


def _node_text(node: dict[str, Any]) -> str:
    return node.get("text", "")


def _match_children(node: dict[str, Any], patterns: list[AstNodePattern]) -> bool:
    children = node.get("children", [])
    for pattern in patterns:
        if not any(_match_ast_node(child, pattern) for child in children):
            return False
    return True


def _count_parameters(params_node: dict[str, Any]) -> int:
    """Count parameters using only direct children of the parameters node."""
    count = 0
    direct_children = params_node.get("children", [])
    param_types = {
        "identifier",
        "default_parameter",
        "typed_parameter",
        "list_splat_pattern",
        "dictionary_splat_pattern",
        "keyword_separator",
        "positional_separator",
    }
    for child in direct_children:
        if child.get("type") in param_types or child.get("type", "").endswith("parameter"):
            count += 1
    return count


def _match_constraints(node: dict[str, Any], constraints: dict[str, Any], text: Optional[str] = None) -> bool:
    for name, value in constraints.items():
        if name == "args_count":
            if not isinstance(value, dict):
                continue
            min_args = value.get("min", 0)
            max_args = value.get("max", 10**9)
            params_nodes = node.get("fields", {}).get("parameters", [])
            if not params_nodes:
                return False
            arg_count = _count_parameters(params_nodes[0])
            if not (min_args <= arg_count <= max_args):
                return False
        elif name == "min_length":
            candidate = text if text is not None else _node_text(node)
            if len(candidate) < int(value):
                return False
        elif name == "exclude_regex":
            candidate = text if text is not None else _node_text(node)
            patterns = value if isinstance(value, list) else [value]
            for pattern in patterns:
                if pattern and re.search(pattern, candidate):
                    return False
    return True


def _match_ast_node(node: dict[str, Any], pattern: AstNodePattern) -> bool:
    if pattern.node_type and node["type"] != pattern.node_type:
        return False

    if pattern.properties:
        for prop_name, prop_value in pattern.properties.items():
            if prop_name == "function_name":
                func_nodes = node.get("fields", {}).get("function", [])
                if not func_nodes:
                    func_nodes = node.get("fields", {}).get("name", [])
                if not func_nodes:
                    func_nodes = [
                        n
                        for n in _descendants(node)
                        if n.get("type") in ("identifier", "attribute", "member_expression", "property_identifier")
                    ]
                if not any(_node_text(n) == prop_value or _node_text(n).endswith(f".{prop_value}") for n in func_nodes):
                    return False
            elif prop_name == "operator":
                op_nodes = node.get("fields", {}).get("operator", [])
                if op_nodes:
                    if not any(_node_text(n).strip() == prop_value for n in op_nodes):
                        return False
                elif prop_value not in _node_text(node):
                    return False
            else:
                field_nodes = node.get("fields", {}).get(prop_name, [])
                if not field_nodes:
                    return False
                if isinstance(prop_value, str):
                    if not any(_node_text(n).strip() == prop_value for n in field_nodes):
                        return False

    target_text = _node_text(node)
    if pattern.node_type == "string":
        content_nodes = [c for c in node.get("children", []) if c.get("type") == "string_content"]
        if content_nodes:
            target_text = _node_text(content_nodes[0])

    if pattern.value_regex and not re.search(pattern.value_regex, target_text):
        return False

    if pattern.constraints and not _match_constraints(node, pattern.constraints, target_text):
        return False

    if pattern.children and not _match_children(node, pattern.children):
        return False

    return True


class TaskCancelled(Exception):
    """Raised when a run is cancelled or stopped via the API."""


def _expand_recipes(task: TaskConfig) -> TaskConfig:
    """Expand recipe references into rules, allowlists, and context_filters."""
    if not task.scan.recipes:
        return task

    from backend.recipes import resolve_recipes
    resolved = resolve_recipes(task.scan.recipes)

    existing_rule_ids = {r.id for r in task.scan.rules}
    for rule in resolved["rules"]:
        if rule.id not in existing_rule_ids:
            task.scan.rules.append(rule)

    existing_allowlist_keys = {
        (e.file, e.pattern, e.match) for e in task.scan.allowlist
    }
    for entry in resolved["allowlist"]:
        key = (entry.file, entry.pattern, entry.match)
        if key not in existing_allowlist_keys:
            task.scan.allowlist.append(entry)

    existing_cf_types = {cf.type for cf in task.scan.context_filters}
    for cf in resolved["context_filters"]:
        if cf.type not in existing_cf_types:
            task.scan.context_filters.append(cf)

    if task.scan.type == "pattern" and not task.scan.rules:
        pass
    elif task.scan.type == "pattern" and task.scan.recipes:
        task.scan.type = "pattern"

    return task


async def _check_cancelled(run_id: str) -> bool:
    status = await db.get_run_status(run_id)
    return status in ("cancelled", "failed")


async def run_task(task: TaskConfig, settings: AppSettings) -> str:
    # Expand recipes into rules, allowlists, and context_filters
    task = _expand_recipes(task)

    conn = config_loader.get_connection(task.connection)
    if not conn:
        raise ValueError(f"Connection '{task.connection}' not found")

    run_id = await db.create_run(task.id, task.scan.mode)
    await db.upsert_task_state(task.id, status="running", last_run_id=run_id)

    current_task = asyncio.current_task()
    if current_task:
        _running_runs[run_id] = current_task

    client = GitHubClient(owner=conn.owner, repo=conn.repo, token=conn.token)
    try:
        branch = conn.default_branch or await client.get_default_branch()
        latest_sha = await client.get_latest_commit_sha(branch)

        if task.scan.mode == "diff":
            state = await db.get_task_state(task.id)
            last_sha = state.get("last_commit_sha", "") if state else ""
            if last_sha and last_sha != latest_sha:
                changed = await client.get_compare(last_sha, latest_sha)
                all_files = [
                    GitHubFile(path=f["filename"], sha=f["sha"], size=0)
                    for f in changed
                    if f["status"] != "removed"
                ]
            else:
                all_files = await client.list_files(branch)
        else:
            all_files = await client.list_files(branch)

        include = task.scan.paths.get("include", ["**/*"])
        exclude = task.scan.paths.get("exclude", [])
        files = filter_files(all_files, include, exclude)

        await db.update_run(run_id, total_files=len(files))

        if await _check_cancelled(run_id):
            raise TaskCancelled(f"Run {run_id} cancelled")

        all_findings: list[dict] = []

        if task.scan.type == "pattern":
            all_findings = await _run_pattern_scan(client, branch, files, task, run_id)
        elif task.scan.type == "ast-pattern":
            all_findings = await _run_ast_pattern_scan(client, branch, files, task, run_id)
        elif task.scan.type == "llm-review":
            all_findings = await _run_llm_scan(client, branch, files, task, settings, run_id)
        elif task.scan.type == "doc-coverage":
            all_findings = await _run_doc_scan(client, branch, files, task, settings, run_id)

        await db.insert_findings(all_findings)
        await db.complete_run(
            run_id,
            finding_count=len(all_findings),
            total_files=len(all_files),
            scanned_files=len(files),
            last_commit_sha=latest_sha,
        )
        await db.upsert_task_state(
            task.id, status="completed", last_commit_sha=latest_sha
        )

        await _run_actions(task, settings, run_id, all_findings, conn)

        logger.info(
            "Task %s completed: %s findings in %s files",
            task.id,
            len(all_findings),
            len(files),
        )
        return run_id

    except TaskCancelled:
        logger.info("Task %s run %s was cancelled", task.id, run_id)
        return run_id
    except asyncio.CancelledError:
        logger.info("Task %s run %s asyncio task cancelled", task.id, run_id)
        return run_id
    except Exception as e:
        logger.error("Task %s failed: %s", task.id, e)
        await db.fail_run(run_id, str(e))
        await db.upsert_task_state(task.id, status="failed")
        raise
    finally:
        _running_runs.pop(run_id, None)
        await client.close()


async def _run_pattern_scan(
    client: GitHubClient,
    branch: str,
    files: list[GitHubFile],
    task: TaskConfig,
    run_id: str,
) -> list[dict]:
    findings = []
    scanned = 0

    for file in files:
        content = await client.get_file_content(file.path, ref=branch)
        if content is None:
            continue

        scanned += 1
        file_findings = scan_file_content(
            file.path,
            content,
            task.scan.rules,
            task.scan.allowlist,
            task.scan.context_filters,
        )

        for f in file_findings:
            findings.append(
                {
                    "run_id": run_id,
                    "task_id": task.id,
                    "category": f.category,
                    "file_path": f.file_path,
                    "line_number": f.line_number,
                    "severity": f.severity,
                    "rule_id": f.rule_id,
                    "description": f.description,
                    "matched_text": f.matched_text,
                    "context": f.context,
                }
            )

        if scanned % 20 == 0:
            await db.update_run(run_id, scanned_files=scanned)
            if await _check_cancelled(run_id):
                raise TaskCancelled(f"Run {run_id} cancelled during pattern scan")

    return findings


async def _run_ast_pattern_scan(
    client: GitHubClient,
    branch: str,
    files: list[GitHubFile],
    task: TaskConfig,
    run_id: str,
) -> list[dict]:
    findings = []
    scanned = 0

    for file in files:
        language_name = _language_for_file(file.path)
        if not language_name:
            continue

        applicable_rules = [
            r for r in (task.scan.ast_rules or []) if not r.language or r.language == language_name
        ]
        if not applicable_rules:
            continue

        content = await client.get_file_content(file.path, ref=branch)
        if content is None:
            continue

        scanned += 1
        nodes = _parse_cli_nodes(content, language_name, os.path.splitext(file.path)[1])
        for node in nodes:
            for rule in applicable_rules:
                if _match_ast_node(node, rule.pattern):
                    findings.append(
                        {
                            "run_id": run_id,
                            "task_id": task.id,
                            "category": "AST Pattern",
                            "file_path": file.path,
                            "line_number": node["srow"] + 1,
                            "severity": rule.severity,
                            "rule_id": rule.id,
                            "description": rule.description or rule.name,
                            "matched_text": node.get("text", ""),
                            "context": node.get("text", ""),
                        }
                    )

        if scanned % 20 == 0:
            await db.update_run(run_id, scanned_files=scanned)
            if await _check_cancelled(run_id):
                raise TaskCancelled(f"Run {run_id} cancelled during AST scan")

    return findings


async def _run_llm_scan(
    client: GitHubClient,
    branch: str,
    files: list[GitHubFile],
    task: TaskConfig,
    settings: AppSettings,
    run_id: str,
) -> list[dict]:
    findings = []
    max_files = task.scan.llm.max_files_per_run or 50
    batch_size = 5

    scan_files = files[:max_files]
    file_contents: dict[str, str] = {}

    for file in scan_files:
        content = await client.get_file_content(file.path, ref=branch)
        if content:
            file_contents[file.path] = content

    paths = list(file_contents.keys())
    for i in range(0, len(paths), batch_size):
        batch_paths = paths[i : i + batch_size]
        batch = {p: file_contents[p] for p in batch_paths}

        result = await review_files(
            batch, task.scan.llm, settings, task.scan.llm.focus
        )

        for f in result.get("findings", []):
            findings.append(
                {
                    "run_id": run_id,
                    "task_id": task.id,
                    "category": f.get("category", "LLM Review"),
                    "file_path": f.get("file", ""),
                    "line_number": f.get("line", 0),
                    "severity": f.get("severity", "medium"),
                    "rule_id": "llm-review",
                    "description": f.get("description", ""),
                    "matched_text": f.get("suggestion", ""),
                    "context": f.get("description", ""),
                }
            )

        await db.update_run(run_id, scanned_files=min(i + batch_size, len(paths)))

        if await _check_cancelled(run_id):
            raise TaskCancelled(f"Run {run_id} cancelled during LLM scan")

    return findings


async def _run_doc_scan(
    client: GitHubClient,
    branch: str,
    files: list[GitHubFile],
    task: TaskConfig,
    settings: AppSettings,
    run_id: str,
) -> list[dict]:
    findings = []
    scanned = 0

    for file in files:
        content = await client.get_file_content(file.path, ref=branch)
        if content is None:
            continue

        scanned += 1
        file_findings = scan_doc_coverage(file.path, content)

        for f in file_findings:
            findings.append(
                {
                    "run_id": run_id,
                    "task_id": task.id,
                    "category": f.category,
                    "file_path": f.file_path,
                    "line_number": f.line_number,
                    "severity": f.severity,
                    "rule_id": f.rule_id,
                    "description": f.description,
                    "matched_text": f.matched_text,
                    "context": f.context,
                }
            )

        if scanned % 20 == 0:
            await db.update_run(run_id, scanned_files=scanned)
            if await _check_cancelled(run_id):
                raise TaskCancelled(f"Run {run_id} cancelled during doc scan")

    return findings


async def _run_actions(
    task: TaskConfig,
    settings: AppSettings,
    run_id: str,
    findings: list[dict],
    conn: Any,
) -> None:
    has_findings = len(findings) > 0

    previous_findings_count = 0
    current_findings_count = len(findings)
    if has_findings:
        task_runs = await db.get_task_runs(task.id, 2)
        if len(task_runs) >= 2:
            previous_findings_count = task_runs[1].get("finding_count", 0)

    has_fixed = previous_findings_count > current_findings_count

    for action in task.actions:
        should_run = (
            action.trigger == "always"
            or (action.trigger == "findings" and has_findings)
            or (action.trigger == "fixed" and has_fixed)
        )
        if not should_run:
            continue

        try:
            if action.type == "email-report":
                await email_report.send(task, run_id, findings, action.recipients, settings)
            elif action.type == "github-issue":
                await github_issue.create(task, run_id, findings, conn, action)
            elif action.type in ("generate-fix-prompt", "generate-prompt"):
                await generate_prompt.generate(task, run_id, findings)
            elif action.type == "ai-fix-request":
                from backend.actions import ai_fix
                await ai_fix.generate_and_apply(task, run_id, findings, conn, action, settings)
            elif action.type == "in-app-notify":
                await in_app_notify.notify(task, run_id, findings)
        except Exception as e:
            logger.error("Action %s failed for task %s: %s", action.type, task.id, e)
