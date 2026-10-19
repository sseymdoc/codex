; electron-builder includes this (package.json build.nsis.include) in the installer and the
; uninstaller. Undeclared, Windows runs them at 96 DPI and stretches the window, which blurs it on
; a scaled screen (a 4K monitor at 150-200%); DPI-aware, NSIS lays them out at the screen's scale.
; ponytail: system DPI only, so on a second screen with another scale Windows still stretches the
; window. Per-monitor needs WM_DPICHANGED handling NSIS lacks (its docs leave PerMonitor out for it).
ManifestDPIAware true

; MUI loads the welcome/finish sidebar (build.nsis.installerSidebar, 4x its 164x314) with LoadImage,
; which resizes nearest-neighbour: redraw it at the control's size with HALFTONE, cropped to the
; control's aspect. MUI frees BITMAP when the page closes.
!macro drawSidebar CONTROL BITMAP
  System::Store "s"
  System::Call 'user32::LoadImage(p 0, t "$PLUGINSDIR\modern-wizard.bmp", i 0, i 0, i 0, i 0x2010) p .r3' ; LR_LOADFROMFILE|LR_CREATEDIBSECTION
  ${If} $3 != 0
    System::Call 'user32::GetClientRect(p ${CONTROL}, @r0)'
    System::Call '*$0(i, i, i .r1, i .r2)'
    System::Call '*(&i24) p .r0' ; BITMAP
    System::Call 'gdi32::GetObject(p r3, i 24, p r0)'
    System::Call '*$0(i, i .r5, i .r6)'
    System::Free $0
    IntOp $7 $1 * $6
    IntOp $8 $2 * $5
    ${If} $7 > $8 ; wider than the image: crop top and bottom
      StrCpy $R5 $5
      IntOp $R6 $8 / $1
      StrCpy $R3 0
      IntOp $R4 $6 - $R6
      IntOp $R4 $R4 / 2
    ${Else} ; narrower: crop the sides
      IntOp $R5 $7 / $2
      StrCpy $R6 $6
      IntOp $R3 $5 - $R5
      IntOp $R3 $R3 / 2
      StrCpy $R4 0
    ${EndIf}
    System::Call 'user32::GetDC(p 0) p .r7'
    System::Call 'gdi32::CreateCompatibleBitmap(p r7, i r1, i r2) p .r8'
    System::Call 'gdi32::CreateCompatibleDC(p r7) p .r9'
    System::Call 'gdi32::CreateCompatibleDC(p r7) p .R0'
    System::Call 'user32::ReleaseDC(p 0, p r7)'
    System::Call 'gdi32::SelectObject(p r9, p r3) p .R1'
    System::Call 'gdi32::SelectObject(p R0, p r8) p .R2'
    System::Call 'gdi32::SetStretchBltMode(p R0, i 4)' ; HALFTONE
    System::Call 'gdi32::SetBrushOrgEx(p R0, i 0, i 0, p 0)'
    System::Call 'gdi32::StretchBlt(p R0, i 0, i 0, i r1, i r2, p r9, i R3, i R4, i R5, i R6, i 0xCC0020)' ; SRCCOPY
    System::Call 'gdi32::SelectObject(p r9, p R1)'
    System::Call 'gdi32::SelectObject(p R0, p R2)'
    System::Call 'gdi32::DeleteDC(p r9)'
    System::Call 'gdi32::DeleteDC(p R0)'
    System::Call 'gdi32::DeleteObject(p r3)'
    SendMessage ${CONTROL} ${STM_SETIMAGE} ${IMAGE_BITMAP} $8
    System::Call 'gdi32::DeleteObject(p ${BITMAP})'
    StrCpy ${BITMAP} $8
  ${EndIf}
  System::Store "l"
!macroend

; electron-builder's own finish page (templates/nsis/assistedInstaller.nsh), plus the redraw
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW finishShow
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.welcomeShow
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

; assistedInstaller.nsh inserts this right before MUI_UNPAGE_FINISH, which takes the define
!macro customUninstallPage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.finishShow
!macroend

; inserted after the pages, which declare the mui.* variables
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Function finishShow
      !insertmacro drawSidebar $mui.FinishPage.Image $mui.FinishPage.Image.Bitmap
    FunctionEnd
  !else
    Function un.welcomeShow
      !insertmacro drawSidebar $mui.WelcomePage.Image $mui.WelcomePage.Image.Bitmap
    FunctionEnd
    Function un.finishShow
      !insertmacro drawSidebar $mui.FinishPage.Image $mui.FinishPage.Image.Bitmap
    FunctionEnd
  !endif
!macroend
