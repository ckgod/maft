#!/usr/bin/env bash
# MAFT — 첫 환경 셋업.
# 시스템 의존성 점검 → Writerside 콘텐츠 확보(없으면 clone) → server/web 의존성 설치.
# 모든 단계가 idempotent 합니다 (이미 충족된 항목은 그냥 통과).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARENT="$(dirname "$ROOT")"

# 환경변수로 override 가능
WRITERSIDE_REPO="${MAFT_WRITERSIDE_REPO:-https://github.com/ckgod/ManifestAndroid.git}"
WRITERSIDE_DIR="${MANIFEST_WRITERSIDE_DIR:-$PARENT/ManifestAndroid}"

# 색깔 출력 (TTY 가 아니면 자동 비활성)
if [ -t 1 ]; then
  C_BLUE=$'\033[1;34m'; C_GREEN=$'\033[1;32m'; C_YELLOW=$'\033[1;33m'
  C_RED=$'\033[1;31m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_DIM=''; C_RESET=''
fi

step() { printf "\n${C_BLUE}▸ %s${C_RESET}\n" "$*"; }
ok()   { printf "  ${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn() { printf "  ${C_YELLOW}△${C_RESET} %s\n" "$*"; }
err()  { printf "  ${C_RED}✗${C_RESET} %s\n" "$*"; }
hint() { printf "    ${C_DIM}%s${C_RESET}\n" "$*"; }

# ────────────────────────────────────────────────────────────
step "1/4  시스템 의존성 확인"

MISSING=0

check_cmd() {
  local cmd=$1 install_hint=$2
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$cmd 발견"
  else
    err "$cmd 가 PATH 에 없습니다"
    hint "$install_hint"
    MISSING=$((MISSING + 1))
  fi
}

check_cmd node   "https://nodejs.org/  또는  brew install node  (20+ 권장)"
check_cmd npm    "Node.js 와 함께 설치됩니다"
check_cmd git    "https://git-scm.com/  또는  brew install git"
check_cmd claude "Claude Code CLI 가 필요합니다 — https://docs.claude.com/claude-code"

if (( MISSING > 0 )); then
  err "누락된 도구 ${MISSING}개. 위 안내를 따른 뒤 다시 실행해 주세요."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if (( NODE_MAJOR < 20 )); then
  err "Node.js 20+ 이 필요합니다 (현재: $(node -v))"
  hint "nvm install 20  또는  brew upgrade node"
  exit 1
fi
ok "node $(node -v) · npm $(npm -v)"

# ────────────────────────────────────────────────────────────
step "2/4  Claude 인증 상태 확인"

if claude --version >/dev/null 2>&1; then
  AUTH_OUTPUT=$(claude auth status 2>&1 || true)
  if echo "$AUTH_OUTPUT" | grep -qi "claude.ai"; then
    ok "claude.ai 구독 자격증명으로 인증되어 있습니다"
  else
    warn "claude.ai OAuth 인증을 확인하지 못했습니다"
    hint "직접 확인:  claude auth status   →   authMethod 가 claude.ai 여야 합니다"
    hint "ANTHROPIC_API_KEY 가 설정되어 있다면 unset 을 권장합니다 (사용량 과금 방지)"
  fi
else
  warn "claude CLI 실행 자체는 가능하지만 버전 확인이 안 됩니다 — 학습 시작 시 실패할 수 있습니다"
fi

# ────────────────────────────────────────────────────────────
step "3/4  ManifestAndroid Writerside 콘텐츠 확보"

if [ -d "$WRITERSIDE_DIR/Writerside" ]; then
  ok "이미 존재합니다: $WRITERSIDE_DIR/Writerside"
elif [ -d "$WRITERSIDE_DIR" ] && [ "$(ls -A "$WRITERSIDE_DIR" 2>/dev/null)" ]; then
  err "$WRITERSIDE_DIR 가 비어있지 않은데 Writerside 하위 디렉토리가 없습니다"
  hint "내용을 확인하시거나, MANIFEST_WRITERSIDE_DIR 로 다른 경로를 지정해 주세요"
  exit 1
else
  printf "  ${C_DIM}clone:${C_RESET} %s\n  ${C_DIM}target:${C_RESET} %s\n" \
    "$WRITERSIDE_REPO" "$WRITERSIDE_DIR"
  if git clone --depth 1 "$WRITERSIDE_REPO" "$WRITERSIDE_DIR" 2>&1 | sed 's/^/    /'; then
    if [ -d "$WRITERSIDE_DIR/Writerside" ]; then
      ok "clone 완료"
    else
      err "clone 은 성공했지만 Writerside 하위 디렉토리를 찾지 못했습니다"
      hint "보관소 구조가 변경되었을 수 있습니다 — 직접 확인해 주세요: $WRITERSIDE_DIR"
      exit 1
    fi
  else
    err "git clone 실패 — 위 출력을 확인해 주세요"
    exit 1
  fi
fi

# ────────────────────────────────────────────────────────────
step "4/4  server / web 의존성 설치"

install_pkg() {
  local label=$1 dir=$2
  if [ ! -f "$dir/package.json" ]; then
    err "$label: package.json 을 찾지 못했습니다 ($dir)"
    return 1
  fi
  printf "  ${C_DIM}npm install in $label …${C_RESET}\n"
  ( cd "$dir" && npm install --no-audit --no-fund 2>&1 | sed 's/^/    /' )
  ok "$label 의존성 설치 완료"
}

install_pkg "server" "$ROOT/server"
install_pkg "web"    "$ROOT/web"

# ────────────────────────────────────────────────────────────
echo
ok "설치 완료"
printf "\n${C_DIM}# 다음 단계${C_RESET}\n"
echo "  ./scripts/dev-up.sh        # 두 dev 서버 백그라운드 시작 + 헬스체크"
echo "  open http://localhost:5173 # 학습 시작"
echo "  ./scripts/dev-down.sh      # 종료"
