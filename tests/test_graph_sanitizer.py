import unittest
from typing import Optional

from fastapi import HTTPException

from app.models import Edge, Graph, Node, BranchInfo
from app.services.graph_sanitizer import sanitize_graph_for_write, graph_to_persistable_payload


DEFAULT_SITE_ID = "SITE-TEST"
DEFAULT_GENERATED_AT = "2025-01-01T00:00:00Z"


def make_node(node_id: str, *, node_type: str = "OUVRAGE", branch: str = "BR-1", **overrides) -> Node:
    base = {
        "id": node_id,
        "type": node_type,
        "name": "",
        "branch_id": branch,
        "site_id": DEFAULT_SITE_ID,
        "gps_lat": 48.0,
        "gps_lon": 2.0,
        "gps_locked": True,
        "extras": {},
    }
    base.update(overrides)
    return Node(**base)


def make_edge(
    edge_id: str,
    from_id: str,
    to_id: str,
    *,
    branch: str = "BR-1",
    diameter: float = 63.0,
    geometry: Optional[list] = None,
    **overrides,
) -> Edge:
    if geometry is None:
        geometry = [[2.0, 48.0], [2.0, 48.0005]]
    base = {
        "id": edge_id,
        "from_id": from_id,
        "to_id": to_id,
        "branch_id": branch,
        "diameter_mm": diameter,
        "material": "PVC",
        "sdr": "17",
        "geometry": geometry,
        "length_m": None,
        "active": True,
        "created_at": "2025-01-01T00:00:00Z",
    }
    base.update(overrides)
    return Edge(**base)


def make_graph(*, nodes: list[Node], edges: list[Edge], generated_at: Optional[str] = DEFAULT_GENERATED_AT) -> Graph:
    return Graph(
        version="1.5",
        site_id=DEFAULT_SITE_ID,
        generated_at=generated_at,
        nodes=nodes,
        edges=edges,
    )


class GraphSanitizerTests(unittest.TestCase):
    def test_missing_diameter_raises(self):
        node_a = make_node("OUVRAGE-A")
        node_b = make_node("OUVRAGE-B")
        edge = make_edge("E1", node_a.id, node_b.id, diameter=None)
        graph = make_graph(nodes=[node_a, node_b], edges=[edge])

        with self.assertRaises(HTTPException) as ctx:
            sanitize_graph_for_write(graph)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("diameter_mm", ctx.exception.detail)

    def test_material_and_sdr_are_normalised(self):
        node_a = make_node("OUVRAGE-A")
        node_b = make_node("OUVRAGE-B")
        edge = make_edge(
            "E1",
            node_a.id,
            node_b.id,
            diameter=63.5,
            material="pehd ",
            sdr=" 17 ",
        )
        graph = make_graph(nodes=[node_a, node_b], edges=[edge])

        cleaned = sanitize_graph_for_write(graph)

        edge = cleaned.edges[0]
        self.assertEqual(edge.material, "PEHD")
        self.assertEqual(edge.sdr, "17")

    def test_computes_length_from_geometry(self):
        node_a = make_node("OUVRAGE-A")
        node_b = make_node("OUVRAGE-B")
        edge = make_edge(
            "E1",
            node_a.id,
            node_b.id,
            diameter=110.0,
            geometry=[[2.0, 48.0], [2.0, 48.001]],
        )
        graph = make_graph(nodes=[node_a, node_b], edges=[edge])

        cleaned = sanitize_graph_for_write(graph)

        edge = cleaned.edges[0]
        self.assertIsNotNone(edge.length_m)
        self.assertAlmostEqual(edge.length_m, 111.2, delta=0.5)

    def test_pm_anchor_must_use_incoming_edge(self):
        pm_node = make_node(
            "POINT_MESURE-1",
            node_type="POINT_MESURE",
            pm_collector_edge_id="E2",
            attach_edge_id="E2",
            pm_offset_m=5.0,
        )
        node_a = make_node("OUVRAGE-A")
        edges = [
            make_edge(
                "E1",
                node_a.id,
                pm_node.id,
                geometry=[[2.0, 48.0], [2.0, 48.0001]],
            ),
            make_edge(
                "E2",
                pm_node.id,
                node_a.id,
                geometry=[[2.0, 48.0001], [2.0, 48.0]],
            ),
        ]
        graph = make_graph(nodes=[node_a, pm_node], edges=edges)

        with self.assertRaises(HTTPException) as ctx:
            sanitize_graph_for_write(graph)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("anchor edge invalid", ctx.exception.detail)

    def test_pm_offset_cannot_exceed_edge_length(self):
        pm_node = make_node(
            "POINT_MESURE-1",
            node_type="POINT_MESURE",
            pm_collector_edge_id="E1",
            attach_edge_id="E1",
            pm_offset_m=500.0,
        )
        node_a = make_node("OUVRAGE-A")
        edge = make_edge(
            "E1",
            node_a.id,
            pm_node.id,
            diameter=90.0,
            geometry=[[2.0, 48.0], [2.0, 48.001]],
        )
        graph = make_graph(nodes=[node_a, pm_node], edges=[edge])

        with self.assertRaises(HTTPException) as ctx:
            sanitize_graph_for_write(graph)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("pm_offset_m exceeds edge length", ctx.exception.detail)

    def test_rejects_ui_fields_on_strict_mode(self):
        node_a = make_node("OUVRAGE-A")
        node_b = make_node("OUVRAGE-B")
        edge = make_edge(
            "E1",
            node_a.id,
            node_b.id,
            diameter=63.0,
            ui_diameter_mm=120,
        )
        graph = make_graph(nodes=[node_a, node_b], edges=[edge])

        with self.assertRaises(HTTPException) as ctx:
            sanitize_graph_for_write(graph)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("forbidden_fields", ctx.exception.detail.get("error", ""))

    def test_clamps_pm_offset_to_edge_length(self):
        edge = make_edge(
            "E1",
            "OUVRAGE-A",
            "POINT_MESURE-1",
            geometry=[[2.0, 48.0], [2.0, 48.0001]],
        )
        pm_node = make_node(
            "POINT_MESURE-1",
            node_type="POINT_MESURE",
            pm_collector_edge_id="E1",
            attach_edge_id="E1",
            pm_offset_m=11.14,
        )
        node_a = make_node("OUVRAGE-A")
        graph = make_graph(nodes=[node_a, pm_node], edges=[edge])

        cleaned = sanitize_graph_for_write(graph, strict=True)

        node = next(n for n in cleaned.nodes if n.id == "POINT_MESURE-1")
        edge_length = cleaned.edges[0].length_m
        self.assertLessEqual(node.pm_offset_m, edge_length)
        self.assertAlmostEqual(node.pm_offset_m, edge_length, places=2)

    def test_graph_payload_filters_edge_fields(self):
        node_a = make_node("OUVRAGE-A")
        node_b = make_node("OUVRAGE-B")
        edge = make_edge(
            "E1",
            node_a.id,
            node_b.id,
            diameter=110.0,
            material="pehd",
            extras={},
            geometry=[[2.0, 48.0], [2.001, 48.001]],
            created_at="2025-01-01T00:00:01Z",
        )
        graph = make_graph(nodes=[node_a, node_b], edges=[edge])
        cleaned = sanitize_graph_for_write(graph, strict=True)
        payload = graph_to_persistable_payload(cleaned)

        edge_payload = payload["edges"][0]
        self.assertNotIn("extras", edge_payload)
        self.assertNotIn("site_id", edge_payload)
        self.assertEqual(edge_payload["material"], "PEHD")
        self.assertIsNotNone(edge_payload["length_m"])
        self.assertGreater(edge_payload["length_m"], 0)

        self.assertIn('crs', payload)
        self.assertEqual(payload['crs']['code'], 'EPSG:4326')
        self.assertIn('branches', payload)
        self.assertGreaterEqual(len(payload['branches']), 1)
        for node_payload in payload["nodes"]:
            self.assertNotIn('sdr_ouvrage', node_payload)
            self.assertNotIn('lat', node_payload)
            self.assertNotIn('lon', node_payload)

    def test_payload_restores_missing_created_at_and_length(self):
        node_a = make_node("OUVRAGE-A")
        node_b = make_node("OUVRAGE-B")
        edge = make_edge(
            "E1",
            node_a.id,
            node_b.id,
            created_at=None,
            length_m=None,
            geometry=[[2.0, 48.0], [2.0008, 48.0008]],
        )
        graph = make_graph(nodes=[node_a, node_b], edges=[edge])

        payload = graph_to_persistable_payload(graph)
        edge_payload = payload["edges"][0]

        self.assertIsInstance(edge_payload["created_at"], str)
        self.assertTrue(edge_payload["created_at"].endswith("Z"))
        self.assertGreater(edge_payload["length_m"], 0.0)

    def test_branch_names_map_persisted_in_style_meta(self):
        node_a = make_node("OUVRAGE-A")
        node_b = make_node("OUVRAGE-B")
        edge = make_edge(
            "E1",
            node_a.id,
            node_b.id,
        )
        graph = make_graph(nodes=[node_a, node_b], edges=[edge])
        graph.branches = [BranchInfo(id="BR-1", name="Branche Principale")]

        cleaned = sanitize_graph_for_write(graph)
        self.assertIn("branch_names_by_id", cleaned.style_meta)
        self.assertEqual(cleaned.style_meta["branch_names_by_id"], {"BR-1": "Branche Principale"})

        payload = graph_to_persistable_payload(cleaned)
        self.assertIn("branch_names_by_id", payload.get("style_meta", {}))
        self.assertEqual(payload["style_meta"]["branch_names_by_id"], {"BR-1": "Branche Principale"})

    def test_branch_parent_relationships_are_recorded(self):
        general = make_node("GENERAL-1", node_type="GENERAL", branch="ROOT")
        junction_1 = make_node("JONCTION-1", node_type="JONCTION")
        junction_2 = make_node("JONCTION-2", node_type="JONCTION")
        leaf_a = make_node("OUVRAGE-A")
        leaf_b = make_node("OUVRAGE-B")

        edges = [
            make_edge(
                "E-root",
                junction_1.id,
                general.id,
                branch="ROOT",
                created_at="2025-01-01T00:00:00Z",
                diameter=200.0,
            ),
            make_edge(
                "E-j1-to-j2",
                junction_2.id,
                junction_1.id,
                branch="BR-temp",
                created_at="2025-01-03T00:00:00Z",
                diameter=160.0,
            ),
            make_edge(
                "E-j1-to-leaf",
                leaf_a.id,
                junction_1.id,
                branch="BR-leaf",
                created_at="2025-01-02T00:00:00Z",
                diameter=160.0,
            ),
            make_edge(
                "E-j2-to-a",
                leaf_a.id,
                junction_2.id,
                branch="BR-A",
                created_at="2025-01-04T00:00:00Z",
                diameter=110.0,
            ),
            make_edge(
                "E-j2-to-b",
                leaf_b.id,
                junction_2.id,
                branch="BR-B",
                created_at="2025-01-05T00:00:00Z",
                diameter=110.0,
            ),
        ]

        graph = make_graph(
            nodes=[general, junction_1, junction_2, leaf_a, leaf_b],
            edges=edges,
        )

        cleaned = sanitize_graph_for_write(graph, strict=True)
        branch_map = {branch.id: branch for branch in cleaned.branches}

        trunk_branch = next(
            (edge.branch_id for edge in cleaned.edges if edge.id == "E-j1-to-j2"),
            None,
        )
        self.assertIsNotNone(trunk_branch)
        self.assertEqual(trunk_branch, "ROOT")

        branch_from_leaf = next(
            (edge.branch_id for edge in cleaned.edges if edge.id == "E-j1-to-leaf"),
            None,
        )
        secondary_branch = next(
            (edge.branch_id for edge in cleaned.edges if edge.id == "E-j2-to-b"),
            None,
        )
        self.assertIsNotNone(branch_from_leaf)
        self.assertIsNotNone(secondary_branch)
        self.assertEqual(branch_map[branch_from_leaf].parent_id, trunk_branch)
        self.assertEqual(branch_map[secondary_branch].parent_id, trunk_branch)

    def test_branch_selection_uses_depth_when_created_at_missing(self):
        general = make_node("GENERAL-1", node_type="GENERAL", branch="BR-ROOT")
        junction = make_node("JONCTION-1", node_type="JONCTION")
        downstream_main = make_node("OUVRAGE-main")
        downstream_tail = make_node("OUVRAGE-tail")
        downstream_leaf = make_node("OUVRAGE-leaf")

        edges = [
            make_edge(
                "E-up",
                junction.id,
                general.id,
                branch="BR-ROOT",
                created_at=None,
                diameter=200.0,
            ),
            make_edge(
                "E-main",
                downstream_main.id,
                junction.id,
                branch="TEMP",
                created_at=None,
                diameter=160.0,
                geometry=[[2.0, 48.0], [2.0, 48.0008], [2.0, 48.0015]],
            ),
            make_edge(
                "E-leaf",
                downstream_leaf.id,
                junction.id,
                branch="TEMP2",
                created_at=None,
                diameter=160.0,
            ),
            make_edge(
                "E-tail",
                downstream_tail.id,
                downstream_main.id,
                branch="TEMP3",
                created_at=None,
                diameter=110.0,
            ),
        ]

        graph = make_graph(nodes=[general, junction, downstream_main, downstream_leaf, downstream_tail], edges=edges)
        cleaned = sanitize_graph_for_write(graph, strict=True)
        edge_map = {edge.id: edge for edge in cleaned.edges}

        self.assertTrue(edge_map["E-up"].created_at.endswith("Z"))
        self.assertTrue(edge_map["E-main"].created_at.endswith("Z"))
        self.assertTrue(edge_map["E-leaf"].created_at.endswith("Z"))

        # The branch continuing to the deeper subtree keeps the parent branch id
        self.assertEqual(edge_map["E-main"].branch_id, "BR-ROOT")
        self.assertEqual(edge_map["E-leaf"].branch_id, "BR-ROOT:001")


def test_persistable_payload_includes_branches_defaults(self):
    node_a = make_node("OUVRAGE-A")
    node_b = make_node("OUVRAGE-B")
    edge = make_edge(
        "E1",
        node_a.id,
        node_b.id,
        diameter=110.0,
        branch="BR-CUSTOM",
        geometry=[[2.0, 48.0], [2.0, 48.001]],
    )
    graph = make_graph(nodes=[node_a, node_b], edges=[edge])
    cleaned = sanitize_graph_for_write(graph, strict=False)
    payload = graph_to_persistable_payload(cleaned)
    branch_ids = {item['id'] for item in payload['branches']}
    self.assertIn('BR-CUSTOM', branch_ids)

    def test_branch_assignment_split_by_diameter(self):
        general = make_node("GENERAL-1", node_type="GENERAL", branch="BR-ROOT")
        junction = make_node("JONCTION-1", node_type="JONCTION", branch="BR-ROOT")
        downstream_main = make_node("OUVRAGE-main", branch="")
        downstream_branch = make_node("OUVRAGE-branch", branch="")

        edges = [
            make_edge(
                "E-in",
                junction.id,
                general.id,
                branch="BR-ROOT",
                diameter=315.0,
                created_at="2025-01-01T00:00:00Z",
            ),
            make_edge(
                "E-main",
                downstream_main.id,
                junction.id,
                branch="TEMP",
                diameter=315.0,
                created_at="2025-01-01T00:01:00Z",
            ),
            make_edge(
                "E-branch",
                downstream_branch.id,
                junction.id,
                branch="TEMP2",
                diameter=200.0,
                created_at="2025-01-01T00:02:00Z",
            ),
        ]

        graph = make_graph(nodes=[general, junction, downstream_main, downstream_branch], edges=edges)
        cleaned = sanitize_graph_for_write(graph, strict=True)

        edge_map = {edge.id: edge for edge in cleaned.edges}
        self.assertEqual(edge_map["E-main"].branch_id, "BR-ROOT")
        self.assertNotEqual(edge_map["E-branch"].branch_id, "BR-ROOT")
        self.assertEqual(edge_map["E-branch"].branch_id, "BR-ROOT:001")

        branch_changes = getattr(cleaned, "branch_changes", [])
        self.assertTrue(any(change["edge_id"] == "E-main" for change in branch_changes))

    def test_branch_assignment_tie_break_created_at(self):
        general = make_node("GENERAL-1", node_type="GENERAL", branch="BR-ROOT")
        junction = make_node("JONCTION-1", node_type="JONCTION")
        downstream_a = make_node("OUVRAGE-A", branch="")
        downstream_b = make_node("OUVRAGE-B", branch="")

        edges = [
            make_edge(
                "E-in",
                junction.id,
                general.id,
                branch="BR-ROOT",
                diameter=200.0,
                created_at="2025-01-01T00:00:00Z",
            ),
            make_edge(
                "E-a",
                downstream_a.id,
                junction.id,
                branch="TEMP",
                diameter=200.0,
                created_at="2025-01-01T00:01:00Z",
            ),
            make_edge(
                "E-b",
                downstream_b.id,
                junction.id,
                branch="TEMP2",
                diameter=200.0,
                created_at="2025-01-01T00:02:00Z",
            ),
        ]

        graph = make_graph(nodes=[general, junction, downstream_a, downstream_b], edges=edges)
        cleaned = sanitize_graph_for_write(graph, strict=True)
        edge_map = {edge.id: edge for edge in cleaned.edges}

        self.assertEqual(edge_map["E-a"].branch_id, "BR-ROOT")
        self.assertEqual(edge_map["E-b"].branch_id, "BR-ROOT:001")

    def test_branch_angle_tie_break_prefers_straight(self):
        general = make_node(
            "GENERAL-1",
            node_type="GENERAL",
            branch="BR-ROOT",
            x=0.0,
            y=0.0,
        )
        junction = make_node(
            "JONCTION-1",
            node_type="JONCTION",
            branch="",
            x=0.0,
            y=10.0,
        )
        straight = make_node("OUVRAGE-A", branch="", x=0.0, y=20.0)
        angled = make_node("OUVRAGE-B", branch="", x=10.0, y=20.0)

        edges = [
            make_edge(
                "E-in",
                junction.id,
                general.id,
                branch="BR-ROOT",
                diameter=200.0,
                geometry=[[0.0, 0.0], [0.0, 10.0]],
            ),
            make_edge(
                "E-straight",
                straight.id,
                junction.id,
                branch="TEMP",
                diameter=160.0,
                created_at="2025-01-01T00:00:00Z",
                geometry=[[0.0, 10.0], [0.0, 20.0]],
            ),
            make_edge(
                "E-angled",
                angled.id,
                junction.id,
                branch="TEMP2",
                diameter=160.0,
                created_at="2025-01-01T00:00:00Z",
                geometry=[[0.0, 10.0], [10.0, 20.0]],
            ),
        ]

        graph = make_graph(nodes=[general, junction, straight, angled], edges=edges)
        cleaned = sanitize_graph_for_write(graph, strict=True)
        edge_map = {edge.id: edge for edge in cleaned.edges}

        self.assertEqual(edge_map["E-straight"].branch_id, "BR-ROOT")
        self.assertEqual(edge_map["E-angled"].branch_id, "BR-ROOT:001")

    def test_pass_through_vanne_keeps_branch(self):
        general = make_node("GENERAL-1", node_type="GENERAL", branch="BR-ROOT")
        vanne_node = make_node(
            "VANNE-1",
            node_type="VANNE",
            branch="BR-ROOT",
            pm_collector_edge_id="E-down",
            attach_edge_id="E-down",
        )
        downstream = make_node("OUVRAGE-1", branch="")

        edges = [
            make_edge(
                "E-up",
                vanne_node.id,
                general.id,
                branch="BR-ROOT",
                diameter=160.0,
                created_at="2025-01-01T00:00:00Z",
            ),
            make_edge(
                "E-down",
                downstream.id,
                vanne_node.id,
                branch="TEMP",
                diameter=160.0,
                created_at="2025-01-01T00:01:00Z",
            ),
        ]

        graph = make_graph(nodes=[general, vanne_node, downstream], edges=edges)
        cleaned = sanitize_graph_for_write(graph, strict=True)
        edge_map = {edge.id: edge for edge in cleaned.edges}
        self.assertEqual(edge_map["E-up"].branch_id, "BR-ROOT")
        self.assertEqual(edge_map["E-down"].branch_id, "BR-ROOT")

    def test_site_id_required(self):
        node_a = make_node("OUVRAGE-A")
        node_b = make_node("OUVRAGE-B")
        edge = make_edge("E1", node_a.id, node_b.id)
        graph = Graph(
            version="1.5",
            site_id="",
            generated_at=DEFAULT_GENERATED_AT,
            nodes=[node_a, node_b],
            edges=[edge],
        )

        with self.assertRaises(HTTPException) as ctx:
            sanitize_graph_for_write(graph)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("site_id", str(ctx.exception.detail))

    def test_legacy_fields_are_rejected(self):
        with self.assertRaises(ValueError):
            make_node("OUVRAGE-LEGACY", lat=48.5)
        with self.assertRaises(ValueError):
            make_node("OUVRAGE-LEGACY", lon=2.1)
        with self.assertRaises(ValueError):
            make_node("OUVRAGE-LEGACY", sdr_ouvrage="SDR11")

    def test_node_requires_gps_coordinates(self):
        node_a = make_node("OUVRAGE-A", gps_lat=None)
        node_b = make_node("OUVRAGE-B")
        edge = make_edge("E1", node_a.id, node_b.id)
        graph = make_graph(nodes=[node_a, node_b], edges=[edge])

        with self.assertRaises(HTTPException) as ctx:
            sanitize_graph_for_write(graph)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("gps_lat", str(ctx.exception.detail))

    def test_edge_requires_geometry(self):
        node_a = make_node("OUVRAGE-A")
        node_b = make_node("OUVRAGE-B")
        edge = make_edge("E1", node_a.id, node_b.id)
        edge.geometry = None
        graph = make_graph(nodes=[node_a, node_b], edges=[edge])

        with self.assertRaises(HTTPException) as ctx:
            sanitize_graph_for_write(graph)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("geometry", str(ctx.exception.detail))

    def test_junction_parent_branch_must_follow_largest_diameter(self):
        upstream = make_node("OUVRAGE-UP", branch="BR-ROOT")
        junction = make_node("JONCTION-1", node_type="JONCTION", branch="BR-ROOT")
        child_a = make_node("OUVRAGE-A", branch="BR-ROOT")
        child_b = make_node("OUVRAGE-B", branch="BR-CHILD")

        inbound = make_edge(
            "E-IN",
            junction.id,
            upstream.id,
            branch="BR-ROOT",
            diameter=160.0,
        )
        # Smaller diameter incorrectly keeps parent branch id
        main_wrong = make_edge(
            "E-MAIN",
            child_a.id,
            junction.id,
            branch="BR-ROOT",
            diameter=90.0,
        )
        larger_branch = make_edge(
            "E-CHILD",
            child_b.id,
            junction.id,
            branch="BR-CHILD",
            diameter=180.0,
        )
        graph = make_graph(nodes=[upstream, junction, child_a, child_b], edges=[inbound, main_wrong, larger_branch])

        cleaned = sanitize_graph_for_write(graph)
        edge_map = {edge.id: edge for edge in cleaned.edges}
        self.assertEqual(edge_map["E-CHILD"].branch_id, "BR-ROOT")
        self.assertNotEqual(edge_map["E-MAIN"].branch_id, "BR-ROOT")
        self.assertEqual(edge_map["E-MAIN"].branch_id, "BR-ROOT:001")

    def test_vanne_edges_propagate_branch(self):
        upstream = make_node("OUVRAGE-UP", branch="BR-ROOT")
        downstream = make_node("OUVRAGE-DOWN", branch="BR-ROOT")
        vanne = make_node(
            "VANNE-1",
            node_type="VANNE",
            branch="BR-ROOT",
            pm_collector_edge_id="E-DOWN",
            attach_edge_id="E-DOWN",
        )
        edge_up = make_edge("E-UP", vanne.id, upstream.id, branch="BR-ROOT")
        edge_down = make_edge("E-DOWN", downstream.id, vanne.id, branch="TEMP")
        graph = make_graph(nodes=[upstream, vanne, downstream], edges=[edge_up, edge_down])

        cleaned = sanitize_graph_for_write(graph)
        edge_map = {edge.id: edge for edge in cleaned.edges}
        self.assertEqual(edge_map["E-UP"].branch_id, edge_map["E-DOWN"].branch_id)


if __name__ == "__main__":
    unittest.main()
