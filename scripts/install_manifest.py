#!/usr/bin/env python3
"""Create, validate, inspect, and safely uninstall owned runtime entries."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PRODUCT = "paradox"
SCHEMA_VERSION = 1
RUNTIMES = {"pi", "codex"}
SCOPES = {"global", "project"}


class ManifestError(ValueError):
    pass


def _absolute(path: str | Path) -> Path:
    return Path(path).expanduser().absolute()


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def load_manifest(path: str | Path) -> dict[str, Any]:
    manifest_path = Path(path)
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ManifestError(f"manifest does not exist: {manifest_path}") from exc
    except json.JSONDecodeError as exc:
        raise ManifestError(f"manifest is not valid JSON: {manifest_path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ManifestError("manifest root must be an object")
    return data


def validate_manifest(data: dict[str, Any], *, check_files: bool = False) -> list[str]:
    errors: list[str] = []
    required = {
        "schema_version",
        "product",
        "runtime",
        "scope",
        "repository_root",
        "destination_root",
        "created_at",
        "entries",
    }
    missing = sorted(required - data.keys())
    if missing:
        errors.append(f"missing fields: {', '.join(missing)}")
        return errors

    if data["schema_version"] != SCHEMA_VERSION:
        errors.append(f"schema_version must be {SCHEMA_VERSION}")
    if data["product"] != PRODUCT:
        errors.append(f"product must be {PRODUCT}")
    if data["runtime"] not in RUNTIMES:
        errors.append(f"runtime must be one of {sorted(RUNTIMES)}")
    if data["scope"] not in SCOPES:
        errors.append(f"scope must be one of {sorted(SCOPES)}")

    destination_root = _absolute(data["destination_root"])
    repository_root = _absolute(data["repository_root"])
    if not isinstance(data["entries"], list) or not data["entries"]:
        errors.append("entries must be a non-empty array")
        return errors

    errors.extend(_validate_entries(data["entries"], "entries", repository_root, destination_root, check_files))

    replacement = data.get("replacement")
    if replacement is not None:
        if not isinstance(replacement, dict):
            errors.append("replacement must be an object")
        else:
            required_replacement = {"status", "legacy_manifest", "entries"}
            missing_replacement = sorted(required_replacement - replacement.keys())
            if missing_replacement:
                errors.append(
                    "replacement is missing fields: " + ", ".join(missing_replacement)
                )
            if replacement.get("status") != "replaced":
                errors.append("replacement.status must be replaced")
            if not isinstance(replacement.get("legacy_manifest"), str) or not replacement.get(
                "legacy_manifest"
            ):
                errors.append("replacement.legacy_manifest must be a non-empty string")
            replacement_entries = replacement.get("entries")
            if not isinstance(replacement_entries, list) or not replacement_entries:
                errors.append("replacement.entries must be a non-empty array")
            else:
                errors.extend(
                    _validate_entries(
                        replacement_entries,
                        "replacement.entries",
                        repository_root,
                        destination_root,
                        False,
                        allow_missing_source=True,
                        allow_missing_target=True,
                        allow_source_outside=True,
                    )
                )
    return errors


def _validate_entries(
    entries: Any,
    label_prefix: str,
    repository_root: Path,
    destination_root: Path,
    check_files: bool,
    *,
    allow_missing_source: bool = False,
    allow_missing_target: bool = False,
    allow_source_outside: bool = False,
) -> list[str]:
    errors: list[str] = []
    if not isinstance(entries, list) or not entries:
        errors.append(f"{label_prefix} must be a non-empty array")
        return errors
    seen_targets: set[Path] = set()
    for index, entry in enumerate(entries):
        label = f"{label_prefix}[{index}]"
        if not isinstance(entry, dict):
            errors.append(f"{label} must be an object")
            continue
        if set(entry) != {"package", "source", "target", "kind"}:
            errors.append(f"{label} must contain package, source, target, and kind only")
            continue
        if entry["kind"] != "symlink":
            errors.append(f"{label}.kind must be symlink")
        if not isinstance(entry["package"], str) or not entry["package"]:
            errors.append(f"{label}.package must be a non-empty string")

        source = _absolute(entry["source"])
        target = _absolute(entry["target"])
        if not allow_source_outside and not _is_within(source, repository_root):
            errors.append(f"{label}.source is outside repository_root")
        if not _is_within(target, destination_root) or target == destination_root:
            errors.append(f"{label}.target is outside destination_root")
        if target in seen_targets:
            errors.append(f"duplicate target: {target}")
        seen_targets.add(target)

        if check_files:
            if not source.exists() and not allow_missing_source:
                errors.append(f"owned source is missing: {source}")
            if not target.is_symlink() and not allow_missing_target:
                errors.append(f"owned target is not a symlink: {target}")
            elif target.resolve(strict=False) != source.resolve(strict=False):
                errors.append(f"owned target no longer points to its source: {target}")

    return errors

def _parse_entry(value: str) -> dict[str, str]:
    parts = value.split("|", 2)
    if len(parts) != 3 or not all(parts):
        raise argparse.ArgumentTypeError("entry must be PACKAGE|SOURCE|TARGET")
    package, source, target = parts
    return {
        "package": package,
        "source": str(_absolute(source)),
        "target": str(_absolute(target)),
        "kind": "symlink",
    }


def build_manifest(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "product": PRODUCT,
        "runtime": args.runtime,
        "scope": args.scope,
        "repository_root": str(_absolute(args.repository_root)),
        "destination_root": str(_absolute(args.destination_root)),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "entries": args.entry,
    }


def record_replacement(
    path: str | Path,
    *,
    legacy_manifest: str | Path,
    entries: list[dict[str, str]],
) -> None:
    manifest_path = Path(path)
    data = load_manifest(manifest_path)
    errors = validate_manifest(data)
    if errors:
        raise ManifestError("cannot record replacement in invalid manifest:\n- " + "\n- ".join(errors))
    legacy_path = Path(legacy_manifest).expanduser().absolute()
    snapshot: str | None = None
    if legacy_path.is_file():
        snapshot = legacy_path.read_text(encoding="utf-8")
    data["replacement"] = {
        "status": "replaced",
        "legacy_manifest": str(legacy_path),
        "legacy_manifest_content": snapshot,
        "entries": entries,
    }
    write_manifest(manifest_path, data)


def read_legacy_entries(
    path: str | Path,
    *,
    destination_root: str | Path,
    packages: set[str],
) -> list[dict[str, str]]:
    """Read a recognized version-one manifest and verify its live ownership."""
    data = load_manifest(path)
    if data.get("product") not in {"my-workflow", "my-workflow-1", "my-workflow-2", "paradox"}:
        raise ManifestError("legacy manifest has an unknown product")
    raw_entries = data.get("entries")
    if not isinstance(raw_entries, list) or not raw_entries:
        raise ManifestError("legacy manifest has no entries")
    destination = _absolute(destination_root)
    result: list[dict[str, str]] = []
    seen_packages: set[str] = set()
    for index, raw in enumerate(raw_entries):
        if not isinstance(raw, dict):
            raise ManifestError(f"legacy entries[{index}] must be an object")
        package = raw.get("package") or Path(str(raw.get("target", ""))).name
        source = raw.get("source")
        target = raw.get("target")
        if not isinstance(package, str) or package not in packages:
            continue
        if not isinstance(source, str) or not isinstance(target, str):
            raise ManifestError(f"legacy entries[{index}] must contain source and target")
        source_path = _absolute(source)
        target_path = _absolute(target)
        if target_path != destination / package:
            raise ManifestError(f"legacy entry targets an unexpected path: {target_path}")
        if package in seen_packages:
            raise ManifestError(f"legacy package is duplicated: {package}")
        if not target_path.is_symlink():
            raise ManifestError(f"legacy target is not an unchanged symlink: {target_path}")
        if target_path.resolve(strict=False) != source_path.resolve(strict=False):
            raise ManifestError(f"legacy target was edited: {target_path}")
        seen_packages.add(package)
        result.append(
            {
                "package": package,
                "source": str(source_path),
                "target": str(target_path),
                "kind": "symlink",
            }
        )
    if not result:
        raise ManifestError("legacy manifest has no canonical skill entries")
    return result


def write_manifest(path: str | Path, data: dict[str, Any]) -> None:
    errors = validate_manifest(data, check_files=True)
    if errors:
        raise ManifestError("cannot write invalid manifest:\n- " + "\n- ".join(errors))

    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".tmp",
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def uninstall_manifest(path: str | Path) -> None:
    manifest_path = Path(path)
    data = load_manifest(manifest_path)
    errors = validate_manifest(data)
    if errors:
        raise ManifestError("refusing uninstall from invalid manifest:\n- " + "\n- ".join(errors))

    conflicts: list[str] = []
    for entry in data["entries"]:
        source = _absolute(entry["source"])
        target = _absolute(entry["target"])
        if not target.exists() and not target.is_symlink():
            continue
        if not target.is_symlink():
            conflicts.append(f"owned target is no longer a symlink: {target}")
        elif target.resolve(strict=False) != source.resolve(strict=False):
            conflicts.append(f"owned target was changed: {target}")
    replacement = data.get("replacement")
    if isinstance(replacement, dict):
        legacy_manifest = Path(str(replacement.get("legacy_manifest", ""))).expanduser()
        snapshot = replacement.get("legacy_manifest_content")
        if not isinstance(snapshot, str):
            snapshot = None
        if legacy_manifest.exists():
            if snapshot is None or legacy_manifest.read_text(encoding="utf-8") != snapshot:
                conflicts.append(f"legacy manifest was changed: {legacy_manifest}")
        for entry in replacement.get("entries", []):
            target = _absolute(entry["target"])
            source = _absolute(entry["source"])
            if target.exists() or target.is_symlink():
                if not target.is_symlink() or target.resolve(strict=False) != source.resolve(strict=False):
                    conflicts.append(f"legacy target is occupied or changed: {target}")
    if conflicts:
        raise ManifestError("refusing unsafe uninstall:\n- " + "\n- ".join(conflicts))

    parents: set[Path] = set()
    for entry in data["entries"]:
        target = _absolute(entry["target"])
        if target.is_symlink():
            parents.add(target.parent)
            target.unlink()
    # Remove empty skill directories created for Pi-compatible link_skill installs.
    for parent in sorted(parents, key=lambda item: len(item.parts), reverse=True):
        if parent.is_dir() and not any(parent.iterdir()):
            parent.rmdir()
    if isinstance(replacement, dict):
        for entry in replacement.get("entries", []):
            target = _absolute(entry["target"])
            source = _absolute(entry["source"])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(source)
        legacy_manifest = Path(str(replacement.get("legacy_manifest", ""))).expanduser()
        snapshot = replacement.get("legacy_manifest_content")
        if isinstance(snapshot, str):
            legacy_manifest.parent.mkdir(parents=True, exist_ok=True)
            legacy_manifest.write_text(snapshot, encoding="utf-8")
    manifest_path.unlink(missing_ok=True)


def adapter_value(path: str | Path, dotted_key: str) -> Any:
    data: Any = json.loads(Path(path).read_text(encoding="utf-8"))
    for part in dotted_key.split("."):
        if not isinstance(data, dict) or part not in data:
            raise ManifestError(f"adapter field does not exist: {dotted_key}")
        data = data[part]
    return data


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    write = subparsers.add_parser("write", help="validate and atomically write a manifest")
    write.add_argument("manifest")
    write.add_argument("--runtime", required=True, choices=sorted(RUNTIMES))
    write.add_argument("--scope", required=True, choices=sorted(SCOPES))
    write.add_argument("--repository-root", required=True)
    write.add_argument("--destination-root", required=True)
    write.add_argument("--entry", action="append", required=True, type=_parse_entry)

    validate = subparsers.add_parser("validate", help="validate a manifest")
    validate.add_argument("manifest")
    validate.add_argument("--check-files", action="store_true")

    uninstall = subparsers.add_parser("uninstall", help="remove only unchanged owned entries")
    uninstall.add_argument("manifest")

    replacement = subparsers.add_parser(
        "record-replacement", help="record legacy entries removed by an explicit replacement"
    )
    replacement.add_argument("manifest")
    replacement.add_argument("--legacy-manifest", required=True)
    replacement.add_argument("--entry", action="append", required=True, type=_parse_entry)

    legacy = subparsers.add_parser(
        "legacy-entries", help="validate and print recognized version-one entries"
    )
    legacy.add_argument("manifest")
    legacy.add_argument("--destination-root", required=True)
    legacy.add_argument("--package", action="append", required=True)

    adapter = subparsers.add_parser("adapter-value", help="read a scalar adapter field")
    adapter.add_argument("adapter")
    adapter.add_argument("key")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "write":
            write_manifest(args.manifest, build_manifest(args))
            print(f"Wrote ownership manifest: {args.manifest}")
        elif args.command == "validate":
            errors = validate_manifest(load_manifest(args.manifest), check_files=args.check_files)
            if errors:
                raise ManifestError("manifest validation failed:\n- " + "\n- ".join(errors))
            print(f"Ownership manifest is valid: {args.manifest}")
        elif args.command == "uninstall":
            uninstall_manifest(args.manifest)
            print(f"Removed owned entries from: {args.manifest}")
        elif args.command == "record-replacement":
            record_replacement(
                args.manifest,
                legacy_manifest=args.legacy_manifest,
                entries=args.entry,
            )
            print(f"Recorded replacement ownership in: {args.manifest}")
        elif args.command == "legacy-entries":
            entries = read_legacy_entries(
                args.manifest,
                destination_root=args.destination_root,
                packages=set(args.package),
            )
            for entry in entries:
                print(f"{entry['package']}|{entry['source']}|{entry['target']}")
        elif args.command == "adapter-value":
            value = adapter_value(args.adapter, args.key)
            if isinstance(value, (dict, list)):
                print(json.dumps(value, separators=(",", ":")))
            else:
                print(value)
    except (ManifestError, OSError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
