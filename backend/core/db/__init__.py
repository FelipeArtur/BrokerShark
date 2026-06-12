"""Data layer split by responsibility — schema, crud, analytics, billing, categories.

External callers import ``core.database`` (a re-export shim over these modules);
the split exists so each concern stays reviewable. All SQL in the project lives
under this package — no inline SQL anywhere else (see Development Guidelines in
``CLAUDE.md``).
"""
