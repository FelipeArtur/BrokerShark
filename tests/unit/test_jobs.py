"""Tests for the systemd job entrypoints.

The backup job is the only scheduled job left (weekly/monthly Telegram reports were
removed with the bot). The entrypoint must call bootstrap() then run_backup(), and
map the tri-state result to an exit code: only a real "failed" exits non-zero —
"skipped" (same-month catch-up) must NOT mark the unit failed, and "created" is the
happy path.
"""
import pytest


def _run(monkeypatch, result: str) -> list:
    import jobs.backup as job
    calls = []
    monkeypatch.setattr(job, "bootstrap", lambda: calls.append("bootstrap"))
    monkeypatch.setattr(job.core_backup, "run_backup", lambda: calls.append("run_backup") or result)
    job.main()
    return calls


def test_backup_entrypoint_calls_bootstrap_then_run_backup(monkeypatch):
    assert _run(monkeypatch, "created") == ["bootstrap", "run_backup"]


def test_backup_entrypoint_exits_zero_on_skip(monkeypatch):
    # Daily run within an already-backed-up month is legitimate — no false alarm.
    assert _run(monkeypatch, "skipped") == ["bootstrap", "run_backup"]


def test_backup_entrypoint_exits_nonzero_on_failure(monkeypatch):
    # exit 1 marks the unit failed → visible in --failed and fires OnFailure.
    with pytest.raises(SystemExit) as exc:
        _run(monkeypatch, "failed")
    assert exc.value.code == 1
