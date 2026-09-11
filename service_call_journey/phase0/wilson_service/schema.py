"""Table definitions for Phase 0 and a DDL generator for SQLite and SQL Server.

Column types are written in a tiny neutral vocabulary and mapped per dialect:
  id        -> INTEGER PRIMARY KEY AUTOINCREMENT | INT IDENTITY(1,1) PRIMARY KEY
  str(n)    -> TEXT | NVARCHAR(n)
  text      -> TEXT | NVARCHAR(MAX)
  int, bit, money, num(p,s), date, ts (ISO-8601 string in SQLite, DATETIME2 in SQL Server)

Column names avoid T-SQL reserved words (KEY, DATE, AT, TRIGGER ...) so the same
application SQL runs unquoted on both engines.
"""
from __future__ import annotations

TABLES: dict[str, list[tuple]] = {
    "settings": [("setting_key", "str(80)", "PK"), ("value", "text"), ("type", "str(12)"), ("description", "text"), ("updated_by", "str(60)"), ("updated_at", "ts")],
    "status_def": [("status", "str(16)", "PK"), ("name", "str(80)"), ("track", "str(12)"), ("customer_stage", "str(40)"), ("sort_order", "int"), ("stuck_after_hours", "int")],
    "tech": [("tech_id", "id"), ("sp_code", "str(8)", "UNIQUE"), ("aliases", "str(40)"), ("name", "str(80)"), ("work_days", "str(28)"), ("role", "str(40)"), ("home_base", "str(120)"), ("start_default", "str(8)"), ("end_default", "str(8)"), ("shift_start", "str(5)"), ("shift_end", "str(5)"), ("skills", "text"), ("auto_route", "bit"), ("auto_schedule", "bit"), ("max_stops", "int"), ("speed_factor", "num(4,2)"), ("active", "bit")],
    "tech_day": [("tech_day_id", "id"), ("tech_id", "int"), ("work_date", "date"), ("available", "bit"), ("reason", "str(12)"), ("capacity_adjust_min", "int"), ("start_override", "str(8)"), ("end_override", "str(8)"), ("parts_loaded_prev_evening", "bit"), ("note", "text"), ("set_by", "str(60)"), ("set_at", "ts")],
    "route_block": [("block_id", "id"), ("tech_id", "int"), ("work_date", "date"), ("start_time", "str(5)"), ("end_time", "str(5)"), ("label", "str(60)"), ("address_id", "int"), ("sequence", "int"), ("created_by", "str(60)"), ("created_at", "ts")],
    "recall": [("recall_id", "id"), ("job_id", "int"), ("original_job_id", "int"), ("tech_id", "int"), ("days_between", "int"), ("basis", "str(16)"), ("state", "str(12)"), ("reviewed_by", "str(60)"), ("reviewed_at", "ts"), ("note", "text"), ("created_at", "ts")],
    "delivered": [("delivered_id", "id"), ("job_id", "int"), ("tech_id", "int"), ("visit_date", "date"), ("labor_amount", "money"), ("parts_sell", "money"), ("parts_cost", "money"), ("parts_profit", "money"), ("delivered_dollars", "money"), ("cost_basis", "str(10)"), ("source", "str(6)"), ("recognised_at", "ts"), ("reconciled_at", "ts"), ("adjustment", "money")],
    "zone": [("zone_code", "str(8)", "PK"), ("zone_group", "str(40)"), ("booking_mode", "str(16)"), ("primary_tech", "str(8)"), ("secondary_techs", "str(120)"), ("centroid_lat", "num(9,6)"), ("centroid_lng", "num(9,6)"), ("km_from_shop", "num(6,1)"), ("trip_tech", "str(8)"), ("notes", "text"), ("needs_review", "bit")],
    "zip_zone": [("zip", "str(5)", "PK"), ("zone_code", "str(8)")],
    "customer": [("customer_id", "id"), ("first_name", "str(60)"), ("last_name", "str(80)"), ("display_name", "str(140)"), ("phone_primary", "str(20)"), ("phone_alt", "str(20)"), ("email", "str(120)"), ("contact_pref", "str(8)"), ("stripe_customer_id", "str(40)"), ("is_landlord", "bit"), ("is_property_manager", "bit"), ("epass_customer_code", "str(20)"), ("notes", "text"), ("created_at", "ts"), ("updated_at", "ts")],
    "address": [("address_id", "id"), ("customer_id", "int"), ("line1", "str(120)"), ("line2", "str(60)"), ("city", "str(60)"), ("state", "str(2)"), ("zip", "str(10)"), ("lat", "num(9,6)"), ("lng", "num(9,6)"), ("geocode_source", "str(8)"), ("gate_code", "str(20)"), ("access_notes", "text"), ("zone_code", "str(8)")],
    "job": [
        ("job_id", "id"), ("sv_number", "str(20)", "UNIQUE"), ("customer_id", "int"), ("address_id", "int"),
        # dashboard-owned
        ("status", "str(16)"), ("status_changed_at", "ts"), ("flags", "str(80)"), ("job_type", "str(10)"), ("qualification", "str(6)"),
        ("is_warranty", "bit"), ("warranty_flags", "str(40)"), ("payment_type", "str(4)"), ("source", "str(10)"),
        ("owner_tech_id", "int"), ("assigned_tech_id", "int"),
        ("promised_window_start", "ts"), ("promised_window_end", "ts"), ("planned_slot_start", "ts"), ("planned_slot_end", "ts"),
        ("route_date", "date"), ("route_sequence", "int"), ("route_locked", "bit"), ("trip_id", "int"), ("booking_mode", "str(16)"),
        ("zone_code", "str(8)"), ("problem_text", "text"), ("balance", "money"), ("total", "money"), ("bin_location", "str(10)"), ("units", "int"),
        # mirror of ePASS (import-owned)
        ("epass_status", "str(16)"), ("epass_route_date", "date"), ("epass_tech_code", "str(8)"), ("epass_seen_at", "ts"), ("epass_source", "str(4)"),
        ("epass_invoice_status", "str(12)"), ("epass_finish_date", "date"), ("epass_created_at", "date"), ("in_feed", "bit"),
        ("stale", "bit"), ("needs_intake_review", "bit"), ("closed_at", "ts"), ("cancel_reason", "str(60)"), ("created_at", "ts"), ("updated_at", "ts"),
    ],
    "unit": [("unit_id", "id"), ("job_id", "int"), ("category", "str(40)"), ("install_type", "str(12)"), ("brand", "str(40)"), ("model", "str(60)"), ("serial", "str(60)"), ("problem_text", "text"), ("raw_detail", "text")],
    "status_history": [("history_id", "id"), ("job_id", "int"), ("from_status", "str(16)"), ("to_status", "str(16)"), ("changed_at", "ts"), ("actor_type", "str(10)"), ("actor_id", "str(40)"), ("trigger_event", "str(60)"), ("reason_code", "str(40)"), ("note", "text")],
    "import_batch": [("import_batch_id", "id"), ("source", "str(16)"), ("file_name", "str(255)", "UNIQUE"), ("file_path", "text"), ("file_modified_at", "ts"), ("imported_at", "ts"), ("row_count", "int"), ("sv_count", "int"), ("created_count", "int"), ("updated_count", "int"), ("status", "str(12)"), ("message", "text")],
    "import_row_raw": [("raw_row_id", "id"), ("import_batch_id", "int"), ("order_number", "str(20)"), ("line_no", "int"), ("job_status", "str(16)"), ("delivery_date", "date"), ("truck", "str(8)"), ("map_zone", "str(8)"), ("model", "str(60)"), ("description", "text"), ("quantity", "num(9,2)"), ("amount", "money"), ("row_json", "text")],
    "sync_item": [("sync_id", "id"), ("job_id", "int"), ("sv_number", "str(20)"), ("kind", "str(16)"), ("payload", "text"), ("packet_text", "text"), ("state", "str(12)"), ("created_at", "ts"), ("keyed_at", "ts"), ("keyed_by", "str(60)"), ("confirmed_at", "ts"), ("confirmed_by_import_id", "int"), ("epass_values", "text"), ("mismatch_count", "int"), ("resolved_at", "ts"), ("resolved_by", "str(60)"), ("resolution", "str(16)"), ("note", "text")],
    "outbox": [("outbox_id", "id"), ("job_id", "int"), ("effect", "str(40)"), ("payload", "text"), ("created_at", "ts"), ("handled_at", "ts")],
    "audit_log": [("audit_id", "id"), ("logged_at", "ts"), ("user_id", "str(60)"), ("action", "str(60)"), ("entity", "str(30)"), ("entity_id", "str(40)"), ("before_json", "text"), ("after_json", "text")],
}

INDEXES = [
    ("ix_job_status_route", "job", "status, route_date"),
    ("ix_job_assigned", "job", "assigned_tech_id, route_date, route_sequence"),
    ("ix_job_owner_status", "job", "owner_tech_id, status"),
    ("ix_job_customer", "job", "customer_id"),
    ("ix_sync_state", "sync_item", "state, sv_number"),
    ("ix_sync_job", "sync_item", "job_id, state"),
    ("ix_raw_batch_order", "import_row_raw", "import_batch_id, order_number"),
    ("ix_hist_job", "status_history", "job_id, changed_at"),
    ("ix_techday", "tech_day", "tech_id, work_date"),
    ("ix_unit_job", "unit", "job_id"),
    ("ix_address_customer", "address", "customer_id"),
    ("ix_outbox_unhandled", "outbox", "handled_at, created_at"),
    ("ix_block_tech_day", "route_block", "tech_id, work_date"),
    ("ix_recall_state", "recall", "state, tech_id"),
    ("ix_recall_job", "recall", "job_id"),
    ("ix_delivered_tech_date", "delivered", "tech_id, visit_date"),
    ("ix_unit_serial", "unit", "serial"),
]

_SQLITE = {"id": "INTEGER PRIMARY KEY AUTOINCREMENT", "text": "TEXT", "int": "INTEGER", "bit": "INTEGER", "money": "NUMERIC", "date": "TEXT", "ts": "TEXT"}
_MSSQL = {"id": "INT IDENTITY(1,1) PRIMARY KEY", "text": "NVARCHAR(MAX)", "int": "INT", "bit": "BIT", "money": "DECIMAL(10,2)", "date": "DATE", "ts": "DATETIME2"}


def _coltype(t: str, dialect: str) -> str:
    m = _SQLITE if dialect == "sqlite" else _MSSQL
    if t.startswith("str("):
        return "TEXT" if dialect == "sqlite" else f"NVARCHAR({t[4:-1]})"
    if t.startswith("num("):
        return "NUMERIC" if dialect == "sqlite" else f"DECIMAL({t[4:-1]})"
    return m[t]


def columns(table: str) -> list[str]:
    return [c[0] for c in TABLES[table]]


def ddl(dialect: str = "sqlite") -> str:
    """Return the full schema as idempotent DDL (safe to run more than once)."""
    out = []
    for name, cols in TABLES.items():
        parts = []
        for c in cols:
            cname, ctype = c[0], c[1]
            extra = c[2] if len(c) > 2 else ""
            line = f"    {cname} {_coltype(ctype, dialect)}"
            if extra == "PK":
                line += " NOT NULL PRIMARY KEY"
            elif extra == "UNIQUE" and dialect == "sqlite":
                line += " UNIQUE"
            parts.append(line)
        if dialect == "sqlite":
            out.append(f"CREATE TABLE IF NOT EXISTS {name} (\n" + ",\n".join(parts) + "\n);")
        else:
            out.append(f"IF OBJECT_ID('dbo.{name}','U') IS NULL\nCREATE TABLE dbo.{name} (\n" + ",\n".join(parts) + "\n);")
            for c in cols:
                if len(c) > 2 and c[2] == "UNIQUE":  # nullable unique -> filtered unique index
                    out.append(f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ux_{name}_{c[0]}')\nCREATE UNIQUE INDEX ux_{name}_{c[0]} ON dbo.{name}({c[0]}) WHERE {c[0]} IS NOT NULL;")
    for ix, tbl, cols in INDEXES:
        if dialect == "sqlite":
            out.append(f"CREATE INDEX IF NOT EXISTS {ix} ON {tbl}({cols});")
        else:
            out.append(f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='{ix}')\nCREATE INDEX {ix} ON dbo.{tbl}({cols});")
    return "\n\n".join(out) + "\n"


if __name__ == "__main__":
    import sys
    print(ddl(sys.argv[1] if len(sys.argv) > 1 else "sqlite"))
