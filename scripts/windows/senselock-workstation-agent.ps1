# TM-07 Senselock workstation agent (Windows).
# Reads Senselock Elite4 USB key (VID_0471 / PID_485D) and exposes workstation id.
#
# Listens: http://127.0.0.1:18779  (also 0.0.0.0 for Docker proxy)
#   GET /health
#   GET /status
#   GET /status?refresh=1   force USB rescan
#
# Run via start-senselock-agent.cmd (ASCII-only script for Windows PowerShell 5.1).

param(
    [int]$Port = 18779,
    [string]$Vid = "0471",
    [string]$UsbPid = "485D",
    [string]$Sense4Dll = "",
    [string]$UserPin = "12345678"
)

$ErrorActionPreference = "Stop"
$script:AgentVersion = 10
$script:VidNorm = ($Vid -replace '^0x', '').ToUpperInvariant().PadLeft(4, '0')
$script:UsbPidNorm = ($UsbPid -replace '^0x', '').ToUpperInvariant().PadLeft(4, '0')
$script:StatusCache = $null
$script:StatusLocked = $false
$script:LastKeyDumpPrinted = $false
if (-not $Sense4Dll) { $Sense4Dll = [string]$env:TM07_SENSE4_DLL }
if (-not $UserPin) { $UserPin = "12345678" }
if ($env:TM07_SENSE4_USER_PIN) { $UserPin = [string]$env:TM07_SENSE4_USER_PIN }
$script:Sense4DllPath = $Sense4Dll
$script:UserPin = $UserPin

function Stop-ListenersOnPort {
    param([int]$ListenPort)
    $stopped = 0
    try {
        $conns = @(Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue)
        foreach ($c in $conns) {
            $procId = [int]$c.OwningProcess
            if ($procId -le 0 -or $procId -eq $PID) { continue }
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if (-not $proc) { continue }
            # Only stop PowerShell hosts (previous agent), not random services.
            if ($proc.ProcessName -notmatch '^(powershell|pwsh)$') { continue }
            Write-Host ("Stopping previous agent on port $ListenPort (PID $procId, $($proc.ProcessName))...")
            try {
                Stop-Process -Id $procId -Force -ErrorAction Stop
                $stopped += 1
            }
            catch {
                Write-Host ("  warn: " + $_.Exception.Message)
            }
        }
        if ($stopped -gt 0) {
            Start-Sleep -Milliseconds 800
        }
    }
    catch { }
    return $stopped
}

function Test-ExistingAgent {
    param([int]$ListenPort)
    try {
        $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$ListenPort/health")
        $req.Method = "GET"
        $req.Timeout = 1500
        $resp = $req.GetResponse()
        try {
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $body = $reader.ReadToEnd()
            $reader.Close()
            if ($body -match 'tm07-senselock-workstation') {
                return $true
            }
        }
        finally {
            $resp.Close()
        }
    }
    catch { }
    return $false
}

function ConvertTo-JsonBytes {
    param([object]$Body)
    $json = $Body | ConvertTo-Json -Depth 14 -Compress
    return [System.Text.Encoding]::UTF8.GetBytes($json)
}

function Send-HttpJson {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [int]$StatusCode,
        [object]$Body
    )
    $bytes = if ($null -eq $Body -or $StatusCode -eq 204) {
        [byte[]]@()
    } else {
        ConvertTo-JsonBytes -Body $Body
    }
    $reason = switch ($StatusCode) {
        200 { "OK" }
        204 { "No Content" }
        404 { "Not Found" }
        default { "Error" }
    }
    $header = "HTTP/1.1 $StatusCode $reason`r`n" +
        "Content-Type: application/json; charset=utf-8`r`n" +
        "Access-Control-Allow-Origin: *`r`n" +
        "Access-Control-Allow-Methods: GET, HEAD, OPTIONS`r`n" +
        "Access-Control-Allow-Headers: Content-Type, Access-Control-Request-Private-Network`r`n" +
        "Access-Control-Allow-Private-Network: true`r`n" +
        "Cache-Control: no-store`r`n" +
        "Connection: close`r`n" +
        "Content-Length: $($bytes.Length)`r`n`r`n"
    $hdrBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($hdrBytes, 0, $hdrBytes.Length)
    if ($bytes.Length -gt 0) {
        $Stream.Write($bytes, 0, $bytes.Length)
    }
    $Stream.Flush()
}

function Get-Sha8 {
    param([string]$Text)
    if (-not $Text) { return "00000000" }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hash = $sha.ComputeHash($bytes)
        $hex = -join ($hash | ForEach-Object { $_.ToString("X2") })
        return $hex.Substring(0, 8)
    }
    finally {
        $sha.Dispose()
    }
}

function Get-PcIdentity {
    $hostname = $env:COMPUTERNAME
    $guid = ""
    try {
        $guid = [string](Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Cryptography" -Name MachineGuid -ErrorAction Stop).MachineGuid
    }
    catch { }
    return @{
        hostname = $hostname
        machineGuid = $guid
        pcCode = "PC-" + (Get-Sha8 -Text ($guid + "|" + $hostname))
    }
}

function ConvertTo-PlainValue {
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [string] -or $Value -is [bool] -or $Value -is [byte] -or $Value -is [int] -or $Value -is [long] -or $Value -is [uint32] -or $Value -is [uint64] -or $Value -is [double] -or $Value -is [decimal]) {
        return $Value
    }
    if ($Value -is [guid]) { return $Value.ToString() }
    if ($Value -is [datetime]) { return $Value.ToUniversalTime().ToString("o") }
    if ($Value -is [byte[]]) {
        return ($Value | ForEach-Object { $_.ToString("X2") }) -join ""
    }
    if ($Value -is [System.Array]) {
        $arr = @()
        foreach ($item in $Value) { $arr += ,(ConvertTo-PlainValue $item) }
        return $arr
    }
    try { return [string]$Value } catch { return ($Value.GetType().FullName) }
}

function Get-PnpPropertyMap {
    param([string]$InstanceId)
    $map = @{}
    try {
        $props = Get-PnpDeviceProperty -InstanceId $InstanceId -ErrorAction SilentlyContinue
        foreach ($p in @($props)) {
            $key = [string]$p.KeyName
            if (-not $key) { continue }
            $map[$key] = ConvertTo-PlainValue $p.Data
        }
    }
    catch { }
    return $map
}

function Get-UsbRegistryDump {
    $root = "HKLM:\SYSTEM\CurrentControlSet\Enum\USB"
    $vidPid = "VID_$($script:VidNorm)&PID_$($script:UsbPidNorm)"
    $out = @()
    $path = Join-Path $root $vidPid
    if (-not (Test-Path -LiteralPath $path)) {
        return @()
    }
    try {
        Get-ChildItem -LiteralPath $path -ErrorAction SilentlyContinue | ForEach-Object {
            $inst = $_
            $props = @{}
            try {
                $item = Get-ItemProperty -LiteralPath $inst.PSPath -ErrorAction SilentlyContinue
                if ($item) {
                    $item.PSObject.Properties | Where-Object {
                        $_.Name -notmatch '^PS'
                    } | ForEach-Object {
                        $props[$_.Name] = ConvertTo-PlainValue $_.Value
                    }
                }
            }
            catch { }
            $devParams = @{}
            $dpPath = Join-Path $inst.PSPath "Device Parameters"
            if (Test-Path -LiteralPath $dpPath) {
                try {
                    $dp = Get-ItemProperty -LiteralPath $dpPath -ErrorAction SilentlyContinue
                    if ($dp) {
                        $dp.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
                            $devParams[$_.Name] = ConvertTo-PlainValue $_.Value
                        }
                    }
                }
                catch { }
            }
            $out += @{
                instanceKey = $inst.PSChildName
                registryPath = $inst.PSPath
                properties = $props
                deviceParameters = $devParams
            }
        }
    }
    catch { }
    return @($out)
}

function Find-Sense4Artifacts {
    $names = @(
        "Sense4.dll", "sense4.dll",
        "EliteEL.dll", "eliteel.dll",
        "S4.dll", "s4.dll"
    )
    $dirs = @(
        $PSScriptRoot,
        (Join-Path $env:LOCALAPPDATA "TM07\senselock-agent"),
        (Join-Path $env:ProgramFiles "Senselock"),
        (Join-Path $env:ProgramFiles "SenseLock"),
        (Join-Path ${env:ProgramFiles(x86)} "Senselock"),
        (Join-Path ${env:ProgramFiles(x86)} "SenseLock"),
        (Join-Path $env:SystemRoot "System32"),
        (Join-Path $env:SystemRoot "SysWOW64")
    )
    $found = @()
    foreach ($dir in $dirs) {
        if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
        foreach ($n in $names) {
            $p = Join-Path $dir $n
            if (Test-Path -LiteralPath $p) {
                $vi = $null
                try { $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($p) } catch { }
                $found += @{
                    path = $p
                    fileVersion = $(if ($vi) { $vi.FileVersion } else { $null })
                    productVersion = $(if ($vi) { $vi.ProductVersion } else { $null })
                    productName = $(if ($vi) { $vi.ProductName } else { $null })
                }
            }
        }
    }
    # Also search slusb driver presence
    $driver = @()
    try {
        $svc = Get-Service -Name "slusb*" -ErrorAction SilentlyContinue
        foreach ($s in @($svc)) {
            $driver += @{ name = $s.Name; status = [string]$s.Status; startType = [string]$s.StartType }
        }
    }
    catch { }
    if ($script:Sense4DllPath -and (Test-Path -LiteralPath $script:Sense4DllPath)) {
        $found = @(
            @{ path = (Resolve-Path -LiteralPath $script:Sense4DllPath).Path; fileVersion = $null; productVersion = $null; productName = "explicit" }
        ) + $found
    }
    $dlls = @($found | Sort-Object { $_.path } | Group-Object { $_.path } | ForEach-Object { $_.Group[0] })
    return @{
        dlls = $dlls
        drivers = $driver
        note = $(if ($dlls.Count) { "Sense4.dll found - reading chip via Elite4 API" } else { "No Sense4.dll: copy from Elite4 SDK next to agent for FULL chip fields" })
    }
}

function Convert-BytesToHex {
    param([byte[]]$Bytes)
    if (-not $Bytes) { return "" }
    return (($Bytes | ForEach-Object { $_.ToString("X2") }) -join "")
}

function Convert-BytesToAscii {
    param([byte[]]$Bytes)
    if (-not $Bytes) { return "" }
    return -join ($Bytes | ForEach-Object {
        if ($_ -ge 32 -and $_ -le 126) { [char]$_ } else { "." }
    })
}

function Ensure-Sense4NativeType {
    if ("Tm07Sense4Api" -as [type]) { return }
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential, Pack = 1)]
public struct Tm07Sense4Context {
  public uint dwIndex;
  public uint dwVersion;
  public IntPtr hLock;
  [MarshalAs(UnmanagedType.ByValArray, SizeConst = 12)]
  public byte[] reserve;
  [MarshalAs(UnmanagedType.ByValArray, SizeConst = 56)]
  public byte[] bAtr;
  [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)]
  public byte[] bID;
  public uint dwAtrLen;
}

public static class Tm07Sense4Api {
  [DllImport("kernel32", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr LoadLibrary(string path);
  [DllImport("kernel32", SetLastError=true)]
  public static extern bool FreeLibrary(IntPtr h);
  [DllImport("kernel32", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern IntPtr GetProcAddress(IntPtr h, string name);

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  public delegate uint S4EnumFn(IntPtr list, ref uint size);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  public delegate uint S4OpenFn(IntPtr ctx);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  public delegate uint S4CloseFn(IntPtr ctx);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  public delegate uint S4ControlFn(IntPtr ctx, uint code, IntPtr inBuf, uint inLen, IntPtr outBuf, uint outLen, ref uint retLen);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  public delegate uint S4ChangeDirFn(IntPtr ctx, [MarshalAs(UnmanagedType.LPStr)] string path);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  public delegate uint S4VerifyPinFn(IntPtr ctx, IntPtr pin, uint pinLen, uint pinType);
}
"@
}

function Invoke-Sense4Control {
    param($Fn, [IntPtr]$Ctx, [uint32]$Code, [int]$OutLen = 64)
    $out = [Runtime.InteropServices.Marshal]::AllocHGlobal($OutLen)
    try {
        [uint32]$retLen = 0
        $rc = $Fn.Invoke($Ctx, $Code, [IntPtr]::Zero, [uint32]0, $out, [uint32]$OutLen, [ref]$retLen)
        $bytes = New-Object byte[] ([Math]::Max([int]$retLen, 0))
        if ($retLen -gt 0) {
            [Runtime.InteropServices.Marshal]::Copy($out, $bytes, 0, [int]$retLen)
        }
        return @{
            code = ("0x{0:X8}" -f $Code)
            rc = ("0x{0:X8}" -f $rc)
            ok = ($rc -eq 0)
            length = [int]$retLen
            hex = (Convert-BytesToHex $bytes)
            ascii = (Convert-BytesToAscii $bytes)
            bytes = $bytes
        }
    }
    finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($out)
    }
}

function Read-Sense4ChipFull {
    param(
        [string]$DllPath,
        [string]$UserPin = "12345678"
    )
    $result = @{
        attempted = $true
        dll = $DllPath
        ok = $false
        error = $null
        deviceCount = 0
        devices = @()
        chip = @()
        note = "Sense4 full probe (S4Enum/Open/Control/VerifyPin)"
        limits = @(
            "Data/EXE files inside the key are NOT readable from PC directly.",
            "Need known file IDs + S4Execute (EXF) and correct PIN to run code on chip.",
            "Place Sense4.dll (Elite4 SDK, same x86/x64 as PowerShell) next to the agent."
        )
    }
    if (-not $DllPath -or -not (Test-Path -LiteralPath $DllPath)) {
        $result.attempted = $false
        $result.note = "Sense4.dll not found. Copy Elite4 SDK Sense4.dll into %LOCALAPPDATA%\TM07\senselock-agent"
        return $result
    }

    $S4_GET_DEVICE_TYPE = [uint32]0x25
    $S4_GET_SERIAL_NUMBER = [uint32]0x26
    $S4_GET_DEVICE_USABLE_SPACE = [uint32]0x29
    $S4_DF_AVAILABLE_SPACE = [uint32]0x31
    $S4_GET_CUSTOMER_NAME = [uint32]0x2b
    $S4_GET_MANUFACTURE_DATE = [uint32]0x2c
    $S4_GET_CURRENT_TIME = [uint32]0x2d
    $S4_GET_LICENSE = [uint32]0x2e
    $S4_USER_PIN = [uint32]0xa1

    try {
        Ensure-Sense4NativeType
        $h = [Tm07Sense4Api]::LoadLibrary($DllPath)
        if ($h -eq [IntPtr]::Zero) {
            $result.error = "LoadLibrary failed (wrong arch? need x64 Sense4.dll for 64-bit PowerShell)"
            return $result
        }
        try {
            $pEnum = [Tm07Sense4Api]::GetProcAddress($h, "S4Enum")
            $pOpen = [Tm07Sense4Api]::GetProcAddress($h, "S4Open")
            $pClose = [Tm07Sense4Api]::GetProcAddress($h, "S4Close")
            $pCtrl = [Tm07Sense4Api]::GetProcAddress($h, "S4Control")
            $pCd = [Tm07Sense4Api]::GetProcAddress($h, "S4ChangeDir")
            $pPin = [Tm07Sense4Api]::GetProcAddress($h, "S4VerifyPin")
            if ($pEnum -eq [IntPtr]::Zero -or $pOpen -eq [IntPtr]::Zero) {
                $result.error = "S4Enum/S4Open exports missing"
                return $result
            }
            $fnEnum = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($pEnum, [Tm07Sense4Api+S4EnumFn])
            $fnOpen = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($pOpen, [type][Tm07Sense4Api+S4OpenFn])
            $fnClose = if ($pClose -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($pClose, [type][Tm07Sense4Api+S4CloseFn]) } else { $null }
            $fnCtrl = if ($pCtrl -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($pCtrl, [type][Tm07Sense4Api+S4ControlFn]) } else { $null }
            $fnCd = if ($pCd -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($pCd, [type][Tm07Sense4Api+S4ChangeDirFn]) } else { $null }
            $fnPin = if ($pPin -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($pPin, [type][Tm07Sense4Api+S4VerifyPinFn]) } else { $null }

            [uint32]$size = 0
            $r1 = $fnEnum.Invoke([IntPtr]::Zero, [ref]$size)
            $result.enumRet1 = ("0x{0:X8}" -f $r1)
            $result.sizeBytes = [int]$size
            if ($size -eq 0) {
                $result.ok = ($r1 -eq 0)
                $result.note = "S4Enum: no Sense4 devices visible to DLL"
                return $result
            }

            $ctxSize = [Runtime.InteropServices.Marshal]::SizeOf([type][Tm07Sense4Context])
            $result.contextSize = $ctxSize
            $count = [int]($size / $ctxSize)
            if ($count -lt 1) {
                # Fallback: treat raw size as one blob
                $count = 1
                $ctxSize = [int]$size
            }
            $result.deviceCount = $count

            $buf = [Runtime.InteropServices.Marshal]::AllocHGlobal([int]$size)
            try {
                $r2 = $fnEnum.Invoke($buf, [ref]$size)
                $result.enumRet2 = ("0x{0:X8}" -f $r2)
                $chipList = @()
                for ($i = 0; $i -lt $count; $i++) {
                    $ctxPtr = [IntPtr]::Add($buf, $i * $ctxSize)
                    $ctx = [Runtime.InteropServices.Marshal]::PtrToStructure($ctxPtr, [type][Tm07Sense4Context])
                    $bid = $ctx.bID
                    $atr = $ctx.bAtr
                    $entry = @{
                        index = [int]$ctx.dwIndex
                        version = ("0x{0:X8}" -f $ctx.dwVersion)
                        bIDHex = (Convert-BytesToHex $bid)
                        bIDAscii = (Convert-BytesToAscii $bid)
                        atrHex = (Convert-BytesToHex $atr)
                        atrLen = [int]$ctx.dwAtrLen
                        open = $null
                        controls = @{}
                        pin = $null
                        dfSpace = $null
                    }

                    $openRc = $fnOpen.Invoke($ctxPtr)
                    $entry.open = @{ rc = ("0x{0:X8}" -f $openRc); ok = ($openRc -eq 0) }
                    if ($openRc -eq 0 -and $fnCtrl) {
                        $ctrls = @{
                            serialNumber = (Invoke-Sense4Control $fnCtrl $ctxPtr $S4_GET_SERIAL_NUMBER 16)
                            deviceType = (Invoke-Sense4Control $fnCtrl $ctxPtr $S4_GET_DEVICE_TYPE 8)
                            usableSpace = (Invoke-Sense4Control $fnCtrl $ctxPtr $S4_GET_DEVICE_USABLE_SPACE 8)
                            customerName = (Invoke-Sense4Control $fnCtrl $ctxPtr $S4_GET_CUSTOMER_NAME 16)
                            manufactureDate = (Invoke-Sense4Control $fnCtrl $ctxPtr $S4_GET_MANUFACTURE_DATE 16)
                            currentTime = (Invoke-Sense4Control $fnCtrl $ctxPtr $S4_GET_CURRENT_TIME 64)
                            license = (Invoke-Sense4Control $fnCtrl $ctxPtr $S4_GET_LICENSE 256)
                        }
                        # strip raw bytes from JSON-friendly output
                        foreach ($k in @($ctrls.Keys)) {
                            $c = $ctrls[$k]
                            $entry.controls[$k] = @{
                                ok = $c.ok; rc = $c.rc; length = $c.length; hex = $c.hex; ascii = $c.ascii
                            }
                        }

                        if ($fnCd) {
                            $cdRc = $fnCd.Invoke($ctxPtr, "\")
                            $entry.changeDirRoot = @{ rc = ("0x{0:X8}" -f $cdRc); ok = ($cdRc -eq 0) }
                            if ($cdRc -eq 0) {
                                $df = Invoke-Sense4Control $fnCtrl $ctxPtr $S4_DF_AVAILABLE_SPACE 8
                                $entry.dfSpace = @{ ok = $df.ok; rc = $df.rc; hex = $df.hex }
                            }
                        }

                        if ($fnPin -and $UserPin) {
                            $pinBytes = [Text.Encoding]::ASCII.GetBytes($UserPin)
                            $pinPtr = [Runtime.InteropServices.Marshal]::AllocHGlobal($pinBytes.Length)
                            try {
                                [Runtime.InteropServices.Marshal]::Copy($pinBytes, 0, $pinPtr, $pinBytes.Length)
                                $pinRc = $fnPin.Invoke($ctxPtr, $pinPtr, [uint32]$pinBytes.Length, $S4_USER_PIN)
                                $entry.pin = @{
                                    tried = $true
                                    pinLen = $pinBytes.Length
                                    rc = ("0x{0:X8}" -f $pinRc)
                                    ok = ($pinRc -eq 0)
                                    note = $(if ($pinRc -eq 0) { "User PIN accepted" } else { "User PIN rejected/changed (default 12345678 may not apply)" })
                                }
                                if ($pinRc -eq 0 -and $fnCtrl) {
                                    $df2 = Invoke-Sense4Control $fnCtrl $ctxPtr $S4_DF_AVAILABLE_SPACE 8
                                    $entry.dfSpaceAfterPin = @{ ok = $df2.ok; hex = $df2.hex }
                                }
                            }
                            finally {
                                [Runtime.InteropServices.Marshal]::FreeHGlobal($pinPtr)
                            }
                        }

                        if ($fnClose) { [void]$fnClose.Invoke($ctxPtr) }
                    }
                    $chipList += $entry
                }
                $result.chip = $chipList
                $result.devices = @($chipList | ForEach-Object {
                    @{
                        index = $_.index
                        bIDHex = $_.bIDHex
                        bIDAscii = $_.bIDAscii
                        husnHex = $(if ($_.controls.serialNumber) { $_.controls.serialNumber.hex } else { $null })
                        customerHex = $(if ($_.controls.customerName) { $_.controls.customerName.hex } else { $null })
                    }
                })
                $result.ok = ($chipList.Count -gt 0)
                $result.note = "Sense4 chip fields read via API. File contents still need EXF+file IDs."
            }
            finally {
                [Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
            }
        }
        finally {
            [void][Tm07Sense4Api]::FreeLibrary($h)
        }
    }
    catch {
        $result.error = $_.Exception.Message
        $result.note = "Sense4 probe failed: " + $_.Exception.Message
    }
    return $result
}

function Find-SenselockDevices {
    $pattern = "VID_$($script:VidNorm).*PID_$($script:UsbPidNorm)"
    $list = @()
    try {
        $devs = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object {
            $_.InstanceId -match $pattern
        }
        foreach ($d in @($devs)) {
            $propMap = Get-PnpPropertyMap -InstanceId $d.InstanceId
            $serial = ""
            $container = ""
            foreach ($k in @('DEVPKEY_Device_BusReportedDeviceDesc','DeviceSerialNumber','DEVPKEY_Device_SerialNumber')) {
                if ($propMap.ContainsKey($k) -and $propMap[$k]) { $serial = [string]$propMap[$k]; break }
            }
            if ($propMap.ContainsKey('DEVPKEY_Device_ContainerId') -and $propMap['DEVPKEY_Device_ContainerId']) {
                $container = [string]$propMap['DEVPKEY_Device_ContainerId']
            }
            $iSerial = ""
            if ($d.InstanceId -match 'VID_[0-9A-F]+&PID_[0-9A-F]+\\(.+)$') {
                $tail = $Matches[1]
                if ($tail -notmatch '^[\d]+&') { $iSerial = $tail }
            }
            $cimExtra = @{}
            try {
                $cim = Get-CimInstance Win32_PnPEntity -Filter ("DeviceID='$($d.InstanceId.Replace('\','\\'))'") -ErrorAction SilentlyContinue
                if (-not $cim) {
                    $cim = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $_.DeviceID -eq $d.InstanceId } | Select-Object -First 1
                }
                if ($cim) {
                    $cimExtra = @{
                        description = [string]$cim.Description
                        manufacturer = [string]$cim.Manufacturer
                        service = [string]$cim.Service
                        pnpClass = [string]$cim.PNPClass
                        status = [string]$cim.Status
                        hardwareId = @(ConvertTo-PlainValue $cim.HardwareID)
                        compatibleId = @(ConvertTo-PlainValue $cim.CompatibleID)
                    }
                }
            }
            catch { }

            $list += [pscustomobject]@{
                name = [string]$d.FriendlyName
                status = [string]$d.Status
                class = [string]$d.Class
                instanceId = [string]$d.InstanceId
                serial = $(if ($serial) { $serial } elseif ($iSerial) { $iSerial } else { "" })
                containerId = $container
                pnpProperties = $propMap
                cim = $cimExtra
            }
        }
    }
    catch { }

    if (-not $list.Count) {
        try {
            $cimList = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object {
                $_.DeviceID -match $pattern
            }
            foreach ($d in @($cimList)) {
                $iSerial = ""
                if ($d.DeviceID -match 'VID_[0-9A-F]+&PID_[0-9A-F]+\\(.+)$') {
                    $tail = $Matches[1]
                    if ($tail -notmatch '^[\d]+&') { $iSerial = $tail }
                }
                $list += [pscustomobject]@{
                    name = [string]$d.Name
                    status = [string]$d.Status
                    class = [string]$d.PNPClass
                    instanceId = [string]$d.DeviceID
                    serial = $iSerial
                    containerId = ""
                    pnpProperties = @{}
                    cim = @{
                        description = [string]$d.Description
                        manufacturer = [string]$d.Manufacturer
                        service = [string]$d.Service
                    }
                }
            }
        }
        catch { }
    }

    return @($list)
}

function Build-KeyDump {
    param($Devices, $SdkArtifacts, $Sense4Enum)
    $interfaces = @()
    foreach ($d in @($Devices)) {
        $interesting = @{}
        if ($d.pnpProperties) {
            foreach ($k in @($d.pnpProperties.Keys)) {
                if ($k -match 'Serial|Container|BusReported|Hardware|Compatible|Location|Address|Parent|Driver|Class|Manufacturer|DeviceDesc|Instance') {
                    $interesting[$k] = $d.pnpProperties[$k]
                }
            }
        }
        $interfaces += @{
            name = $d.name
            status = $d.status
            class = $d.class
            instanceId = $d.instanceId
            serial = $d.serial
            containerId = $d.containerId
            interestingProperties = $interesting
            allPnpProperties = $d.pnpProperties
            cim = $d.cim
        }
    }
    return @{
        readMode = "windows-pnp + usb-registry + optional Sense4.dll"
        vendorId = "0x$($script:VidNorm)"
        productId = "0x$($script:UsbPidNorm)"
        interfaceCount = $interfaces.Count
        interfaces = $interfaces
        usbRegistry = @(Get-UsbRegistryDump)
        sdk = $SdkArtifacts
        sense4 = $Sense4Enum
        limits = @(
            "Without Sense4.dll from Elite4 SDK: only USB/PnP identity is available.",
            "License modules / data files / EXF on chip require Sense4 API + PIN.",
            "bID from S4Enum is the best stable chip id when SDK works."
        )
    }
}

function Write-KeyDumpConsole {
    param($Dump, $WorkstationCode, $Source)
    Write-Host ""
    Write-Host "======== SenseLock key dump ========"
    Write-Host ("workstationCode : " + $WorkstationCode)
    Write-Host ("idSource        : " + $Source)
    Write-Host ("interfaces      : " + $Dump.interfaceCount)
    $n = 0
    foreach ($iface in @($Dump.interfaces)) {
        $n++
        Write-Host ""
        Write-Host ("--- interface #$n ---")
        Write-Host ("  name       : " + $iface.name)
        Write-Host ("  status     : " + $iface.status)
        Write-Host ("  class      : " + $iface.class)
        Write-Host ("  serial     : " + $iface.serial)
        Write-Host ("  container  : " + $iface.containerId)
        Write-Host ("  instanceId : " + $iface.instanceId)
        if ($iface.cim -and $iface.cim.manufacturer) {
            Write-Host ("  manuf      : " + $iface.cim.manufacturer)
        }
        if ($iface.cim -and $iface.cim.service) {
            Write-Host ("  service    : " + $iface.cim.service)
        }
        Write-Host "  interesting PnP props:"
        if ($iface.interestingProperties -and $iface.interestingProperties.Keys.Count) {
            foreach ($k in ($iface.interestingProperties.Keys | Sort-Object)) {
                Write-Host ("    {0} = {1}" -f $k, $iface.interestingProperties[$k])
            }
        }
        else {
            Write-Host "    (none)"
        }
        $allCount = 0
        if ($iface.allPnpProperties) { $allCount = @($iface.allPnpProperties.Keys).Count }
        Write-Host ("  all PnP properties: $allCount (also in /status keyDump)")
    }
    Write-Host ""
    Write-Host "--- USB registry ---"
    $regs = @($Dump.usbRegistry)
    if (-not $regs.Count) {
        Write-Host "  (no HKLM\...\Enum\USB\VID_xxxx&PID_yyyy entries)"
    }
    else {
        foreach ($r in $regs) {
            Write-Host ("  instance: " + $r.instanceKey)
            foreach ($k in @('HardwareID','CompatibleIDs','ContainerID','LocationInformation','ParentIdPrefix','Service','DeviceDesc','Mfg','Driver')) {
                if ($r.properties -and $r.properties.ContainsKey($k)) {
                    $val = $r.properties[$k]
                    if ($val -is [System.Array]) { $val = ($val -join '; ') }
                    Write-Host ("    {0} = {1}" -f $k, $val)
                }
            }
            if ($r.deviceParameters -and $r.deviceParameters.Keys.Count) {
                Write-Host "    Device Parameters:"
                foreach ($k in ($r.deviceParameters.Keys | Sort-Object)) {
                    Write-Host ("      {0} = {1}" -f $k, $r.deviceParameters[$k])
                }
            }
        }
    }
    Write-Host ""
    Write-Host "--- Sense4 / Elite SDK ---"
    Write-Host ("  " + $Dump.sdk.note)
    foreach ($dll in @($Dump.sdk.dlls)) {
        Write-Host ("  DLL: " + $dll.path + "  ver=" + $dll.fileVersion)
    }
    foreach ($drv in @($Dump.sdk.drivers)) {
        Write-Host ("  driver service: " + $drv.name + " status=" + $drv.status)
    }
    if ($Dump.sense4 -and $Dump.sense4.attempted) {
        Write-Host ("  Sense4 ok=" + $Dump.sense4.ok + " count=" + $Dump.sense4.deviceCount)
        Write-Host ("  " + $Dump.sense4.note)
        if ($Dump.sense4.error) { Write-Host ("  error: " + $Dump.sense4.error) }
        foreach ($ch in @($Dump.sense4.chip)) {
            Write-Host ""
            Write-Host ("  --- chip index " + $ch.index + " ---")
            Write-Host ("  bID       : " + $ch.bIDHex + "  [" + $ch.bIDAscii + "]")
            Write-Host ("  version   : " + $ch.version)
            Write-Host ("  open      : " + $(if ($ch.open) { $ch.open.rc } else { "n/a" }))
            if ($ch.controls) {
                foreach ($k in @($ch.controls.Keys | Sort-Object)) {
                    $c = $ch.controls[$k]
                    Write-Host ("  {0,-16}: ok={1} hex={2} ascii=[{3}]" -f $k, $c.ok, $c.hex, $c.ascii)
                }
            }
            if ($ch.pin) {
                Write-Host ("  user PIN  : ok={0} rc={1} ({2})" -f $ch.pin.ok, $ch.pin.rc, $ch.pin.note)
            }
            if ($ch.dfSpace) {
                Write-Host ("  DF space  : " + $ch.dfSpace.hex)
            }
        }
        foreach ($line in @($Dump.sense4.limits)) {
            Write-Host ("  ! " + $line)
        }
    }
    Write-Host ""
    Write-Host "Limits:"
    foreach ($line in @($Dump.limits)) { Write-Host ("  - " + $line) }
    Write-Host "===================================="
    Write-Host ""
}

function Get-WorkstationStatus {
    param([bool]$ForceRefresh = $false)

    if (-not $ForceRefresh -and $script:StatusLocked -and $script:StatusCache) {
        $cached = @{}
        foreach ($k in $script:StatusCache.Keys) {
            $cached[$k] = $script:StatusCache[$k]
        }
        $cached["cached"] = $true
        $cached["checkedAt"] = (Get-Date).ToUniversalTime().ToString("o")
        return $cached
    }

    $pc = Get-PcIdentity
    $devices = @(Find-SenselockDevices)
    $sdk = Find-Sense4Artifacts
    $sense4 = @{ attempted = $false; ok = $false; note = "Sense4.dll not found" }
    if ($sdk.dlls -and $sdk.dlls.Count) {
        $sense4 = Read-Sense4ChipFull -DllPath $sdk.dlls[0].path -UserPin $script:UserPin
    }

    $present = $devices.Count -gt 0 -or ($sense4.ok -and $sense4.deviceCount -gt 0)
    $primary = $null
    if ($devices.Count -gt 0) {
        $primary = $devices | Where-Object { $_.status -eq 'OK' } | Select-Object -First 1
        if (-not $primary) { $primary = $devices[0] }
    }

    $stable = ""
    $source = "none"
    # Prefer real HUSN from S4_GET_SERIAL_NUMBER, else bID from S4Enum
    if ($sense4.ok -and $sense4.chip -and $sense4.chip.Count -gt 0) {
        $c0 = $sense4.chip[0]
        if ($c0.controls -and $c0.controls.serialNumber -and $c0.controls.serialNumber.ok -and $c0.controls.serialNumber.hex) {
            $stable = "husn:" + $c0.controls.serialNumber.hex
            $source = "sense4-husn"
        }
        elseif ($c0.bIDHex) {
            $stable = "bid:" + $c0.bIDHex
            $source = "sense4-bid"
        }
    }
    elseif ($sense4.ok -and $sense4.devices -and $sense4.devices.Count -gt 0 -and $sense4.devices[0].bIDHex) {
        $stable = "bid:" + $sense4.devices[0].bIDHex
        $source = "sense4-bid"
    }
    elseif ($primary) {
        if ($primary.serial) {
            $stable = "sn:" + $primary.serial
            $source = "usb-serial"
        }
        elseif ($primary.containerId) {
            $stable = "cid:" + $primary.containerId
            $source = "container"
        }
        else {
            $stable = "inst:" + $primary.instanceId
            $source = "instance"
        }
    }

    $code = $null
    $keyId = $null
    if ($present -and $stable) {
        $keyId = Get-Sha8 -Text $stable
        $code = "SL-" + $keyId
    }

    $keyDump = Build-KeyDump -Devices $devices -SdkArtifacts $sdk -Sense4Enum $sense4

    $note = ""
    if (-not $present) {
        $note = "Senselock Elite4 key not found (VID_$($script:VidNorm)/PID_$($script:UsbPidNorm)). Plug the dongle in."
    }
    elseif ($source -eq "sense4-bid") {
        $note = "ID from Sense4 S4Enum bID (chip HUSN/ATR). Full dump in keyDump."
    }
    elseif ($source -eq "instance") {
        $note = "Windows did not expose USB serial; id is tied to USB port (may change)."
    }
    elseif ($source -eq "container") {
        $note = "Using device ContainerId. Full PnP/USB dump in keyDump."
    }
    else {
        $note = "Key detected. Full dump in keyDump / console."
    }

    $payload = @{
        ok = $true
        agent = "tm07-senselock-workstation"
        version = $script:AgentVersion
        present = $present
        workstationCode = $code
        keyId = $keyId
        source = $source
        vendorId = "0x$($script:VidNorm)"
        productId = "0x$($script:UsbPidNorm)"
        productHint = "Senselock Elite4"
        hostname = $pc.hostname
        machineGuid = $pc.machineGuid
        pcCode = $pc.pcCode
        cached = $false
        device = $(if ($primary) {
            @{
                name = $primary.name
                status = $primary.status
                instanceId = $primary.instanceId
                serial = $primary.serial
                containerId = $primary.containerId
            }
        } else { $null })
        devices = @($devices | ForEach-Object {
            @{
                name = $_.name
                status = $_.status
                instanceId = $_.instanceId
                serial = $_.serial
                containerId = $_.containerId
            }
        })
        keyDump = $keyDump
        note = $note
        checkedAt = (Get-Date).ToUniversalTime().ToString("o")
    }

    if ($present -and $code) {
        $script:StatusCache = $payload
        $script:StatusLocked = $true
    }
    else {
        $script:StatusCache = $null
        $script:StatusLocked = $false
    }

    return $payload
}

Write-Host ""
Write-Host "TM-07 Senselock agent v$($script:AgentVersion)"
Write-Host "Looking for USB VID_$($script:VidNorm) PID_$($script:UsbPidNorm)"

try {
    $bootStatus = Get-WorkstationStatus -ForceRefresh $true
    if ($bootStatus.present) {
        Write-Host ("Key OK: " + $bootStatus.workstationCode + " (" + $bootStatus.source + ")")
        if ($bootStatus.device -and $bootStatus.device.name) {
            Write-Host ("Device: " + $bootStatus.device.name)
        }
        if ($bootStatus.keyDump) {
            Write-KeyDumpConsole -Dump $bootStatus.keyDump -WorkstationCode $bootStatus.workstationCode -Source $bootStatus.source
            $script:LastKeyDumpPrinted = $true
        }
    }
    else {
        Write-Host "Key NOT found yet. Plug Senselock Elite4, then open /status."
        Write-Host $bootStatus.note
        if ($bootStatus.keyDump) {
            Write-KeyDumpConsole -Dump $bootStatus.keyDump -WorkstationCode "(none)" -Source "none"
        }
    }
}
catch {
    Write-Host ("Key scan warning: " + $_.Exception.Message)
}

$tcp = $null
# Free port if an old PowerShell agent is still listening.
[void](Stop-ListenersOnPort -ListenPort $Port)

try {
    $tcp = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
    $tcp.Start()
}
catch {
    Write-Host ""
    if (Test-ExistingAgent -ListenPort $Port) {
        Write-Host "Agent already running on http://127.0.0.1:$Port/ — OK, leave that window open."
        Write-Host "Browser check: http://127.0.0.1:${Port}/status"
        Write-Host ""
        try {
            $st = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/status" -TimeoutSec 2
            if ($st.workstationCode) {
                Write-Host ("Current code: " + $st.workstationCode)
            }
        }
        catch { }
        Write-Host ""
        Read-Host "Press Enter to exit this window (agent keeps running)"
        exit 0
    }
    Write-Host ("ERROR: cannot listen on port $Port")
    Write-Host $_.Exception.Message
    Write-Host "Close the other Senselock agent window, or in PowerShell:"
    Write-Host ("  Get-NetTCPConnection -LocalPort $Port -State Listen | %% { Stop-Process -Id `$_.OwningProcess -Force }")
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Listening http://0.0.0.0:$Port/ (localhost + LAN)"
Write-Host "Open in browser: http://127.0.0.1:${Port}/status"
Write-Host "GET /health  GET /status  GET /status?refresh=1   Ctrl+C to stop"
Write-Host "Full key dump is printed above and available in /status as keyDump."
Write-Host ""

try {
    while ($true) {
        $client = $tcp.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $stream.ReadTimeout = 3000
            $stream.WriteTimeout = 3000
            $buf = New-Object byte[] 8192
            $read = 0
            try {
                $read = $stream.Read($buf, 0, $buf.Length)
            }
            catch [System.IO.IOException] {
                continue
            }
            if ($read -le 0) { continue }
            $reqText = [System.Text.Encoding]::ASCII.GetString($buf, 0, $read)
            $first = ($reqText -split "`r`n")[0]
            $method = "GET"
            $path = "/"
            $query = ""
            if ($first -match '^(GET|OPTIONS|HEAD)\s+(\S+)') {
                $method = $Matches[1]
                $rawTarget = $Matches[2]
                $path = ($rawTarget -split '\?')[0]
                if ($rawTarget -match '\?(.+)$') { $query = $Matches[1] }
            }
            $path = $path.TrimEnd("/")
            if (-not $path) { $path = "/" }
            $forceRefresh = ($query -match '(^|&)refresh=1(&|$)')

            if ($method -eq "OPTIONS") {
                Send-HttpJson -Stream $stream -StatusCode 204 -Body $null
            }
            elseif ($path -eq "/health") {
                Send-HttpJson -Stream $stream -StatusCode 200 -Body @{
                    ok = $true
                    agent = "tm07-senselock-workstation"
                    version = $script:AgentVersion
                    port = $Port
                    locked = $script:StatusLocked
                }
            }
            elseif ($path -eq "/status" -or $path -eq "/" -or $path -eq "/dump") {
                Send-HttpJson -Stream $stream -StatusCode 200 -Body (Get-WorkstationStatus -ForceRefresh:$forceRefresh)
            }
            else {
                Send-HttpJson -Stream $stream -StatusCode 404 -Body @{
                    ok = $false
                    error = "Use GET /health, /status or /dump (optional ?refresh=1)"
                }
            }
        }
        catch { }
        finally {
            try { $client.Close() } catch { }
        }
    }
}
finally {
    try { $tcp.Stop() } catch { }
}
