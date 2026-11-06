"""Inventory persistent work/output only. Runs inside OpenSandbox, never the API host."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


def inventory(root):
    def scan_error(error):
        raise error

    result = []
    total = 0
    for name in ('work', 'output'):
        directory = root / name
        if directory.is_symlink():
            raise ValueError('Persistent root must not be a symlink')
        if not directory.exists():
            continue
        if not directory.is_dir():
            raise ValueError('Persistent root must be a directory')
        for parent, directories, files in os.walk(directory, followlinks=False, onerror=scan_error):
            for child in directories:
                if (Path(parent) / child).is_symlink():
                    raise ValueError('Workspace symlinks are not persistent files')
            for name in files:
                path = Path(parent) / name
                descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(descriptor, 'rb') as stream:
                    info = os.fstat(stream.fileno())
                    if not stat.S_ISREG(info.st_mode):
                        raise ValueError('Workspace entry is not a regular file')
                    digest = hashlib.sha256()
                    size = 0
                    while True:
                        chunk = stream.read(65536)
                        if not chunk:
                            break
                        size += len(chunk)
                        total += len(chunk)
                        if size > 25 * 1024 * 1024 or total > 100 * 1024 * 1024:
                            raise ValueError('Workspace byte limit exceeded')
                        digest.update(chunk)
                result.append(dict(path=path.relative_to(root).as_posix(), size=size, sha256=digest.hexdigest()))
                if len(result) > 1000:
                    raise ValueError('Workspace file count limit exceeded')
    return sorted(result, key=lambda item: item['path'])


if __name__ == '__main__':
    target = Path(sys.argv[1])
    if target.parent != Path('/workspace') or not target.name.startswith('.workspace-manifest-'):
        raise ValueError('Invalid response path')
    payload = json.dumps(inventory(Path('/workspace')), ensure_ascii=True).encode()
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(payload)
