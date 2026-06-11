@echo off
echo ========================================
echo   TokenSyber 本地测试服务器
echo   公网游戏不受影响
echo ========================================
echo.
echo   测试模式特性：
echo     - 燃料无限（储液罐自动补满）
echo     - 模型消耗降低（50万~100万 token）
echo     - 注入速率 10 倍（100K/s）
echo     - 无需连接 Claude Code 插件
echo.
echo   访问地址：http://127.0.0.1:8080/?test
echo.
echo   按 Ctrl+C 停止
echo ========================================
echo.

start http://127.0.0.1:8080/?test
python -m http.server 8080 --bind 127.0.0.1
