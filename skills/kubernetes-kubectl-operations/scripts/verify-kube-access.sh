#!/usr/bin/env bash
#
# verify-kube-access.sh — read-only preflight for kubectl and the optional Kubernetes MCP.
#
# Resolves the target context, checks API reachability and namespace access, reports
# read and write permissions, and confirms that npx is available for the MCP row. It
# never applies, patches, deletes, execs, drains, or otherwise mutates the cluster.
#
# Usage:
#   scripts/verify-kube-access.sh [--context NAME] [--namespace NAME] [--require-read-only]
#
# Options:
#   --context NAME        Check this context instead of the current one.
#   --namespace NAME      Require this namespace to exist.
#   --require-read-only   Exit non-zero if any create/delete permission is detected.
#   -h, --help            Show this help.
#
# Exits non-zero on missing kubectl, an unknown context, an unreachable API server, a
# missing or unreadable namespace, or a failed --require-read-only check.

set -euo pipefail

context=""
namespace=""
require_read_only=0

usage() { sed -n '3,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --context)
      [ "$#" -ge 2 ] || { echo "--context needs a value" >&2; exit 2; }
      context="$2"
      shift 2
      ;;
    --namespace)
      [ "$#" -ge 2 ] || { echo "--namespace needs a value" >&2; exit 2; }
      namespace="$2"
      shift 2
      ;;
    --require-read-only)
      require_read_only=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

warn() {
  printf 'WARN: %s\n' "$1" >&2
}

ok() {
  printf '  %s\n' "$1"
}

command -v kubectl >/dev/null 2>&1 || fail "kubectl not found on PATH"

kubectl_args=()
if [ -n "$context" ]; then
  kubectl_args+=(--context "$context")
fi

if [ -n "$context" ]; then
  if ! kubectl config get-contexts "$context" >/dev/null 2>&1; then
    fail "context not found in kubeconfig: $context"
  fi
  current="$context"
else
  current="$(kubectl config current-context 2>/dev/null || true)"
  [ -n "$current" ] || fail "no current kubeconfig context; set one or pass --context"
fi

cluster="$(kubectl "${kubectl_args[@]}" config view --minify -o jsonpath='{.clusters[0].name}' 2>/dev/null || true)"
server="$(kubectl "${kubectl_args[@]}" config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)"
user="$(kubectl "${kubectl_args[@]}" config view --minify -o jsonpath='{.users[0].name}' 2>/dev/null || true)"

printf 'Kubernetes access preflight\n'
ok "context: ${current}"
ok "cluster: ${cluster:-<unknown>}"
ok "server:  ${server:-<unknown>}"
ok "user:    ${user:-<unknown>}"

if ! kubectl "${kubectl_args[@]}" get --raw=/readyz --request-timeout=5s >/dev/null 2>&1; then
  fail "API server is not reachable at ${server:-the configured server}"
fi
ok "API:     reachable (/readyz)"

if [ -n "$namespace" ]; then
  if ! kubectl "${kubectl_args[@]}" get namespace "$namespace" >/dev/null 2>&1; then
    fail "namespace not found or not readable: $namespace"
  fi
  ok "namespace: $namespace"
fi

can() {
  if kubectl "${kubectl_args[@]}" auth can-i "$@" >/dev/null 2>&1; then
    printf 'yes'
  else
    printf 'no'
  fi
}

read_pods="$(can list pods --all-namespaces)"
read_nodes="$(can get nodes)"
read_namespaces="$(can list namespaces)"
write_pods="$(can create pods --all-namespaces)"
delete_pods="$(can delete pods --all-namespaces)"
write_deployments="$(can create deployments --all-namespaces)"
write_secrets="$(can create secrets --all-namespaces)"

printf 'Permissions\n'
ok "read pods:            ${read_pods}"
ok "get nodes:            ${read_nodes}"
ok "list namespaces:      ${read_namespaces}"
ok "create pods:          ${write_pods}"
ok "delete pods:          ${delete_pods}"
ok "create deployments:   ${write_deployments}"
ok "create secrets:       ${write_secrets}"

if [ "$read_pods" != "yes" ]; then
  warn "cannot list pods; the MCP inspection tools will be limited"
fi
if [ -z "$namespace" ]; then
  warn "no --namespace check; pass one when the task is namespace-scoped"
fi

write_access=0
for permission in "$write_pods" "$delete_pods" "$write_deployments" "$write_secrets"; do
  if [ "$permission" = "yes" ]; then
    write_access=1
    break
  fi
done

if [ "$write_access" -eq 1 ]; then
  warn "write permissions detected; do not enable the Kubernetes MCP for exploratory inspection"
  warn "point the MCP at a read-only kubeconfig/RBAC, or use kubectl with explicit confirmation"
  if [ "$require_read_only" -eq 1 ]; then
    fail "writes are allowed but --require-read-only was requested"
  fi
else
  ok "writes:   none of the checked create/delete permissions are granted"
fi

if command -v npx >/dev/null 2>&1; then
  ok "npx:      found (needed by the Kubernetes MCP row)"
else
  warn "npx not found; the Kubernetes MCP row will fail to start"
fi

printf 'PASS: preflight completed without a blocking error\n'
