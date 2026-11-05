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

HELM_ARGS=(upgrade --install "$RELEASE" "$CHART" -n "$NS" -f "$VALUES" --wait --timeout 15m)
if [ -n "${IMAGE_TAG:-}" ]; then
  HELM_ARGS+=(--set "app.image.tag=${IMAGE_TAG}")
fi

if [ "${DRY_RUN:-true}" = "true" ]; then
  echo "=== dry-run helm template ==="
  helm template "$RELEASE" "$CHART" -n "$NS" -f "$VALUES" ${IMAGE_TAG:+--set "app.image.tag=${IMAGE_TAG}"} | head -n 80
  echo "... (truncated)"
  helm upgrade --install "$RELEASE" "$CHART" -n "$NS" -f "$VALUES" --dry-run=client ${IMAGE_TAG:+--set "app.image.tag=${IMAGE_TAG}"}
  echo "dry_run OK — apply: workflow_dispatch dry_run=false + secret hub-secrets in ns"
  exit 0
fi

kubectl -n "$NS" get secret hub-secrets >/dev/null \
  || { echo "missing secret/${NS}/hub-secrets — create before real apply"; exit 1; }

helm "${HELM_ARGS[@]}"
kubectl -n "$NS" get deploy,ingress,svc
echo "deployed $RELEASE → expect https://hub.fm.flomni.ru after DNS/TLS"
