; electron-builder includes this (package.json build.nsis.include) in the installer and the
; uninstaller. Undeclared, Windows runs them at 96 DPI and stretches the window, which blurs it on
; a scaled screen (a 4K monitor at 150-200%); DPI-aware, NSIS lays them out at the screen's scale.
ManifestDPIAware true
