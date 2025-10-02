import unittest
from unittest.mock import patch

from app.models import PlanOverlayConfig
from app.sheets import write_plan_overlay_media_config, clear_plan_overlay_media_config


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def execute(self):
        return self._payload


class _FakeValuesService:
    def __init__(self, header, rows):
        self.header = list(header)
        self.rows = [list(row) for row in rows]
        self.update_calls = []

    # Google Sheets Values get
    def get(self, *, spreadsheetId, range):  # noqa: D401 - mimic API
        return _FakeResponse({"values": [self.header] + self.rows})

    def update(self, *, spreadsheetId, range, valueInputOption, body):  # noqa: D401 - mimic API
        self.update_calls.append({
            "range": range,
            "body": body,
        })
        values = body.get("values", [])
        if not values:
            return _FakeResponse({})
        row_values = list(values[0])
        if range.endswith("A1"):
            self.header = row_values
        else:
            # Range like PlanOverlay!A{row_number}
            target = range.split("!")[-1]
            row_number = int(''.join(filter(str.isdigit, target)) or 2)
            index = max(0, row_number - 2)
            while len(self.rows) <= index:
                self.rows.append([])
            self.rows[index] = row_values
        return _FakeResponse({})


class _FakeSpreadsheetsService:
    def __init__(self, values_service):
        self._values_service = values_service

    def values(self):
        return self._values_service


class _FakeSheetsClient:
    def __init__(self, values_service):
        self._spreadsheets = _FakeSpreadsheetsService(values_service)

    def spreadsheets(self):
        return self._spreadsheets


class PlanOverlaySheetsTests(unittest.TestCase):
    def test_write_plan_overlay_media_config_updates_drive_columns(self):
        header = [
            "site_id",
            "display_name",
            "drive_file_id",
            "media_type",
            "media_source",
            "url",
            "cache_max_age_s",
            "corner_sw_lat",
            "corner_sw_lon",
            "corner_se_lat",
            "corner_se_lon",
            "corner_nw_lat",
            "corner_nw_lon",
            "corner_ne_lat",
            "corner_ne_lon",
            "enabled",
        ]
        row = [
            "site-001",
            "Ancien plan",
            "drive-original",
            "application/pdf",
            "drive",
            "",
            "600",
            "45.0",
            "4.0",
            "45.0",
            "4.1",
            "45.1",
            "4.0",
            "45.1",
            "4.1",
            "TRUE",
        ]
        values_service = _FakeValuesService(header, [row])
        fake_client = _FakeSheetsClient(values_service)

        with patch("app.sheets._client", return_value=fake_client):
            config = write_plan_overlay_media_config(
                "sheet123",
                site_id="site-001",
                display_name="Nouveau plan",
                source_drive_file_id="drive-source",
                png_original_id="png-original",
                png_transparent_id="png-transparent",
                fallback_bounds=None,
            )

        # Header should now include the new PNG columns
        self.assertIn("drive_png_original_id", [h.strip().lower() for h in values_service.header])
        self.assertIn("drive_png_transparent_id", [h.strip().lower() for h in values_service.header])
        self.assertIn("source_drive_file_id", [h.strip().lower() for h in values_service.header])

        # Updated row should reference the new PNG identifiers
        updated_row = values_service.rows[0]
        header_map = {h.strip().lower(): idx for idx, h in enumerate(values_service.header)}
        self.assertEqual(updated_row[header_map["display_name"]], "Nouveau plan")
        self.assertEqual(updated_row[header_map["drive_file_id"]], "png-original")
        self.assertEqual(updated_row[header_map["drive_png_original_id"]], "png-original")
        self.assertEqual(updated_row[header_map["drive_png_transparent_id"]], "png-transparent")
        self.assertEqual(updated_row[header_map["source_drive_file_id"]], "drive-source")
        self.assertEqual(updated_row[header_map["media_type"]], "image/png")

        self.assertIsInstance(config, PlanOverlayConfig)
        self.assertEqual(config.display_name, "Nouveau plan")
        self.assertEqual(config.media.drive_file_id, "png-original")
        self.assertEqual(config.media.drive_png_transparent_id, "png-transparent")

    def test_clear_plan_overlay_media_config_blanks_drive_columns(self):
        header = [
            "site_id",
            "display_name",
            "drive_file_id",
            "drive_png_original_id",
            "drive_png_transparent_id",
            "source_drive_file_id",
            "media_type",
            "media_source",
            "enabled",
        ]
        row = [
            "site-002",
            "Plan en place",
            "drive-original",
            "png-original",
            "png-transparent",
            "drive-source",
            "image/png",
            "drive",
            "TRUE",
        ]
        values_service = _FakeValuesService(header, [row])
        fake_client = _FakeSheetsClient(values_service)

        with patch("app.sheets._client", return_value=fake_client):
            clear_plan_overlay_media_config("sheet456", site_id="site-002")

        self.assertEqual(len(values_service.rows), 0)
