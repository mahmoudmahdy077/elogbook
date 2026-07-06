#!/usr/bin/env python3
import yaml

with open('/root/elogbook/docs/openapi.yaml') as f:
    spec = yaml.safe_load(f)

paths = list(spec.get('paths', {}).keys())
rpcs = [r['name'] for r in spec.get('x-rpcs', [])]
triggers = [t['name'] for t in spec.get('x-database-triggers', [])]

print(f'Servers: {[s["url"] for s in spec["servers"]]}')
print(f'Info: {spec["info"]["title"]} v{spec["info"]["version"]}')
print(f'\nPaths ({len(paths)}):')
for p in sorted(paths):
    methods = list(spec['paths'][p].keys())
    print(f'  {p}: {", ".join(methods)}')

print(f'\nRPCs ({len(rpcs)}):')
for r in rpcs:
    desc = [d['name'] for d in spec['x-rpcs'] if d['name'] == r][0]
    print(f'  - {r}')

print(f'\nDatabase Triggers ({len(triggers)}):')
for t in triggers:
    print(f'  - {t}')

print('\n=== YAML valid: OK ===')
