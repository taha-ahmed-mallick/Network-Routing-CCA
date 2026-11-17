#pragma once

#include <string>
#include <vector>

// Forward declarations and structures for graph representation
namespace routing {

    // Representation of a directed or undirected edge
    struct Edge {
        int to;
        int weight;
        Edge(int t = -1, int w = 0) : to(t), weight(w) {}
    };

    // Min-Heap node used during Dijkstra's priority queue operations
    struct HeapNode {
        int vertex;
        int distance;
        HeapNode(int v = -1, int d = 0) : vertex(v), distance(d) {}
    };

    // Custom MinHeap implementation ported from main.cpp
    class MinHeap {
    private:
        std::vector<HeapNode> heap;

        void siftUp(int i);
        void siftDown(int i);

    public:
        MinHeap() = default;
        bool empty() const;
        void push(int vertex, int distance);
        HeapNode pop();
    };

    // Input edge struct received from JSON payload
    struct RawEdge {
        std::string from;
        std::string to;
        int weight;
    };

    // Result struct returned by Dijkstra shortest path computation
    struct RouteResult {
        bool reachable;
        int cost;
        std::vector<std::string> path;
    };

    // Core Dijkstra route finding function
    // Computes shortest path from src to dest given a list of node IDs and edge definitions
    RouteResult findShortestRoute(
        const std::string &src,
        const std::string &dest,
        const std::vector<std::string> &nodes,
        const std::vector<RawEdge> &edges
    );

} // namespace routing
