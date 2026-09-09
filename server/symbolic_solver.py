"""Bounded Z3 adapter for the solver-neutral IR. No case data or LLM dependency."""
import hashlib
import json
import re

NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")


def solve(query):
    if not isinstance(query, dict) or set(query) != {'version','kind','perspective','variables','constraints','assumptions','horizon','minute'} or type(query.get('version')) is not int or query.get('version') != 1 or query.get('kind') != 'plan-feasibility' or query.get('perspective') != 'world':
        raise ValueError('Unsupported symbolic query')
    if type(query['minute']) is not int or not 0 <= query['minute'] <= 1000000 or type(query['horizon']) is not int or not 0 <= query['horizon'] <= 120:
        raise ValueError('Invalid time bounds')
    assumptions = query['assumptions']
    if not isinstance(assumptions, list) or len(assumptions) > 8 or any(not isinstance(a, dict) or set(a) != {'id','text'} or not isinstance(a['id'], str) or not NAME.fullmatch(a['id']) or not isinstance(a['text'], str) or len(a['text']) > 400 for a in assumptions):
        raise ValueError('Invalid assumptions')
    variables, constraints = query.get('variables'), query.get('constraints')
    if not isinstance(variables, dict) or not 1 <= len(variables) <= 128 or not isinstance(constraints, list) or not 1 <= len(constraints) <= 256:
        raise ValueError('Invalid query bounds')
    # Separate contexts isolate concurrent HTTP requests.
    try:
        import z3
    except ImportError:
        return {'status': 'unavailable', 'reason': 'Install server/requirements-solver.txt'}
    context = z3.Context()
    solver = z3.Solver(ctx=context)
    solver.set(timeout=1500, rlimit=200000)
    symbols = {}
    for name, spec in variables.items():
        if not NAME.fullmatch(name) or not isinstance(spec, dict) or set(spec) != {'sort', 'min', 'max'} or spec['sort'] != 'int':
            raise ValueError('Unsupported variable')
        lo, hi = spec['min'], spec['max']
        if type(lo) is not int or type(hi) is not int or not 0 <= lo <= hi <= 1000000:
            raise ValueError('Invalid domain')
        symbols[name] = z3.Int(name, ctx=context)
        solver.add(symbols[name] >= lo, symbols[name] <= hi)
    budget = [0]

    def translate(node, depth=0):
        budget[0] += 1
        if depth > 12 or budget[0] > 5000:
            raise ValueError('Expression budget exceeded')
        if type(node) is bool:
            return z3.BoolVal(node, ctx=context), 'bool'
        if type(node) is int and abs(node) <= 1000000:
            return z3.IntVal(node, ctx=context), 'int'
        if not isinstance(node, dict):
            raise ValueError('Unsupported literal')
        if set(node) == {'var'} and isinstance(node['var'], str) and node['var'] in symbols:
            return symbols[node['var']], 'int'
        if set(node) != {'op', 'args'} or not isinstance(node['args'], list) or len(node['args']) > 32:
            raise ValueError('Unsupported expression')
        pairs = [translate(x, depth + 1) for x in node['args']]
        a, sorts = [x[0] for x in pairs], [x[1] for x in pairs]
        op = node['op']
        if op == 'eq' and len(a) == 2 and sorts[0] == sorts[1]:
            return a[0] == a[1], 'bool'
        if op in ('ge', 'le') and sorts == ['int', 'int']:
            return (a[0] >= a[1] if op == 'ge' else a[0] <= a[1]), 'bool'
        if op == 'add' and a and all(s == 'int' for s in sorts):
            return z3.Sum(a), 'int'
        if op in ('and', 'or') and a and all(s == 'bool' for s in sorts):
            return (z3.And(a) if op == 'and' else z3.Or(a)), 'bool'
        if op == 'not' and sorts == ['bool']:
            return z3.Not(a[0]), 'bool'
        raise ValueError('Unsupported operator or type')

    labels = {}
    for constraint in constraints:
        if not isinstance(constraint, dict) or set(constraint) != {'id', 'label', 'formula', 'sources'}:
            raise ValueError('Invalid constraint')
        name = constraint['id']
        if not isinstance(name, str) or not NAME.fullmatch(name) or name in labels or name in symbols:
            raise ValueError('Invalid constraint identity')
        if not isinstance(constraint['label'], str) or len(constraint['label']) > 400 or not isinstance(constraint['sources'], list) or len(constraint['sources']) > 40 or not all(isinstance(x, str) and len(x) < 80 for x in constraint['sources']):
            raise ValueError('Invalid provenance')
        value, sort = translate(constraint['formula'])
        if sort != 'bool':
            raise ValueError('Constraint must be Boolean')
        labels[name] = constraint
        solver.assert_and_track(value, z3.Bool(name, ctx=context))
    result = solver.check()
    answer = {'status': str(result), 'solver': 'z3', 'solverVersion': z3.get_version_string(), 'adapterVersion': 1,
              'queryDigest': hashlib.sha256(json.dumps(query, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
    if result == z3.sat:
        model = solver.model()
        answer['witness'] = {name: model.eval(value, model_completion=True).as_long() for name, value in symbols.items()}
    elif result == z3.unsat:
        answer['conflicts'] = [labels[str(x)] for x in solver.unsat_core()]
    else:
        answer['reason'] = solver.reason_unknown()
    return answer
