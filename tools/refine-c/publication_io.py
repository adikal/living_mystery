"""Durable JSON and the shared lock for published-case maintenance."""
import contextlib
import errno
import glob
import json
import os
import stat
import tempfile
import threading
import time

try:                      # POSIX file locks; Windows has msvcrt instead
    import fcntl
except ImportError:
    fcntl = None
try:
    import msvcrt
except ImportError:
    msvcrt = None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PUBLICATION_ROOT = os.path.join(ROOT, 'dist', 'cases', 'generated')
STALE_TEMPORARY_SECONDS = 3600   # an atomic_json temporary this old belongs to a writer that was interrupted
_PROCESS_LOCK = threading.RLock()
_HELD = threading.local()        # per thread: resolved root -> how deeply this thread holds its lock


def read_json(path):
    """Read JSON and close its descriptor on success or failure."""
    with open(path, encoding='utf-8') as source:
        return json.load(source)


def _sync_directory(directory):
    """Persist a directory-entry change where the platform supports it (Windows cannot open a directory)."""
    if os.name == 'nt':
        return
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _mode_for(path):
    """The permission bits a replacement should keep: the destination's own, or ordinary 0644 for a new file."""
    try:
        return stat.S_IMODE(os.stat(path).st_mode)
    except FileNotFoundError:
        return 0o644


def atomic_json(path, value):
    """Replace a JSON file only after its complete contents reach durable storage."""
    directory = os.path.dirname(path) or '.'
    os.makedirs(directory, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.publication-', suffix='.json.tmp', dir=directory)
    try:
        # mkstemp creates 0600; a served or shared file must keep the permissions readers already rely on.
        if hasattr(os, 'fchmod'):
            os.fchmod(descriptor, _mode_for(path))
        else:
            os.chmod(temporary, _mode_for(path))
        with os.fdopen(descriptor, 'w', encoding='utf-8') as target:
            json.dump(value, target, ensure_ascii=False, indent=1, allow_nan=False)   # NaN is not JSON
            target.write('\n')
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
        _sync_directory(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def durable_unlink(path):
    """Remove a transaction marker and persist the directory update."""
    try:
        os.unlink(path)
    except FileNotFoundError:
        return
    _sync_directory(os.path.dirname(path) or '.')


def durable_rename(source, target):
    """Atomically move a file within its directory and persist the directory update."""
    os.replace(source, target)
    _sync_directory(os.path.dirname(target) or '.')


def sweep_stale_temporaries(root, max_age=STALE_TEMPORARY_SECONDS):
    """Remove temporaries that an interrupted atomic_json left in root and root/live. Called with the publication lock
    held, and only for old files, so a write still in flight is never touched. Returns the paths removed."""
    cutoff, removed = time.time() - max_age, []
    for directory in (root, os.path.join(root, 'live')):
        for pattern in ('.publication-*.tmp', '*.json.tmp'):
            for path in glob.glob(os.path.join(glob.escape(directory), pattern)):
                try:
                    if os.path.getmtime(path) < cutoff:
                        os.unlink(path)
                        removed.append(path)
                except OSError:
                    pass   # already gone, or not ours to remove: never a reason to refuse the lock
    return removed


def _lock_file(handle):
    """Block until this process holds an exclusive lock on the open file."""
    if fcntl is not None:
        fcntl.flock(handle, fcntl.LOCK_EX)
        return
    while True:   # msvcrt.LK_LOCK gives up after ten one-second tries; keep waiting, as flock does
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)   # byte 0 stands for the whole file
            return
        except OSError as error:
            if error.errno not in (errno.EDEADLK, getattr(errno, 'EDEADLOCK', errno.EDEADLK), errno.EACCES):
                raise


def _unlock_file(handle):
    if fcntl is not None:
        fcntl.flock(handle, fcntl.LOCK_UN)
        return
    handle.seek(0)
    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def _depths():
    if not hasattr(_HELD, 'depth'):
        _HELD.depth = {}
    return _HELD.depth


@contextlib.contextmanager
def publication_lock(root=PUBLICATION_ROOT):
    """Serialize publication commits across threads and processes; reentrant within one thread for the same root.

    The lock is `<root>/.publication.lock`, then `<root>/live/.index.lock` when live/ exists: generator processes
    started before the shared lock existed take only that one, and a fixed order means the two cannot deadlock.
    A nested acquisition by the thread that holds the root only counts depth: opening and locking the file again
    would wait on this thread's own lock (flock is per open file, not per process)."""
    os.makedirs(root, exist_ok=True)
    key, depths = os.path.realpath(root), _depths()
    if depths.get(key):
        depths[key] += 1
        try:
            yield
        finally:
            depths[key] -= 1
        return
    with _PROCESS_LOCK, contextlib.ExitStack() as held:
        paths = [os.path.join(root, '.publication.lock')]
        if os.path.isdir(os.path.join(root, 'live')):
            paths.append(os.path.join(root, 'live', '.index.lock'))
        for path in paths:
            handle = held.enter_context(open(path, 'a+', encoding='utf-8'))
            _lock_file(handle)
            held.callback(_unlock_file, handle)    # unlocked before it is closed, in reverse order
        sweep_stale_temporaries(root)
        depths[key] = 1
        try:
            yield
        finally:
            depths.pop(key, None)
