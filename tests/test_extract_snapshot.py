import importlib.util
import io
import tarfile
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("extract_snapshot", ROOT / "deploy/extract-snapshot.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
STAMP = "20260929T121314Z"


class ExtractSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "snapshot.tar.gz"

    def write_archive(self, members):
        with tarfile.open(self.archive, "w:gz") as output:
            for name, kind, data in members:
                info = tarfile.TarInfo(name)
                if kind == "file":
                    info.size = len(data)
                    output.addfile(info, io.BytesIO(data))
                elif kind == "symlink":
                    info.type = tarfile.SYMTYPE
                    info.linkname = data.decode()
                    output.addfile(info)

    def test_extracts_regular_snapshot(self):
        self.write_archive([(f"{STAMP}/delivery.sqlite", "file", b"sqlite"),
                            (f"{STAMP}/snapshot.json", "file", b"{}")])
        MODULE.extract(self.archive, self.root / "extracted", STAMP)
        self.assertEqual((self.root / "extracted" / STAMP / "delivery.sqlite").read_bytes(), b"sqlite")

    def test_rejects_parent_traversal(self):
        self.write_archive([(f"{STAMP}/../../escape", "file", b"unsafe")])
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            MODULE.extract(self.archive, self.root / "extracted", STAMP)
        self.assertFalse((self.root / "escape").exists())

    def test_rejects_symlink(self):
        self.write_archive([(f"{STAMP}/releases", "symlink", b"/tmp")])
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            MODULE.extract(self.archive, self.root / "extracted", STAMP)

    def test_rejects_duplicate_file(self):
        self.write_archive([(f"{STAMP}/snapshot.json", "file", b"first"),
                            (f"{STAMP}/snapshot.json", "file", b"second")])
        with self.assertRaises(FileExistsError):
            MODULE.extract(self.archive, self.root / "extracted", STAMP)


if __name__ == "__main__":
    unittest.main()
