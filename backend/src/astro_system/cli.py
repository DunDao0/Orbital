from __future__ import annotations

import argparse
import json
from pathlib import Path
import uvicorn

from .api.main import app
from .ephemeris import SpiceEphemeris


def main() -> None:
    parser = argparse.ArgumentParser(prog="orbis")
    commands = parser.add_subparsers(dest="command", required=True)
    state = commands.add_parser("reference-state")
    state.add_argument("--utc", default="2026-08-05T00:00:00")
    state.add_argument("--kernels", type=Path, default=Path("data/kernels"))
    serve = commands.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.command == "reference-state":
        result = SpiceEphemeris(args.kernels).snapshot_payload(args.utc, ("Sun", "Earth", "Moon"))
        print(json.dumps(result, indent=2))
    else:
        uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
