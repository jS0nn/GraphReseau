import unittest

from app.models import PlanOverlayMedia
from app.services.plan_overlay import PlanOverlayMediaService


class PlanOverlayMediaServiceTests(unittest.TestCase):
    def test_fetch_prefers_png_drive_ids(self):
        service = PlanOverlayMediaService()
        calls = []

        original_download = service._download_drive

        def fake_download(file_id, *, transparent):  # type: ignore[override]
            calls.append((file_id, transparent))
            return b"data", "image/png"

        service._download_drive = fake_download  # type: ignore[assignment]
        try:
            media = PlanOverlayMedia(
                drive_file_id="source-file",
                drive_png_original_id="png-original",
                drive_png_transparent_id="png-transparent",
                type="image/png",
                source="drive",
            )

            payload, mime, ttl = service.fetch_media(media, transparent=True)
            self.assertEqual(payload, b"data")
            self.assertEqual(mime, "image/png")
            self.assertIsInstance(ttl, int)
            self.assertGreater(ttl, 0)
            self.assertEqual(calls[-1], ("png-transparent", False))

            payload, mime, ttl = service.fetch_media(media, transparent=False)
            self.assertEqual(calls[-1], ("png-original", False))
        finally:
            service._download_drive = original_download  # type: ignore[assignment]


if __name__ == "__main__":
    unittest.main()

