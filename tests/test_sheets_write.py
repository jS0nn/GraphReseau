import unittest
from unittest.mock import patch

from app.models import Graph, Node, Edge
from app.sheets import (
    write_nodes_edges,
    NODE_HEADERS_FR_V10,
    EXTRA_SHEET_HEADERS,
    EDGE_HEADERS_FR_V5,
)


class _FakeResponse:
    def __init__(self, payload=None):
        self._payload = payload or {}

    def execute(self):
        return self._payload


class _FakeValuesService:
    def __init__(self, existing_nodes_values):
        self._existing_nodes_values = existing_nodes_values
        self.clear_calls = []
        self.batch_kwargs = None
        self.update_calls = []

    def get(self, *, spreadsheetId, range):  # noqa: A003 - match API signature
        if "Nodes" in range:
            return _FakeResponse({"values": self._existing_nodes_values})
        return _FakeResponse({"values": []})

    def clear(self, *, spreadsheetId, range):  # noqa: A003
        self.clear_calls.append(range)
        return _FakeResponse({})

    def batchUpdate(self, *, spreadsheetId, body):  # noqa: A003
        self.batch_kwargs = body
        return _FakeResponse({})

    def update(self, *, spreadsheetId, range, valueInputOption, body):  # noqa: A003
        self.update_calls.append({
            "range": range,
            "valueInputOption": valueInputOption,
            "body": body,
        })
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


class SheetsWriteTests(unittest.TestCase):
    def test_write_preserves_existing_xy_and_formats_edges(self):
        base_row = [
            "N1", "Node 1", "OUVRAGE", "", "", "", "", "", "", "",
            "", "", "", "", 10, 20, "", "",
        ]
        existing_nodes = [
            NODE_HEADERS_FR_V10,
            base_row + ["" for _ in EXTRA_SHEET_HEADERS],
        ]
        values_service = _FakeValuesService(existing_nodes)
        fake_client = _FakeSheetsClient(values_service)

        graph = Graph(
            style_meta={"mode": "continuous", "width_px": {"min": 2, "max": 8}},
            nodes=[
                Node(id="N1", name="Node 1", type="OUVRAGE", x=100, y=200, x_ui=100, y_ui=200, branch_id="B-1"),
                Node(id="N2", name="Node 2", type="OUVRAGE", x=300, y=400, x_ui=300, y_ui=400, branch_id="B-1"),
            ],
            edges=[
                Edge(
                    id="E1",
                    from_id="N1",
                    to_id="N2",
                    active=True,
                    commentaire="Demo",
                    geometry=[[1.1, 2.2], [3.3, 4.4]],
                    branch_id="B-1",
                    diameter_mm=110.0,
                    length_m=42.0,
                    material="PVC",
                    sdr="17",
                )
            ],
        )

        with patch("app.sheets._client", return_value=fake_client):
            write_nodes_edges("sheet123", "Nodes", "Edges", graph)

        # Ensure both tabs are cleared before writing
        self.assertEqual(
            set(values_service.clear_calls),
            {"Nodes!A:ZZZ", "Edges!A:ZZZ"},
        )

        body = values_service.batch_kwargs
        self.assertIsNotNone(body)
        nodes_payload = body["data"][0]["values"]
        edges_payload = body["data"][1]["values"]

        # Headers should match the latest layouts
        self.assertEqual(nodes_payload[0], NODE_HEADERS_FR_V10 + EXTRA_SHEET_HEADERS)
        self.assertEqual(edges_payload[0], EDGE_HEADERS_FR_V5)

        # First row is headers, second row is N1 data
        n1_row = nodes_payload[1]
        x_index = NODE_HEADERS_FR_V10.index("x")
        y_index = NODE_HEADERS_FR_V10.index("y")
        self.assertEqual(n1_row[x_index], 10)
        self.assertEqual(n1_row[y_index], 20)

        # Edge row should include commentaire, formatted geometry and branch/material data
        e1_row = edges_payload[1]
        self.assertEqual(e1_row[0], "E1")
        self.assertEqual(e1_row[1], "N1")
        self.assertEqual(e1_row[2], "N2")
        self.assertEqual(e1_row[3], 110.0)
        self.assertEqual(e1_row[4], 42.0)
        self.assertEqual(e1_row[5], True)
        self.assertEqual(e1_row[6], "Demo")
        self.assertEqual(e1_row[7], "1.1 2.2; 3.3 4.4")
        self.assertEqual(e1_row[8], "B-1")
        self.assertEqual(e1_row[9], "PVC")
        self.assertEqual(e1_row[10], "17")

        # STYLE_META sheet should be updated with the serialized style meta
        style_calls = [call for call in values_service.update_calls if call["range"] == "STYLE_META!A1:B1"]
        self.assertTrue(style_calls)
        meta_row = style_calls[-1]["body"]["values"][0]
        self.assertEqual(meta_row[0], "style_meta")
        self.assertIn("width_px", meta_row[1])


if __name__ == "__main__":
    unittest.main()
