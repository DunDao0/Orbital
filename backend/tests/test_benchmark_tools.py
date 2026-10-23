"""Tool regressions; no scientific load and no calls to pre-existing services."""
import io
import json
import os
from contextlib import nullcontext
from pathlib import Path
import subprocess
import sys
import threading
import time
from types import SimpleNamespace

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import benchmark_services as benchmark
from tools import service_pair as lifecycle


def test_nearest_rank_keeps_failure_latencies_separate():
    rows = [benchmark.Observation("success", x, 200) for x in (30, 10, 20)]
    rows += [benchmark.Observation("rejected_429", 1, 429),
             benchmark.Observation("timeout", 1000)]
    result = benchmark.summarize(rows)
    assert result["groups"]["success"]["p50_ms"] == 20
    assert result["groups"]["success"]["p95_ms"] == 30
    assert result["groups"]["rejected_429"]["count"] == 1
    assert result["groups"]["timeout"]["p95_ms"] == 1000
    assert result["groups"]["http_error"]["p95_ms"] is None
    assert benchmark.nearest_rank(range(1, 21), .95) == 19


@pytest.mark.parametrize("status,category", [(200, "success"), (429, "rejected_429"),
                                            (501, "http_error"), (503, "http_error")])
def test_http_status_and_post_are_not_retried(status, category):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"status": status})
    with httpx.Client(base_url="http://test", transport=httpx.MockTransport(handler)) as client:
        row = benchmark.request_once(client, "simulate_short")
    assert len(calls) == 1
    assert calls[0].method == "POST"
    assert row.category == category and row.status == status


def test_client_timeout_is_not_a_cancellation_or_retry():
    calls = []
    def handler(request):
        calls.append(request)
        raise httpx.ReadTimeout("private-url-secret")
    with httpx.Client(base_url="http://test", transport=httpx.MockTransport(handler)) as client:
        row = benchmark.request_once(client, "simulate_max")
    assert len(calls) == 1 and row.category == "timeout"
    assert benchmark.unsettled([row])
    assert benchmark.unsettled([benchmark.Observation("http_error", 1, 504)])
    assert not benchmark.unsettled([benchmark.Observation("rejected_429", 1, 429)])


def test_report_does_not_overwrite_and_preserves_partial_evidence(tmp_path):
    path = tmp_path / "report.json"
    with pytest.raises(RuntimeError):
        with benchmark.new_report(path) as report:
            report["evidence"] = 3
            raise RuntimeError("interrupted")
    assert json.loads(path.read_text())["evidence"] == 3
    before = path.read_bytes()
    with pytest.raises(FileExistsError):
        with benchmark.new_report(path):
            pass
    assert path.read_bytes() == before


def test_owned_tree_rejects_pid_reuse_and_unrelated_processes():
    sample = lifecycle.ProcessSample
    snapshot = {1: sample(1, 0, 100, 1), 2: sample(2, 1, 110, 2),
                3: sample(3, 2, 120, 3), 4: sample(4, 1, 90, 4),
                5: sample(5, 0, 130, 5)}
    assert set(lifecycle.owned_tree(snapshot, {1: 100})) == {1, 2, 3}
    assert lifecycle.owned_tree(snapshot, {1: 99}) == {}


def test_memory_aggregate_is_same_poll_not_sum_of_individual_peaks():
    sample = lifecycle.ProcessSample
    snapshots = iter([
        {"science": {1: sample(1, 0, 100, 10)}, "orbital": {2: sample(2, 0, 100, 2)}},
        {"science": {1: sample(1, 0, 100, 1)}, "orbital": {2: sample(2, 0, 100, 20)}},
    ])
    pair = SimpleNamespace(samples=lambda: next(snapshots),
                           worker_pids={"science": {1}, "orbital": {2}},
                           processes={"science": SimpleNamespace(pid=1), "orbital": SimpleNamespace(pid=2)})
    sampler = benchmark.MemorySampler(pair)
    sampler.sample()
    sampler.sample()
    report = sampler.report()
    assert report["total_peak_same_poll_bytes"] == 21
    assert sum(row["peak_rss_bytes"] for row in report["processes"]) == 30
    assert all(row["kind"] == "worker" for row in report["processes"])


@pytest.mark.parametrize("line", [
    "Authorization: bearer private-secret",
    'File "C:/Users/private/source.py", line 9',
    "https://private.example/?token=private-secret",
    '{"latitude_deg": 42, "longitude_deg": 15}',
    "ValueError: private-secret",
    "Authorization: MyPrivatePasswordError",
])
def test_startup_diagnostics_never_retain_raw_context(line):
    value = lifecycle.safe_diagnostic(line)
    assert "private" not in value
    assert "42" not in value and "15" not in value
    assert len(value) < 80


def test_process_snapshot_captures_current_identity():
    sample = lifecycle.process_snapshot()[os.getpid()]
    assert sample.creation_id > 0
    assert sample.rss_bytes > 0
    assert sample.parent_pid > 0


@pytest.mark.parametrize("processes", [{}, {1: lifecycle.ProcessSample(1, 0, 100, None)}])
def test_missing_memory_is_incomplete_not_zero(processes):
    pair = SimpleNamespace(samples=lambda: {"science": processes}, worker_pids={"science": {1}},
                           processes={"science": SimpleNamespace(pid=1)})
    sampler = benchmark.MemorySampler(pair)
    sampler.sample()
    report = sampler.report()
    assert report["total_peak_same_poll_bytes"] is None
    assert report["role_peak_same_poll_bytes"]["science"] is None
    assert report["failed_or_incomplete_polls"] == 1
    assert report["complete_polls"] == 0


def test_unrelated_healthy_api_does_not_prove_ownership():
    impostor = SimpleNamespace(status=200, headers={})
    assert not lifecycle.owned_health(impostor, "unique-instance")
    impostor.headers["X-Orbis-Benchmark-Instance"] = "different-instance"
    assert not lifecycle.owned_health(impostor, "unique-instance")
    impostor.headers["X-Orbis-Benchmark-Instance"] = "unique-instance"
    assert lifecycle.owned_health(impostor, "unique-instance")


def test_invalid_startup_configuration():
    for options in ({"startup_timeout": 0}, {"orbital_timeout": float("nan")},
                    {"workers": True}, {"science_concurrency": -1}):
        with pytest.raises(ValueError):
            lifecycle.ServicePair(**options)
    with pytest.raises(ValueError):
        lifecycle.ServicePair().start("remote")


def test_log_drain_has_bounded_retention():
    pair = lifecycle.ServicePair()
    from collections import deque
    pair.logs["science"], pair.worker_pids["science"] = deque(maxlen=40), set()
    pair._drain("science", io.StringIO("secret " * 4000 + "\n" * 100))
    assert len(pair.logs["science"]) == 40
    assert all(value == "log_line_redacted" for value in pair.logs["science"])


@pytest.mark.parametrize("error_type", [OSError, RuntimeError])
def test_cleanup_still_closes_owned_handle_when_sampling_fails(monkeypatch, error_type):
    pair = lifecycle.ServicePair(shutdown_timeout=.01)
    process = SimpleNamespace(pid=123, returncode=None, killed=False)
    process.poll = lambda: process.returncode
    def kill():
        process.killed, process.returncode = True, -1
    process.kill = kill
    process.wait = lambda timeout: process.returncode
    job = SimpleNamespace(closed=False)
    job.close = lambda: setattr(job, "closed", True)
    pair.processes["science"] = process
    pair._jobs["science"] = job
    pair._anchors["science"] = {}
    pair._readers["science"] = SimpleNamespace(join=lambda timeout: None)
    def failure():
        raise error_type("private-error")
    monkeypatch.setattr(pair, "samples", failure)
    with pytest.raises(RuntimeError, match="cleanup unconfirmed"):
        pair.stop("science")
    assert job.closed and process.killed


@pytest.mark.parametrize("reader_failure", [False, True])
def test_startup_failure_explains_reason_and_cleans_owned_process(monkeypatch, reader_failure):
    process = SimpleNamespace(pid=123, returncode=None, stdout=io.StringIO("private-secret\n"))
    process.poll = lambda: process.returncode
    process.kill = lambda: setattr(process, "returncode", -9)
    process.wait = lambda timeout: process.returncode
    monkeypatch.setattr(lifecycle.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(lifecycle, "process_snapshot", lambda:
                        {123: lifecycle.ProcessSample(123, 0, 10, 100)} if process.returncode is None else {})
    monkeypatch.setattr(lifecycle, "_terminate_windows", lambda sample: process.kill())
    if hasattr(os, "killpg"):
        monkeypatch.setattr(os, "killpg", lambda pid, sig: process.kill())
    opener = SimpleNamespace(open=lambda *args, **kwargs:
                             nullcontext(SimpleNamespace(status=200, headers={})))
    monkeypatch.setattr(lifecycle.urllib.request, "build_opener", lambda *args: opener)
    if reader_failure:
        def fail_start():
            raise RuntimeError("private-secret")
        monkeypatch.setattr(lifecycle.threading, "Thread", lambda *args, **kwargs:
                            SimpleNamespace(start=fail_start, ident=None))
    pair = lifecycle.ServicePair(startup_timeout=.02, shutdown_timeout=.02, windows_job=False)
    expected = "startup_check_failed" if reader_failure else "instance_mismatch"
    with pytest.raises(RuntimeError, match=expected) as caught:
        pair.start("science")
    assert "private-secret" not in str(caught.value)
    assert process.returncode == -9
    assert "science" not in pair.processes


@pytest.mark.parametrize("use_job", [False, True])
def test_owned_launcher_and_child_cleanup(use_job):
    """Exercises identity fallback on Windows and private process group on Linux."""
    pair = lifecycle.ServicePair(shutdown_timeout=2, windows_job=False)
    program = ("import subprocess,sys,time; "
               "child=subprocess.Popen([sys.executable,'-B','-c','import time; time.sleep(30)']); "
               "print(child.pid,flush=True); time.sleep(30)")
    process = subprocess.Popen(
        [sys.executable, "-B", "-c", program], stdout=subprocess.PIPE, text=True,
        start_new_session=os.name != "nt",
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    pair.processes["science"] = process
    pair._readers["science"] = SimpleNamespace(join=lambda timeout: None)
    pair._anchors["science"] = {}
    try:
        if use_job and os.name == "nt":
            pair._jobs["science"] = lifecycle._WindowsJob(process)
        first = lifecycle.process_snapshot()[process.pid]
        pair._anchors["science"][process.pid] = first.creation_id
        # Reading this owned child's single line is bounded by a daemon thread.
        result = []
        reader = threading.Thread(target=lambda: result.append(process.stdout.readline()), daemon=True)
        reader.start()
        reader.join(timeout=5)
        assert result, "owned child did not start"
        child_pid = int(result[0])
        deadline = time.monotonic() + 3
        while child_pid not in pair.samples()["science"] and time.monotonic() < deadline:
            time.sleep(.02)
        owned = pair.samples()["science"]
        assert child_pid in owned
        identities = {pid: row.creation_id for pid, row in owned.items()}
        pair.stop("science")
        assert lifecycle.owned_tree(lifecycle.process_snapshot(), identities) == {}
    finally:
        pair.stop("science")
        process.stdout.close()


def test_benchmark_max_load_is_explicit_and_smoke_is_selectable():
    method, _, payload = benchmark.OPERATIONS["simulate_max"]
    assert method == "POST" and len(payload["bodies"]) == 10
    assert payload["duration_s"] / payload["step_s"] == 20_000
    args = benchmark.parser().parse_args(["--operations", "reference", "--repetitions", "1",
                                         "--concurrency", "1", "--output", "new.json"])
    assert args.operations == ["reference"]
    assert benchmark.OPERATIONS["stars"][2]["limit"] == 100
