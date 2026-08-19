# Nameplate print agent for TM-07 bench (Windows). No BarTender required.
# Listens on http://127.0.0.1:18778
#
# POST /print  { printer, format?, pdfBase64?, tsplBase64? }

param(
    [int]$Port = 18778,
    [string]$GeneratedRoot = "",
    [string]$SumatraPath = "",
    [string]$AgentToken = ""
)

$ErrorActionPreference = "Stop"

# Token: param > env TM07_PRINT_AGENT_TOKEN. Empty = auth disabled (legacy).
if (-not $AgentToken) {
    $AgentToken = [string]$env:TM07_PRINT_AGENT_TOKEN
}
$AgentToken = $AgentToken.Trim()

function Write-JsonResponse {
    param([System.Net.HttpListenerResponse]$Response, [int]$StatusCode, [object]$Body)
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.StatusCode = $StatusCode
    $Response.ContentType = "application/json; charset=utf-8"
    $Response.Headers.Add("Access-Control-Allow-Origin", "*")
    $Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, X-TM07-Print-Token")
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.OutputStream.Close()
}

function Read-JsonBody {
    param([System.Net.HttpListenerRequest]$Request)
    $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
    $raw = $reader.ReadToEnd()
    if (-not $raw) { return @{} }
    return ($raw | ConvertFrom-Json)
}

function Resolve-SumatraPath {
    param([string]$Explicit)
    if ($Explicit -and (Test-Path -LiteralPath $Explicit)) {
        return (Resolve-Path -LiteralPath $Explicit).Path
    }
    foreach ($c in @(
        "${env:ProgramFiles}\SumatraPDF\SumatraPDF.exe",
        "${env:ProgramFiles(x86)}\SumatraPDF\SumatraPDF.exe",
        "${env:LocalAppData}\SumatraPDF\SumatraPDF.exe",
        (Join-Path $PSScriptRoot "SumatraPDF.exe")
    )) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            return (Resolve-Path -LiteralPath $c).Path
        }
    }
    return $null
}

function Resolve-PrinterInfo {
    param([string]$RequestedName)
    $printers = @(Get-Printer -ErrorAction SilentlyContinue)
    if (-not $printers.Count) {
        throw "No printers found in Windows"
    }
    if ($RequestedName) {
        $exact = $printers | Where-Object { $_.Name -eq $RequestedName } | Select-Object -First 1
        if ($exact) { return $exact }
        $partial = $printers | Where-Object { $_.Name -like "*$RequestedName*" } | Select-Object -First 1
        if ($partial) { return $partial }
    }
    $tsc = $printers | Where-Object { $_.Name -like "*TSC*" } | Select-Object -First 1
    if ($tsc) { return $tsc }
    return $printers[0]
}

function Resolve-GeneratedPath {
    param(
        [string]$Filename,
        [string]$Serial,
        [string]$Kind,
        [string]$Root,
        [string]$Extension
    )
    if ($Filename) {
        $safe = [System.IO.Path]::GetFileName($Filename)
        if ($safe -match "\.$([regex]::Escape($Extension))$") {
            $candidate = Join-Path $Root $safe
            if (Test-Path -LiteralPath $candidate) {
                return (Resolve-Path -LiteralPath $candidate).Path
            }
        }
    }
    if ($Serial -match '^\d{10}$') {
        if (-not $Kind) { $Kind = "corrector" }
        $Kind = $Kind.ToLower()
        if ($Kind -ne "corrector" -and $Kind -ne "complex") { $Kind = "corrector" }
        $auto = Join-Path $Root ($Serial + "-" + $Kind + "." + $Extension)
        if (Test-Path -LiteralPath $auto) {
            return (Resolve-Path -LiteralPath $auto).Path
        }
    }
    return $null
}

function Ensure-RawPrinterType {
    if ("RawPrinterHelper" -as [type]) { return }
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DOCINFO_1 {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, ref DOCINFO_1 di);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
    public static void SendBytesToPrinter(string printerName, byte[] bytes) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "OpenPrinter failed for '" + printerName + "'");
        try {
            DOCINFO_1 di = new DOCINFO_1();
            di.pDocName = "TM07 Nameplate";
            di.pDataType = "RAW";
            if (!StartDocPrinter(hPrinter, 1, ref di))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "StartDocPrinter failed");
            try {
                if (!StartPagePrinter(hPrinter))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "StartPagePrinter failed");
                int written;
                if (!WritePrinter(hPrinter, bytes, bytes.Length, out written))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "WritePrinter failed");
                EndPagePrinter(hPrinter);
            } finally {
                EndDocPrinter(hPrinter);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
    }
}
"@
}

function Invoke-PrintTsplPort {
    param(
        [byte[]]$Bytes,
        [string]$PortName
    )
    if (-not $PortName) {
        throw "Printer port not found"
    }
    $device = if ($PortName -match '^\\\\') { $PortName } else { "\\.\$PortName" }
    $stream = [System.IO.File]::Open($device, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write)
    try {
        $stream.Write($Bytes, 0, $Bytes.Length)
        $stream.Flush()
    }
    finally {
        $stream.Close()
    }
    return @{ method = "tspl-port"; port = $device; bytes = $Bytes.Length }
}

function Invoke-PrintTspl {
    param(
        [byte[]]$Bytes,
        [string]$PrinterName
    )
    $info = Resolve-PrinterInfo -RequestedName $PrinterName
    $errors = @()

    if ($info.PortName -and $info.PortName -notmatch '^(PORTPROMPT|nul:)' ) {
        try {
            return Invoke-PrintTsplPort -Bytes $Bytes -PortName $info.PortName
        }
        catch {
            $errors += "port $($info.PortName): $($_.Exception.Message)"
        }
    }

    try {
        Ensure-RawPrinterType
        [RawPrinterHelper]::SendBytesToPrinter($info.Name, $Bytes) | Out-Null
        return @{ method = "raw-spooler"; printer = $info.Name; bytes = $Bytes.Length }
    }
    catch {
        $errors += "spooler $($info.Name): $($_.Exception.Message)"
    }

    throw ("TSPL print failed. " + ($errors -join "; "))
}

function Invoke-PrintPdf {
    param(
        [string]$Path,
        [string]$PrinterName,
        [string]$Sumatra
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "File not found: $Path"
    }
    $info = Resolve-PrinterInfo -RequestedName $PrinterName
    $printer = $info.Name

    if ($Sumatra) {
        $args = @("-print-to", $printer, "-silent", $Path)
        $p = Start-Process -FilePath $Sumatra -ArgumentList $args -PassThru -Wait -WindowStyle Hidden
        if ($p.ExitCode -ne 0) {
            throw "SumatraPDF exit code $($p.ExitCode)"
        }
        return @{ method = "sumatra"; printer = $printer; exitCode = $p.ExitCode }
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Path
    $psi.Verb = "PrintTo"
    $psi.Arguments = "`"$printer`""
    $psi.UseShellExecute = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $proc = [System.Diagnostics.Process]::Start($psi)
    if (-not $proc) {
        throw "PrintTo failed. Install SumatraPDF for silent PDF printing."
    }
    return @{ method = "shell-printto"; printer = $printer }
}

if (-not $GeneratedRoot) {
    $local = Join-Path $PSScriptRoot "..\..\data\nameplate-generated"
    if (Test-Path -LiteralPath $local) {
        $GeneratedRoot = (Resolve-Path -LiteralPath $local).Path
    }
    else {
        $GeneratedRoot = "C:\tm07-agent\generated"
        New-Item -ItemType Directory -Force -Path $GeneratedRoot | Out-Null
    }
}

$sumatra = Resolve-SumatraPath -Explicit $SumatraPath
$resolvedPrinter = Resolve-PrinterInfo -RequestedName "TSC TE200"

try {
    $existing = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($existing -and $existing.ok) {
        Write-Host "Agent already running on http://127.0.0.1:$Port/"
        Write-Host ("version=" + $existing.version + " printer=" + $existing.printer + " port=" + $existing.port)
        Write-Host "To restart: run restart-print-agent.cmd"
        exit 0
    }
}
catch {
    # not running yet
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try {
    $listener.Start()
}
catch {
    Write-Host "ERROR: port $Port is busy. Another agent instance is already active."
    Write-Host "Check: http://127.0.0.1:$Port/health"
    Write-Host "Restart: run restart-print-agent.cmd (from scripts\windows)"
    exit 1
}

Write-Host "TM-07 nameplate print agent v3: http://127.0.0.1:$Port/"
Write-Host "Printer: $($resolvedPrinter.Name) port $($resolvedPrinter.PortName)"
Write-Host "Generated: $GeneratedRoot"
Write-Host "SumatraPDF: $(if ($sumatra) { $sumatra } else { 'not installed' })"

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
            $pi = Resolve-PrinterInfo -RequestedName "TSC TE200"
            Write-JsonResponse -Response $response -StatusCode 200 -Body @{
                ok = $true
                agent = "tm07-nameplate-print"
                version = 4
                generatedRoot = $GeneratedRoot
                sumatra = $sumatra
                printer = $pi.Name
                port = $pi.PortName
                bartenderRequired = $false
                authRequired = [bool]$AgentToken
                supports = @("tspl", "pdf", "png")
            }
            continue
        }

        if ($path -ne "/print" -or $request.HttpMethod -ne "POST") {
            Write-JsonResponse -Response $response -StatusCode 404 -Body @{
                ok = $false
                error = "Use GET /health or POST /print"
            }
            continue
        }

        $payload = Read-JsonBody -Request $request

        if ($AgentToken) {
            $hdrTok = [string]$request.Headers["X-TM07-Print-Token"]
            $bodyTok = [string]$payload.token
            $got = if ($hdrTok) { $hdrTok.Trim() } else { $bodyTok.Trim() }
            if (-not $got -or $got -ne $AgentToken) {
                Write-JsonResponse -Response $response -StatusCode 401 -Body @{
                    ok = $false
                    error = "Unauthorized: set X-TM07-Print-Token or body.token"
                }
                continue
            }
        }

        $printer = [string]$payload.printer
        if (-not $printer) { $printer = "TSC TE200" }
        $format = ([string]$payload.format).ToLower()
        if (-not $format) { $format = "tspl" }

        $tempFile = $null
        $result = $null
        $printedFile = $null

        if ($format -eq "tspl") {
            $bytes = $null
            if ($payload.tsplBase64) {
                $bytes = [Convert]::FromBase64String([string]$payload.tsplBase64)
            }
            else {
                $tsplPath = Resolve-GeneratedPath `
                    -Filename ([string]$payload.filename) `
                    -Serial ([string]$payload.serial) `
                    -Kind ([string]$payload.kind) `
                    -Root $GeneratedRoot `
                    -Extension "tspl"
                if ($tsplPath) {
                    $bytes = [System.IO.File]::ReadAllBytes($tsplPath)
                    $printedFile = $tsplPath
                }
            }
            if (-not $bytes) {
                throw "TSPL not found. Send tsplBase64 from browser."
            }
            # Allowlist SIZE for nameplate (58x20 mm) or close variants; reject HOME/CLS spam.
            $ascii = [System.Text.Encoding]::ASCII.GetString($bytes)
            if ($ascii -match '(?i)\bHOME\b') {
                throw "TSPL rejected: HOME command not allowed"
            }
            if ($ascii -notmatch '(?i)SIZE\s*58(\.0+)?\s*(mm)?\s*,\s*20(\.0+)?') {
                throw "TSPL rejected: SIZE must be 58 mm x 20 mm (nameplate)"
            }
            $result = Invoke-PrintTspl -Bytes $bytes -PrinterName $printer
        }
        else {
            $pdfPath = $null
            if ($payload.pdfBase64) {
                $bytes = [Convert]::FromBase64String([string]$payload.pdfBase64)
                $name = [System.IO.Path]::GetFileName([string]$payload.filename)
                if (-not $name -or $name -notmatch '\.pdf$') {
                    $name = "nameplate-" + [guid]::NewGuid().ToString() + ".pdf"
                }
                $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) ("tm07-" + $name)
                [System.IO.File]::WriteAllBytes($tempFile, $bytes)
                $pdfPath = $tempFile
            }
            else {
                $pdfPath = Resolve-GeneratedPath `
                    -Filename ([string]$payload.filename) `
                    -Serial ([string]$payload.serial) `
                    -Kind ([string]$payload.kind) `
                    -Root $GeneratedRoot `
                    -Extension "pdf"
            }
            if (-not $pdfPath) {
                throw "PDF not found. Send pdfBase64 from browser."
            }
            $printedFile = $pdfPath
            $result = Invoke-PrintPdf -Path $pdfPath -PrinterName $printer -Sumatra $sumatra
        }

        Write-JsonResponse -Response $response -StatusCode 200 -Body @{
            ok = $true
            printed = $true
            format = $format
            printer = $printer
            file = $printedFile
            serial = [string]$payload.serial
            result = $result
        }

        if ($tempFile -and (Test-Path -LiteralPath $tempFile)) {
            Start-Sleep -Milliseconds 300
            Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        }
    }
    catch {
        Write-JsonResponse -Response $response -StatusCode 500 -Body @{
            ok = $false
            error = $_.Exception.Message
        }
    }
}
