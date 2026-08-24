import re,sys,collections
import sqlglot
from sqlglot import exp

import os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE=os.path.join(ROOT,'sql','maintenance_schema.sql'); MIG=os.path.join(ROOT,'sql','maintenance_migration_v09.sql')
base=open(BASE,encoding='utf-8').read(); mig=open(MIG,encoding='utf-8').read()
fails=[]; notes=[]

def batches(text):
    out=[];cur=[]
    for line in text.splitlines():
        if line.strip().upper()=='GO': out.append("\n".join(cur));cur=[]
        else: cur.append(line)
    if "".join(cur).strip(): out.append("\n".join(cur))
    return [b for b in out if b.strip()]

mb=batches(mig)
print(f"migration batches: {len(mb)}")

# 1. sqlglot parse coverage
ok=bad=0; badlist=[]
for i,b in enumerate(mb):
    stripped=re.sub(r'/\*.*?\*/','',b,flags=re.S).strip()
    if not stripped: continue
    try:
        sqlglot.parse(stripped,dialect='tsql'); ok+=1
    except Exception as e:
        bad+=1; badlist.append((i,str(e).splitlines()[0][:110]))
print(f"sqlglot tsql parse: {ok} ok, {bad} unparsed")
for i,e in badlist[:12]: print(f"   batch {i}: {e}")
notes.append(f"sqlglot parsed {ok}/{ok+bad} batches")

# 2. every CREATE TABLE guarded
for m in re.finditer(r'CREATE TABLE dbo\.(\w+)',mig):
    tbl=m.group(1); before=mig[:m.start()]
    gos=[g.end() for g in re.finditer(r'(?m)^GO$',before)]
    seg=before[gos[-1]:] if gos else before
    if f"OBJECT_ID('dbo.{tbl}', 'U') IS NULL" not in seg:
        fails.append(f"CREATE TABLE dbo.{tbl} is not guarded by an OBJECT_ID check")

# 3. every ADD column guarded by COL_LENGTH on the same table/column
for m in re.finditer(r'ALTER TABLE dbo\.(\w+) ADD (\w+) ',mig):
    tbl,col=m.group(1),m.group(2)
    if col=='CONSTRAINT': continue
    if f"COL_LENGTH('dbo.{tbl}', '{col}') IS NULL" not in mig[max(0,m.start()-260):m.start()]:
        fails.append(f"ALTER TABLE dbo.{tbl} ADD {col} is not guarded by COL_LENGTH")

# 4. every ADD CONSTRAINT guarded
for m in re.finditer(r'ADD CONSTRAINT (\w+)',mig):
    name=m.group(1); pre=mig[max(0,m.start()-300):m.start()]
    if f"OBJECT_ID('dbo.{name}'" not in pre:
        fails.append(f"ADD CONSTRAINT {name} is not guarded by an OBJECT_ID check")

# 5. every standalone CREATE INDEX guarded (those inside CREATE TABLE blocks are covered by #2)
for m in re.finditer(r'^(\s*)CREATE (?:UNIQUE )?INDEX (\w+)\s*\n\s*ON dbo\.(\w+)',mig,re.M):
    name=m.group(2)
    pre=mig[:m.start()]
    gos=[g.end() for g in re.finditer(r'(?m)^GO$',pre)]
    blk=pre[gos[-1]:] if gos else pre
    if 'CREATE TABLE' in blk: continue
    if f"name = '{name}'" not in blk:
        fails.append(f"CREATE INDEX {name} outside a guarded CREATE TABLE lacks a sys.indexes guard")

# 6. constraint / object names unique across both files
names=collections.Counter(re.findall(r'CONSTRAINT (\w+)',base+mig))
for n,c in names.items():
    if c>1 and not n.startswith('DF_'): fails.append(f"constraint name {n} declared {c} times")
newtables=set(re.findall(r'CREATE TABLE dbo\.(\w+)',mig))
for t in newtables:
    if f'CREATE TABLE dbo.{t} ' in base or f'CREATE TABLE dbo.{t}\n' in base:
        fails.append(f"migration recreates existing table {t}")

# 7. FK targets must exist, with the right column
cols=collections.defaultdict(set)
for src in (base,mig):
    for tm in re.finditer(r'CREATE TABLE dbo\.(\w+) \((.*?)\n    \);',src,re.S):
        t=tm.group(1)
        for cm in re.finditer(r'^        (\w+) ',tm.group(2),re.M): cols[t].add(cm.group(1))
for src in (base,mig):
    for am in re.finditer(r"COL_LENGTH\('dbo\.(\w+)', '(\w+)'\) IS NULL",src): cols[am.group(1)].add(am.group(2))
for m in re.finditer(r'REFERENCES dbo\.(\w+)\((\w+)\)',mig):
    t,c=m.group(1),m.group(2)
    if t not in cols: fails.append(f"FK references unknown table {t}")
    elif c not in cols[t]: fails.append(f"FK references unknown column {t}.{c}")

# 8. columns referenced by new views must exist
for m in re.finditer(r'\ba\.(\w+)',mig):
    if m.group(1) not in cols['MaintenanceAssets']: fails.append(f"view references MaintenanceAssets.{m.group(1)} which does not exist")
for m in re.finditer(r'\bh\.(\w+)',mig):
    if m.group(1) not in cols['MaintenanceHouseholds']|{'HouseholdId'}: fails.append(f"view references MaintenanceHouseholds.{m.group(1)} which does not exist")
for m in re.finditer(r'\bfi\.(\w+)',mig):
    if m.group(1) not in cols['MaintenanceFieldInspections']: fails.append(f"view references MaintenanceFieldInspections.{m.group(1)} which does not exist")
for m in re.finditer(r'\bv\.(\w+)',mig):
    if m.group(1) not in cols['MaintenanceVisits']: fails.append(f"view references MaintenanceVisits.{m.group(1)} which does not exist")
for m in re.finditer(r'\bpa\.(\w+)',mig):
    if m.group(1) not in cols['MaintenanceProtocolAssignments']: fails.append(f"view references MaintenanceProtocolAssignments.{m.group(1)} which does not exist")

# 9. every MERGE ON key must be backed by a UNIQUE constraint/index
for m in re.finditer(r'MERGE dbo\.(\w+) AS target(.*?)\nON (.*?)\nWHEN MATCHED',mig,re.S):
    tbl,on=m.group(1),m.group(3)
    # Only equality joins against the source are merge keys; filter predicates
    # like "target.PartNumber IS NULL" narrow the match, they don't identify it.
    keys=sorted(set(re.findall(r'target\.(\w+)\s*=\s*source\.\1',on)))
    # The whole guarded block, not just the column list -- CREATE UNIQUE INDEX
    # statements sit after the closing paren of CREATE TABLE.
    body=re.search(rf"IF OBJECT_ID\('dbo\.{tbl}', 'U'\) IS NULL(.*?)\nGO",base+mig,re.S)
    if not body: fails.append(f"MERGE target {tbl} has no guarded CREATE TABLE"); continue
    uq=re.findall(r'UNIQUE \(([^)]*)\)',body.group(1))+re.findall(r'(\w+) NVARCHAR\(\d+\) NOT NULL\s*\n\s*CONSTRAINT \w+ UNIQUE',body.group(1))
    flat=[sorted(x.replace(' ','').split(',')) for x in uq]+[[x] for x in uq if ',' not in x]
    # Unfiltered unique indexes back a MERGE on their columns outright.
    idx=re.findall(r'CREATE UNIQUE INDEX \w+\s*\n\s*ON dbo\.\w+\(([^)]*)\)\s*;',body.group(1))
    flat+= [sorted(x.replace(' ','').split(',')) for x in idx]
    # A FILTERED unique index only backs the MERGE if the ON clause repeats its
    # filter -- otherwise the MERGE can match rows outside the filter.
    for icols,pred in re.findall(r'CREATE UNIQUE INDEX \w+\s*\n\s*ON dbo\.\w+\(([^)]*)\)\s*\n\s*WHERE ([^;]+);',body.group(1)):
        if pred.strip().replace('target.','') in on.replace('target.',''):
            flat.append(sorted(icols.replace(' ','').split(',')))
    if keys not in flat:
        fails.append(f"MERGE on dbo.{tbl} keys {keys} not backed by a UNIQUE constraint or a matching filtered unique index (found {flat})")

# 10. string literals: unicode must be N-prefixed
for m in re.finditer(r"(?<!N)'([^'\n]*)'",mig):
    if any(ord(ch)>127 for ch in m.group(1)):
        fails.append(f"non-ASCII literal without N prefix: {m.group(1)[:40]!r}")

# 11. balanced parens per batch, no unterminated block comment
for i,b in enumerate(mb):
    nb=re.sub(r"'[^']*'",'',re.sub(r'/\*.*?\*/','',b,flags=re.S))
    if nb.count('(')!=nb.count(')'): fails.append(f"batch {i} has unbalanced parentheses")
if mig.count('/*')!=mig.count('*/'): fails.append("unbalanced block comment markers")

# 12. seed counts
print("\nseeded rows:")
for t in ['MaintenanceProtocolTemplates','MaintenanceProtocolCheckpoints','MaintenanceProtocolAssignments','MaintenanceLifecycleTiers','MaintenanceBrandTiers','MaintenanceExpectedLifeRules','MaintenanceLifecycleStages']:
    mm=re.search(rf'MERGE dbo\.{t} AS target(.*?)\n\) AS source|MERGE dbo\.{t} AS target(.*?)WHEN MATCHED',mig,re.S)
    seg=mm.group(0) if mm else ''
    n=len(re.findall(r'^\s+\(N?',seg,re.M))
    print("  %-38s %4d" % (t,n))

print("\nnew tables:",len(newtables))
print("new columns on existing tables:",len(set(re.findall(r"COL_LENGTH\('dbo\.(\w+)', '(\w+)'\)",mig))))
print("new views:",len(re.findall(r'CREATE OR ALTER VIEW',mig)))
print()
if fails:
    print(f"{len(fails)} PROBLEM(S):")
    for f in dict.fromkeys(fails): print("  -",f)
    sys.exit(1)
print("ALL STRUCTURAL CHECKS PASSED")
