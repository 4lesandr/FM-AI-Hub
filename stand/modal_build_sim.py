"""Build apps/sim on Modal (high RAM), publish .next tarball to a Volume.

Usage:
  modal run stand/modal_build_sim.py
  modal volume get sim-build-artifacts sim-next-build.tgz ./stand/artifacts/
"""

from __future__ import annotations

from pathlib import Path

import modal

REPO_ROOT = Path(__file__).resolve().parents[1]
VOLUME_NAME = "sim-build-artifacts"
ARTIFACT = "sim-next-build.tgz"

app = modal.App("sim-sandbox-build")
vol = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

IGNORE = [
    "**/node_modules/**",
    "**/.next/**",
    "**/.git/**",
    "**/.turbo/**",
    "**/dist/**",
    "stand/artifacts/**",
    "stand/livekit-voice/**",
    "**/*.mp4",
    "apps/sim/uploads/**",
]

base_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "ca-certificates", "bash", "xz-utils", "python3", "make", "g++")
    .run_commands(
        "curl -fsSL https://bun.sh/install | bash",
        "ln -sf /root/.bun/bin/bun /usr/local/bin/bun",
        "ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx",
        "curl -fsSL https://deb.nodesource.com/setup_24.x | bash -",
        "apt-get install -y --no-install-recommends nodejs",
    )
    .env(
        {
            "PATH": "/root/.bun/bin:/usr/local/bin:/usr/bin:/bin",
            "HUSKY": "0",
            "NEXT_TELEMETRY_DISABLED": "1",
            "VERCEL_TELEMETRY_DISABLED": "1",
        }
    )
)

build_image = base_image.add_local_dir(
    str(REPO_ROOT),
    remote_path="/app",
    ignore=IGNORE,
)


@app.function(
    image=build_image,
    cpu=8,
    memory=32768,
    timeout=60 * 60,
    volumes={"/out": vol},
)
def build_sim() -> str:
    import os
    import subprocess

    os.chdir("/app")
    os.environ["HUSKY"] = "0"
    os.environ["NEXT_TELEMETRY_DISABLED"] = "1"
    os.environ["VERCEL_TELEMETRY_DISABLED"] = "1"
    os.environ["DOCKER_BUILD"] = "1"
    os.environ["NODE_OPTIONS"] = "--max-old-space-size=24576"
    os.environ["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/dummy"
    os.environ["NEXT_PUBLIC_APP_URL"] = "http://localhost:3000"
    os.environ["BETTER_AUTH_URL"] = "http://localhost:3000"
    os.environ["BETTER_AUTH_SECRET"] = "dev-secret-at-least-32-characters-long"
    os.environ["INTERNAL_API_SECRET"] = "dev-internal-api-secret-min-32-chars"
    os.environ["ENCRYPTION_KEY"] = (
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    )

    print("==> bun install", flush=True)
    subprocess.check_call(["bun", "install", "--frozen-lockfile"])

    isolated = Path("/app/node_modules/isolated-vm")
    if isolated.exists():
        print("==> rebuild isolated-vm", flush=True)
        subprocess.check_call(["bun", "rebuild", "isolated-vm"])

    print("==> bun run build (turbopack, DOCKER_BUILD=1)", flush=True)
    subprocess.check_call(["bun", "run", "build"], cwd="/app/apps/sim")

    build_id_path = Path("/app/apps/sim/.next/BUILD_ID")
    if not build_id_path.exists():
        raise RuntimeError("next build finished but .next/BUILD_ID is missing")
    build_id = build_id_path.read_text().strip()

    out = Path("/out") / ARTIFACT
    if out.exists():
        out.unlink()
    print(f"==> packing {ARTIFACT}", flush=True)
    # Serve unpacks .next (+ public) and expects standalone under .next/standalone.
    subprocess.check_call(
        [
            "tar",
            "-czf",
            str(out),
            "-C",
            "/app/apps/sim",
            ".next",
            "public",
        ]
    )
    vol.commit()
    size = out.stat().st_size
    print(f"==> done BUILD_ID={build_id} size={size}", flush=True)
    return build_id


@app.local_entrypoint()
def main() -> None:
    build_id = build_sim.remote()
    print(f"Artifact on Modal Volume '{VOLUME_NAME}': {ARTIFACT}")
    print(f"BUILD_ID={build_id}")
    print(f"Download: modal volume get {VOLUME_NAME} {ARTIFACT} ./stand/artifacts/")
