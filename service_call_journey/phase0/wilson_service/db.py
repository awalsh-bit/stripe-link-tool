"""Thin DB layer: same SQL for SQLite (dev/tests) and SQL Server (prod, via pyodbc).

Both drivers accept '?' placeholders. Timestamps are ISO-8601 strings produced in Python
(local time, second precision) so no dialect-specific date functions are needed in
application SQL. SQL Server stores them in DATETIME2 columns; pyodbc converts the string.
"""
from __future__ import annotations

import datetime as _dt
import json
import sqlite3
from typing import Any, Iterable, Optional

from . import schema


def now_iso(now: Optional[_dt.datetime] = None) -> str:
    return (now or _dt.datetime.now()).replace(microsecond=0).isoformat(sep=" ")


def today_iso(now: Optional[_dt.datetime] = None) -> str:
    return (now or _dt.datetime.now()).date().isoformat()


class DB:
    def __init__(self, conn, dialect: str):
        self.conn = conn
        self.dialect = dialect

    # ---- construction
    @classmethod
    def sqlite(cls, path: str = ":memory:") -> "DB":
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL") if path != ":memory:" else None
        return cls(conn, "sqlite")

    @classmethod
    def mssql(cls, connection_string: str) -> "DB":
        import pyodbc  # optional dependency, production only
        conn = pyodbc.connect(connection_string, autocommit=False)
        return cls(conn, "mssql")

    @classmethod
    def from_url(cls, url: str) -> "DB":
        """'sqlite:path.db'  |  'mssql:DRIVER={ODBC Driver 17 for SQL Server};SERVER=...;DATABASE=...;Trusted_Connection=yes'"""
        scheme, _, rest = url.partition(":")
        if scheme == "sqlite":
            return cls.sqlite(rest or ":memory:")
        if scheme == "mssql":
            return cls.mssql(rest)
        raise ValueError(f"unknown db url scheme: {scheme!r} (use sqlite:PATH or mssql:CONNSTR)")

    # ---- schema
    def init_schema(self) -> None:
        for stmt in schema.ddl(self.dialect).split(";\n"):
            s = stmt.strip()
            if s:
                self.conn.execute(s)
        self.conn.commit()

    # ---- helpers
    def execute(self, sql: str, params: Iterable[Any] = ()) -> Any:
        return self.conn.execute(sql, tuple(params))

    def fetchone(self, sql: str, params: Iterable[Any] = ()):
        cur = self.conn.execute(sql, tuple(params))
        row = cur.fetchone()
        return _row_to_dict(cur, row) if row is not None else None

    def fetchall(self, sql: str, params: Iterable[Any] = ()) -> list[dict]:
        cur = self.conn.execute(sql, tuple(params))
        return [_row_to_dict(cur, r) for r in cur.fetchall()]

    def scalar(self, sql: str, params: Iterable[Any] = ()):
        cur = self.conn.execute(sql, tuple(params))
        row = cur.fetchone()
        return row[0] if row is not None else None

    def insert(self, table: str, values: dict) -> int:
        cols = list(values.keys())
        sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})"
        params = tuple(_coerce(values[c]) for c in cols)
        if self.dialect == "mssql":
            cur = self.conn.execute("SET NOCOUNT ON; " + sql + "; SELECT CAST(SCOPE_IDENTITY() AS INT)", params)
            row = cur.fetchone()
            return int(row[0]) if row and row[0] is not None else 0
        cur = self.conn.execute(sql, params)
        return cur.lastrowid

    def update(self, table: str, key: dict, values: dict) -> int:
        if not values:
            return 0
        sets = ", ".join(f"{k}=?" for k in values)
        where = " AND ".join(f"{k}=?" for k in key)
        cur = self.conn.execute(f"UPDATE {table} SET {sets} WHERE {where}",
                                tuple(_coerce(v) for v in values.values()) + tuple(key.values()))
        return cur.rowcount

    def commit(self) -> None:
        self.conn.commit()

    def rollback(self) -> None:
        self.conn.rollback()

    def close(self) -> None:
        self.conn.close()

    def setting(self, key: str, default=None):
        r = self.fetchone("SELECT value, type FROM settings WHERE setting_key=?", (key,))
        if not r:
            return default
        v, t = r["value"], r["type"]
        if t == "int":
            return int(v)
        if t == "float":
            return float(v)
        if t == "json":
            return json.loads(v)
        if t == "bool":
            return v in ("1", "true", "True")
        return v

    def set_setting(self, key: str, value, user: str = "system") -> None:
        v = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
        if self.fetchone("SELECT 1 FROM settings WHERE setting_key=?", (key,)):
            self.update("settings", {"setting_key": key}, {"value": v, "updated_by": user, "updated_at": now_iso()})
        else:
            t = "json" if isinstance(value, (dict, list)) else "float" if isinstance(value, float) else "int" if isinstance(value, int) else "str"
            self.insert("settings", {"setting_key": key, "value": v, "type": t, "description": "", "updated_by": user, "updated_at": now_iso()})


def _coerce(v):
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (dict, list)):
        return json.dumps(v)
    if isinstance(v, (_dt.datetime,)):
        return now_iso(v)
    if isinstance(v, (_dt.date,)):
        return v.isoformat()
    return v


def _row_to_dict(cur, row) -> dict:
    if isinstance(row, sqlite3.Row):
        return dict(row)
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, row))
