#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_DIR="$(cd -- "$DEPLOY_DIR/.." && pwd)"
COMMAND="${1:-deploy}"
ENV_FILE="${2:-$DEPLOY_DIR/.env.production}"
PROJECT="${CLOUD_PROJECT_NAME:-picoddy-cloud-prod}"
fail() { printf '%s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
Usage: bash cloud/deploy/deploy.sh COMMAND [ENV_FILE]
  init     Copy local credentials to production config (never overwrites)
  deploy   Build, validate, initialize, start and check the application stack
  check    Validate config against the built image; no database mutation
  status   Show service status
  logs     Follow API, worker and scheduler logs
  stop     Stop application services; keep database and all persistent volumes
Requires Docker Engine + Docker Compose v2. Default project: picoddy-cloud-prod.
OpenSandbox is deployed on this server; configure HTTPS reverse proxy separately.
HELP
}
case "$COMMAND" in help|-h|--help) usage; exit 0;; init|deploy|check|status|logs|stop) ;; *) usage; exit 2;; esac
if [[ "$COMMAND" == init ]]; then
  [[ ! -e "$ENV_FILE" ]] || fail "配置已存在，不覆盖：$ENV_FILE"
  command -v node >/dev/null || fail 'init 需要 Node.js 22+；可在本地执行 init 后复制生产配置到服务器'
  node "$DEPLOY_DIR/init-local.mjs" "${LOCAL_ENV_FILE:-$CLOUD_DIR/.env}" "$ENV_FILE"
  exit 0
fi
[[ -f "$ENV_FILE" ]] || fail "缺少配置：$ENV_FILE。先执行：bash $DEPLOY_DIR/deploy.sh init"
ENV_FILE="$(cd -- "$(dirname -- "$ENV_FILE")" && pwd)/$(basename -- "$ENV_FILE")"
command -v docker >/dev/null || fail '请先安装 Docker Engine 和 Docker Compose v2'
docker compose version >/dev/null || fail '需要 Docker Compose v2'
docker info >/dev/null 2>&1 || fail 'Docker 未运行或当前用户无访问权限'
export CLOUD_ENV_FILE="$ENV_FILE"
export CLOUD_SECRET_DIR="$(dirname -- "$ENV_FILE")/secrets"
[[ -d "$CLOUD_SECRET_DIR" ]] || fail "缺少 secrets 目录，请复制 init 生成的配置目录"
export CLOUD_IMAGE="${CLOUD_IMAGE:-picoddy-cloud:production}"
COMPOSE=(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$DEPLOY_DIR/compose.yaml" -f "$DEPLOY_DIR/compose.sandbox.yaml")
# Never source dotenv as shell code, or print rendered config containing credentials.
"${COMPOSE[@]}" config --quiet
case "$COMMAND" in
  status) "${COMPOSE[@]}" ps --all; exit 0;;
  logs) "${COMPOSE[@]}" logs --tail 100 -f api worker scheduler opensandbox-server; exit 0;;
  stop) "${COMPOSE[@]}" stop scheduler worker api; exit 0;;
esac
if [[ "$COMMAND" == deploy ]]; then
  if grep -Eq '^[A-Z_]+=[^#]*(CHANGE_ME|GENERATE_ON_INIT)' "$ENV_FILE"; then
    fail "请先填写 $ENV_FILE 中的占位配置，再执行部署。"
  fi
  printf '构建云端前端和服务端镜像…\n'
  "${COMPOSE[@]}" build api
fi
"${COMPOSE[@]}" run --rm --no-deps -T api node --import tsx scripts/deploy-preflight.mjs
[[ "$COMMAND" != check ]] || exit 0
# Refuse to interrupt live work when redeploying an existing stack.
if [[ -n "$("${COMPOSE[@]}" ps --status running -q api)" ]]; then
  "${COMPOSE[@]}" exec -T api node --import tsx --input-type=module -e '
    import { pool } from "./src/infra/db.ts";
    try {
      const r = await pool.query("SELECT count(*)::int AS count FROM runs WHERE status = ANY($1)", [["queued","provisioning","running","waiting_approval","cancelling","cleanup_pending"]]);
      if (r.rows[0].count) { console.error("存在未结束任务，稍后再部署。"); process.exitCode = 1; }
    } finally { await pool.end(); }
  '
fi
printf '构建任务沙箱镜像并启动 OpenSandbox…\n'
"${COMPOSE[@]}" --profile build build sandbox-image
"${COMPOSE[@]}" up -d --wait --wait-timeout 180 opensandbox-server
"${COMPOSE[@]}" run --rm --no-deps -T api node --import tsx scripts/deploy-sandbox-smoke.mjs
printf '启动数据库并校验安装结构（不清空、不自动迁移）…\n'
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 postgres
"${COMPOSE[@]}" run --rm --no-deps -T initialize
"${COMPOSE[@]}" run --rm --no-deps -T storage-init
printf '启动 API、Worker、Scheduler…\n'
"${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 180 api worker scheduler
"${COMPOSE[@]}" exec -T api node --input-type=module -e '
  for (const path of ["/api/health", "/api/ready", "/"]) {
    const response = await fetch("http://127.0.0.1:8080" + path, {signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error("Readiness check failed: " + path + " HTTP " + response.status);
    console.log("OK " + path);
  }
'
"${COMPOSE[@]}" ps
printf '\n业务服务已启动。请通过 PUBLIC_ORIGIN 配置的地址访问，并通过企业登录验证任务。\n'
printf 'OpenSandbox、模型和企业连接器须进行一次真实任务验收。配置与数据卷请独立备份。\n'
