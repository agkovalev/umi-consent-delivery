#!/usr/bin/env python3
"""Extract a downloaded backup without following archive links or path traversal."""

import shutil
import sys
import tarfile
import re
from pathlib import Path, PurePosixPath


def extract(archive: Path, destination: Path, stamp: str) -> None:
    if re.fullmatch(r"[0-9]{8}T[0-9]{6}Z", stamp) is None:
        raise ValueError("Invalid snapshot name")
    destination.mkdir(mode=0o700)
    total_size = 0
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            path = PurePosixPath(member.name)
            if (
                path.is_absolute()
                or ".." in path.parts
                or not path.parts
                or path.parts[0] != stamp
                or not (member.isdir() or member.isfile())
            ):
                raise ValueError("Unsafe backup archive entry")
            total_size += member.size
            if member.size > 256 * 1024 * 1024 or total_size > 512 * 1024 * 1024:
                raise ValueError("Oversized backup archive entry")
            target = destination.joinpath(*path.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
                continue
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            data = source.extractfile(member)
            if data is None:
                raise ValueError("Unreadable backup archive entry")
            with target.open("xb") as output:
                shutil.copyfileobj(data, output)
            target.chmod(0o600)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("Usage: extract-snapshot.py ARCHIVE NEW_DESTINATION STAMP")
    extract(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
