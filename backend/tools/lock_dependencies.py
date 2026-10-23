"""Generate hash locks from an explicitly selected, tested Docker image.

Online maintenance only. Does not modify the running services or environments.
Existing locks are never overwritten: choose a new output directory for updates.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def resolve(requirements, destination, linux=False):
    with tempfile.TemporaryDirectory() as temporary:
        report = Path(temporary) / "report.json"
        command = [sys.executable, "-m", "pip", "install", "--dry-run", "--ignore-installed",
                   "--only-binary=:all:", "--no-deps", "--report", str(report)]
        if linux:
            command += ["--python-version", "3.12", "--implementation", "cp", "--abi", "cp312",
                        "--abi", "abi3", "--platform", "manylinux_2_28_x86_64",
                        "--platform", "manylinux_2_27_x86_64", "--platform", "manylinux2014_x86_64"]
        subprocess.run(command + sorted(requirements), check=True)
        items = json.loads(report.read_text(encoding="utf-8"))["install"]
        lines = ["# Generated from approved versions; install with --require-hashes --only-binary=:all:."]
        for item in sorted(items, key=lambda row: row["metadata"]["name"].lower()):
            lines.append(f'{item["metadata"]["name"]}=={item["metadata"]["version"]} --hash=sha256:{item["download_info"]["archive_info"]["hashes"]["sha256"]}')
        destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
        destination.with_suffix(".artifacts.json").write_text(json.dumps([
            {"name": i["metadata"]["name"], "version": i["metadata"]["version"], **i["download_info"]}
            for i in items], indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default="solar-science-tests")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if any(args.output.iterdir()):
        raise SystemExit("Output must be empty; preserve existing locks")
    raw = subprocess.check_output(["docker", "run", "--rm", "--network", "none", args.image,
        "python", "-c", "import importlib.metadata as m,json; print(json.dumps({d.metadata['Name'].lower():d.version for d in m.distributions()}))"], text=True)
    versions = json.loads(raw)
    test_names = {"pytest", "iniconfig", "pluggy", "pygments"}
    versions = {k: v for k, v in versions.items() if k not in {"pip", "setuptools", "wheel", "orbis-scientia"}}
    for profile, names in {
        "runtime": set(versions) - test_names - {"spiceypy"},
        "orbital": {"spiceypy"}, "tests": test_names,
    }.items():
        resolve([f"{k}=={versions[k]}" for k in names], args.output / f"{profile}.lock", linux=True)
    resolve(["setuptools==80.9.0", "wheel==0.45.1"], args.output / "build.lock", linux=True)
    policy = json.loads((Path(__file__).resolve().parents[1] / "src/astro_system/iers-policy.json").read_text())
    if versions["astropy-iers-data"] != policy["version"]:
        raise SystemExit("Image IERS version does not match the approved policy")
    resolve([f"astropy-iers-data=={policy['version']}"], args.output / "iers.lock")
