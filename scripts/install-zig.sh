#!/usr/bin/env bash
set -euo pipefail

DESTINATION="${1:-$(pwd)/.tools/zig-0.15.2}"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)
    ARCHIVE="zig-aarch64-macos-0.15.2"
    HASH="3cc2bab367e185cdfb27501c4b30b1b0653c28d9f73df8dc91488e66ece5fa6b"
    ;;
  Linux-x86_64)
    ARCHIVE="zig-x86_64-linux-0.15.2"
    HASH="02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239"
    ;;
  *) echo "Supported toolchain hosts: macOS arm64 and Linux x86_64" >&2; exit 1 ;;
esac

if [ -e "$DESTINATION" ]; then
  echo "Destination already exists; choose an empty path: $DESTINATION" >&2
  exit 1
fi
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/zig-download.XXXXXX")
trap 'rm -rf "$SCRATCH"' EXIT
curl --fail --location --max-time 180 "https://ziglang.org/download/0.15.2/$ARCHIVE.tar.xz" -o "$SCRATCH/zig.tar.xz"
printf '%s  %s\n' "$HASH" "$SCRATCH/zig.tar.xz" | shasum -a 256 --check
tar -xJf "$SCRATCH/zig.tar.xz" -C "$SCRATCH"
[ "$("$SCRATCH/$ARCHIVE/zig" version)" = "0.15.2" ]
mkdir -p "$(dirname "$DESTINATION")"
mv "$SCRATCH/$ARCHIVE" "$DESTINATION"
echo "Installed verified Zig 0.15.2 at $DESTINATION"
