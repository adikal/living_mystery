"""A running game, driven over JSON lines (tools/playtest/game.mjs)."""
import json
import os
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SERVER = os.path.join(ROOT, 'tools', 'playtest', 'game.mjs')


class GameClient:
    """One game per process. new() starts a case; act() performs an action; report() is the private trace."""

    def __init__(self):
        self.proc = subprocess.Popen(['node', SERVER], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, text=True, bufsize=1)

    def _ask(self, msg):
        self.proc.stdin.write(json.dumps(msg) + '\n')
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError('the game process ended')
        return json.loads(line)

    def new(self, case_file, **options):
        r = self._ask({'op': 'new', 'case': case_file, 'options': options})
        if not r.get('ok'):
            raise RuntimeError(r.get('error'))
        return r['observation']

    def act(self, action):
        return self._ask({'op': 'act', 'action': action})

    def report(self):
        return self._ask({'op': 'report'})['report']

    def close(self):
        try:
            self._ask({'op': 'close'})
        except Exception:
            pass
        self.proc.kill()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
