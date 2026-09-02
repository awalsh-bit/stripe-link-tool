#!/usr/bin/env python3
"""
Generates sql/maintenance_migration_v09.sql.

Why this is generated rather than hand-written
----------------------------------------------
The DDL below is static, but the protocol, brand-tier and expected-life seed
data is derived from assets/plan-config.js. Hand-transcribing 47 checkpoints
across 10 protocols into SQL is exactly how the JS config and the database
drift apart -- which is the class of defect v0.9.1 just finished repairing.

Re-run this whenever plan-config.js protocols change:

    node sql/dump_config.js > /tmp/wilson_config.json
    python3 sql/generate_migration_v09.py

The emitted MERGE statements are idempotent, so re-running the migration after
a config change updates the seed rows in place and versions the templates.
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "maintenance_migration_v09.sql")

# Precedence mirrors WILSON_PROTOCOL.resolveCheckpointSet in plan-config.js:
# an exact appliance-type match is more specific than a customer category.
SCOPE_APPLIANCE_TYPE = ("APPLIANCE_TYPE", 10)
SCOPE_CUSTOMER_CATEGORY = ("CUSTOMER_CATEGORY", 20)


def load_config():
    """Read the dumped config, re-dumping whenever plan-config.js is newer.

    This used to dump once and then reuse /tmp/wilson_config.json forever. A
    config change therefore produced a migration built from the PREVIOUS config,
    silently and with a confident summary line -- adding the age-provenance
    vocabulary reported "0 age-provenance sources" while the seed it wrote was
    empty. A generator that can silently emit stale SQL is worse than no
    generator, because the output looks authoritative.
    """
    cached = "/tmp/wilson_config.json"
    source = os.path.join(ROOT, "assets", "plan-config.js")
    dumper = os.path.join(HERE, "dump_config.js")
    stale = (
        not os.path.exists(cached)
        or os.path.getmtime(cached) < os.path.getmtime(source)
        or os.path.getmtime(cached) < os.path.getmtime(dumper)
    )
    if stale:
        with open(cached, "w", encoding="utf-8") as fh:
            subprocess.run(["node", dumper], stdout=fh, check=True)
    with open(cached, encoding="utf-8") as fh:
        return json.load(fh)


def lit(value):
    """T-SQL string literal, always N-prefixed (protocol text contains ° and en dashes)."""
    if value is None or value == "":
        return "NULL"
    return "N'" + str(value).replace("'", "''") + "'"


def num(value):
    return "NULL" if value is None else str(value)


def bit(value):
    return "1" if value else "0"


def json_lit(value):
    if not value:
        return "NULL"
    return lit(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def merge(table, key_cols, cols, rows, extra_set=None, extra_on=None):
    """Emit an idempotent MERGE matching the base script's seeding style.

    extra_on adds predicates to the ON clause. Required when the target's
    uniqueness comes from a FILTERED unique index: without the filter predicate
    the MERGE would match rows outside the filter and overwrite them.
    """
    if not rows:
        return ""
    on_parts = [f"target.{k} = source.{k}" for k in key_cols]
    on_parts.extend(extra_on or [])
    on_clause = " AND ".join(on_parts)
    updates = [f"    {c} = source.{c}" for c in cols if c not in key_cols]
    for line in (extra_set or []):
        updates.append(f"    {line}")
    values = ",\n".join("    (" + ", ".join(r) + ")" for r in rows)
    update_block = ",\n".join(updates)
    col_list = ", ".join(cols)
    src_list = ", ".join("source." + c for c in cols)
    return f"""MERGE dbo.{table} AS target
USING (VALUES
{values}
) AS source ({col_list})
ON {on_clause}
WHEN MATCHED THEN UPDATE SET
{update_block}
WHEN NOT MATCHED THEN INSERT (
    {col_list}
) VALUES (
    {src_list}
);
GO
"""


def build_protocol_templates(cfg):
    rows = []
    for code, checks in cfg["checkpointSets"].items():
        rows.append([
            lit(code),
            lit(code.replace("_", " ").title() + " protocol"),
            "1",
            lit(f"{len(checks)} checkpoints. Seeded from plan-config.js v{cfg['configVersion']}."),
            lit(cfg["configVersion"]),
            "1",
        ])
    return merge(
        "MaintenanceProtocolTemplates",
        ["TemplateCode", "TemplateVersion"],
        ["TemplateCode", "TemplateName", "TemplateVersion", "TemplateNote",
         "SourceConfigVersion", "IsActive"],
        rows,
        extra_set=["UpdatedAt = SYSUTCDATETIME()"],
    )


def build_protocol_checkpoints(cfg):
    rows = []
    kinds = cfg.get("answerKinds") or {}
    for code, checks in cfg["checkpointSets"].items():
        for index, cp in enumerate(checks):
            # v0.9.17: the answer kind, resolved by WILSON_ANSWERS and dumped
            # with the config, rather than a rating hard-coded onto every
            # checkpoint. RatingRequired now follows the control: an observed
            # frost pattern and a completed clean cycle do not have one, and
            # a database that says they do is a database that will average
            # them into somebody's health score.
            answer = (kinds.get(code) or {}).get(cp["id"]) or {}
            kind = answer.get("kind") or "scored"
            control = answer.get("control") or ("passfail" if kind == "maintenance" else "rating")
            rows.append([
                lit(code),
                "1",
                lit(cp["id"]),
                lit(cp.get("name")),
                lit(cp.get("prompt")),
                lit(cp.get("guidance")),
                lit(cp.get("readingLabel")),
                json_lit(cp.get("readingFields")),
                lit(cp.get("derivedReading")),
                lit(cp.get("unit")),
                lit(cp.get("photoPrompt")),
                "1" if control == "rating" else "0",
                str((index + 1) * 10),
                "1",
                lit(kind),
                "1" if answer.get("scores") else "0",
                lit(control),
                lit(answer.get("options")),
            ])
    cols = ["TemplateCode", "TemplateVersion", "CheckpointCode", "CheckpointName",
            "PromptText", "GuidanceText", "ReadingLabel", "ReadingFieldsJson",
            "DerivedReadingCode", "ReadingUnit", "PhotoPromptText",
            "RatingRequired", "SortOrder", "IsActive",
            "ResultKind", "ScoresHealth", "AnswerControl", "OptionSetCode"]
    values = ",\n".join("        (" + ", ".join(r) + ")" for r in rows)
    # Checkpoints resolve TemplateCode -> ProtocolTemplateId through a join, so
    # this MERGE is written against a derived source rather than plain VALUES.
    return f"""MERGE dbo.MaintenanceProtocolCheckpoints AS target
USING (
    SELECT
        t.ProtocolTemplateId,
        source.CheckpointCode,
        source.CheckpointName,
        source.PromptText,
        source.GuidanceText,
        source.ReadingLabel,
        source.ReadingFieldsJson,
        source.DerivedReadingCode,
        source.ReadingUnit,
        source.PhotoPromptText,
        source.RatingRequired,
        source.SortOrder,
        source.IsActive,
        source.ResultKind,
        source.ScoresHealth,
        source.AnswerControl,
        source.OptionSetCode
    FROM (VALUES
{values}
    ) AS source ({", ".join(cols)})
    INNER JOIN dbo.MaintenanceProtocolTemplates t
        ON t.TemplateCode = source.TemplateCode
       AND t.TemplateVersion = source.TemplateVersion
) AS source
ON target.ProtocolTemplateId = source.ProtocolTemplateId
   AND target.CheckpointCode = source.CheckpointCode
WHEN MATCHED THEN UPDATE SET
    CheckpointName = source.CheckpointName,
    PromptText = source.PromptText,
    GuidanceText = source.GuidanceText,
    ReadingLabel = source.ReadingLabel,
    ReadingFieldsJson = source.ReadingFieldsJson,
    DerivedReadingCode = source.DerivedReadingCode,
    ReadingUnit = source.ReadingUnit,
    PhotoPromptText = source.PhotoPromptText,
    RatingRequired = source.RatingRequired,
    SortOrder = source.SortOrder,
    IsActive = source.IsActive,
    ResultKind = source.ResultKind,
    ScoresHealth = source.ScoresHealth,
    AnswerControl = source.AnswerControl,
    OptionSetCode = source.OptionSetCode,
    UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (
    ProtocolTemplateId, CheckpointCode, CheckpointName, PromptText, GuidanceText,
    ReadingLabel, ReadingFieldsJson, DerivedReadingCode, ReadingUnit,
    PhotoPromptText, RatingRequired, SortOrder, IsActive,
    ResultKind, ScoresHealth, AnswerControl, OptionSetCode
) VALUES (
    source.ProtocolTemplateId, source.CheckpointCode, source.CheckpointName,
    source.PromptText, source.GuidanceText, source.ReadingLabel,
    source.ReadingFieldsJson, source.DerivedReadingCode, source.ReadingUnit,
    source.PhotoPromptText, source.RatingRequired, source.SortOrder, source.IsActive,
    source.ResultKind, source.ScoresHealth, source.AnswerControl, source.OptionSetCode
);
GO
"""


def build_assignments(cfg):
    rows = []
    for entry in cfg["applianceTypes"]:
        scope, precedence = SCOPE_APPLIANCE_TYPE
        rows.append([
            lit(scope), lit(entry["id"]), lit(entry.get("label")),
            lit(entry["checkpointSet"]), str(precedence), "1",
        ])
    for entry in cfg["customerApplianceCategories"]:
        scope, precedence = SCOPE_CUSTOMER_CATEGORY
        rows.append([
            lit(scope), lit(entry["id"]), lit(entry.get("label")),
            lit(entry["checkpointSet"]), str(precedence), "1",
        ])
    return merge(
        "MaintenanceProtocolAssignments",
        ["AssignmentScope", "ScopeCode"],
        ["AssignmentScope", "ScopeCode", "ScopeLabel", "TemplateCode",
         "Precedence", "IsActive"],
        rows,
        extra_set=["UpdatedAt = SYSUTCDATETIME()"],
    )


def build_lifecycle_tiers(cfg):
    rows = []
    for code, tier in cfg["lifecycleTiers"].items():
        rows.append([
            lit(code), lit(tier.get("label")),
            num(tier.get("defaultYears")), lit(tier.get("examples")), "1",
        ])
    return merge(
        "MaintenanceLifecycleTiers",
        ["TierCode"],
        ["TierCode", "TierLabel", "DefaultExpectedYears", "ExampleBrands", "IsActive"],
        rows,
        extra_set=["UpdatedAt = SYSUTCDATETIME()"],
    )


def build_brand_tiers(cfg):
    rows = []
    for index, (brand, tier) in enumerate(cfg["brandTierDefaults"].items()):
        rows.append([
            # v0.9.30: WORD, not CONTAINS. The JS side matched brands as
            # substrings until this version, which scored Gaggenau and Fulgor as
            # mass-market ("gaggenau" contains "ge"; "fulgor" contains "lg").
            # Emitting CONTAINS here would invite the dashboard to reproduce a
            # bug the field tool has just stopped having.
            lit(brand), lit("WORD"), lit(tier), str((index + 1) * 10), "1",
        ])
    return merge(
        "MaintenanceBrandTiers",
        ["BrandMatchText"],
        ["BrandMatchText", "MatchType", "TierCode", "SortOrder", "IsActive"],
        rows,
        extra_set=["UpdatedAt = SYSUTCDATETIME()"],
    )


def build_appliance_lines(cfg):
    rows = []
    for index, (code, line) in enumerate((cfg.get("applianceLines") or {}).items()):
        rows.append([
            lit(code), lit(line.get("label")),
            json_lit(line.get("sets") or []),
            json_lit(line.get("categories") or []),
            json_lit(line.get("types") or []),
            "1",
        ])
    return merge(
        "MaintenanceApplianceLines",
        ["LineCode"],
        ["LineCode", "DisplayName", "MatchSets", "MatchCategories", "MatchTypes", "IsActive"],
        rows,
        extra_set=["UpdatedAt = SYSUTCDATETIME()"],
    )


def build_brand_lifespans(cfg):
    rows = []
    for row in (cfg.get("brandLifespans") or []):
        series = row.get("series") or {}
        rows.append([
            lit(row.get("brand")), lit(row.get("line")),
            lit(series.get("id")), lit(series.get("label")),
            json_lit(series.get("match") or []) if series else "NULL",
            lit(row.get("tier")),
            # A brand-wide row deliberately ships NULL here -- see the CHECK
            # constraint on the table.
            num(row.get("years")), num(row.get("field")), num(row.get("anchored")),
            json_lit(row["covers"]) if row.get("covers") is not None else "NULL",
            bit(row.get("coversDrafted")),
            bit(row.get("tierDrafted")),
            lit(row.get("noAnchorReason")),
            "1",
        ])
    return merge(
        "MaintenanceBrandLifespans",
        ["BrandKey", "LineCode", "SeriesCode"],
        ["BrandKey", "LineCode", "SeriesCode", "SeriesLabel", "SeriesMatchText",
         "TierCode", "ExpectedYears", "FieldYears", "AnchoredYears",
         "CoversLines", "CoversDrafted", "TierDrafted", "NoAnchorReason", "IsActive"],
        rows,
        extra_set=["UpdatedAt = SYSUTCDATETIME()"],
    )


def build_brand_exclusions(cfg):
    rows = []
    for row in (cfg.get("notServicedBrands") or []):
        rows.append([lit(row.get("brand")), lit(row.get("label")),
                     lit("NOT_SERVICED"), "NULL", "1"])
    for row in (cfg.get("notMaintainable") or []):
        rows.append([lit(row.get("brand")), lit(row.get("label")),
                     lit("NOT_MAINTAINABLE"), lit(row.get("because")), "1"])
    return merge(
        "MaintenanceBrandExclusions",
        ["BrandKey"],
        ["BrandKey", "DisplayName", "ExclusionKind", "Because", "IsActive"],
        rows,
        extra_set=["UpdatedAt = SYSUTCDATETIME()"],
    )


def build_serviceability_copy(cfg):
    rows = []
    for state, copy in (cfg.get("serviceabilityCopy") or {}).items():
        rows.append([
            lit(state), lit(copy.get("customer")),
            lit(copy.get("office")), lit(copy.get("tech")),
        ])
    return merge(
        "MaintenanceServiceabilityCopy",
        ["StateCode"],
        ["StateCode", "CustomerText", "OfficeText", "TechText"],
        rows,
        extra_set=["UpdatedAt = SYSUTCDATETIME()"],
    )


def build_expected_life(cfg):
    rows = []
    for template, tiers in cfg["lifecycleMatrix"].items():
        for tier_code, years in tiers.items():
            rows.append([lit(template), lit(tier_code), num(years), "1"])
    return merge(
        "MaintenanceExpectedLifeRules",
        ["TemplateCode", "TierCode"],
        ["TemplateCode", "TierCode", "ExpectedYears", "IsActive"],
        rows,
        extra_set=["UpdatedAt = SYSUTCDATETIME()"],
    )


def build_lifecycle_stages(cfg):
    rows = []
    for index, stage in enumerate(cfg["lifecycleStages"]):
        rows.append([
            lit(stage["label"]), num(stage["maxRatio"]), str((index + 1) * 10), "1",
        ])
    return merge(
        "MaintenanceLifecycleStages",
        ["StageLabel"],
        ["StageLabel", "MaxAgeRatio", "SortOrder", "IsActive"],
        rows,
        extra_set=["UpdatedAt = SYSUTCDATETIME()"],
    )


def build_filter_prices(cfg):
    """Kind-level fallback prices, mirroring plan-config.js. Placeholders."""
    kinds = ((cfg.get("refrigerationFilterService") or {}).get("pricing") or {}).get("kinds") or {}
    rows = []
    for code, kind in kinds.items():
        rows.append([
            lit(code),
            "NULL",  # PartNumber NULL = kind-level fallback
            lit(kind.get("description")),
            num(kind.get("unitPrice")),
            str(int(kind.get("defaultQuantity") or 1)),
            "1",     # PriceIsPlaceholder
            "1",
        ])
    return merge(
        "MaintenanceFilterPrices",
        ["FilterKindCode"],
        ["FilterKindCode", "PartNumber", "FilterDescription", "UnitSalesPrice",
         "DefaultQuantity", "PriceIsPlaceholder", "IsActive"],
        rows,
        extra_set=["UpdatedAt = SYSUTCDATETIME()"],
        # Match only the kind-level fallback row. UX_MaintenanceFilterPrices_KindFallback
        # is filtered on PartNumber IS NULL, so omitting this would let the
        # placeholder seed overwrite Wilson's real part-number prices.
        extra_on=["target.PartNumber IS NULL"],
    )


def build_checkpoint_options(cfg):
    """Seed every answer a checkpoint accepts, with its published score.

    v0.9.19. The scores existed only in plan-config.js, which is fine while the
    browser computes the health score and useless the moment SQL Server has to.
    Resolved through the same dumper the kinds come from, so the two cannot
    disagree about what "cloudy or incomplete cubes" is worth.
    """
    rows = []
    kinds = cfg.get("answerKinds") or {}
    for code, checks in cfg["checkpointSets"].items():
        for cp in checks:
            answer = (kinds.get(code) or {}).get(cp["id"]) or {}
            for index, opt in enumerate(answer.get("optionList") or []):
                rows.append([
                    lit(code),
                    "1",
                    lit(cp["id"]),
                    lit(answer.get("options")),
                    lit(opt["code"]),
                    lit(opt["label"]),
                    lit(opt["result"]),
                    num(opt.get("score")),
                    bit(opt.get("attention")),
                    lit(opt.get("requiresDetail")),
                    str((index + 1) * 10),
                    "1",
                ])
    if not rows:
        return ""
    cols = ["TemplateCode", "TemplateVersion", "CheckpointCode", "OptionSetCode",
            "OptionCode", "OptionLabel", "ResultText", "ScoreValue",
            "RaisesFinding", "RequiresDetail", "SortOrder", "IsActive"]
    values = ",\n".join("        (" + ", ".join(r) + ")" for r in rows)
    return f"""MERGE dbo.MaintenanceCheckpointOptions AS target
USING (
    SELECT
        c.ProtocolCheckpointId,
        source.OptionSetCode,
        source.OptionCode,
        source.OptionLabel,
        source.ResultText,
        source.ScoreValue,
        source.RaisesFinding,
        source.RequiresDetail,
        source.SortOrder,
        source.IsActive
    FROM (VALUES
{values}
    ) AS source ({", ".join(cols)})
    INNER JOIN dbo.MaintenanceProtocolTemplates t
        ON t.TemplateCode = source.TemplateCode
       AND t.TemplateVersion = source.TemplateVersion
    INNER JOIN dbo.MaintenanceProtocolCheckpoints c
        ON c.ProtocolTemplateId = t.ProtocolTemplateId
       AND c.CheckpointCode = source.CheckpointCode
) AS source
ON target.ProtocolCheckpointId = source.ProtocolCheckpointId
   AND target.OptionCode = source.OptionCode
WHEN MATCHED THEN UPDATE SET
    OptionSetCode = source.OptionSetCode,
    OptionLabel = source.OptionLabel,
    ResultText = source.ResultText,
    ScoreValue = source.ScoreValue,
    RaisesFinding = source.RaisesFinding,
    RequiresDetail = source.RequiresDetail,
    SortOrder = source.SortOrder,
    IsActive = source.IsActive,
    UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (
    ProtocolCheckpointId, OptionSetCode, OptionCode, OptionLabel, ResultText,
    ScoreValue, RaisesFinding, RequiresDetail, SortOrder, IsActive
) VALUES (
    source.ProtocolCheckpointId, source.OptionSetCode, source.OptionCode,
    source.OptionLabel, source.ResultText, source.ScoreValue,
    source.RaisesFinding, source.RequiresDetail, source.SortOrder, source.IsActive
);
GO
"""


def build_age_sources(cfg):
    """The age-provenance vocabulary, from plan-config.js.

    IsDocumented is the field the rest of the system reasons about: it is the
    difference between an age off an invoice and an age somebody remembered, and
    a hand-transcribed copy of it in SQL would eventually disagree with the
    application's copy -- exactly how protocol resolution drifted before v0.9.1.
    """
    rows = []
    for code, source in (cfg.get("ageSources") or {}).items():
        rows.append([
            lit(code), lit(source.get("label")), lit(source.get("short")),
            bit(source.get("documented")), num(source.get("rank")),
            lit(source.get("note")), "1",
        ])
    return merge(
        "MaintenanceAgeSources",
        ["AgeSourceCode"],
        ["AgeSourceCode", "DisplayName", "ShortName", "IsDocumented",
         "SortOrder", "CustomerNote", "IsActive"],
        rows,
    )


def build_water_hardness(cfg):
    """Water hardness: the bands, the interpolation anchors, and which protocols
    run water.

    All seeded from plan-config.js for the usual reason: a hand-transcribed
    anchor table would eventually disagree with the application's, and the
    symptom would be a customer report and a dashboard quoting different
    expected lives for the same dishwasher with nothing to say which was right.

    The ANCHORS are the important ones. They are the algorithm -- the whole
    curve is these five points plus the rule that it is linear between them and
    flat outside them.
    """
    water = cfg.get("waterHardness") or {}
    bands = water.get("bands") or []
    if not bands:
        return ""

    # Bands carry no arithmetic any more: they name a reading for the customer.
    band_rows = []
    for index, band in enumerate(bands):
        band_rows.append([
            lit(band.get("id")), lit(band.get("label")),
            num(band.get("max")) if band.get("max") is not None else "NULL",
            lit(band.get("plain")),
            str((index + 1) * 10), "1",
        ])

    anchor_rows = []
    for index, anchor in enumerate(water.get("lifeFactorAnchors") or []):
        anchor_rows.append([
            num(anchor.get("gpg")), num(anchor.get("factor")),
            str((index + 1) * 10), "1",
        ])

    bearing_rows = [[lit(code), "1"] for code in (water.get("waterBearingSets") or [])]

    settings_row = [[
        "1", num(water.get("untestedFactor", 1)),
        lit(water.get("customerFlagBand")),
        num(water.get("maxPlausibleGpg", 100)),
        lit(water.get("basis")),
        bit(water.get("sourced")),
    ]]

    return "\n".join(filter(None, [
        merge("MaintenanceWaterHardnessBands", ["BandCode"],
              ["BandCode", "DisplayName", "MaxGrainsPerGallon",
               "PlainLanguage", "SortOrder", "IsActive"],
              band_rows),
        merge("MaintenanceWaterLifeFactorAnchors", ["GrainsPerGallon"],
              ["GrainsPerGallon", "LifeFactor", "SortOrder", "IsActive"],
              anchor_rows),
        merge("MaintenanceWaterBearingProtocols", ["TemplateCode"],
              ["TemplateCode", "IsActive"], bearing_rows),
        merge("MaintenanceWaterHardnessSettings", ["SettingsId"],
              ["SettingsId", "UntestedLifeFactor", "CustomerFlagBandCode",
               "MaxPlausibleGpg", "Basis", "IsSourced"],
              settings_row,
              extra_set=["UpdatedAt = SYSUTCDATETIME()"]),
    ]))


def main():
    cfg = load_config()
    ddl_path = os.path.join(HERE, "_migration_v09_ddl.sql")
    with open(ddl_path, encoding="utf-8") as fh:
        ddl = fh.read()

    seeds = "\n".join([
        SECTION.format(title="7.7  Protocol templates (seeded from plan-config.js)"),
        build_protocol_templates(cfg),
        build_protocol_checkpoints(cfg),
        build_checkpoint_options(cfg),
        build_assignments(cfg),
        SECTION.format(title="7.6  Lifecycle configuration (seeded from plan-config.js)"),
        build_lifecycle_tiers(cfg),
        build_brand_tiers(cfg),
        build_expected_life(cfg),
        build_lifecycle_stages(cfg),
    ])

    filter_seed = "\n".join([
        SECTION.format(title="7.8  Filter service pricing (placeholders from plan-config.js)"),
        build_filter_prices(cfg),
    ])

    age_seed = "\n".join([
        SECTION.format(title="7.9  Age provenance vocabulary (seeded from plan-config.js)"),
        build_age_sources(cfg),
    ])

    water_seed = "\n".join([
        SECTION.format(title="7.10  Water hardness modifier (seeded from plan-config.js)"),
        build_water_hardness(cfg),
    ])

    brand_seed = "\n".join([
        SECTION.format(title="7.11  Brand, product line and serviceability (seeded from plan-config.js)"),
        build_appliance_lines(cfg),
        build_brand_lifespans(cfg),
        build_brand_exclusions(cfg),
        build_serviceability_copy(cfg),
    ])

    out = ddl.replace("-- {{SEEDS}}", seeds)
    out = out.replace("{{AGE_SOURCE_SEED}}", age_seed)
    out = out.replace("-- {{FILTER_PRICE_SEED}}", filter_seed)
    out = out.replace("-- {{WATER_SEED}}", water_seed)
    out = out.replace("-- {{BRAND_SEED}}", brand_seed)
    out = out.replace("{{CONFIG_VERSION}}", cfg["configVersion"])
    with open(OUT, "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write(out)

    checkpoints = sum(len(v) for v in cfg["checkpointSets"].values())
    print(f"wrote {os.path.relpath(OUT, ROOT)}")
    print(f"  {len(cfg['checkpointSets'])} protocol templates, {checkpoints} checkpoints")
    print(f"  {len(cfg.get('ageSources') or {})} age-provenance sources")
    water = cfg.get("waterHardness") or {}
    print(f"  {len(water.get('bands') or [])} water hardness bands, "
          f"{len(water.get('lifeFactorAnchors') or [])} life-factor anchors, "
          f"{len(water.get('waterBearingSets') or [])} water-bearing protocols")
    print(f"  {len(cfg['applianceTypes'])} appliance-type + "
          f"{len(cfg['customerApplianceCategories'])} category assignments")
    print(f"  {len(cfg['brandTierDefaults'])} brand-tier rules, "
          f"{sum(len(v) for v in cfg['lifecycleMatrix'].values())} category expected-life rules")
    spans = cfg.get("brandLifespans") or []
    print(f"  {len(spans)} brand x line lifespans "
          f"({sum(1 for r in spans if r.get('series'))} model-series overrides) "
          f"across {len(cfg.get('applianceLines') or {})} product lines")
    print(f"  {len(cfg.get('notServicedBrands') or [])} not-serviced + "
          f"{len(cfg.get('notMaintainable') or [])} nothing-to-maintain brands")


SECTION = """/* -------------------------------------------------------------------------
   {title}
   ------------------------------------------------------------------------- */"""

if __name__ == "__main__":
    sys.exit(main())
