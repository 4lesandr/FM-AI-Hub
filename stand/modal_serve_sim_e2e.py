"""Serve Install-MVP UI on Modal (next standalone + Postgres) with a public tunnel.

Does NOT run next on Air. Alexander opens the printed E2E_URL.

Prereqs on volume `sim-build-artifacts`:
  - sim-next-build.tgz   (from modal_build_sim.py)
  - simstudio-e2e.dump   (pg_dump -Fc of local simstudio)

Usage:
  modal run stand/modal_serve_sim_e2e.py
"""

from __future__ import annotations

import os
from pathlib import Path

import modal

VOLUME_NAME = "sim-build-artifacts"
ARTIFACT = "sim-next-build.tgz"
DB_DUMP = "simstudio-e2e.sql"

app = modal.App("sim-sandbox-e2e-serve")
vol = modal.Volume.from_name(VOLUME_NAME, create_if_missing=False)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "curl",
        "ca-certificates",
        "postgresql",
        "postgresql-client",
        "postgresql-17-pgvector",
        "redis-server",
        "bash",
        "tini",
    )
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y --no-install-recommends nodejs",
        "node --version",
    )
    .env({"NODE_ENV": "production"})
)


def _read_local_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


@app.function(
    image=image,
    cpu=4,
    memory=8192,
    timeout=60 * 60 * 6,
    volumes={"/out": vol},
)
def serve(secrets: dict[str, str]) -> str:
    import shutil
    import subprocess
    import time

    work = Path("/app/sim")
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    tgz = Path("/out") / ARTIFACT
    dump = Path("/out") / DB_DUMP
    if not tgz.exists():
        raise RuntimeError(f"missing volume file {ARTIFACT}")
    if not dump.exists() or dump.stat().st_size < 1000:
        raise RuntimeError(f"missing/empty volume file {DB_DUMP}")

    print("==> extract .next artifact", flush=True)
    subprocess.check_call(["tar", "-xzf", str(tgz), "-C", str(work)])
    nxt = work / ".next"
    public = work / "public"
    standalone = nxt / "standalone"
    if not (standalone / "apps/sim/server.js").exists():
        raise RuntimeError("standalone server.js missing from artifact")

    run_root = work / "run"
    if run_root.exists():
        shutil.rmtree(run_root)
    shutil.copytree(standalone, run_root)
    static_dst = run_root / "apps/sim/.next/static"
    static_dst.parent.mkdir(parents=True, exist_ok=True)
    if static_dst.exists():
        shutil.rmtree(static_dst)
    shutil.copytree(nxt / "static", static_dst)
    pub_dst = run_root / "apps/sim/public"
    if public.exists():
        if pub_dst.exists():
            shutil.rmtree(pub_dst)
        shutil.copytree(public, pub_dst)

    build_id = (nxt / "BUILD_ID").read_text().strip()
    print(f"==> BUILD_ID={build_id}", flush=True)

    print("==> start postgres + redis", flush=True)
    # Cluster mode via pg_ctlcluster when available; else initdb.
    pg_start = subprocess.run(
        ["bash", "-lc", "pg_lsclusters || true; service postgresql start || true"],
        capture_output=True,
        text=True,
    )
    print(pg_start.stdout or "", pg_start.stderr or "", flush=True)
    time.sleep(2)
    # Ensure role/db exist, then restore SQL dump (from Air PG17; plain SQL).
    subprocess.check_call(
        [
            "bash",
            "-lc",
            "su - postgres -c \"psql -v ON_ERROR_STOP=0 -c \\\"SELECT 1\\\"\" "
            "|| (mkdir -p /tmp/pgdata && chown -R postgres:postgres /tmp/pgdata && "
            "su - postgres -c 'initdb -D /tmp/pgdata --auth-local=trust --auth-host=trust' && "
            "su - postgres -c \"pg_ctl -D /tmp/pgdata -o \\\"-c listen_addresses=127.0.0.1 -p 5432\\\" -w start\")",
        ]
    )
    subprocess.check_call(
        [
            "bash",
            "-lc",
            "su - postgres -c \"psql -tc \\\"SELECT 1 FROM pg_database WHERE datname='simstudio'\\\"\" | grep -q 1 "
            "|| su - postgres -c 'createdb simstudio'",
        ]
    )
    # Ensure pgvector operators exist before restore (dump includes vector indexes).
    ext_sql = Path("/tmp/ext-vector.sql")
    ext_sql.write_text("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;\n")
    subprocess.check_call(["chown", "postgres:postgres", str(ext_sql)])
    subprocess.check_call(
        ["su", "-", "postgres", "-c", f"psql -d simstudio -v ON_ERROR_STOP=1 -f {ext_sql}"],
    )
    # Plain dumps from Homebrew PG17 can emit non-fatal operator noise; require core tables after.
    restore = subprocess.run(
        ["su", "-", "postgres", "-c", f"psql -d simstudio -f {dump}"],
        capture_output=True,
        text=True,
    )
    print((restore.stdout or "")[-2000:], flush=True)
    print((restore.stderr or "")[-2000:], flush=True)
    check_sql = Path("/tmp/check-core.sql")
    check_sql.write_text(
        "SELECT COUNT(*) FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name IN "
        "('user','workflow','agent_release','agent_installation');\n"
    )
    subprocess.check_call(["chown", "postgres:postgres", str(check_sql)])
    check = subprocess.run(
        ["su", "-", "postgres", "-c", f"psql -d simstudio -At -f {check_sql}"],
        capture_output=True,
        text=True,
    )
    n = (check.stdout or "").strip()
    print(f"==> core tables present count={n}", flush=True)
    if n != "4":
        raise RuntimeError(f"DB restore incomplete; core tables={n}")
    # TCP auth for node (peer only works on unix socket as OS user postgres).
    pw_sql = Path("/tmp/set-pg-pass.sql")
    pw_sql.write_text("ALTER USER postgres WITH PASSWORD 'postgres';\n")
    subprocess.check_call(["chown", "postgres:postgres", str(pw_sql)])
    subprocess.check_call(["su", "-", "postgres", "-c", f"psql -f {pw_sql}"])
    hba = Path("/etc/postgresql/17/main/pg_hba.conf")
    if hba.exists():
        txt = hba.read_text()
        if "host all all 127.0.0.1/32 trust" not in txt:
            hba.write_text(
                "local all all trust\n"
                "host all all 127.0.0.1/32 trust\n"
                "host all all ::1/128 trust\n"
                + txt
            )
            subprocess.check_call(["bash", "-lc", "pg_ctlcluster 17 main reload || true"])
    subprocess.Popen(
        ["redis-server", "--daemonize", "yes", "--port", "6379", "--bind", "127.0.0.1"],
    )
    time.sleep(1)

    # Open tunnel first so auth URLs match what Александр opens.
    print("==> opening public tunnel on :3000", flush=True)
    with modal.forward(3000) as tunnel:
        url = tunnel.url.rstrip("/")
        print(f"E2E_URL={url}", flush=True)
        Path("/out/e2e-url.txt").write_text(url + "\n")
        Path("/out/e2e-build-id.txt").write_text(build_id + "\n")
        vol.commit()

        env = {
            **os.environ,
            **secrets,
            "DATABASE_URL": "postgresql://postgres:postgres@127.0.0.1:5432/simstudio",
            "REDIS_URL": "redis://127.0.0.1:6379",
            "NEXT_PUBLIC_APP_URL": url,
            "BETTER_AUTH_URL": url,
            "TRUSTED_ORIGINS": url,
            "SOCKET_SERVER_URL": url,
            "NEXT_PUBLIC_SOCKET_URL": url,
            "PORT": "3000",
            "HOSTNAME": "0.0.0.0",
            "NODE_ENV": "production",
            "ORG_REVOKE_PERSONAL_KEYS_ON_LEAVE": "true",
        }
        # Ensure required secrets exist (dev fallbacks only if local dotenv missed them)
        env.setdefault("BETTER_AUTH_SECRET", "dev-secret-at-least-32-characters-long")
        env.setdefault("INTERNAL_API_SECRET", "dev-internal-api-secret-min-32-chars")
        env.setdefault(
            "ENCRYPTION_KEY",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )

        server_js = run_root / "apps/sim/server.js"
        print(f"==> node {server_js}", flush=True)
        proc = subprocess.Popen(
            ["node", str(server_js)],
            cwd=str(run_root / "apps/sim"),
            env=env,
        )
        # Wait until healthy
        import urllib.request

        healthy = False
        for i in range(60):
            if proc.poll() is not None:
                raise RuntimeError(f"next exited early code={proc.returncode}")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:3000/api/health", timeout=2) as r:
                    if r.status == 200:
                        healthy = True
                        break
            except Exception:
                time.sleep(2)
        if not healthy:
            proc.kill()
            raise RuntimeError("next health check failed")
        print("==> healthy; walkthrough ready", flush=True)
        print(
            "WALKTHROUGH: login fvks-smoke@localhost.local / SmokeTest!23456 → "
            "open Test Chat Agent → Publish → copy /install/{token} → "
            "incognito installer@localhost.local → Поставить себе → /apps/{id} agent-pane chat → "
            "Publish N+1 → Defer/Accept",
            flush=True,
        )
        try:
            while True:
                if proc.poll() is not None:
                    raise RuntimeError(f"next exited code={proc.returncode}")
                time.sleep(30)
                Path("/out/e2e-url.txt").write_text(url + "\n")
                vol.commit()
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except Exception:
                proc.kill()
        return url


@app.local_entrypoint()
def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    dotenv = _read_local_dotenv(repo / "apps/sim/.env.local")
    # Pass only auth/crypto secrets — never print values.
    keys = [
        "BETTER_AUTH_SECRET",
        "INTERNAL_API_SECRET",
        "ENCRYPTION_KEY",
        "CRON_SECRET",
    ]
    secrets = {k: dotenv[k] for k in keys if k in dotenv and dotenv[k]}
    print("Starting Modal E2E serve (stdout will include E2E_URL=...)", flush=True)
    serve.remote(secrets)
