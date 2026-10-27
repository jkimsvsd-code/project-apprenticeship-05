"""Restore unchanged upstream fonts, licenses and metadata at one reviewed commit.

Run explicitly from this repository: python scripts/fetch-fonts.py
The application never runs this script or contacts Google Fonts at runtime.
"""

import hashlib
import json
from pathlib import Path
import struct
import urllib.parse
import urllib.request

COMMIT = "47d54ca1ebb14fd864695f1d39dc734f39017c33"
ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "apps/demo/public/assets/fonts"
FONTS = [
    ("Noto Sans KR", "notosanskr", "NotoSansKR[wght].ttf", "NotoSansKR-Variable.ttf"),
    ("Noto Serif KR", "notoserifkr", "NotoSerifKR[wght].ttf", "NotoSerifKR-Variable.ttf"),
    ("Jua", "jua", "Jua-Regular.ttf", "Jua-Regular.ttf"),
]


def font_names(data: bytes) -> dict:
    count = struct.unpack_from(">H", data, 4)[0]
    for index in range(count):
        tag, _, offset, _ = struct.unpack_from(">4sIII", data, 12 + index * 16)
        if tag != b"name":
            continue
        _, name_count, string_offset = struct.unpack_from(">HHH", data, offset)
        names = {}
        for name_index in range(name_count):
            platform, _, language, name_id, length, start = struct.unpack_from(
                ">HHHHHH", data, offset + 6 + name_index * 12
            )
            if platform not in (0, 3) or name_id not in (0, 5):
                continue
            value = data[offset + string_offset + start: offset + string_offset + start + length]
            key = "copyright" if name_id == 0 else "version"
            if key not in names or language == 0x409:
                names[key] = value.decode("utf-16-be")
        return names
    raise ValueError("No TrueType name table")


def download(source: str, destination: Path) -> dict:
    source_path = urllib.parse.quote(source, safe="/")
    url = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/{source_path}"
    request = urllib.request.Request(url, headers={"User-Agent": "jjal-card-studio-local-font-restore"})
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return {
        "sourceUrl": url,
        "sourcePath": source,
        "localPath": destination.relative_to(ROOT).as_posix(),
        "sha256": hashlib.sha256(data).hexdigest(),
        "byteLength": len(data),
    }


def main() -> None:
    entries = []
    for family, directory, source_file, local_file in FONTS:
        target = DESTINATION / directory
        font = download(f"ofl/{directory}/{source_file}", target / local_file)
        license_file = download(f"ofl/{directory}/OFL.txt", target / "OFL.txt")
        metadata = download(f"ofl/{directory}/METADATA.pb", target / "METADATA.pb")
        names = font_names((ROOT / font["localPath"]).read_bytes())
        entries.append({
            "family": family,
            "sourceRepository": "https://github.com/google/fonts",
            "sourceCommit": COMMIT,
            "license": "OFL-1.1",
            "modified": False,
            **names,
            "licenseCopyright": (target / "OFL.txt").read_text(encoding="utf-8").splitlines()[0],
            "files": {"font": font, "license": license_file, "metadata": metadata},
        })
    (DESTINATION / "manifest.json").write_text(
        json.dumps({"schemaVersion": 1, "fonts": entries}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    for entry in entries:
        print(f"{entry['family']}: {entry['version']}; {entry['files']['font']['sha256']}")


if __name__ == "__main__":
    main()
