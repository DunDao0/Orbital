"""Pre-build source checks, run explicitly on the checkout (not inside its image)."""
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def configuration():
    return yaml.safe_load((ROOT / "docker-compose.yml").read_text())


def test_all_services_have_explicit_platform_and_resource_guardrails():
    services = configuration()["services"]
    for service in services.values():
        assert service["platform"] == "linux/amd64"
        assert service["init"] is True
        assert service["read_only"] is True
        assert service["cap_drop"] == ["ALL"]
        assert "no-new-privileges:true" in service["security_opt"]
        assert all(key in service for key in ("cpus", "mem_limit", "pids_limit", "stop_grace_period"))
        assert "size=" in service["tmpfs"][0]
        assert "noexec" in service["tmpfs"][0] and "nosuid" in service["tmpfs"][0]
        assert service["logging"]["driver"] == "json-file"
        assert set(service["logging"]["options"]) == {"max-size", "max-file"}


def test_no_orbital_exposure_or_test_autostart():
    config = configuration()
    services = config["services"]
    assert config["networks"]["computation"]["internal"] is True
    assert services["orbital"]["networks"] == ["computation"]
    assert "ports" not in services["orbital"]
    assert services["science"]["ports"] == ["127.0.0.1:${SCIENCE_PORT:-8000}:8000"]
    tests = services["science-tests"]
    assert tests["network_mode"] == "none" and tests["profiles"] == ["tests"]
    assert tests["restart"] == "no"
    assert "ports" not in tests
    for name in ("science", "orbital"):
        assert services[name]["restart"] == "unless-stopped"
        assert "--timeout-graceful-shutdown" in services[name]["command"]


def test_runtime_inherits_inventory_and_gate_selects_linux_explicitly():
    dockerfile = (ROOT / "backend/Dockerfile").read_text()
    runtime = dockerfile.split("FROM runtime AS orbital", 1)[0]
    assert "COPY data-inventory.json ./data-inventory.json" in runtime
    assert "@sha256:" in runtime.splitlines()[0]
    assert "--require-hashes --only-binary=:all:" in runtime
    assert 'CMD ["python", "tools/run_gates.py", "--environment", "linux-cp312"]' in dockerfile
