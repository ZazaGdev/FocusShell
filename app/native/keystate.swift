// FocusShell's key helper on a Mac (#2562): what the PowerShell key watchers do on Windows.
// Built on the Mac runner with `swiftc -O keystate.swift -o bin/keystate` and shipped in the app.
//
//   keystate space   for each line read, waits until Space is up, then prints "up"
//                    (talk to the CTO from any app: letting go sends what was said)
//   keystate ctrl    prints "<ctrl 0|1><other 0|1>" each time that changes ("10": Ctrl alone)
//                    (the recorder's hold Ctrl to draw); quits when FocusShell does
//
// Its first line is "ok", or "noperm" when macOS has not given Input Monitoring to FocusShell:
// then every key reads as up, so the app tells the owner where to turn it on.
import Foundation
import CoreGraphics

setvbuf(stdout, nil, _IOLBF, 0)
let src = CGEventSourceStateID.combinedSessionState
func down(_ k: CGKeyCode) -> Bool { CGEventSource.keyState(src, key: k) }

if CGPreflightListenEventAccess() { print("ok") } else { _ = CGRequestListenEventAccess(); print("noperm") }

let mode = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
let parent = getppid()
if mode == "space" {
  while readLine() != nil {
    while down(49) { usleep(25_000) }
    print("up")
  }
} else if mode == "ctrl" {
  // Modifiers (Shift, Ctrl, Option, Cmd, Caps Lock, Fn) never count as another key.
  let skip: Set<CGKeyCode> = [54, 55, 56, 57, 58, 59, 60, 61, 62, 63]
  var last = ""
  while true {
    let ctrl = down(59) || down(62)
    var other = false
    if ctrl { for k in 0..<128 where !skip.contains(CGKeyCode(k)) { if down(CGKeyCode(k)) { other = true; break } } }
    let s = "\(ctrl ? 1 : 0)\(other ? 1 : 0)"
    if s != last { print(s); last = s }
    if getppid() != parent { exit(0) }
    usleep(30_000)
  }
} else {
  FileHandle.standardError.write("usage: keystate space|ctrl\n".data(using: .utf8)!)
  exit(2)
}
