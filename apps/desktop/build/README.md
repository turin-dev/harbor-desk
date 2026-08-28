# Windows installer branding

These checked-in resources brand the Harbor Desk assisted NSIS installer and
the installed Windows executable:

- `icon.ico`: multi-resolution application, installer, and uninstaller icon.
- `icon.png`: high-resolution preview/source raster.
- `installerHeader.bmp`: 150 x 57, 24-bit NSIS header image.
- `installerSidebar.bmp`: 164 x 314, 24-bit install welcome/finish image.
- `uninstallerSidebar.bmp`: 164 x 314, 24-bit uninstall image.

The design extends the blue code-bracket mark already used by Harbor Desk's
tray and in-app branding. The generated files are committed so normal Node.js
builds do not acquire a Python dependency.

To intentionally regenerate them, install Pillow in a Python environment and
run from the repository root:

```powershell
python scripts/generate-installer-assets.py
```

`apps/desktop/package.json` pins the NSIS GUID to the identifier already used by
the v0.3.1 per-user installation. Do not replace it with a new GUID: doing so
would break silent upgrades and leave a parallel uninstall entry.
