import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from land_publisher_code_v2 import service_headers  # noqa: E402


class ServiceHeaderTest(unittest.TestCase):
    def test_sb_secret_sends_apikey_only(self):
        headers = service_headers("sb_secret_example")
        self.assertEqual(headers, {"apikey": "sb_secret_example"})
        self.assertNotIn("Authorization", headers)

    def test_jwt_keeps_bearer(self):
        headers = service_headers("eyJhbGciOiJIUzI1NiJ9.e30.sig")
        self.assertEqual(headers["apikey"], "eyJhbGciOiJIUzI1NiJ9.e30.sig")
        self.assertEqual(headers["Authorization"], "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig")


if __name__ == "__main__":
    unittest.main()
