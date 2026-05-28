@echo off
:: 解决 UNC 路径不受 CMD 支持的问题
pushd %~dp0
echo 正在启动渐进执行...
wsl.exe -d Ubuntu -- bash -c "cd /home/cntoz/incremental-life && npm run dev"
popd
pause
