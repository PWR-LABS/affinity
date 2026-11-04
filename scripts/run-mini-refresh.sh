#!/bin/bash
set -euo pipefail
runtime_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
refresh_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
cd "$runtime_root"
"$refresh_node" -e 'const [major,minor,patch]=process.versions.node.split(".").map(Number);if(major!==24||minor<22||(minor===22&&patch<1))throw new Error("Refresh requires Node 24.22.1 or newer within Node 24");'
exec /usr/bin/caffeinate -i "$refresh_node" --import tsx scripts/run-mini-refresh.ts "$@"
