; Uninstaller: an unticked "Also delete my FocusShell data" checkbox (#1134).
; electron-builder includes this file by default (build/installer.nsh).
;
; Data is deleted only when all of these hold:
; - the person ticked the box themselves on the interactive uninstall page,
; - the uninstall is not silent (an in-app update and an install over the top run
;   the old uninstaller silently, with --updated, and never show the page),
; - the folder is FocusShell's own: a non-empty AppData path, named after the
;   product, existing, and not a link to somewhere else.
; A data folder moved elsewhere (deckRoot, FOCUSSHELL_HOME) is never followed, and
; %APPDATA%\FocusShell (PCs that ran it under the old name) is left alone.
; Folder names come from the product name, so a test build under another name
; never reaches the real FocusShell folders.

!ifdef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var deleteMyData
  Var deleteMyDataBox

  !macro customUnInit
    StrCpy $deleteMyData "0"
  !macroend

  ; The page's functions live in the macro because Modern UI is loaded only by then.
  !macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.deleteDataPage un.deleteDataPageLeave

  Function un.deleteDataPage
    StrCpy $deleteMyData "0"
    !insertmacro MUI_HEADER_TEXT "Your ${PRODUCT_NAME} data" "Choose whether to keep it."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 36u "${PRODUCT_NAME} keeps your boards and settings, and the VS Code copy it made, in your AppData folder. They stay unless you tick the box below."
    Pop $0
    ${NSD_CreateCheckbox} 0 44u 100% 12u "Also delete my ${PRODUCT_NAME} data"
    Pop $deleteMyDataBox
    ${NSD_Uncheck} $deleteMyDataBox
    ${NSD_CreateLabel} 12u 60u 100% 48u "Deletes your boards, settings and the VS Code copy ${PRODUCT_NAME} made. Your projects, Claude Code and VS Code data are never touched. A data folder you moved somewhere else is left alone."
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function un.deleteDataPageLeave
    ${NSD_GetState} $deleteMyDataBox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $deleteMyData "1"
    ${Else}
      StrCpy $deleteMyData "0"
    ${EndIf}
  FunctionEnd
  !macroend

  ; Deletes $R9 only if its base is a real AppData path and the folder is a plain
  ; folder (not a junction or symlink to somewhere else).
  Function un.deleteOwnFolder
    StrLen $0 $R8
    ${If} $0 < 4
      DetailPrint "Skipped $R9: no AppData path"
      Return
    ${EndIf}
    ${IfNot} ${FileExists} "$R9\*.*"
      Return
    ${EndIf}
    System::Call 'kernel32::GetFileAttributesW(w "$R9") i .r1'
    ${If} $1 = -1
      Return
    ${EndIf}
    IntOp $2 $1 & 0x400
    ${If} $2 <> 0
      DetailPrint "Skipped $R9: it links to another folder"
      Return
    ${EndIf}
    DetailPrint "Deleting $R9"
    RMDir /r "$R9"
  FunctionEnd

  !macro customUnInstall
    ${If} $deleteMyData == "1"
    ${AndIfNot} ${Silent}
    ${AndIfNot} ${isUpdated}
      ; Electron keeps app data per user, whatever the install mode.
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}
      StrCpy $R8 "$APPDATA"
      StrCpy $R9 "$APPDATA\${PRODUCT_FILENAME}"
      Call un.deleteOwnFolder
      StrCpy $R8 "$LOCALAPPDATA"
      StrCpy $R9 "$LOCALAPPDATA\${PRODUCT_FILENAME}"
      Call un.deleteOwnFolder
      StrCpy $R9 "$LOCALAPPDATA\${PRODUCT_FILENAME}-updater"
      Call un.deleteOwnFolder
      StrCpy $R9 "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
      Call un.deleteOwnFolder
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  !macroend
!endif
