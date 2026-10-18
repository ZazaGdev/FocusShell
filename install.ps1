# One-time setup: desktop shortcut plus the global `backlog` skill.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

# WScript.Shell cannot set a shortcut's System.AppUserModel.ID, so use the property store.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShortcutAppId {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  struct PropertyKey { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    void GetCount(out uint c);
    void GetAt(uint i, out PropertyKey k);
    void GetValue(ref PropertyKey k, out PropVariant v);
    void SetValue(ref PropertyKey k, ref PropVariant v);
    void Commit();
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr bc, int flags, ref Guid iid, out IPropertyStore store);
  // The taskbar ID (pid 5) and, when given, the toast activator CLSID (pid 26).
  public static void Set(string lnk, string id, string clsid) {
    Guid iid = typeof(IPropertyStore).GUID;
    IPropertyStore store;
    SHGetPropertyStoreFromParsingName(lnk, IntPtr.Zero, 2, ref iid, out store);
    Guid fmt = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    PropertyKey key = new PropertyKey { fmtid = fmt, pid = 5 };
    PropVariant v = new PropVariant { vt = 31, p = Marshal.StringToCoTaskMemUni(id) };
    IntPtr g = IntPtr.Zero;
    try {
      store.SetValue(ref key, ref v);
      if (!String.IsNullOrEmpty(clsid)) {
        g = Marshal.AllocCoTaskMem(16);
        Marshal.Copy(new Guid(clsid).ToByteArray(), 0, g, 16);
        PropertyKey ck = new PropertyKey { fmtid = fmt, pid = 26 };
        PropVariant cv = new PropVariant { vt = 72, p = g };
        store.SetValue(ref ck, ref cv);
      }
      store.Commit();
    }
    finally { Marshal.FreeCoTaskMem(v.p); if (g != IntPtr.Zero) Marshal.FreeCoTaskMem(g); Marshal.ReleaseComObject(store); }
  }
}
'@
function Set-ShortcutAppId([string]$lnk, [string]$id, [string]$clsid = '') { [ShortcutAppId]::Set($lnk, $id, $clsid) }

# Main shortcut: the FocusShell app.
$electron = Join-Path $root 'app\node_modules\electron\dist\electron.exe'
if (Test-Path $electron) {
  # Notifications name their sender after the Start Menu shortcut Electron keeps for them,
  # named after electron.exe's product name, so that becomes FocusShell (#191).
  node (Join-Path $root 'app\build\name-electron.cjs')
  $app = $shell.CreateShortcut((Join-Path $desktop 'FocusShell.lnk'))
  $app.TargetPath = $electron
  $app.Arguments = "`"$(Join-Path $root 'app')`""
  # Electron rewrites the Start Menu shortcut unless its folder is electron.exe's own.
  $app.WorkingDirectory = Split-Path $electron
  $app.IconLocation = (Join-Path $root 'app\build\icon.ico') + ',0'
  $app.Description = 'FocusShell'
  $app.Save()
  # The window and notifications use AppUserModelId 'FocusShell'. The shortcut must carry the
  # same ID, or Windows shows electron.exe's icon on the taskbar instead of ours, and a toast
  # activator CLSID, or Electron rewrites the Start Menu copy without our arguments (#191).
  Set-ShortcutAppId (Join-Path $desktop 'FocusShell.lnk') 'FocusShell' '{F5EE4B02-220A-4A6C-933D-910AB0D0F5B7}'
  Write-Output "Shortcut: $(Join-Path $desktop 'FocusShell.lnk')"
  # Windows resolves a taskbar ID through Start Menu shortcuts, so add one there too.
  $startLnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'FocusShell.lnk'
  Copy-Item -Force (Join-Path $desktop 'FocusShell.lnk') $startLnk
  Write-Output "Start Menu: $startLnk"
  # Any other Start Menu shortcut to this electron.exe (such as a stray "Electron.lnk")
  # can carry the same taskbar ID with Electron's icon, and Windows may pick it instead.
  Get-ChildItem ([Environment]::GetFolderPath('Programs')) -Recurse -Filter *.lnk |
    Where-Object { $_.FullName -ne $startLnk -and $shell.CreateShortcut($_.FullName).TargetPath -eq $electron } |
    ForEach-Object { Remove-Item $_.FullName; Write-Output "Removed: $($_.FullName)" }
} else {
  Write-Output "App not installed yet: run 'npm install' in $(Join-Path $root 'app') and install again."
}

# The old Windows Terminal backup shortcut is retired (launch.ps1 still works by hand).
$oldLnk = Join-Path $desktop 'FocusShell Terminal.lnk'
if (Test-Path $oldLnk) { Remove-Item $oldLnk; Write-Output "Removed: $oldLnk" }
# The app's shortcut from before its rename to FocusShell (#1094).
$oldLnk = Join-Path $desktop 'FocusShell.lnk'
if (Test-Path $oldLnk) { Remove-Item $oldLnk; Write-Output "Removed: $oldLnk" }

$skillDest = Join-Path $env:USERPROFILE '.claude\skills\backlog'
New-Item -ItemType Directory -Force -Path $skillDest | Out-Null
# The skill names the data folder as <data>; this copy says where it is (#346).
$skillText = (Get-Content -Raw -Path (Join-Path $root 'skill\backlog\SKILL.md')).Replace('<data>', $root)
[System.IO.File]::WriteAllText((Join-Path $skillDest 'SKILL.md'), $skillText)
Write-Output "Skill: $skillDest"
