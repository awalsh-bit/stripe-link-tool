# Maintenance module — integration questions for the main dashboard

**To:** Wilson main dashboard developer
**From:** Cayden — Wilson AC & Appliance
**Why:** We have a maintenance module (customer enrollment, technician field tool, health reports) built as a standalone prototype. Before it gets merged into the main dashboard, we need it to use *your* auth, *your* templates and *your* database helpers rather than standing up a parallel set. That means knowing what those are called.

---

## What this is not asking for

To be explicit, because this should be easy to say yes to:

- **No source code is required to answer Tier 1.** Names and yes/no answers are enough.
- **No credentials, connection strings, API keys, or `.env` values.** If a setting name matters, the *name* is what we need — never the value.
- **No production access**, no database access, no deployment access.
- **No customer data** of any kind.

If a question can only be answered by pasting something, paste the smallest thing that answers it — a function signature, a decorator line, a template block name. Redact anything that looks like a secret; we only need the shape.

---

## Tier 1 — the fifteen lines that unblock everything

This is the whole ask. Filling this in is enough to start.

```text
MAIN APP ROOT:              (repo or folder the Flask app lives in)
APP ENTRY POINT:            (e.g. app.py / wsgi.py / run.py)
APP FACTORY USED?           (yes / no — is there a create_app())
ROUTE ORGANISATION:         (single file / blueprints — and blueprint names if so)
BASE TEMPLATE:              (e.g. templates/base.html)
NAV TEMPLATE:               (file, or the block name nav sits in)
AUTH LIBRARY:               (Flask-Login / custom session / something else)
CURRENT USER OBJECT:        (e.g. current_user — and how a view gets it)
USER ID FIELD:              (attribute name on that object)
USER DISPLAY NAME FIELD:    (attribute name on that object)
ROLE / PERMISSION METHOD:   (how a view checks "is this person allowed")
USER TABLE / ROLE TABLE:    (table names)
SQL CONNECTION HELPER:      (function or module used to get a connection/cursor)
AUDIT / EVENT LOG HELPER:   (if one exists — function name)
BACKGROUND JOB METHOD:      (cron / Celery / Windows task / none)
PRODUCTION SERVER:          (IIS / Waitress / Gunicorn / other)
```

### Why each one is needed, briefly

Most of these exist to stop us duplicating something you already have.

| Line | What it prevents |
|---|---|
| App entry point, factory, route organisation | Us guessing at where the maintenance blueprint registers |
| Base and nav templates | The maintenance pages looking like a bolted-on second app |
| Auth library, current user, id and name fields | Us inventing a second login. The field tool must inherit technician identity from your existing logins — the technician's internal user id is what stamps an inspection, with their display name stored as a historical snapshot |
| Role / permission method | Us inventing a parallel permission system for dispatcher / technician / manager |
| User and role tables | Foreign keys from maintenance tables pointing at the right place |
| SQL connection helper | A second connection pool against the same server |
| Audit helper | A parallel audit trail that doesn't show up in yours |
| Background job method | Deciding how filter-due and report-delivery jobs get scheduled |
| Production server | Whether file uploads and PDF generation need different handling |

---

## Tier 2 — helpful, small, only if you're comfortable

Each of these is one small file or one function, and each saves us a round of guessing. Redact freely.

1. **The base Jinja template** — so maintenance pages extend it correctly rather than approximating it.
2. **One representative view function**, any one, showing your normal shape: decorators, how the user is obtained, how the DB is called, how a template is rendered. One example teaches the whole house style.
3. **The SQL connection helper** — signature and usage pattern. Whether it returns a connection, a cursor, or a context manager changes how every repository function gets written.
4. **The names of settings in `config.py` / `.env`** — *names only, no values.* We need to know what configuration already exists so we ask for the right things rather than adding duplicates.

---

## Tier 3 — only if they already exist

Yes/no is a fine answer. If any of these already exist we should use them rather than building our own.

- Stripe or payment helper
- Email sending helper
- File / object storage mechanism for uploads
- PDF generation mechanism
- Existing customer or household table the maintenance households should link to
- Existing EPASS / NetSuite integration code

---

## What happens with the answers

They go into a short implementation note, and the maintenance module is then written against your conventions instead of its own. Concretely:

- The prototype's demo data layer (`store.js`, browser `localStorage`) is thrown away entirely — it was never production persistence.
- Maintenance tables are added to the existing SQL Server database via an additive, idempotent migration. Nothing existing is dropped or altered.
- Technician identity comes from your login. There is no second user system.
- The maintenance pages extend your base template and appear in your nav.

If any answer above is "we do that differently", that's the useful answer — the point is to match what exists, not to impose a structure.

---

## One question that isn't technical

Does the main dashboard already have a concept of **roles** — dispatcher, technician, sales, manager, admin? If it does, we should map onto it. If it doesn't, that's a decision Wilson needs to make rather than something the maintenance module should invent on its own.
