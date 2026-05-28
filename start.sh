#!/bin/bash
cd "$(dirname "$0")"
echo "正在启动 渐进执行..."
npm run dev &
sleep 3
# 尝试用默认浏览器打开
xdg-open http://localhost:5173 2>/dev/null || open http://localhost:5173 2>/dev/null || echo "请手动打开 http://localhost:5173"
# 保持终端不关闭
echo "服务已启动，按 Ctrl+C 停止。"
wait
