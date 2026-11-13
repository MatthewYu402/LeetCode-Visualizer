"""python3 -m backend [--host HOST] [--port PORT]

Serves the API (backend/app.py) with Uvicorn. It listens on 127.0.0.1 by
default, so only this machine can reach it; the frontend's dev server proxies
/api to it. Settings come from the environment (see app.py).
"""

import argparse

import uvicorn

from pipeline.runners import remove_leftovers


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python3 -m backend", description="Serve the LeetCode Visualizer API.")
    parser.add_argument("--host", default="127.0.0.1", help="address to listen on (default 127.0.0.1, this machine only)")
    parser.add_argument("--port", type=int, default=8000, help="port (default 8000)")
    args = parser.parse_args(argv)
    # Containers a crashed backend left behind. Assumes one backend per Docker daemon.
    removed = remove_leftovers()
    if removed:
        print(f"backend: removed {removed} sandbox container(s) left from an earlier run")
    # proxy_headers=False: the app works out the visitor's address itself, from
    # X-Forwarded-For only when the request comes from a trusted proxy (app.py).
    uvicorn.run("backend.app:app", host=args.host, port=args.port, proxy_headers=False)


if __name__ == "__main__":
    main()
