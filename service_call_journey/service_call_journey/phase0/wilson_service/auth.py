"""Permissions (9/18): who may retire a tech, publish zones, edit settings, open the test bench.

    can(db, email_or_role, permission) -> bool
    role_of(db, email_or_role)        -> 'owner' | 'manager' | ... | None
    add_user(db, email, name, role, by, active=True) -> user_id

A permission is a plain dotted name ('roster.retire'). A role is a label that carries a list of them (app_permission),
and a person (app_user) has one role. In Agility this maps onto app_users + user_page_permissions, so nothing here
assumes more structure than that: the strings are the contract, the tables are the seed.
"""
from __future__ import annotations

import json
from typing import Optional

from .db import DB, now_iso

ROLES = ("owner", "manager", "dispatcher", "csr", "parts", "tech")

# role -> permissions. Owner and manager are the same set today; kept as two roles so the split can happen in data.
ROLE_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "owner": ("roster.retire", "zones.publish", "settings.edit", "test_bench"),
    "manager": ("roster.retire", "zones.publish", "settings.edit", "test_bench"),
    "dispatcher": ("routes.edit", "tech.route_settings", "zones.draft"),
    "csr": ("jobs.book",),
    "parts": ("parts.verify",),
    "tech": (),
}


def role_of(db: DB, email_or_role: Optional[str]) -> Optional[str]:
    """A role name passes through; anything else is looked up as an active app_user email (case-insensitive)."""
    s = (email_or_role or "").strip()
    if not s:
        return None
    if s.lower() in ROLES:
        return s.lower()
    u = db.fetchone("SELECT role FROM app_user WHERE LOWER(email)=? AND active=1", (s.lower(),))
    return (u or {}).get("role")


def can(db: DB, email_or_role: Optional[str], permission: str) -> bool:
    role = role_of(db, email_or_role)
    if not role:
        return False
    return db.fetchone("SELECT 1 FROM app_permission WHERE role=? AND permission=?", (role, permission)) is not None


def permissions_for(db: DB, email_or_role: Optional[str]) -> list[str]:
    role = role_of(db, email_or_role)
    if not role:
        return []
    return [r["permission"] for r in db.fetchall("SELECT permission FROM app_permission WHERE role=? ORDER BY permission", (role,))]


def add_user(db: DB, email: str, name: str, role: str, by: str, *, active: bool = True, now=None) -> int:
    """Create or update the one row for an email. Audited; role must be one of ROLES."""
    role = (role or "").strip().lower()
    if role not in ROLES:
        raise ValueError(f"role must be one of {ROLES}")
    email = email.strip().lower()
    ts = now_iso(now)
    before = db.fetchone("SELECT * FROM app_user WHERE LOWER(email)=?", (email,))
    if before:
        db.update("app_user", {"user_id": before["user_id"]}, {"name": name, "role": role, "active": 1 if active else 0})
        uid = before["user_id"]
    else:
        uid = db.insert("app_user", {"email": email, "name": name, "role": role, "active": 1 if active else 0})
    db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": "auth.user_set", "entity": "app_user", "entity_id": str(uid),
                            "before_json": json.dumps(before, default=str) if before else None, "after_json": json.dumps({"email": email, "name": name, "role": role, "active": active})})
    return uid
