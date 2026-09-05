; Stillsong NSIS uninstaller hooks.
;
; Uninstall policy: the app, runtimes, models, logs and temp are removed
; unconditionally. The user's song/photo library is asked about, with DELETE
; as the default; "No" preserves only <appdata>\library\ and the database.
; Anything exported with "Save a copy" is untouched wherever it was saved.
; Silent uninstall (/S) deletes everything.

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $R9 "delete" ; default: delete the library too
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 \
    "Also delete your songs and photos?$\r$\n$\r$\nAnything you exported with Save a copy stays where you saved it." \
    /SD IDYES IDYES +2 IDNO 0
  Goto +2
  StrCpy $R9 "keep"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The components dir (runtimes + models, possibly on another drive) is
  ; recorded by the app; remove it unconditionally.
  ReadRegStr $0 HKCU "Software\Logiscape\Stillsong" "ComponentsDir"
  ${If} $0 != ""
    RMDir /r "$0"
  ${EndIf}
  RMDir /r "$LOCALAPPDATA\com.logiscape.stillsong\components"
  DeleteRegKey HKCU "Software\Logiscape\Stillsong"

  ; Roaming app data: logs, temp, WebView2 leftovers — and, unless the user
  ; chose to keep it, the library + database.
  ${If} $R9 == "keep"
    RMDir /r "$APPDATA\com.logiscape.stillsong\logs"
    RMDir /r "$APPDATA\com.logiscape.stillsong\EBWebView"
    Delete "$APPDATA\com.logiscape.stillsong\components-dir.txt"
  ${Else}
    RMDir /r "$APPDATA\com.logiscape.stillsong"
  ${EndIf}
  ; Belt and braces for anything left under local app data.
  ${If} $R9 != "keep"
    RMDir /r "$LOCALAPPDATA\com.logiscape.stillsong"
  ${EndIf}
!macroend
