"""Where a generation run is: its milestones so far (seed, each step, reviews, publishing) and its timing table.

    python tools/refine-c/status.py [runs/live-<stamp>]      (default: the newest run)
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MILESTONE = re.compile(r'seed (ok|round)|step \d+ \S+ -> |targets met|time budget|whole-case review|DONE|published|failed|Error|Traceback')


def main():
    run = sys.argv[1] if len(sys.argv) > 1 else max(glob.glob(os.path.join(HERE, 'runs', 'live-*[0-9]')), key=os.path.getmtime)
    run = run.rstrip('/')
    print(f'== {os.path.basename(run)}')
    try:
        for line in open(run + '.log'):
            if MILESTONE.search(line):
                print(line.rstrip()[:240])
    except OSError:
        print('(no log)')
    try:
        print('\n' + open(os.path.join(run, 'timings.md')).read())
    except OSError:
        print('(no timings yet)')


if __name__ == '__main__':
    main()
