#include "include/algorithm.h++"
#include <limits>
#include <algorithm>
#include <unordered_map>

namespace routing {

    // Constant for unreachable distance (safe from overflow)
    const int INF = std::numeric_limits<int>::max() / 4;

    // -------------------------------------------------------------
    // MinHeap Implementation (Ported from main.cpp)
    // -------------------------------------------------------------

    void MinHeap::siftUp(int i) {
        while (i > 0) {
            int parent = (i - 1) / 2;
            if (heap[parent].distance <= heap[i].distance) break;
            HeapNode temp = heap[parent];
            heap[parent] = heap[i];
            heap[i] = temp;
            i = parent;
        }
    }

    void MinHeap::siftDown(int i) {
        int n = static_cast<int>(heap.size());
        while (true) {
            int left = 2 * i + 1;
            int right = 2 * i + 2;
            int smallest = i;

            if (left < n && heap[left].distance < heap[smallest].distance)
                smallest = left;
            if (right < n && heap[right].distance < heap[smallest].distance)
                smallest = right;

            if (smallest == i) break;
            HeapNode temp = heap[i];
            heap[i] = heap[smallest];
            heap[smallest] = temp;
            i = smallest;
        }
    }

    bool MinHeap::empty() const {
        return heap.empty();
    }

    void MinHeap::push(int vertex, int distance) {
        heap.push_back(HeapNode(vertex, distance));
        siftUp(static_cast<int>(heap.size()) - 1);
    }

    HeapNode MinHeap::pop() {
        HeapNode result = heap[0];
        heap[0] = heap.back();
        heap.pop_back();
        if (!heap.empty()) siftDown(0);
        return result;
    }

    // -------------------------------------------------------------
    // Dijkstra Algorithm Execution
    // -------------------------------------------------------------

    RouteResult findShortestRoute(
        const std::string &src,
        const std::string &dest,
        const std::vector<std::string> &nodes,
        const std::vector<RawEdge> &edges
    ) {
        RouteResult result;
        result.reachable = false;
        result.cost = 0;
        result.path = {};

        // 1. Map string node IDs (e.g., "R1", "C1") to internal integer indices [0..N-1]
        std::unordered_map<std::string, int> idToIndex;
        std::vector<std::string> indexToId;
        indexToId.reserve(nodes.size());

        for (const auto &nodeId : nodes) {
            if (idToIndex.find(nodeId) == idToIndex.end()) {
                idToIndex[nodeId] = static_cast<int>(indexToId.size());
                indexToId.push_back(nodeId);
            }
        }

        // Verify that source and destination exist in the provided network
        if (idToIndex.find(src) == idToIndex.end() || idToIndex.find(dest) == idToIndex.end()) {
            return result; // Unreachable / missing endpoints
        }

        int s = idToIndex[src];
        int d = idToIndex[dest];
        int numVertices = static_cast<int>(indexToId.size());

        // 2. Build adjacency list for the graph (undirected links)
        std::vector<std::vector<Edge>> adjacency(numVertices);
        for (const auto &e : edges) {
            auto itU = idToIndex.find(e.from);
            auto itV = idToIndex.find(e.to);
            if (itU != idToIndex.end() && itV != idToIndex.end()) {
                int u = itU->second;
                int v = itV->second;
                adjacency[u].push_back(Edge(v, e.weight));
                adjacency[v].push_back(Edge(u, e.weight));
            }
        }

        // 3. Dijkstra's Algorithm using custom MinHeap
        std::vector<int> dist(numVertices, INF);
        std::vector<int> parent(numVertices, -1);
        std::vector<bool> settled(numVertices, false);

        MinHeap minHeap;
        dist[s] = 0;
        minHeap.push(s, 0);

        while (!minHeap.empty()) {
            HeapNode node = minHeap.pop();
            int u = node.vertex;

            if (settled[u]) continue;
            settled[u] = true;

            // Early exit if we reached the target destination
            if (u == d) break;

            for (const auto &edge : adjacency[u]) {
                int v = edge.to;
                int w = edge.weight;

                if (!settled[v] && dist[u] + w < dist[v]) {
                    dist[v] = dist[u] + w;
                    parent[v] = u;
                    minHeap.push(v, dist[v]);
                }
            }
        }

        // If destination remains at INF, no path exists
        if (dist[d] == INF) {
            return result;
        }

        // 4. Reconstruct path from destination backwards to source
        std::vector<std::string> pathNodes;
        for (int at = d; at != -1; at = parent[at]) {
            pathNodes.push_back(indexToId[at]);
        }
        std::reverse(pathNodes.begin(), pathNodes.end());

        result.reachable = true;
        result.cost = dist[d];
        result.path = pathNodes;

        return result;
    }

} // namespace routing
