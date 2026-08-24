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
    """Read the dumped config, dumping it first if necessary."""
    cached = "/tmp/wilson_config.json"
    if not os.path.exists(cached):
        with open(cached, "w", encoding="utf-8") as fh:
            subprocess.run(
                ["node", os.path.join(HERE, "dump_config.js")],
                stdout=fh, check=True,
            )
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
    for code, checks in cfg["checkpointSets"].items():
        for index, cp in enumerate(checks):
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
                "1",
                str((index + 1) * 10),
                "1",
            ])
    cols = ["TemplateCode", "TemplateVersion", "CheckpointCode", "CheckpointName",
            "PromptText", "GuidanceText", "ReadingLabel", "ReadingFieldsJson",
            "DerivedReadingCode", "ReadingUnit", "PhotoPromptText",
            "RatingRequired", "SortOrder", "IsActive"]
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
        source.IsActive
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
    UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (
    ProtocolTemplateId, CheckpointCode, CheckpointName, PromptText, GuidanceText,
    ReadingLabel, ReadingFieldsJson, DerivedReadingCode, ReadingUnit,
    PhotoPromptText, RatingRequired, SortOrder, IsActive
) VALUES (
    source.ProtocolTemplateId, source.CheckpointCode, source.CheckpointName,
    source.PromptText, source.GuidanceText, source.ReadingLabel,
    source.ReadingFieldsJson, source.DerivedReadingCode, source.ReadingUnit,
    source.PhotoPromptText, source.RatingRequired, source.SortOrder, source.IsActive
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
            lit(brand), lit("CONTAINS"), lit(tier), str((index + 1) * 10), "1",
        ])
    return merge(
        "MaintenanceBrandTiers",
        ["BrandMatchText"],
        ["BrandMatchText", "MatchType", "TierCode", "SortOrder", "IsActive"],
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


def main():
    cfg = load_config()
    ddl_path = os.path.join(HERE, "_migration_v09_ddl.sql")
    with open(ddl_path, encoding="utf-8") as fh:
        ddl = fh.read()

    seeds = "\n".join([
        SECTION.format(title="7.7  Protocol templates (seeded from plan-config.js)"),
        build_protocol_templates(cfg),
        build_protocol_checkpoints(cfg),
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

    out = ddl.replace("-- {{SEEDS}}", seeds)
    out = out.replace("-- {{FILTER_PRICE_SEED}}", filter_seed)
    out = out.replace("{{CONFIG_VERSION}}", cfg["configVersion"])
    with open(OUT, "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write(out)

    checkpoints = sum(len(v) for v in cfg["checkpointSets"].values())
    print(f"wrote {os.path.relpath(OUT, ROOT)}")
    print(f"  {len(cfg['checkpointSets'])} protocol templates, {checkpoints} checkpoints")
    print(f"  {len(cfg['applianceTypes'])} appliance-type + "
          f"{len(cfg['customerApplianceCategories'])} category assignments")
    print(f"  {len(cfg['brandTierDefaults'])} brand-tier rules, "
          f"{sum(len(v) for v in cfg['lifecycleMatrix'].values())} expected-life rules")


SECTION = """/* -------------------------------------------------------------------------
   {title}
   ------------------------------------------------------------------------- */"""

if __name__ == "__main__":
    sys.exit(main())
