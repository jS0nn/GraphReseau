import json
import os
import tempfile
import unittest

from fastapi import HTTPException

from app.datasources import load_graph, save_graph
from app.models import Edge, Graph, Node


class DatasourceDispatchTests(unittest.TestCase):
    def test_unknown_source_raises(self):
        with self.assertRaises(HTTPException):
            load_graph(source="unknown")
        with self.assertRaises(HTTPException):
            save_graph(source="unknown", graph=Graph())

    def test_save_and_load_local_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "graph.json")
            uri = f"file://{path}"
            graph = Graph(
                nodes=[Node(id="A"), Node(id="B")],
                edges=[
                    Edge(
                        id="E1",
                        from_id="A",
                        to_id="B",
                        branch_id="BR-1",
                        diameter_mm=63.0,
                        material="PVC",
                        sdr="17",
                    )
                ],
            )

            save_graph(source="json", graph=graph, gcs_uri=uri)

            # Ensure file exists and is valid JSON
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
                self.assertIn("nodes", data)
                self.assertIn("edges", data)

            loaded = load_graph(source="json", gcs_uri=uri)
            expected_nodes = {"OUVRAGE-A", "OUVRAGE-B"}
            self.assertEqual({node.id for node in loaded.nodes}, expected_nodes)
            self.assertEqual(len(loaded.edges), 1)
            self.assertEqual(loaded.edges[0].from_id, "OUVRAGE-A")
            self.assertEqual(loaded.edges[0].to_id, "OUVRAGE-B")


if __name__ == "__main__":
    unittest.main()
