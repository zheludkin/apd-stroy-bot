# Регистрирует почасовую задачу в Планировщике заданий Windows, которая
# запускает local_publish_relay.js — временный обход сетевой проблемы на
# Timeweb (см. local_publish_relay.js для контекста).
$taskName = "APD-Stroy-LocalPublishRelay"
$nodePath = (Get-Command node).Source
$scriptPath = Join-Path $PSScriptRoot "local_publish_relay.js"
$workDir = $PSScriptRoot

$action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$scriptPath`"" -WorkingDirectory $workDir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "APD Stroy: hourly Instagram publish relay via local machine while Timeweb network to graph.instagram.com is broken" -Force

Write-Host "Task '$taskName' registered - runs hourly."
