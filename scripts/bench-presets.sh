#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
GP="${GLTFPACK_BIN:-$DIR/../src-tauri/binaries/gltfpack-x86_64-pc-windows-msvc.exe}"
# 用法：bash bench-presets.sh <模型1.glb> [模型2.glb ...]
# 不传参数时提示——测试模型路径不入库（避免内部信息进仓库）
MODELS=("$@")
if [ ${#MODELS[@]} -eq 0 ]; then
  echo "用法: bash bench-presets.sh <模型.glb> [更多模型...]" >&2
  exit 1
fi
for M in "${MODELS[@]}"; do
  [ -f "$M" ] || continue
  N=$(basename "$M")
  ORIG=$(stat -c%s "$M")
  echo "=== $N (原始 $((ORIG/1024)) KB) ==="
  while IFS='|' read -r K ARGS; do
    OUT="$DIR/${N%.glb}-${K}.glb"
    T0=$(date +%s%N)
    "$GP" -i "$M" -o "$OUT" $ARGS 2>/dev/null
    T1=$(date +%s%N)
    if [ -f "$OUT" ]; then
      S=$(stat -c%s "$OUT")
      MS=$(( (T1-T0)/1000000 ))
      awk -v k="$K" -v s="$S" -v o="$ORIG" -v ms="$MS" 'BEGIN{printf "  %-4s %8d KB  省 %5.1f%%  %dms\n", k, int(s/1024), (1-s/o)*100, ms}'
    else
      echo "  $K  失败"
    fi
  done <<'EOF'
保守|-cc -vp 16 -vt 14 -vn 10 -vc 8 -kn
均衡|-cc -vp 14 -vt 12 -vn 8 -vc 8 -kn -mm
激进|-cz -vp 12 -vt 10 -vn 6 -vc 6 -kn -mm -si 0.5 -sa -slb
EOF
done
