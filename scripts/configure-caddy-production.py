#!/usr/bin/env python3
"""Safely route the public Trackify host to the production PM2 port."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile


DEFAULT_CADDYFILE = Path("/etc/caddy/Caddyfile")
DEFAULT_HOST = "trackify.ranajakub.com"
DEFAULT_UPSTREAM = "127.0.0.1:3000"


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def find_matching_brace(contents: str, opening_brace: int) -> int:
    depth = 0
    quote: str | None = None
    escaped = False
    in_comment = False

    for index in range(opening_brace, len(contents)):
        char = contents[index]

        if in_comment:
            if char == "\n":
                in_comment = False
            continue

        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue

        if char == "#":
            in_comment = True
        elif char in {"'", '"'}:
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
            if depth < 0:
                break

    fail("could not find the end of the Trackify Caddy site block")
    raise AssertionError("unreachable")


def find_site_block(contents: str, host: str) -> tuple[int, int]:
    host_pattern = re.compile(
        rf"(?<![A-Za-z0-9.-])(?:https?://)?{re.escape(host)}(?::\d+)?(?![A-Za-z0-9.-])"
    )
    candidates: list[tuple[int, int]] = []
    offset = 0

    for line in contents.splitlines(keepends=True):
        uncommented = line.split("#", 1)[0]
        if host_pattern.search(uncommented) and "{" in uncommented:
            opening_brace = offset + uncommented.index("{")
            candidates.append((opening_brace, find_matching_brace(contents, opening_brace)))
        offset += len(line)

    if not candidates:
        fail(f"could not find an explicit Caddy site block for {host}")
    if len(candidates) != 1:
        fail(f"found {len(candidates)} Caddy site blocks for {host}; refusing to choose one")

    return candidates[0]


def replace_local_upstream(contents: str, opening_brace: int, closing_brace: int, upstream: str) -> str:
    block = contents[opening_brace + 1 : closing_brace]
    reverse_proxy_pattern = re.compile(
        r"^(?P<prefix>[ \t]*reverse_proxy[ \t]+)"
        r"(?P<upstream>(?:https?://)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)"
        r"(?P<suffix>.*)$",
        re.MULTILINE,
    )
    matches = list(reverse_proxy_pattern.finditer(block))

    if not matches:
        fail(
            "could not find a direct local reverse_proxy target in the Trackify Caddy block"
        )
    if len(matches) != 1:
        fail(
            f"found {len(matches)} local reverse_proxy targets in the Trackify Caddy block; refusing to choose one"
        )

    match = matches[0]
    current_upstream = match.group("upstream")
    replacement = f"{match.group('prefix')}{upstream}{match.group('suffix')}"
    updated_block = f"{block[:match.start()]}{replacement}{block[match.end():]}"

    if current_upstream == upstream:
        print(f"   Caddy already routes the public host to {upstream}")
    else:
        print(f"   Updating Caddy upstream: {current_upstream} -> {upstream}")

    return f"{contents[:opening_brace + 1]}{updated_block}{contents[closing_brace:]}"


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--caddyfile", type=Path, default=DEFAULT_CADDYFILE)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--upstream", default=DEFAULT_UPSTREAM)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    caddyfile: Path = args.caddyfile
    if os.geteuid() != 0:
        fail("this script must run as root")
    if not caddyfile.is_file() or caddyfile.is_symlink():
        fail(f"expected a regular Caddyfile at {caddyfile}")

    original = caddyfile.read_text()
    opening_brace, closing_brace = find_site_block(original, args.host)
    updated = replace_local_upstream(
        original, opening_brace, closing_brace, args.upstream
    )

    if args.dry_run:
        print("   Dry run complete; Caddy configuration was not changed")
        return

    caddyfile_stat = caddyfile.stat()
    with NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=caddyfile.parent,
        prefix=f"{caddyfile.name}.trackify-",
        delete=False,
    ) as temporary_file:
        temporary_file.write(updated)
        temporary_path = Path(temporary_file.name)

    try:
        os.chmod(temporary_path, stat.S_IMODE(caddyfile_stat.st_mode))
        os.chown(temporary_path, caddyfile_stat.st_uid, caddyfile_stat.st_gid)
        run(
            [
                "caddy",
                "validate",
                "--config",
                str(temporary_path),
                "--adapter",
                "caddyfile",
            ]
        )

        backup_path = caddyfile.with_name(
            f"{caddyfile.name}.before-trackify-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
        )
        shutil.copy2(caddyfile, backup_path)
        os.replace(temporary_path, caddyfile)

        try:
            run(["systemctl", "reload", "caddy"])
        except subprocess.CalledProcessError:
            shutil.copy2(backup_path, caddyfile)
            subprocess.run(["systemctl", "reload", "caddy"], check=False)
            fail(f"Caddy reload failed; restored {backup_path}")

        print(f"   Caddy reloaded successfully (backup: {backup_path})")
    finally:
        temporary_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
