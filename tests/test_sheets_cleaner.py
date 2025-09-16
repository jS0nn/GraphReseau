import unittest

from app.datasources.sheets import _clean_sheet_id


class CleanSheetIdTests(unittest.TestCase):
    def test_returns_empty_on_none(self):
        self.assertEqual(_clean_sheet_id(None), "")

    def test_strips_trailing_slash_and_spaces(self):
        self.assertEqual(_clean_sheet_id(" abc/"), "abc")

    def test_strips_urlencoded_slashes(self):
        self.assertEqual(_clean_sheet_id("abc%2F%2F"), "abc")


if __name__ == "__main__":
    unittest.main()
