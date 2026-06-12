"""Tests for the systemd job entrypoints.

The backup job is the only scheduled job left (weekly/monthly Telegram reports were
removed with the bot). Each entrypoint must call bootstrap() then its one action.
"""


def test_backup_entrypoint_calls_bootstrap_then_run_backup(monkeypatch):
    import jobs.backup as job
    calls = []
    monkeypatch.setattr(job, "bootstrap", lambda: calls.append("bootstrap"))
    monkeypatch.setattr(job.core_backup, "run_backup", lambda: calls.append("run_backup") or True)
    job.main()
    assert calls == ["bootstrap", "run_backup"]
