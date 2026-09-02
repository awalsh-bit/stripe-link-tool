import json
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
    uq=(re.findall(r'UNIQUE \(([^)]*)\)',body.group(1))
        +re.findall(r'(\w+) NVARCHAR\(\d+\) NOT NULL\s*\n\s*CONSTRAINT \w+ UNIQUE',body.group(1))
        # An inline single-column PRIMARY KEY guarantees uniqueness just as a
        # UNIQUE constraint does. Not recognising it produced a false alarm on
        # a correct table, and a checker that cries wolf gets ignored.
        # TINYINT added v0.9.21 for the single-row settings table; DECIMAL added
        # v0.9.22 for the life-factor anchors, whose key IS the reading. Both
        # omissions were arbitrary rather than meaningful -- a TINYINT or DECIMAL
        # primary key is as unique as an INT one -- and each flagged a correct
        # table until it was added.
        +re.findall(r'(\w+) (?:NVARCHAR\(\d+\)|DECIMAL\(\d+,\d+\)|INT|SMALLINT|BIGINT|TINYINT) NOT NULL\s*\n\s*CONSTRAINT \w+ PRIMARY KEY',body.group(1))
        +re.findall(r'PRIMARY KEY \(([^)]*)\)',body.group(1)))
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
for t in ['MaintenanceProtocolTemplates','MaintenanceProtocolCheckpoints','MaintenanceProtocolAssignments','MaintenanceLifecycleTiers','MaintenanceBrandTiers','MaintenanceExpectedLifeRules','MaintenanceLifecycleStages','MaintenanceAgeSources']:
    mm=re.search(rf'MERGE dbo\.{t} AS target(.*?)\n\) AS source|MERGE dbo\.{t} AS target(.*?)WHEN MATCHED',mig,re.S)
    seg=mm.group(0) if mm else ''
    n=len(re.findall(r'^\s+\(N?',seg,re.M))
    print("  %-38s %4d" % (t,n))

# 13. age provenance: the columns the application depends on, and the one
#     invariant that matters -- a documented age must be distinguishable from a
#     remembered one, in SQL as well as in JS.
for col in ['InstallYear','InstallDate','AgeSourceCode','AgeSourceReference']:
    if f"COL_LENGTH('dbo.MaintenanceAssets', '{col}')" not in mig:
        fails.append(f"MaintenanceAssets is missing the {col} column")
if 'IsDocumented' not in mig:
    fails.append("MaintenanceAgeSources has no IsDocumented flag, so SQL cannot tell a dated invoice from a recollection")
for code in ["N'invoice'","N'customer'","N'estimate'","N'unknown'"]:
    if code not in mig:
        fails.append(f"age-source vocabulary is missing {code} -- the seed did not run against the current config")
# The generator caches the dumped config; an empty seed here means it emitted
# stale SQL while reporting success.
if re.search(r'MERGE dbo\.MaintenanceAgeSources AS target\s*\nUSING \(VALUES\s*\n\s*\) AS source', mig):
    fails.append("the age-source MERGE has no rows -- the config dump was stale")
if 'vw_MaintenanceAssetAgeProvenance' not in mig:
    fails.append("the age-provenance view is missing, so the office has no list of undated appliances")
# 14. photo evidence reconciliation
for col in ['LocalCaptureId','UploadedAt']:
    if f"COL_LENGTH('dbo.MaintenanceFieldInspectionPhotos', '{col}')" not in mig:
        fails.append(f"MaintenanceFieldInspectionPhotos is missing {col}, so an upload cannot be matched to its capture")

# ---------------------------------------------------------------------------
# 15. THE SEED IS ACTUALLY GENERATED FROM THE CURRENT CONFIG
#
# This is the check that was missing, and its absence cost real damage: the
# checked-in migration had been generated from a config predating the HVAC work,
# so it carried 11 protocol templates where the config had 15, and ZERO of the
# four HVAC protocols, 21 HVAC brand tiers or 12 HVAC expected-life rows. The
# file header says "regenerate, do not hand-edit"; nothing verified that anyone
# had. Whoever ran it against SQL Server would have got a database that could
# not resolve an HVAC protocol at all, and the structural checks above all
# passed while that was true.
#
# So the counts are compared against plan-config.js itself, live.
# ---------------------------------------------------------------------------
import json as _json, subprocess as _sp
cfg = _json.loads(_sp.run(["node", os.path.join(ROOT, "sql", "dump_config.js")],
                         capture_output=True, text=True, check=True).stdout)

def seeded_rows(table):
    """Row count for one MERGE seed, using the same tolerant match as the
    summary above -- the strict `USING (VALUES\n` form missed the checkpoint
    seed entirely and reported it as zero rows, which would have made this
    whole check pass on an empty table."""
    mm = re.search(rf"MERGE dbo\.{table} AS target(.*?)\n\) AS source"
                   rf"|MERGE dbo\.{table} AS target(.*?)WHEN MATCHED", mig, re.S)
    if not mm:
        return None
    return re.findall(r"^\s+\(N?", mm.group(0), re.M)

want_templates = set(cfg["checkpointSets"].keys())
_tpl = re.search(r"MERGE dbo\.MaintenanceProtocolTemplates AS target(.*?)\n\) AS source", mig, re.S)
got_templates = set(re.findall(r"^\s+\(N'([^']+)'", _tpl.group(1) if _tpl else "", re.M))
missing_templates = sorted(want_templates - got_templates)
if missing_templates:
    fails.append("the migration is stale: plan-config.js has protocol(s) %s that are not seeded "
                 "-- re-run node sql/dump_config.js && python3 sql/generate_migration_v09.py"
                 % ", ".join(missing_templates))
extra_templates = sorted(got_templates - want_templates)
if extra_templates:
    fails.append("the migration seeds protocol(s) %s that plan-config.js no longer defines"
                 % ", ".join(extra_templates))

want_checkpoints = sum(len(v) for v in cfg["checkpointSets"].values())
got_checkpoints = seeded_rows("MaintenanceProtocolCheckpoints")
if got_checkpoints is not None and len(got_checkpoints) != want_checkpoints:
    fails.append("checkpoint count drift: config has %d, the migration seeds %d"
                 % (want_checkpoints, len(got_checkpoints)))

want_brands = len(cfg["brandTierDefaults"])
got_brands = seeded_rows("MaintenanceBrandTiers")
if got_brands is not None and len(got_brands) != want_brands:
    fails.append("brand-tier drift: config has %d brands, the migration seeds %d"
                 % (want_brands, len(got_brands)))

want_life = sum(len(v) for v in cfg["lifecycleMatrix"].values())
got_life = seeded_rows("MaintenanceExpectedLifeRules")
if got_life is not None and len(got_life) != want_life:
    fails.append("expected-life drift: config has %d rules, the migration seeds %d"
                 % (want_life, len(got_life)))

for code in cfg["checkpointSets"]:
    if code.startswith("hvac_") and ("N'%s'" % code) not in mig:
        fails.append("HVAC protocol %s is not in the migration at all" % code)

want_stages = [st["label"] for st in cfg["lifecycleStages"]]
for label in want_stages:
    if ("N'%s'" % label.replace("'", "''")) not in mig:
        fails.append("lifecycle stage label %r is not seeded -- the stage vocabulary has drifted"
                     % label)

# ---------------------------------------------------------------------------
# v0.9.17: the scoring gate has to survive the trip into SQL Server.
#
# The rule that work Wilson performed cannot raise a customer's health score
# lives in WILSON_ANSWERS.scorable(). The dashboard will eventually compute the
# score in the database, so the rule exists twice -- and a rule that exists
# twice is a rule that will disagree with itself. These checks compare the two
# sides row by row, and the guardrail constraint is asserted to exist, because
# a CHECK is what makes "maintenance raises the score" unrepresentable rather
# than merely discouraged.
# ---------------------------------------------------------------------------
kinds = cfg.get("answerKinds") or {}
if not kinds:
    fails.append("dump_config.js is not emitting answerKinds -- the SQL seed cannot carry "
                 "the scoring gate, and every checkpoint would default to scoring")
else:
    want_counts = collections.Counter(
        row["kind"] for prot in kinds.values() for row in prot.values())
    # One VALUES row per checkpoint; the kind is the 4th-from-last column.
    seed = re.search(r"MERGE dbo\.MaintenanceProtocolCheckpoints AS target(.*?)WHEN MATCHED",
                     mig, re.S)
    seeded_kinds = collections.Counter(
        re.findall(r"N'(scored|maintenance|observed|trend)', [01], N'", seed.group(1) if seed else ""))
    for kind, n in want_counts.items():
        if seeded_kinds.get(kind, 0) != n:
            fails.append("answer-kind drift: config has %d %r checkpoint(s), the migration seeds %d"
                         % (n, kind, seeded_kinds.get(kind, 0)))
    # WHICH KINDS MAY CARRY ScoresHealth = 1.
    #
    # This asserted that only `scored` could, on the grounds that a technician's
    # judgement must not move the number. v0.9.19 changed that deliberately: a
    # condition scores through an option whose value is published and shown on
    # the button, which is what makes it repeatable. The half that must never
    # change is the other half -- work performed cannot score, and neither can a
    # reading with no agreed band.
    wrong = re.findall(r"N'(maintenance|trend)', 1, N'", seed.group(1) if seed else "")
    if wrong:
        fails.append("the migration seeds ScoresHealth = 1 on %d checkpoint(s) that must never "
                     "score (%s) -- work performed and unbanded readings stay out of the number"
                     % (len(wrong), ", ".join(sorted(set(wrong)))))
    for kind in ("scored", "observed"):
        unscored = re.findall(r"N'%s', 0, N'" % kind, seed.group(1) if seed else "")
        if unscored:
            fails.append("the migration seeds ScoresHealth = 0 on %d %r checkpoint(s) -- "
                         "measurements and anchored conditions are what the score is made of"
                         % (len(unscored), kind))
    for name, why in [
        ("CK_MaintenanceProtocolCheckpoints_ResultKind",
         "any string could be stored as an answer kind"),
        ("CK_MaintenanceProtocolCheckpoints_ScoresOnlyScored",
         "a future seed could make work performed raise the health score"),
    ]:
        if name not in mig:
            fails.append("%s is missing -- without it, %s" % (name, why))
    # ----------------------------------------------------------------------
    # v0.9.19: the published score of every answer has to reach the database.
    #
    # Conditions score now, and what makes that defensible is that the value of
    # each answer is written down rather than judged. If those values live only
    # in plan-config.js then a dashboard recomputing the score in SQL has to
    # invent them, which is the same drift this file exists to prevent -- one
    # layer down and much harder to see.
    # ----------------------------------------------------------------------
    want_options = []
    for setKey, checksById in kinds.items():
        for checkId, entry in checksById.items():
            for opt in (entry.get("optionList") or []):
                want_options.append((setKey, checkId, opt))
    opt_seed = re.search(r"MERGE dbo\.MaintenanceCheckpointOptions AS target(.*?)WHEN MATCHED",
                         mig, re.S)
    if not want_options:
        fails.append("dump_config.js is not emitting optionList -- the published scores stop at "
                     "the browser and SQL Server has nothing to compute a score from")
    elif not opt_seed:
        fails.append("the migration does not seed dbo.MaintenanceCheckpointOptions at all")
    else:
        body = opt_seed.group(1)
        seeded = len(re.findall(r"^\s+\(N'", body, re.M))
        if seeded != len(want_options):
            fails.append("answer drift: config has %d checkpoint answers, the migration seeds %d"
                         % (len(want_options), seeded))
        # Every score, exactly as published -- including the NULLs.
        #
        # The rows are parsed rather than regexed a column at a time: a first
        # attempt matched `N'<code>', [^\n]*?, (NULL|\d+),` and picked up the
        # score of a DIFFERENT option on the same line, reporting four failures
        # against a correct seed. A checker that misreads its own input is worse
        # than no checker.
        def split_row(line):
            """Top-level comma split of one T-SQL VALUES row."""
            out, buf, in_str, i = [], "", False, 0
            while i < len(line):
                ch = line[i]
                if in_str:
                    if ch == "'" and i + 1 < len(line) and line[i + 1] == "'":
                        buf += "''"; i += 2; continue
                    if ch == "'":
                        in_str = False
                    buf += ch
                elif ch == "'":
                    in_str = True; buf += ch
                elif ch == ",":
                    out.append(buf.strip()); buf = ""
                else:
                    buf += ch
                i += 1
            out.append(buf.strip())
            return out

        parsed = {}
        for line in body.splitlines():
            line = line.strip()
            if not line.startswith("(N'"):
                continue
            cells = split_row(line.rstrip(",").strip()[1:-1])
            if len(cells) < 8:
                fails.append("checkpoint-answer row has %d columns, expected 12" % len(cells))
                continue
            key = (cells[0][2:-1], cells[2][2:-1], cells[4][2:-1])   # template, check, code
            parsed[key] = cells[7]                                    # ScoreValue
        for setKey, checkId, opt in want_options:
            got = parsed.get((setKey, checkId, opt["code"]))
            want = "NULL" if opt["score"] is None else str(opt["score"])
            if got is None:
                fails.append("answer %s.%s -> %s is not seeded" % (setKey, checkId, opt["code"]))
            elif got != want:
                fails.append("answer %s.%s -> %s seeds score %s, config publishes %s"
                             % (setKey, checkId, opt["code"], got, want))
        # And the dirt rule, asserted in the SQL as well as the JS.
        dirt = [o for _, _, o in want_options
                if re.search(r"cleaned at this visit|cosmetic|residue only|debris only|"
                             r"build-up only|grease-laden|accumulation removed", o["label"], re.I)]
        bad_dirt = [o["label"] for o in dirt if o["score"] != 5]
        if bad_dirt:
            fails.append("the seed would deduct for dirt or cosmetic wear: %s"
                         % ", ".join(bad_dirt[:3]))
        elif dirt:
            print("dirt-and-cosmetic answers seeded at full marks:", len(dirt))
        print("checkpoint answers seeded:", seeded, "of", len(want_options))

    if "vw_MaintenanceScoringCheckpoints" not in mig:
        fails.append("vw_MaintenanceScoringCheckpoints is missing -- anything computing a score "
                     "would have to remember the exclusion in its own WHERE clause")
    print("config answer kinds:", dict(want_counts), "seeded:", dict(seeded_kinds))

# ---------------------------------------------------------------------------
# v0.9.22: the water hardness modifier, on both sides of the wire.
#
# This factor multiplies the expected service life of every water-bearing
# appliance in a house, and it now exists in two places -- WILSON_WATER in
# plan-config.js and the seeded tables plus vw_MaintenanceHouseholdWaterLatest
# here. If they drift, a customer report and the dashboard quote different
# expected lives for the same dishwasher and nothing says which is right.
#
# So: the numbers are compared row by row, and the RULE the view encodes is
# asserted structurally, because "the strip beats the claim" is the part most
# likely to be helpfully simplified back into "trust the softener field".
# ---------------------------------------------------------------------------
water = cfg.get("waterHardness") or {}
if not water:
    fails.append("dump_config.js is not emitting waterHardness -- the migration would seed "
                 "an empty anchor table and every house would silently read as untested")
else:
    # --- the bands: description only, no arithmetic ------------------------
    band_seed = re.search(r"MERGE dbo\.MaintenanceWaterHardnessBands AS target(.*?)\n\) AS source",
                          mig, re.S)
    seeded_bands = {}
    if band_seed:
        # Positional, not a comma split: the labels contain commas and
        # apostrophes, and a "clever" split on commas-outside-quotes cut in the
        # wrong places and reported every band as missing.
        for row in re.findall(r"^\s+\((.*?)\),?\r?$", band_seed.group(1), re.M):
            cell = re.match(r"N'([^']+)',\s*N'(?:[^']|'')*',\s*([^,]+),", row)
            if cell:
                seeded_bands[cell.group(1)] = cell.group(2).strip()
    for band in water.get("bands") or []:
        got = seeded_bands.get(band["id"])
        if got is None:
            fails.append("water band %r is not seeded -- the SQL side cannot name a reading "
                         "for the customer" % band["id"])
            continue
        want_max = "NULL" if band.get("max") is None else str(band["max"])
        if got != want_max:
            fails.append("water band %s: SQL ceiling %s, config %s" % (band["id"], got, want_max))
    extra_bands = sorted(set(seeded_bands) - {b["id"] for b in (water.get("bands") or [])})
    if extra_bands:
        fails.append("the migration seeds water band(s) %s that plan-config.js no longer defines"
                     % ", ".join(extra_bands))
    # v0.9.22: a band that regained a factor would put the technician back in the
    # business of choosing a multiplier by choosing a band.
    band_ddl = re.search(r"CREATE TABLE dbo\.MaintenanceWaterHardnessBands(.*?)\n    \);", mig, re.S)
    if band_ddl and "LifeFactor" in band_ddl.group(1):
        fails.append("MaintenanceWaterHardnessBands carries a LifeFactor again -- bands describe "
                     "a reading, they must not price one")

    # --- the anchors: this IS the algorithm --------------------------------
    anchor_seed = re.search(r"MERGE dbo\.MaintenanceWaterLifeFactorAnchors AS target(.*?)\n\) AS source",
                            mig, re.S)
    seeded_anchors = []
    if anchor_seed:
        for row in re.findall(r"^\s+\(([^)]*?)\),?\r?$", anchor_seed.group(1), re.M):
            cells = [c.strip() for c in row.split(",")]
            if len(cells) >= 2:
                seeded_anchors.append((float(cells[0]), float(cells[1])))
    want_anchors = [(float(a["gpg"]), float(a["factor"]))
                    for a in (water.get("lifeFactorAnchors") or [])]
    if not seeded_anchors:
        fails.append("the life-factor anchors are not seeded -- the SQL view would interpolate "
                     "against an empty table and return NULL for every house")
    elif seeded_anchors != want_anchors:
        fails.append("life-factor anchor drift: SQL has %s, config has %s -- the dashboard and "
                     "the report would quote different expected lives"
                     % (seeded_anchors, want_anchors))
    if any(f < 0.7 or f > 1.0 for _, f in seeded_anchors):
        fails.append("a seeded anchor is outside the 0.70-1.00 bound the evidence supports")
    if any(seeded_anchors[i][1] > seeded_anchors[i - 1][1] for i in range(1, len(seeded_anchors))):
        fails.append("the seeded anchors are not monotonic -- harder water would be kinder "
                     "somewhere on the curve")

    # --- which equipment it reaches ----------------------------------------
    bearing_seed = re.search(r"MERGE dbo\.MaintenanceWaterBearingProtocols AS target(.*?)\n\) AS source",
                             mig, re.S)
    seeded_bearing = set(re.findall(r"^\s+\(N'([^']+)'", bearing_seed.group(1) if bearing_seed else "", re.M))
    want_bearing = set(water.get("waterBearingSets") or [])
    if seeded_bearing != want_bearing:
        fails.append("water-bearing protocol drift: SQL has %s, config has %s -- one side would "
                     "adjust equipment the other leaves alone"
                     % (sorted(seeded_bearing), sorted(want_bearing)))
    for code in want_bearing:
        if code not in cfg["checkpointSets"]:
            fails.append("water-bearing protocol %r is not a protocol at all -- the modifier "
                         "would apply to nothing" % code)

    # --- the softener question is gone, and must stay gone -----------------
    # It was double-counting: the strip is read downstream of any softener, so a
    # working unit already shows up as a soft reading.
    if "MaintenanceWaterSoftenerStates" in mig or "SoftenerStateCode" in mig:
        fails.append("the softener vocabulary is back in the migration -- the strip is read "
                     "downstream of the softener, so recording it separately asks the same "
                     "question twice and then needs a rule for the disagreement")
    # A stored multiplier would freeze today's inference into history.
    tests_ddl = re.search(r"CREATE TABLE dbo\.MaintenanceHouseholdWaterTests(.*?)\n    \);", mig, re.S)
    if tests_ddl:
        if re.search(r"\bLifeFactor\b|\bBandCode\b", tests_ddl.group(1)):
            fails.append("MaintenanceHouseholdWaterTests stores a derived band or factor -- "
                         "correcting an anchor would then fix new houses and leave old ones "
                         "carrying the old inference forever")
        if not re.search(r"GrainsPerGallon DECIMAL\(6,2\) NOT NULL", tests_ddl.group(1)):
            fails.append("the reading is nullable -- a water test row without a number is not a "
                         "water test, and there is no band left to fall back on")

    # --- the honesty flag has to travel ------------------------------------
    if water.get("sourced"):
        fails.append("waterHardness.sourced is true -- if a real lifespan study now backs these "
                     "factors, say which one in the basis text; if not, this must stay false")
    settings_seed = re.search(r"MERGE dbo\.MaintenanceWaterHardnessSettings AS target(.*?)\n\) AS source",
                              mig, re.S)
    if not settings_seed:
        fails.append("the water settings row is not seeded -- the view has nothing to resolve "
                     "the flag band against and would return no rows at all")
    else:
        if not re.search(r",\s*0\s*\)\s*$", settings_seed.group(1).strip(), re.M):
            fails.append("the seeded water settings row does not carry IsSourced = 0")
        if ("N'%s'" % water.get("customerFlagBand")) not in settings_seed.group(1):
            fails.append("the seeded customer flag band does not match config's %r"
                         % water.get("customerFlagBand"))

    # --- THE RULE, not just the numbers ------------------------------------
    view = re.search(r"CREATE VIEW dbo\.vw_MaintenanceHouseholdWaterLatest(.*?)\nGO", mig, re.S)
    if not view:
        fails.append("vw_MaintenanceHouseholdWaterLatest is missing -- every caller would have to "
                     "re-implement the interpolation in its own SELECT")
    else:
        body = view.group(1)
        if "ROW_NUMBER()" not in body or "PARTITION BY" not in body:
            fails.append("the water view does not pick ONE reading per household -- a house with "
                         "two tests would multiply into duplicate asset rows")
        if "MaintenanceWaterLifeFactorAnchors" not in body:
            fails.append("the water view does not read the anchors -- the factor is coming from "
                         "somewhere other than the algorithm")
        # The clamps are the honesty: flat below the first anchor, and flat above
        # the hardness the study actually measured.
        if not re.search(r"<=\s*bd\.FirstGpg", body) or not re.search(r">=\s*bd\.LastGpg", body):
            fails.append("the water view does not clamp outside the anchors -- it would "
                         "extrapolate past the evidence, or below zero cost")
        if not re.search(r"ROUND\(", body):
            fails.append("the water view does not round the interpolated factor -- it would "
                         "agree with the application to fourteen decimals and disagree in the "
                         "fifteenth, which is enough to print a different number of years")
        if "IsFlaggedToCustomer" not in body:
            fails.append("the water view does not carry the customer hardness flag")
    if "vw_MaintenanceAssetExpectedLife" not in mig:
        fails.append("vw_MaintenanceAssetExpectedLife is missing -- nothing joins the household's "
                     "water to the equipment it actually affects")
    elif not re.search(r"wb\.TemplateCode IS NULL THEN CAST\(1\.000", mig):
        fails.append("the asset life view does not pass non-water equipment through untouched")
    print("water bands seeded:", len(seeded_bands), "life-factor anchors:", len(seeded_anchors),
          "water-bearing protocols:", len(seeded_bearing))

# ---------------------------------------------------------------------------
# v0.9.30  Brand, product line and serviceability
#
# The dashboard has to reach the SAME expected life as the field tool for the
# same appliance, so this is a parity check and not merely a structure check:
# every row in plan-config.js has to be in the migration, with the same years
# AND the same two parent figures behind it. A seeded number that agrees with
# the JS today and cannot be traced tomorrow is how the two sides drift.
# ---------------------------------------------------------------------------
brand_fails = []
for table, cols in [
    ("MaintenanceApplianceLines", ["LineCode", "MatchSets", "MatchCategories", "MatchTypes"]),
    ("MaintenanceBrandLifespans", ["BrandKey", "LineCode", "SeriesCode", "SeriesMatchText",
                                   "TierCode", "ExpectedYears", "FieldYears", "AnchoredYears"]),
    ("MaintenanceBrandExclusions", ["BrandKey", "ExclusionKind", "Because"]),
    ("MaintenanceServiceabilityCopy", ["StateCode", "CustomerText", "OfficeText", "TechText"]),
]:
    ddl = re.search(r"CREATE TABLE dbo\." + table + r"\s*\((.*?)\n    \);", mig, re.S)
    if not ddl:
        brand_fails.append(table + " is missing from the migration")
        continue
    for col in cols:
        if col not in ddl.group(1):
            brand_fails.append(table + " has no " + col + " column")

# The two exclusion kinds must be constrained, not merely documented -- they
# drive two different sentences to a customer.
# Match the CHECK CONSTRAINT itself, not the comment above it. The first version
# of this searched the whole table body for the two kind names -- which the
# explanatory comment also contains, so replacing the constraint with CHECK (1=1)
# sailed through. A check that reads prose is not checking the schema.
excl = re.search(
    r"CONSTRAINT CK_MaintenanceBrandExclusions_Kind\s*\n?\s*CHECK \(ExclusionKind IN \(([^)]*)\)\)",
    mig)
if not excl:
    brand_fails.append("MaintenanceBrandExclusions has no CHECK constraint on ExclusionKind -- a "
                       "third kind could arrive with no sentence to say about it")
else:
    kinds = set(re.findall(r"'(\w+)'", excl.group(1)))
    if kinds != {"NOT_SERVICED", "NOT_MAINTAINABLE"}:
        brand_fails.append("ExclusionKind is constrained to %s, not the two reasons the tool has "
                           "wording for" % sorted(kinds))

want_spans = cfg.get("brandLifespans") or []
span_seed = re.search(r"MERGE dbo\.MaintenanceBrandLifespans AS target(.*?)\n\) AS source",
                      mig, re.S)

# Column order the generator emits, so a field is looked up BY NAME.
#
# This check scraped numbers out of each row with a regex and indexed them from
# the end, which broke twice: once when CoversLines was added and shifted the
# slice, and again because a NULL CoversLines is captured while a JSON string is
# not -- so named-line and brand-wide rows needed different offsets. Positional
# scraping of a value list is not worth defending; the rows are split properly.
SPAN_COLS = ["BrandKey", "LineCode", "SeriesCode", "SeriesLabel", "SeriesMatchText",
             "TierCode", "ExpectedYears", "FieldYears", "AnchoredYears",
             "CoversLines", "CoversDrafted", "TierDrafted", "NoAnchorReason", "IsActive"]


def split_sql_tuple(text):
    """Split one MERGE VALUES row into its fields, respecting N'...' quoting."""
    fields, buf, depth, in_str = [], [], 0, False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == "'":
                if i + 1 < len(text) and text[i + 1] == "'":   # escaped quote
                    buf.append("''")
                    i += 2
                    continue
                in_str = False
            buf.append(ch)
        elif ch == "'":
            in_str = True
            buf.append(ch)
        elif ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            fields.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
        i += 1
    fields.append("".join(buf).strip())
    return fields


def span_row(raw):
    parts = split_sql_tuple(raw)
    if len(parts) != len(SPAN_COLS):
        return None
    return dict(zip(SPAN_COLS, parts))


def unlit(v):
    if v == "NULL":
        return None
    if v.startswith("N'") and v.endswith("'"):
        return v[2:-1].replace("''", "'")
    return v


if not span_seed:
    brand_fails.append("MaintenanceBrandLifespans is never seeded")
    seeded_spans = []
else:
    seeded_spans = re.findall(r"\n\s*\((N'.*?)\),?\r?$", span_seed.group(1), re.M)
    parsed = [span_row(r) for r in seeded_spans]
    if any(p is None for p in parsed):
        brand_fails.append("%d seeded lifespan row(s) do not have %d fields"
                           % (sum(1 for p in parsed if p is None), len(SPAN_COLS)))
    parsed = [p for p in parsed if p]
    if len(parsed) != len(want_spans):
        brand_fails.append("brand lifespans seeded %d, config has %d"
                           % (len(parsed), len(want_spans)))
    by_key = {}
    for p in parsed:
        by_key[(unlit(p["BrandKey"]), unlit(p["LineCode"]), unlit(p["SeriesCode"]))] = p
    for row in want_spans:
        series = (row.get("series") or {}).get("id")
        got = by_key.get((row["brand"], row["line"], series))
        if not got:
            brand_fails.append("no seeded row for %s / %s%s"
                               % (row["brand"], row["line"], "/" + series if series else ""))
            continue

        def num_cell(v):
            return None if v == "NULL" else float(v)

        for col, key in [("ExpectedYears", "years"), ("FieldYears", "field"),
                         ("AnchoredYears", "anchored")]:
            want = row.get(key)
            want = None if want is None else float(want)
            if num_cell(got[col]) != want:
                brand_fails.append("%s/%s %s seeded %s, config says %s"
                                   % (row["brand"], row["line"], col, got[col], want))

        covers = row.get("covers")
        if row["line"] == "*":
            if row.get("years") is not None or row.get("anchored") is not None:
                brand_fails.append("%s is brand-wide but carries a resolved figure" % row["brand"])
            if not covers:
                brand_fails.append("%s is brand-wide with no coverage list" % row["brand"])
            else:
                seeded_covers = json.loads(unlit(got["CoversLines"]) or "[]")
                if sorted(seeded_covers) != sorted(covers):
                    brand_fails.append("%s coverage seeded %s, config says %s"
                                       % (row["brand"], sorted(seeded_covers), sorted(covers)))
            if got["CoversDrafted"] not in ("0", "1"):
                brand_fails.append("%s CoversDrafted is not a bit" % row["brand"])
        # An unanchored row must carry its reason on both sides, or the dashboard
        # would average an outdoor fridge against the indoor NAHB row and print
        # 14 years where the field tool prints 8.
        if row["line"] != "*":
            if row.get("anchored") is None:
                if unlit(got["NoAnchorReason"]) is None:
                    brand_fails.append("%s/%s is unanchored but seeds no reason"
                                       % (row["brand"], row["line"]))
                if unlit(got["NoAnchorReason"]) != row.get("noAnchorReason"):
                    brand_fails.append("%s/%s reason did not survive seeding"
                                       % (row["brand"], row["line"]))
            elif unlit(got["NoAnchorReason"]) is not None:
                brand_fails.append("%s/%s is anchored but seeds a no-anchor reason"
                                   % (row["brand"], row["line"]))
        if got["TierDrafted"] != ("1" if row.get("tierDrafted") else "0"):
            brand_fails.append("%s/%s TierDrafted seeded %s, config says %s"
                               % (row["brand"], row["line"], got["TierDrafted"],
                                  bool(row.get("tierDrafted"))))
        if row["line"] != "*" and got["CoversLines"] != "NULL":
            brand_fails.append("%s/%s is a named line but carries a coverage list"
                               % (row["brand"], row["line"]))

resolved_ck = re.search(
    r"CONSTRAINT CK_MaintenanceBrandLifespans_Resolved CHECK \((.*?)\n        \)", mig, re.S)
if not resolved_ck:
    brand_fails.append("MaintenanceBrandLifespans does not constrain a brand-wide row to carry no "
                       "resolved figure -- one line's column could be applied to every line")
else:
    body = resolved_ck.group(1)
    if "LineCode <> '*'" not in body or "ExpectedYears IS NULL" not in body:
        brand_fails.append("the brand-wide CHECK no longer distinguishes a named line from '*'")
    if "NoAnchorReason IS NOT NULL" not in body:
        brand_fails.append("the CHECK does not require a reason on an unanchored row -- a figure "
                           "could opt out of the averaging rule silently")
    if "CoversLines IS NOT NULL" not in body:
        brand_fails.append("the brand-wide CHECK does not require a coverage list -- a wildcard "
                           "with none would answer for every line again")

# The exclusion seed itself was never compared with the config -- only its
# ABSENCE from the tier table was. So a brand quietly dropped from the seed
# passed: the dashboard would have priced a Traeger the field tool refuses.
excl_seed = re.search(r"MERGE dbo\.MaintenanceBrandExclusions AS target(.*?)\n\) AS source",
                      mig, re.S)
if not excl_seed:
    brand_fails.append("MaintenanceBrandExclusions is never seeded")
else:
    seeded_excl = {}
    for raw in re.findall(r"\n\s*\((N'.*?)\),?\r?$", excl_seed.group(1), re.M):
        parts = split_sql_tuple(raw)
        if len(parts) != 5:
            brand_fails.append("a seeded exclusion row does not have 5 fields")
            continue
        seeded_excl[unlit(parts[0])] = unlit(parts[2])
    want_excl = {}
    for row in (cfg.get("notServicedBrands") or []):
        want_excl[row["brand"]] = "NOT_SERVICED"
    for row in (cfg.get("notMaintainable") or []):
        want_excl[row["brand"]] = "NOT_MAINTAINABLE"
    for brand, kind in want_excl.items():
        if brand not in seeded_excl:
            brand_fails.append("%s is excluded in the config but not seeded" % brand)
        elif seeded_excl[brand] != kind:
            brand_fails.append("%s seeded as %s, config says %s"
                               % (brand, seeded_excl[brand], kind))
    for brand in seeded_excl:
        if brand not in want_excl:
            brand_fails.append("%s is seeded as excluded but is not in the config" % brand)
    print("exclusions seeded:", len(seeded_excl), "of", len(want_excl),
          "| not-serviced:", sum(1 for k in seeded_excl.values() if k == "NOT_SERVICED"),
          "| nothing-to-maintain:", sum(1 for k in seeded_excl.values() if k == "NOT_MAINTAINABLE"))

# A brand Wilson does not service must not be tiered on either side.
tier_text = re.search(r"MERGE dbo\.MaintenanceBrandTiers AS target(.*?)\n\) AS source",
                      mig, re.S)
for row in (cfg.get("notServicedBrands") or []):
    if tier_text and ("N'%s'" % row["brand"]) in tier_text.group(1):
        brand_fails.append("%s is seeded into MaintenanceBrandTiers -- a tier row implies the "
                           "appliance is inside a plan" % row["brand"])

# The substring matcher is the bug this version removed. Emitting CONTAINS would
# invite the dashboard to reproduce it: "gaggenau" contains "ge".
if tier_text and "N'CONTAINS'" in tier_text.group(1):
    brand_fails.append("MaintenanceBrandTiers still seeds MatchType CONTAINS -- substring "
                       "matching scored Gaggenau and Fulgor as mass-market")

fails.extend(brand_fails)
print("brand x line lifespans seeded:", len(re.findall(r"\n\s*\(N'", span_seed.group(1))) if span_seed else 0,
      "of", len(want_spans),
      "| exclusions:", len(cfg.get("notServicedBrands") or []) + len(cfg.get("notMaintainable") or []),
      "| product lines:", len(cfg.get("applianceLines") or {}))

print("config protocols:", len(want_templates), "seeded:", len(got_templates))
print("config checkpoints:", want_checkpoints, "seeded:", len(got_checkpoints or []))
print("config brand tiers:", want_brands, "seeded:", len(got_brands or []))
print("config life rules:", want_life, "seeded:", len(got_life or []))

print("\nnew tables:",len(newtables))
print("new columns on existing tables:",len(set(re.findall(r"COL_LENGTH\('dbo\.(\w+)', '(\w+)'\)",mig))))
print("new views:",len(re.findall(r'CREATE OR ALTER VIEW',mig)))
print()
if fails:
    print(f"{len(fails)} PROBLEM(S):")
    for f in dict.fromkeys(fails): print("  -",f)
    sys.exit(1)
print("ALL STRUCTURAL CHECKS PASSED")
