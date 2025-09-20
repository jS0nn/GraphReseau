import unittest

from app.models import Graph, Node, Edge


class ModelDefaultsTests(unittest.TestCase):
    def test_graph_nodes_edges_default_are_independent(self):
        g1 = Graph()
        g2 = Graph()

        g1.nodes.append(Node(id="A"))

        self.assertEqual(len(g1.nodes), 1)
        self.assertEqual(len(g2.nodes), 0)
        self.assertIsNot(g1.nodes, g2.nodes)
        self.assertIsNot(g1.edges, g2.edges)

    def test_node_collector_well_ids_default_is_independent(self):
        n1 = Node(id="A")
        n2 = Node(id="B")

        n1.collector_well_ids.append("X")

        self.assertEqual(n1.collector_well_ids, ["X"])
        self.assertEqual(n2.collector_well_ids, [])
        self.assertIsNot(n1.collector_well_ids, n2.collector_well_ids)

    def test_edge_model_auto_computes_length(self):
        edge = Edge(
            id="E1",
            from_id="A",
            to_id="B",
            branch_id="BR-1",
            diameter_mm=90.0,
            geometry=[[2.0, 48.0], [2.0005, 48.0005]],
            length_m=None,
        )

        self.assertIsNotNone(edge.length_m)
        self.assertGreater(edge.length_m, 0)


if __name__ == "__main__":
    unittest.main()
