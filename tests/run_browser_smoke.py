#!/usr/bin/env python3
"""Stage the static site and run the browser smoke test (Playwright).

Stages frontend/ + the generated data (meta, states, counties, index, zips,
county shards) + the fetch receipts at the site path data/receipts.json,
serves on a local port, and runs browser_smoke.js.

Set SMOKE_BASE to run the same script against a deployed URL instead.
"""
from __future__ import annotations

import functools
import http.server
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]


def main() -> int:
    if os.environ.get("SMOKE_BASE"):
        # live mode: no staging, point the smoke at the deployed site
        subprocess.run(
            ["node", str(PROJECT / "tests" / "browser_smoke.js")],
            check=True, timeout=300, cwd=str(PROJECT),
        )
        print("[smoke] live browser smoke passed")
        return 0

    with tempfile.TemporaryDirectory(prefix="eb-smoke-") as temporary:
        stage = Path(temporary)
        shutil.copytree(PROJECT / "frontend", stage, dirs_exist_ok=True)
        data = stage / "data"
        data.mkdir()
        gen = PROJECT / "data" / "generated"
        for name in ("meta.json", "states.json", "counties.json", "zips.json"):
            shutil.copy2(gen / name, data / name)
        shutil.copytree(gen / "i", data / "i")
        shutil.copytree(gen / "c", data / "c")
        shutil.copy2(gen / "receipts.json", data / "receipts.json")

        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=stage)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            environment = os.environ.copy()
            environment["SMOKE_BASE"] = f"http://127.0.0.1:{server.server_port}/"
            subprocess.run(
                ["node", str(PROJECT / "tests" / "browser_smoke.js")],
                check=True, timeout=300, env=environment, cwd=str(PROJECT),
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    print("[smoke] browser smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
