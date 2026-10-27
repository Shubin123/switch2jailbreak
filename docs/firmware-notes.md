# Firmware preservation and version check

## Check your firmware version

1. Power on the Switch 2 (do **not** connect to Wi-Fi first).
2. Open **System Settings → System → System Update**.
3. Record the version number shown. Do **not** accept any update.

## Target firmware

The upstream ns2jb demo was physically tested on **23.0.1** (October 21, 2026).
No other firmware version has confirmed compatibility in the upstream README.

## Preservation rules

- **Do not update** your firmware. An update may patch the vulnerability.
- **Disable auto-update**: System Settings → System → Auto-Update Software → Off.
- **Block update servers** (optional, network-level):
  You can block Nintendo update domains at your router's DNS level. Common
  domains include `conntest.nintendowifi.net` and `sun.hac.lp1.d4c.nintendo.net`.
  This is a precaution, not a guarantee.
- **Airplane mode** is the safest default when not actively using online features.

## If you're on a different version

- **Below 23.0.1**: may or may not work. Upstream does not document older versions.
  Do not update to reach 23.0.1 — the exploit surface may differ.
- **Above 23.0.1**: likely patched. Preserve the version anyway; future exploits
  may target it.
- **Exactly 23.0.1**: you are on the tested firmware. Proceed with environment setup.

## Console serial and hardware revision

Record your console's serial number prefix (visible on the bottom of the unit
or in System Settings → Serial Information). This can help identify your
hardware revision if exploit compatibility varies by manufacturing batch.
