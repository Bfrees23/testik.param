# BarTender print agent for TM-07 bench (Windows).
# Fills .btw templates and sends to printer via BarTender COM Automation.
# Requires BarTender Automation edition (2016+).
#
# Endpoints:
#   GET  /health
#   GET  /list-fields?template=corrector-300.btw
#   POST /generate-btw  — fill template, save .btw, return base64
#   POST /print         — fill template, optional save copy, print to printer
#   POST /print-filled  — alias for /print

param(
    [int]$Port = 18777,
    [string]$TemplateRoot = ""
)

$ErrorActionPreference = "Stop"

function Write-JsonResponse {
    param([System.Net.HttpListenerResponse]$Response, [int]$StatusCode, [object]$Body)
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.StatusCode = $StatusCode
    $Response.ContentType = "application/json; charset=utf-8"
    $Response.Headers.Add("Access-Control-Allow-Origin", "*")
    $Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.OutputStream.Close()
}

function Get-GeneratedRoot {
    return Join-Path (Split-Path $TemplateRoot -Parent) "nameplate-generated"
}

function Resolve-TemplatePath {
    param([string]$TemplatePath, [string]$TemplateName, [string]$Root)
    if ($TemplatePath -and (Test-Path -LiteralPath $TemplatePath)) {
        return (Resolve-Path -LiteralPath $TemplatePath).Path
    }
    if ($TemplateName -and $Root) {
        $candidate = Join-Path $Root $TemplateName
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    if ($TemplateName) {
        $local = Join-Path $PSScriptRoot "..\..\data\nameplate-templates\$TemplateName"
        if (Test-Path -LiteralPath $local) {
            return (Resolve-Path -LiteralPath $local).Path
        }
    }
    throw "Template not found: $TemplateName"
}

function Read-JsonBody {
    param([System.Net.HttpListenerRequest]$Request)
    $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
    $raw = $reader.ReadToEnd()
    if (-not $raw) {
        return @{}
    }
    return ($raw | ConvertFrom-Json)
}

function ConvertTo-FieldMap {
    param($Payload)
    $fields = @{}
    if ($Payload.fields) {
        $Payload.fields.PSObject.Properties | ForEach-Object { $fields[$_.Name] = [string]$_.Value }
    }
    if (-not $fields.Count -and $Payload.serial) {
        $fields["Serial"] = [string]$Payload.serial
    }
    return $fields
}

function Set-BartenderNamedFields {
    param($Format, [hashtable]$Fields)
    $warnings = @()
    foreach ($key in $Fields.Keys) {
        $val = [string]$Fields[$key]
        if ($val -eq "") { continue }
        try {
            $Format.SetNamedSubStringValue([string]$key, $val) | Out-Null
        }
        catch {
            $msg = "Field '$key' not set: $($_.Exception.Message)"
            Write-Warning $msg
            $warnings += $msg
        }
    }
    return $warnings
}

function Test-BartenderComAvailable {
    $bt = $null
    try {
        $bt = New-Object -ComObject BarTender.Application
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($bt) {
            try { $bt.Quit(0) } catch {}
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($bt)
        }
    }
}

function Invoke-BartenderGenerateBtw {
    param(
        [string]$TemplatePath,
        [hashtable]$Fields,
        [string]$OutputFilename
    )

    if (-not $OutputFilename) {
        throw "filename required"
    }

    $generatedRoot = Get-GeneratedRoot
    if (-not (Test-Path -LiteralPath $generatedRoot)) {
        New-Item -ItemType Directory -Path $generatedRoot | Out-Null
    }
    $outPath = Join-Path $generatedRoot $OutputFilename

    $bt = $null
    $fmt = $null
    try {
        $bt = New-Object -ComObject BarTender.Application
        $bt.Visible = $false
        $fmt = $bt.Formats.Open($TemplatePath, $false, "")
        $fieldWarnings = Set-BartenderNamedFields -Format $fmt -Fields $Fields
        $fmt.SaveAs($outPath, $true)
        $bytes = [System.IO.File]::ReadAllBytes($outPath)
        return @{
            method = "com-saveas"
            filename = $OutputFilename
            path = $outPath
            size = $bytes.Length
            dataBase64 = [Convert]::ToBase64String($bytes)
            filled = $true
            fieldWarnings = $fieldWarnings
        }
    }
    finally {
        if ($fmt) {
            try { $fmt.Close($false) } catch {}
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($fmt)
        }
        if ($bt) {
            try { $bt.Quit(0) } catch {}
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($bt)
        }
    }
}

function Invoke-BartenderListFields {
    param([string]$TemplatePath)

    $bt = $null
    $fmt = $null
    try {
        $bt = New-Object -ComObject BarTender.Application
        $bt.Visible = $false
        $fmt = $bt.Formats.Open($TemplatePath, $false, "")
        $raw = [string]$fmt.NamedSubStrings.GetAll("=", "`n")
        $fields = @()
        foreach ($line in ($raw -split "`n")) {
            if ($line -match '^(.+?)=(.*)$') {
                $fields += @{ name = $Matches[1]; value = $Matches[2] }
            }
        }
        return @{ fields = $fields; raw = $raw }
    }
    finally {
        if ($fmt) {
            try { $fmt.Close($false) } catch {}
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($fmt)
        }
        if ($bt) {
            try { $bt.Quit(0) } catch {}
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($bt)
        }
    }
}

function Invoke-BartenderPrintBtxml {
    param(
        [string]$TemplatePath,
        [string]$Btxml
    )

    $resolvedFormat = $TemplatePath
    if ($Btxml -match '<Format>([^<]+)</Format>') {
        $fmt = $Matches[1]
        if ($fmt -and -not (Test-Path -LiteralPath $fmt)) {
            $Btxml = $Btxml.Replace($fmt, $resolvedFormat)
        }
    }
    $tmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "tm07-nameplate-" + [guid]::NewGuid().ToString() + ".btxml")
    [System.IO.File]::WriteAllText($tmp, $Btxml, [System.Text.UTF8Encoding]::new($false))
    try {
        $exe = "${env:ProgramFiles}\Seagull\BarTender Suite\bartend.exe"
        if (-not (Test-Path -LiteralPath $exe)) {
            $exe = "${env:ProgramFiles(x86)}\Seagull\BarTender Suite\bartend.exe"
        }
        if (-not (Test-Path -LiteralPath $exe)) {
            throw "bartend.exe not found. Install BarTender Automation."
        }
        $args = @("/XMLScript=`"$tmp`"", "/X")
        $p = Start-Process -FilePath $exe -ArgumentList $args -PassThru -Wait -WindowStyle Hidden
        if ($p.ExitCode -ne 0) {
            throw "bartend.exe exit code $($p.ExitCode)"
        }
        return @{ method = "btxml"; exitCode = $p.ExitCode; fieldWarnings = @() }
    }
    finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    }
}

function Invoke-BartenderPrint {
    param(
        [string]$TemplatePath,
        [string]$Printer,
        [hashtable]$Fields,
        [string]$Btxml,
        [string]$SaveCopyFilename
    )

    if ($Btxml) {
        return Invoke-BartenderPrintBtxml -TemplatePath $TemplatePath -Btxml $Btxml
    }

    $bt = $null
    $fmt = $null
    $savedCopy = $null
    try {
        $bt = New-Object -ComObject BarTender.Application
        $bt.Visible = $false
        $fmt = $bt.Formats.Open($TemplatePath, $false, "")
        if ($Printer) {
            try { $fmt.PrintSetup.Printer = $Printer } catch {
                Write-Warning "Printer '$Printer' not set: $($_.Exception.Message)"
            }
        }
        $fieldWarnings = Set-BartenderNamedFields -Format $fmt -Fields $Fields

        if ($SaveCopyFilename) {
            $generatedRoot = Get-GeneratedRoot
            if (-not (Test-Path -LiteralPath $generatedRoot)) {
                New-Item -ItemType Directory -Path $generatedRoot | Out-Null
            }
            $outPath = Join-Path $generatedRoot $SaveCopyFilename
            $fmt.SaveAs($outPath, $true)
            $savedCopy = @{
                filename = $SaveCopyFilename
                path = $outPath
                size = (Get-Item -LiteralPath $outPath).Length
            }
        }

        # WaitForCompletionTimeout: 0 = default; do not show dialog
        $fmt.PrintOut($false, $false)
        return @{
            method = "com-printout"
            printer = $Printer
            template = $TemplatePath
            fieldWarnings = $fieldWarnings
            savedCopy = $savedCopy
        }
    }
    finally {
        if ($fmt) {
            try { $fmt.Close($false) } catch {}
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($fmt)
        }
        if ($bt) {
            try { $bt.Quit(0) } catch {}
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($bt)
        }
    }
}

function Handle-PrintRequest {
    param($Payload)

    $fields = ConvertTo-FieldMap -Payload $Payload
    $templatePath = Resolve-TemplatePath -TemplatePath ([string]$Payload.templatePath) -TemplateName ([string]$Payload.template) -Root $TemplateRoot
    $printer = [string]$Payload.printer
    $btxmlBody = [string]$Payload.btxml

    if ($btxmlBody) {
        if ($Payload.templatePath) {
            $btxmlBody = $btxmlBody.Replace([string]$Payload.templatePath, $templatePath)
        }
        if ($Payload.template) {
            $btxmlBody = $btxmlBody.Replace([string]$Payload.template, $templatePath)
        }
    }

    $filename = [string]$Payload.filename
    if (-not $filename -and $Payload.serial) {
        $kind = [string]$Payload.kind
        if (-not $kind) { $kind = "corrector" }
        $filename = ([string]$Payload.serial) + "-" + $kind + ".btw"
    }

    $saveCopy = $false
    if ($Payload.saveCopy -eq $true -or $Payload.saveCopy -eq "true" -or $Payload.saveCopy -eq 1) {
        $saveCopy = $true
    }

    $result = Invoke-BartenderPrint `
        -TemplatePath $templatePath `
        -Printer $printer `
        -Fields $fields `
        -Btxml $(if ($btxmlBody) { $btxmlBody } else { "" }) `
        -SaveCopyFilename $(if ($saveCopy -and $filename) { $filename } else { "" })

    return @{
        ok = $true
        serial = [string]$Payload.serial
        template = $templatePath
        printer = $printer
        filename = $filename
        filled = $true
        printed = $true
        fieldWarnings = $result.fieldWarnings
        savedCopy = $result.savedCopy
        result = $result
    }
}

if (-not $TemplateRoot) {
    $TemplateRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\data\nameplate-templates")).Path
}

$comOk = Test-BartenderComAvailable

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "TM-07 BarTender agent: http://127.0.0.1:$Port/"
Write-Host "Templates: $TemplateRoot"
Write-Host "BarTender COM: $(if ($comOk) { 'OK' } else { 'NOT AVAILABLE — install BarTender Automation' })"

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    try {
        if ($request.HttpMethod -eq "OPTIONS") {
            Write-JsonResponse -Response $response -StatusCode 204 -Body @{ ok = $true }
            continue
        }

        $path = $request.Url.AbsolutePath.TrimEnd('/')
        if (-not $path) { $path = "/" }

        if ($path -eq "/health") {
            Write-JsonResponse -Response $response -StatusCode 200 -Body @{
                ok = $true
                agent = "tm07-bartender"
                version = 2
                templateRoot = $TemplateRoot
                generatedRoot = (Get-GeneratedRoot)
                bartenderCom = $comOk
            }
            continue
        }

        if ($path -eq "/list-fields" -and $request.HttpMethod -eq "GET") {
            $templateName = $request.QueryString["template"]
            $templatePath = Resolve-TemplatePath -TemplatePath "" -TemplateName ([string]$templateName) -Root $TemplateRoot
            $listed = Invoke-BartenderListFields -TemplatePath $templatePath
            Write-JsonResponse -Response $response -StatusCode 200 -Body @{
                ok = $true
                template = $templatePath
                fields = $listed.fields
                raw = $listed.raw
            }
            continue
        }

        if ($path -eq "/generate-btw" -and $request.HttpMethod -eq "POST") {
            $payload = Read-JsonBody -Request $request
            $fields = ConvertTo-FieldMap -Payload $payload
            $templatePath = Resolve-TemplatePath -TemplatePath ([string]$payload.templatePath) -TemplateName ([string]$payload.template) -Root $TemplateRoot
            $filename = [string]$payload.filename
            if (-not $filename) {
                $kind = [string]$payload.kind
                if (-not $kind) { $kind = "corrector" }
                $filename = ([string]$payload.serial) + "-" + $kind + ".btw"
            }
            $result = Invoke-BartenderGenerateBtw -TemplatePath $templatePath -Fields $fields -OutputFilename $filename

            Write-JsonResponse -Response $response -StatusCode 200 -Body @{
                ok = $true
                serial = [string]$payload.serial
                template = $templatePath
                filename = $result.filename
                size = $result.size
                filled = $true
                dataBase64 = $result.dataBase64
                fieldWarnings = $result.fieldWarnings
                result = $result
            }
            continue
        }

        if (($path -eq "/print" -or $path -eq "/print-filled") -and $request.HttpMethod -eq "POST") {
            if (-not $comOk) {
                throw "BarTender COM unavailable. Install BarTender Automation and restart the agent."
            }
            $payload = Read-JsonBody -Request $request
            if ($payload.saveCopy -eq $null) {
                $payload | Add-Member -NotePropertyName saveCopy -NotePropertyValue $true -Force
            }
            $body = Handle-PrintRequest -Payload $payload
            Write-JsonResponse -Response $response -StatusCode 200 -Body $body
            continue
        }

        Write-JsonResponse -Response $response -StatusCode 404 -Body @{
            ok = $false
            error = "Unknown route. Use GET /health, POST /print, POST /print-filled, POST /generate-btw"
        }
    }
    catch {
        Write-JsonResponse -Response $response -StatusCode 500 -Body @{
            ok = $false
            error = $_.Exception.Message
        }
    }
}
