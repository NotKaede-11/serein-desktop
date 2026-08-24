# Serein Packaging Readiness

Serein ships for Windows as a current-user NSIS Setup executable plus a standalone portable ZIP. MSI is intentionally out of scope for v1.

## Build

```powershell
npm run build:release
npm run package:preview
npm run verify:release
```

The preview packaging step writes these untracked local artifacts:

- `artifacts/Serein-0.1.0-Windows-x64-Setup.exe`
- `artifacts/Serein-0.1.0-Windows-x64-Portable.zip`

Artifacts are deliberately ignored by Git. Publishing or uploading them is a separate, explicitly approved action.

The release build embeds the compiled Vite assets through Tauri's custom protocol. It does not start or require Vite, Node, FastAPI, PyWebView, Python, or a localhost server.

## Windows identity

- Product and executable: `Serein`
- Permanent identifier: `io.serein.desktop`
- Installer scope: current Windows user
- WebView2: the normal small installer uses the Evergreen download bootstrapper when the runtime is missing
- Code signing: the 0.1.0 preview is unsigned and intended for early testers; Windows may show a reputation warning. Code signing remains required before wider distribution.

## Portable behavior

The portable ZIP contains `Serein.exe` and `PORTABLE-README.txt`. It runs without installation and writes application preferences to the current user's application-data directory, never beside the executable. Vault-local data remains under `.serein/` in the selected vault. Installed and portable builds therefore share the same safe vault format without duplicating vault content.

## Preview safety gates

- The preview accepts only generated test vaults containing Serein's synthetic-vault marker. Arbitrary personal folders are not enabled.
- Installer and uninstaller tests must hash a generated synthetic vault before and after the lifecycle.
- Uninstall must remove only the application installation; vault-local `.serein/`, notes, and attachments are not installer-owned.
- A true offline installer is not claimed by the normal Setup artifact. An offline WebView2 package remains a separate future release artifact.

## Manual release matrix

The release candidate must be checked at Windows display scaling 100%, 125%, and 150%, together with Serein UI scaling. Verify tabs, dialogs, Settings, editor/preview/sidebar typography, panel resizing, and restored window geometry. Perform the matrix in an isolated Windows VM or test profile so the primary desktop configuration is not disrupted.

## Acceptance status

The application, Setup package, portable archive, automated tests, and packaged smoke checks are suitable for an early technical preview. Final production readiness is **not** claimed. Clean-machine install/offline/uninstall testing, current-identity upgrade testing, and clean-machine performance measurements remain required before Phase 1 can be declared fully accepted.
