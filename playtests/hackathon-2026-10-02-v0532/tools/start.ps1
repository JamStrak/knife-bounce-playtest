$ErrorActionPreference = 'Stop'
try {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw '未找到 Node.js。请安装 Node.js 22 或更新版本后，再双击启动。' }
    $launchResult = & $nodeCommand.Source (Join-Path $PSScriptRoot 'launch.mjs') 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($launchResult -join "`n") }
    $gameUrl = ($launchResult | Select-Object -Last 1).ToString().Trim()
    if ($gameUrl -notmatch '^http://localhost:\d+$') { throw '没有获得有效的游戏地址，请检查启动文件是否完整。' }
    Start-Process $gameUrl
} catch {
    $popup = New-Object -ComObject WScript.Shell
    $popup.Popup(('飞刀弹弹乐启动失败：' + "`n" + $_.Exception.Message), 0, '飞刀弹弹乐', 16) | Out-Null
}
