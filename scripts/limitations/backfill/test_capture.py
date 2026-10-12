import builtins
import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import capture


class CaptureByteIdentityTests(unittest.TestCase):
    def test_proxy_html_breaks_and_markdown_hard_breaks_leave_only_plain_text(self):
        raw = "First\\\nline<br>Second\\<br/>line<BR />Third line."
        self.assertEqual(capture.markdown_to_text(raw), "First\nline\nSecond\nline\nThird line.\n")

    def test_proxy_table_cells_and_doubly_escaped_citation_breaks_are_plain(self):
        raw = "| **Synthetic heading**<br>second line |\n| --- |\n[128 AD3d\\\\\n808](https://example.gov/case)"
        self.assertEqual(capture.markdown_to_text(raw), "Synthetic heading\nsecond line\n\n128 AD3d\n808\n")

    def run_capture(self, intermediary):
        raw = ("<p>Synthetic official text, not law. First line.</p>\n"
               "<p>Second line includes café and a retained newline.</p>\n") * 8
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "input.txt"
            source.write_bytes(raw.encode("utf-8"))
            args = ["capture.py", "NY", "fixture", "https://example.gov/statute"]
            if intermediary:
                args += ["--text-file", str(source), "--method", "synthetic fixture"]
            response = SimpleNamespace(
                status_code=200, content=raw.encode("utf-8"),
                headers={"Content-Type": "text/html; charset=utf-8"},
                url="https://example.gov/statute",
            )
            original_open = builtins.open

            def windows_text_open(file, mode="r", *args, **kwargs):
                # Exercise Windows newline translation on every CI OS. Binary writes stay exact.
                if mode == "w" and "newline" not in kwargs:
                    kwargs["newline"] = "\r\n"
                return original_open(file, mode, *args, **kwargs)

            with patch.object(capture, "WORK", folder), patch("sys.argv", args), \
                    patch.object(capture.requests, "get", return_value=response) as request, \
                    patch("builtins.open", windows_text_open), contextlib.redirect_stdout(io.StringIO()):
                capture.main()
            if intermediary:
                request.assert_not_called()
            else:
                request.assert_called_once()
            base = Path(folder) / "captures" / "NY" / "fixture"
            meta = json.loads(base.with_suffix(".json").read_bytes())
            stored_raw = base.with_suffix(".raw").read_bytes()
            stored_text = base.with_suffix(".txt").read_bytes()
            self.assertEqual(stored_raw, raw.encode("utf-8"))
            self.assertEqual(meta["rawSha256"], hashlib.sha256(stored_raw).hexdigest())
            self.assertEqual(meta["textBytes"], len(stored_text))
            self.assertEqual(meta["textSha256"], hashlib.sha256(stored_text).hexdigest())
            expected = raw if intermediary else capture.html_to_text(stored_raw, "utf-8")
            self.assertEqual(stored_text, expected.encode("utf-8"))

    def test_direct_capture_hashes_the_exact_stored_text_bytes(self):
        self.run_capture(intermediary=False)

    def test_intermediary_capture_hashes_the_exact_stored_text_bytes(self):
        self.run_capture(intermediary=True)


if __name__ == "__main__":
    unittest.main()
