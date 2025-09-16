import unittest

from app.models import Edge, Graph, Node
from app.services.graph_sanitizer import sanitize_graph_for_write


class GraphSanitizerTests(unittest.TestCase):
    def make_graph(self, edges):
        return Graph(nodes=[], edges=edges)

    def test_assigns_ids_to_edges_without_id(self):
        graph = self.make_graph([
            Edge(id=None, from_id="A", to_id="B"),
            Edge(id="", from_id="B", to_id="C"),
        ])

        cleaned = sanitize_graph_for_write(graph)

        self.assertTrue(all(edge.id for edge in cleaned.edges))
        self.assertNotEqual(cleaned.edges[0].id, cleaned.edges[1].id)

    def test_deduplicates_duplicate_edges(self):
        shared_id = "E-123"
        graph = self.make_graph([
            Edge(id=shared_id, from_id="A", to_id="B"),
            Edge(id=shared_id, from_id="A", to_id="B"),
            Edge(id=shared_id, from_id="A", to_id="C"),
        ])

        cleaned = sanitize_graph_for_write(graph)

        ids = [edge.id for edge in cleaned.edges]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(any(edge.from_id == "A" and edge.to_id == "B" for edge in cleaned.edges))
        self.assertTrue(any(edge.from_id == "A" and edge.to_id == "C" for edge in cleaned.edges))

    def test_drops_edges_without_endpoints(self):
        graph = self.make_graph([
            Edge(id="E1", from_id="A", to_id=""),
            Edge(id="E2", from_id="", to_id="B"),
            Edge(id="E3", from_id="A", to_id="B"),
        ])

        cleaned = sanitize_graph_for_write(graph)

        self.assertEqual(len(cleaned.edges), 1)
        self.assertEqual(cleaned.edges[0].from_id, "A")
        self.assertEqual(cleaned.edges[0].to_id, "B")

    def test_preserves_nodes_list(self):
        graph = Graph(nodes=[Node(id="N1")], edges=[Edge(id="E", from_id="A", to_id="B")])

        cleaned = sanitize_graph_for_write(graph)

        self.assertEqual(cleaned.nodes, graph.nodes)


if __name__ == "__main__":
    unittest.main()
