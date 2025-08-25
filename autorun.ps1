param(
    [switch]$UseProxy,
    [string]$ProxyHost = "127.0.0.1:7890",
    [switch]$SkipConfirm
)
$ErrorActionPreference = "Stop"

# 自动提权 & 切回脚本目录
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "当前非管理员权限，正在尝试以管理员身份重新启动..." -ForegroundColor Yellow
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
    $params = $MyInvocation.UnboundArguments
    foreach ($p in $params) { $arguments += " `"$p`"" }
    Start-Process powershell -ArgumentList $arguments -Verb RunAs
    exit
}

Set-Location -LiteralPath $PSScriptRoot

# ---------- 代理 ----------
function Use-ProxyIfNeeded {
    param([scriptblock]$Script)
    if ($UseProxy) {
        $oldHttp  = [Environment]::GetEnvironmentVariable("HTTP_PROXY")
        $oldHttps = [Environment]::GetEnvironmentVariable("HTTPS_PROXY")
        [Environment]::SetEnvironmentVariable("HTTP_PROXY",  "http://$ProxyHost", "Process")
        [Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://$ProxyHost", "Process")
        try { & $Script } finally {
            [Environment]::SetEnvironmentVariable("HTTP_PROXY",  $oldHttp,  "Process")
            [Environment]::SetEnvironmentVariable("HTTPS_PROXY", $oldHttps, "Process")
        }
    } else { & $Script }
}
function Test-Cmd { param($cmd); $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }
function Invoke-WebRequestWithProxy([string]$Url, [string]$OutFile) {
    if ($UseProxy) { Invoke-WebRequest $Url -OutFile $OutFile -Proxy "http://$ProxyHost" }
    else           { Invoke-WebRequest $Url -OutFile $OutFile }
}

# ---------- 用户确认 ----------
if (-not $SkipConfirm) {
    Write-Host "警告：此脚本仅适用于 Windows 10/11 64 位" -ForegroundColor Green
    Write-Host "建议使用 Windows Terminal 终端管理员方式运行" -ForegroundColor Green
    Write-Host "如果 nvm、git、python 安装失败，建议手动安装" -ForegroundColor Green
    Write-Host "下载失败可指定旁路由代理：.\drpys-final.ps1 -UseProxy -ProxyHost `"192.168.1.21:7890`"" -ForegroundColor Green
    Write-Host "如果旁路由也下载失败那就换成道长那个白嫖地址" -ForegroundColor Green
    $confirm = Read-Host "您是否理解并同意继续？(y/n) 默认(y)"
    if ($confirm -eq "n") { exit 1 }
}

# ---------- 安装 Node / nvm / git / python ----------
Use-ProxyIfNeeded -Script {
    $needNode = $false
    if (Test-Cmd "node") {
        $nodeVer = (node -v) -replace '^v','' -split '\.' | ForEach-Object { [int]$_ }
        if ($nodeVer[0] -ge 20) {
            Write-Host "已检测到 Node v$($nodeVer -join '.') ≥20，跳过安装" -ForegroundColor Green
        } else {
            Write-Host "Node 版本低于 20，将使用 nvm 安装/切换到 20" -ForegroundColor Yellow
            $needNode = $true
        }
    } else {
        Write-Host "未检测到 Node，准备安装" -ForegroundColor Yellow
        $needNode = $true
    }

    if (-not (Test-Cmd "nvm")) {
        Write-Host "正在安装 nvm-windows..." -ForegroundColor Green
        $nvmSetup = "$env:TEMP\nvm-setup.exe"
        Invoke-WebRequestWithProxy "https://github.com/coreybutler/nvm-windows/releases/latest/download/nvm-setup.exe" $nvmSetup
        Start-Process -Wait -FilePath $nvmSetup -ArgumentList "/silent"
        Remove-Item $nvmSetup
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } else {
        Write-Host "已检测到 nvm，跳过安装" -ForegroundColor Green
    }

    if ($needNode) {
        nvm install 20
        nvm use 20
    }

    $tools = @{
        yarn   = { npm install -g yarn }
        pm2    = { npm install -g pm2 }
        git    = { winget install --id Git.Git -e --source winget }
        python = { winget install --id Python.Python.3 -e --source winget }
    }
    foreach ($kv in $tools.GetEnumerator()) {
        $cmd = $kv.Key
        if (-not (Test-Cmd $cmd)) {
            Write-Host "正在安装 $cmd ..." -ForegroundColor Yellow
            & $kv.Value
        } else {
            Write-Host "已检测到 $cmd，跳过安装" -ForegroundColor Green
        }
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# ---------- 工作目录 ----------
$repoDir = Read-Host "请输入项目存放目录（留空则使用当前目录）"
if ([string]::IsNullOrWhiteSpace($repoDir)) { $repoDir = (Get-Location).Path }
$projectPath = Join-Path $repoDir "drpy-node"
$remoteRepo  = "https://github.com/hjdhnx/drpy-node.git"

# ---------- 首次克隆 / 配置 ----------
Use-ProxyIfNeeded -Script {
    if (-not (Test-Path $projectPath)) {
        Write-Host "正在克隆仓库..." -ForegroundColor Yellow
        if ($UseProxy) {
            git -c http.proxy="http://$ProxyHost" clone $remoteRepo $projectPath
        } else {
            git clone $remoteRepo $projectPath
        }
    }
    Set-Location $projectPath

    $configJson = "config\env.json"
    if (-not (Test-Path $configJson)) {
        @{
            ali_token = ""; ali_refresh_token = ""; quark_cookie = ""
            uc_cookie = ""; bili_cookie = ""; thread = "10"
            enable_dr2 = "1"; enable_py = "2"
        } | ConvertTo-Json | Set-Content $configJson -Encoding UTF8
    }

    $envFile = ".env"
    if (-not (Test-Path $envFile)) {
        Copy-Item ".env.development" $envFile
        $cookieAuth = Read-Host "网盘入库密码（默认 drpys）"
        $apiUser    = Read-Host "登录用户名（默认 admin）"
        $apiPass    = Read-Host "登录密码（默认 drpys）"
        $apiPwd     = Read-Host "订阅PWD值（默认 dzyyds）"
        (Get-Content $envFile) `
            -replace 'COOKIE_AUTH_CODE = .*', "COOKIE_AUTH_CODE = $(if([string]::IsNullOrWhiteSpace($cookieAuth)){'drpys'}else{$cookieAuth})" `
            -replace 'API_AUTH_NAME = .*',    "API_AUTH_NAME = $(if([string]::IsNullOrWhiteSpace($apiUser)){'admin'}else{$apiUser})" `
            -replace 'API_AUTH_CODE = .*',    "API_AUTH_CODE = $(if([string]::IsNullOrWhiteSpace($apiPass)){'drpys'}else{$apiPass})" `
            -replace 'API_PWD = .*',          "API_PWD = $(if([string]::IsNullOrWhiteSpace($apiPwd)){'dzyyds'}else{$apiPwd})" |
            Set-Content $envFile -Encoding UTF8
    }

    if (-not (Test-Path "node_modules")) {
        Write-Host "首次安装 Node 依赖..." -ForegroundColor Yellow
        yarn config set registry https://registry.npmmirror.com/
        yarn
    }
    if (-not (Test-Path ".venv\pyvenv.cfg")) {
        Write-Host "首次创建 Python 虚拟环境..." -ForegroundColor Yellow
        python -m venv .venv
    }
    & .\.venv\Scripts\Activate.ps1
    if ((git diff HEAD^ HEAD --name-only 2>$null) -match "requirements.txt") {
        Write-Host "检测到 requirements.txt 变动，更新 Python 依赖..." -ForegroundColor Yellow
        pip install -r spider\py\base\requirements.txt -i https://mirrors.cloud.tencent.com/pypi/simple
    }

    if (-not (pm2 list | Select-String "drpyS.*online")) {
        Write-Host "首次启动 PM2 进程..." -ForegroundColor Yellow
        pm2 start index.js --name drpyS --update-env
        pm2 save
    } else {
        Write-Host "PM2 进程 drpyS 已在运行，跳过启动" -ForegroundColor Green
    }
}

# ---------- 任务计划 ----------
$taskStartup = "drpyS_PM2_Startup"
$taskUpdate  = "drpyS_Update"

# 获取绝对路径
$pm2     = (Get-Command pm2.cmd  -ErrorAction SilentlyContinue).Source
$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source

if (-not $pm2 -or -not $nodeExe) {
    Write-Warning "找不到 pm2.cmd 或 node.exe，跳过计划任务注册"
} else {
    # 删除旧任务
    $taskStartup,$taskUpdate | ForEach-Object {
        if (Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $_ -Confirm:$false
        }
    }

    $commonSettings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    # 1) 开机自启（直接启动 drpyS，不依赖 dump）
    $action  = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"& { Set-Location '$projectPath'; & '$nodeExe' '$projectPath\index.js' | & '$pm2' start '$projectPath\index.js' --name drpyS --update-env }`"" `
        -WorkingDirectory $projectPath
    $trigger = New-ScheduledTaskTrigger -AtStartup -RandomDelay (New-TimeSpan -Seconds 30)
    Register-ScheduledTask -TaskName $taskStartup `
        -Action $action -Trigger $trigger -Settings $commonSettings `
        -User "SYSTEM" -RunLevel Highest -Force | Out-Null
    Write-Host "已创建/更新开机自启任务：$taskStartup" -ForegroundColor Yellow

    # 2) 每 24 h 更新
    $action  = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"& { Set-Location '$projectPath'; git fetch origin; if (git status -uno | Select-String 'Your branch is behind') { git reset --hard origin/main; yarn --prod --silent; if (git diff HEAD^ HEAD --name-only | Select-String 'spider/py/base/requirements.txt') { python -m venv .venv; & .\.venv\Scripts\Activate.ps1; pip install -r spider\py\base\requirements.txt -q } & '$pm2' restart drpyS } }`"" `
        -WorkingDirectory $projectPath
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 24)
    Register-ScheduledTask -TaskName $taskUpdate `
        -Action $action -Trigger $trigger -Settings $commonSettings `
        -User "SYSTEM" -RunLevel Highest -Force | Out-Null
    Write-Host "已创建/更新每 24 小时更新任务：$taskUpdate" -ForegroundColor Yellow
}

# ---------- 完成 ----------
$ip     = (ipconfig | Select-String "IPv4 地址" | Select-Object -First 1).ToString().Split(":")[-1].Trim()
$public = (Invoke-RestMethod "https://ipinfo.io/ip")
Write-Host "内网地址：http://${ip}:5757" -ForegroundColor Yellow
Write-Host "公网地址：http://${public}:5757" -ForegroundColor Yellow
Write-Host "脚本执行完成！重启后 drpyS 自动启动并每 24 小时检查更新。" -ForegroundColor Yellow
Write-Host "脚本只需要执行一次，无需重复执行。" -ForegroundColor Yellow
Write-Host "按任意键退出！！！" -ForegroundColor Yellow
Read-Host
