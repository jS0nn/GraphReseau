import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.models import Edge, Graph, Node


class APIGraphContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch("app.routers.api.load_graph")
    def test_get_returns_graph_payload_for_frontend(self, mock_load):
        mock_load.return_value = Graph(
            version="1.5",
            site_id="c034bf83",
            style_meta={"mode": "continuous"},
            nodes=[
                Node(id="N1", name="Source", x=12, y=34, gps_lat=1.0, gps_lon=2.0, branch_id="B-ROOT"),
                Node(id="N2", name="Destination", x=56, y=78, branch_id="B-1"),
            ],
            edges=[
                Edge(
                    id="E-1",
                    from_id="N1",
                    to_id="N2",
                    active=True,
                    commentaire="test edge",
                    geometry=[[2.0, 1.0], [3.0, 2.0]],
                    branch_id="B-1",
                    diameter_mm=90.0,
                    length_m=24.5,
                    material="PVC",
                    sdr="17",
                )
            ],
        )

        response = self.client.get("/api/graph")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["version"], "1.5")
        self.assertEqual(data["site_id"], "c034bf83")
        self.assertEqual(data["style_meta"], {"mode": "continuous"})
        self.assertEqual(len(data["nodes"]), 2)
        self.assertEqual(len(data["edges"]), 1)
        edge = data["edges"][0]
        self.assertEqual(edge["id"], "E-1")
        self.assertEqual(edge["geometry"], [[2.0, 1.0], [3.0, 2.0]])
        self.assertTrue(edge["active"])
        self.assertEqual(edge["branch_id"], "B-1")
        self.assertEqual(edge["diameter_mm"], 90.0)

    @patch("app.routers.api.save_graph")
    def test_post_accepts_frontend_sanitized_payload(self, mock_save):
        captured = {}

        def fake_save(*, graph, **kwargs):
            captured["graph"] = graph

        mock_save.side_effect = fake_save

        payload = {
            "version": "1.5",
            "site_id": "demo-site",
            "generated_at": "2024-05-01T12:00:00Z",
            "style_meta": {"mode": "continuous", "width_px": {"min": 2, "max": 9}},
            "nodes": [
                {
                    "id": "N1",
                    "name": "Source",
                    "type": "OUVRAGE",
                    "x": 12,
                    "y": 34,
                    "x_ui": 12,
                    "y_ui": 34,
                    "diameter_mm": None,
                    "gps_lat": 1.0,
                    "gps_lon": 2.0,
                    "branch_id": "",
                    "commentaire": "",
                },
                {
                    "id": "N2",
                    "name": "Destination",
                    "type": "OUVRAGE",
                    "x": 56,
                    "y": 78,
                    "x_ui": 56,
                    "y_ui": 78,
                    "diameter_mm": None,
                    "gps_lat": None,
                    "gps_lon": None,
                    "branch_id": "",
                    "commentaire": "",
                },
            ],
            "edges": [
                {
                    "id": "E-ABC",
                    "from_id": "N1",
                    "to_id": "N2",
                    "active": True,
                    "commentaire": "",
                    "geometry": [[2.0, 1.0], [3.0, 2.0]],
                    "branch_id": "B-123",
                    "diameter_mm": 75,
                    "length_m": 18.2,
                    "material": "PVC",
                    "sdr": "17",
                }
            ],
        }

        response = self.client.post("/api/graph", json=payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        self.assertIn("graph", captured)
        stored = captured["graph"]
        self.assertIsInstance(stored, Graph)
        self.assertEqual(stored.version, "1.5")
        self.assertEqual(stored.site_id, "demo-site")
        self.assertEqual(stored.style_meta, {"mode": "continuous", "width_px": {"min": 2, "max": 9}})
        self.assertEqual(len(stored.nodes), 2)
        self.assertEqual(len(stored.edges), 1)
        edge = stored.edges[0]
        self.assertEqual(edge.id, "E-ABC")
        self.assertEqual(edge.geometry, [[2.0, 1.0], [3.0, 2.0]])
        self.assertTrue(edge.active)
        self.assertEqual(edge.branch_id, "B-123")
        self.assertEqual(edge.diameter_mm, 75)


if __name__ == "__main__":
    unittest.main()
