import unittest

from fastapi import HTTPException

from app.models import Edge, Graph, Node
from app.services.graph_sanitizer import sanitize_graph_for_write, graph_to_persistable_payload


class GraphSanitizerTests(unittest.TestCase):
    def test_missing_diameter_raises(self):
        graph = Graph(
            nodes=[Node(id="A"), Node(id="B")],
            edges=[
                Edge(
                    id="E1",
                    from_id="A",
                    to_id="B",
                    branch_id="BR-1",
                    diameter_mm=None,
                    material="PVC",
                    sdr="17",
                )
            ],
        )

        with self.assertRaises(HTTPException) as ctx:
            sanitize_graph_for_write(graph)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("diameter_mm", ctx.exception.detail)

    def test_material_and_sdr_are_normalised(self):
        graph = Graph(
            nodes=[Node(id="A"), Node(id="B")],
            edges=[
                Edge(
                    id="E1",
                    from_id="A",
                    to_id="B",
                    branch_id="BR-1",
                    diameter_mm=63.5,
                    material="pehd ",
                    sdr=" 17 ",
                )
            ],
        )

        cleaned = sanitize_graph_for_write(graph)

        edge = cleaned.edges[0]
        self.assertEqual(edge.material, "PEHD")
        self.assertEqual(edge.sdr, "17")

    def test_computes_length_from_geometry(self):
        graph = Graph(
            nodes=[Node(id="A"), Node(id="B")],
            edges=[
                Edge(
                    id="E1",
                    from_id="A",
                    to_id="B",
                    branch_id="BR-1",
                    diameter_mm=110.0,
                    material="PVC",
                    sdr="17",
                    geometry=[[2.0, 48.0], [2.0, 48.001]],
                    length_m=None,
                )
            ],
        )

        cleaned = sanitize_graph_for_write(graph)

        edge = cleaned.edges[0]
        self.assertIsNotNone(edge.length_m)
        self.assertAlmostEqual(edge.length_m, 111.2, delta=0.5)

    def test_pm_anchor_must_use_incoming_edge(self):
        pm_node = Node(
            id="POINT_MESURE-1",
            type="POINT_MESURE",
            pm_collector_edge_id="E2",
            pm_offset_m=5.0,
        )
        graph = Graph(
            nodes=[Node(id="A"), pm_node],
            edges=[
                Edge(
                    id="E1",
                    from_id="A",
                    to_id="POINT_MESURE-1",
                    branch_id="BR-1",
                    diameter_mm=63.0,
                    material="PVC",
                    sdr="17",
                    geometry=[[2.0, 48.0], [2.0, 48.0001]],
                ),
                Edge(
                    id="E2",
                    from_id="POINT_MESURE-1",
                    to_id="A",
                    branch_id="BR-1",
                    diameter_mm=63.0,
                    material="PVC",
                    sdr="17",
                ),
            ],
        )

        with self.assertRaises(HTTPException) as ctx:
            sanitize_graph_for_write(graph)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("anchor edge invalid", ctx.exception.detail)

    def test_pm_offset_cannot_exceed_edge_length(self):
        pm_node = Node(
            id="POINT_MESURE-1",
            type="POINT_MESURE",
            pm_collector_edge_id="E1",
            pm_offset_m=500.0,
        )
        graph = Graph(
            nodes=[Node(id="A"), pm_node],
            edges=[
                Edge(
                    id="E1",
                    from_id="A",
                    to_id="POINT_MESURE-1",
                    branch_id="BR-1",
                    diameter_mm=90.0,
                    material="PVC",
                    sdr="17",
                    geometry=[[2.0, 48.0], [2.0, 48.001]],
                )
            ],
        )

        with self.assertRaises(HTTPException) as ctx:
            sanitize_graph_for_write(graph)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("pm_offset_m exceeds edge length", ctx.exception.detail)

    def test_rejects_ui_fields_on_strict_mode(self):
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
                    ui_diameter_mm=120,
                )
            ],
        )

        with self.assertRaises(HTTPException) as ctx:
            sanitize_graph_for_write(graph)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("forbidden_fields", ctx.exception.detail.get("error", ""))

    def test_clamps_pm_offset_to_edge_length(self):
        edge = Edge(
            id="E1",
            from_id="A",
            to_id="POINT_MESURE-1",
            branch_id="BR-1",
            diameter_mm=63.0,
            material="PVC",
            sdr="17",
            geometry=[[2.0, 48.0], [2.0, 48.0001]],
        )
        pm_node = Node(
            id="POINT_MESURE-1",
            type="POINT_MESURE",
            pm_collector_edge_id="E1",
            pm_offset_m=11.5,
        )
        graph = Graph(nodes=[Node(id="A"), pm_node], edges=[edge])

        cleaned = sanitize_graph_for_write(graph, strict=True)

        node = next(n for n in cleaned.nodes if n.id == "POINT_MESURE-1")
        edge_length = cleaned.edges[0].length_m
        self.assertLessEqual(node.pm_offset_m, edge_length)
        self.assertAlmostEqual(node.pm_offset_m, edge_length, places=2)

    def test_graph_payload_filters_edge_fields(self):
        edge = Edge(
            id="E1",
            from_id="A",
            to_id="B",
            branch_id="BR-1",
            diameter_mm=110.0,
            material="pehd",
            sdr="17",
            extras={},
            geometry=[[2.0, 48.0], [2.001, 48.001]],
            length_m=None,
        )
        graph = Graph(nodes=[Node(id="A"), Node(id="B")], edges=[edge])
        cleaned = sanitize_graph_for_write(graph, strict=True)
        payload = graph_to_persistable_payload(cleaned)

        edge_payload = payload["edges"][0]
        self.assertNotIn("extras", edge_payload)
        self.assertNotIn("site_id", edge_payload)
        self.assertEqual(edge_payload["material"], "PEHD")
        self.assertIsNotNone(edge_payload["length_m"])
        self.assertGreater(edge_payload["length_m"], 0)


if __name__ == "__main__":
    unittest.main()
