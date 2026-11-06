#!/usr/bin/env bash
# CI-кнопка: helm в ns hub (тот же кластер, что FVKS meet / fvcs).
# Вход: HUB_KUBECONFIG или VK_KUBECONFIG (file или содержимое), DRY_RUN=true|false,
# IMAGE_TAG (опционально). Секреты приложения — Secret hub-secrets (не из git).
set -euo pipefail

KUBE_RAW="${HUB_KUBECONFIG:-${VK_KUBECONFIG:-}}"
test -n "$KUBE_RAW" || { echo "HUB_KUBECONFIG (или VK_KUBECONFIG) required"; exit 1; }

mkdir -p "$HOME/.kube"
if [ -f "$KUBE_RAW" ]; then
  cp "$KUBE_RAW" "$HOME/.kube/config"
else
  printf '%s' "$KUBE_RAW" > "$HOME/.kube/config"
fi
chmod 600 "$HOME/.kube/config"
export KUBECONFIG="$HOME/.kube/config"

NS=hub
RELEASE=fm-ai-hub
CHART=./helm/sim
VALUES=./deploy/helm/values-flomni.yaml

test -f "$VALUES"
test -f "$CHART/Chart.yaml"

kubectl get ns "$NS" >/dev/null 2>&1 || kubectl create ns "$NS"

SET_ARGS=()
if [ -n "${IMAGE_TAG:-}" ]; then
  SET_ARGS+=(--set "app.image.tag=${IMAGE_TAG}")
fi
# Chart requires postgresql.auth.password when bundled PG is on.
# Real apply: HUB_POSTGRES_PASSWORD (Actions secret) или --set снаружи.
# Dry-run: placeholder (в кластер не пишется).
if [ "${DRY_RUN:-true}" = "true" ]; then
  SET_ARGS+=(--set "postgresql.auth.password=dry-run-placeholder")
elif [ -n "${HUB_POSTGRES_PASSWORD:-}" ]; then
  SET_ARGS+=(--set "postgresql.auth.password=${HUB_POSTGRES_PASSWORD}")
else
  echo "HUB_POSTGRES_PASSWORD required for apply (bundled postgres)"
  exit 1
fi

if [ "${DRY_RUN:-true}" = "true" ]; then
  echo "=== dry-run helm template ==="
  helm template "$RELEASE" "$CHART" -n "$NS" -f "$VALUES" "${SET_ARGS[@]}" | sed -n '1,80p' || true
  echo "... (truncated)"
  helm upgrade --install "$RELEASE" "$CHART" -n "$NS" -f "$VALUES" --dry-run=client "${SET_ARGS[@]}"
  echo "dry_run OK — apply только после cutover FMAH (см. deploy/CUTOVER-fmah-to-sim.md)"
  exit 0
fi

kubectl -n "$NS" get secret hub-secrets >/dev/null \
  || { echo "missing secret/${NS}/hub-secrets — Sim keys, не FMAH (см. hub-secrets.example.md)"; exit 1; }

# Guard: не ставить поверх живого FMAH hub-tenant
if helm -n "$NS" status hub >/dev/null 2>&1; then
  echo "REFUSE: helm release 'hub' (FMAH hub-tenant) still present — uninstall first (cutover)"
  exit 1
fi

helm upgrade --install "$RELEASE" "$CHART" -n "$NS" -f "$VALUES" --wait --timeout 15m "${SET_ARGS[@]}"
kubectl -n "$NS" get deploy,ingress,svc
echo "deployed $RELEASE → expect https://hub.fm.flomni.ru after DNS/TLS"
