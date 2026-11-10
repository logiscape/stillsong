; Stillsong 2 NSIS uninstaller hooks.
;
; Uninstall policy: the app, runtimes, models, logs and temp are removed
; unconditionally. The user's song/photo library is asked about, with DELETE
; as the default; "No" preserves only <appdata>\library\ and the database.
; Anything exported with "Save a copy" is untouched wherever it was saved.
; Silent uninstall (/S) deletes everything.
;
; Stillsong 2 installs beside Stillsong 1 (com.logiscape.stillsong,
; HKCU\Software\Logiscape\Stillsong). Every path and key below must name
; Stillsong 2's own identifier — never touch Stillsong 1's.

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
  ReadRegStr $0 HKCU "Software\Logiscape\Stillsong 2" "ComponentsDir"
  ${If} $0 != ""
    RMDir /r "$0"
  ${EndIf}
  DeleteRegKey HKCU "Software\Logiscape\Stillsong 2"

  ; Local app data holds only machine-specific state: the default components
  ; dir and the WebView2 profile (EBWebView). Nothing the user keeps lives
  ; here, so it goes either way.
  RMDir /r "$LOCALAPPDATA\com.logiscape.stillsong2"

  ; Roaming app data: logs and the components pointer — and, unless the user
  ; chose to keep it, the library + database.
  ${If} $R9 == "keep"
    RMDir /r "$APPDATA\com.logiscape.stillsong2\logs"
    Delete "$APPDATA\com.logiscape.stillsong2\components-dir.txt"
  ${Else}
    RMDir /r "$APPDATA\com.logiscape.stillsong2"
  ${EndIf}
!macroend
