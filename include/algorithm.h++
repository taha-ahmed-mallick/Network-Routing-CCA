#pragma once

#include <string>
#include <vector>
#include <limits>

namespace routing {

    // Representation of infinity for shortest path distance
    const int INF = std::numeric_limits<int>::max() / 4;

    // Node classification: Routers forward traffic, Clients are endpoints only
    enum class NodeType {
        ROUTER,
        CLIENT
    };

    // Edge representation for undirected graph adjacency list
    struct Edge {
        int to;        // Destination vertex index
        int weight;    // Cost / latency of the network link
        Edge(int t = -1, int w = 0) : to(t), weight(w) {}
    };

    // Priority queue element for Dijkstra's algorithm
    struct HeapNode {
        int vertex;
        int distance;
        HeapNode(int v = -1, int d = 0) : vertex(v), distance(d) {}
    };

    // Custom MinHeap implementation (Dynamic size, zero limits)
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
        void clear();
    };

    // Custom Dynamic Open-Addressing Hash Table (Linear Probing with automatic rehashing)
    // Maps string labels (e.g. "R1", "C2") -> internal integer vertex indices [0, 1, 2, ...]
    class RouterHashTable {
    private:
        struct Entry {
            std::string key;
            int value;
            int state; // 0 = empty, 1 = occupied, 2 = deleted
            Entry() : key(""), value(-1), state(0) {}
        };

        std::vector<Entry> table;
        int capacity;
        int occupiedCount; // Active entries (state == 1)

        int hashFunction(const std::string &key, int cap) const;
        void rehash();

    public:
        RouterHashTable(int initialCap = 31);
        bool insert(const std::string &key, int value);
        int find(const std::string &key) const;
        bool remove(const std::string &key);
        void clear();
        int size() const;
    };

    // Internal node record in the Network graph
    struct NodeInfo {
        std::string label;
        NodeType type;
        bool active;
        NodeInfo(const std::string &lbl = "", NodeType t = NodeType::ROUTER)
            : label(lbl), type(t), active(true) {}
    };

    // Step in a graph traversal (from parent to child; from is empty for root start node)
    struct TraversalStep {
        std::string from;
        std::string to;
    };

    // Full traversal outcome returned to server and frontend
    struct TraversalResult {
        std::string type; // "bfs" or "dfs"
        std::string start;
        std::vector<std::string> order;
        std::vector<TraversalStep> steps;
    };

    // Core Network topology class
    // Manages dynamic vertices (routers and clients) and undirected links
    class Network {
    private:
        std::vector<std::vector<Edge>> adjacency;
        std::vector<NodeInfo> nodes;
        RouterHashTable registry;

        bool validLabel(const std::string &label) const;
        void removeAllEdges(int vertex);

    public:
        Network();

        int getIndex(const std::string &label) const;
        NodeType getNodeType(const std::string &label) const;

        // Adds a node (Router or Client) with no fixed size limits
        bool addNode(const std::string &label, NodeType type);

        // Removes a node and all connected undirected links
        bool removeNode(const std::string &label);

        // Adds an undirected (bidirectional) network link between two nodes
        bool addLink(const std::string &a, const std::string &b, int weight);

        // Removes an undirected network link between two nodes
        bool removeLink(const std::string &a, const std::string &b);

        // Dijkstra shortest path computation:
        // Ensures transit hops are strictly Routers, never intermediate Clients
        bool shortestPath(const std::string &source, const std::string &destination,
                          std::vector<int> &path, int &totalCost) const;

        // Helper to convert internal index path to label string path
        std::vector<std::string> getPathLabels(const std::vector<int> &path) const;

        // Graph traversals
        std::vector<std::string> bfs(const std::string &startLabel) const;
        std::vector<std::string> dfs(const std::string &startLabel) const;

        // Rich graph traversals returning ordered steps for frontend visualization
        TraversalResult runBFS(const std::string &startLabel) const;
        TraversalResult runDFS(const std::string &startLabel) const;
    };

    // Input edge struct from JSON payload
    struct RawEdge {
        std::string from;
        std::string to;
        int weight;
    };

    // Input node struct from JSON payload
    struct RawNode {
        std::string id;
        std::string type; // "router" or "client"
    };

    // Result structure returned to Crow HTTP server
    struct RouteResult {
        bool reachable;
        int cost;
        std::vector<std::string> path;
    };

    // Bridge function: builds a dynamic Network topology and executes Dijkstra
    RouteResult findShortestRoute(
        const std::string &src,
        const std::string &dest,
        const std::vector<RawNode> &nodes,
        const std::vector<RawEdge> &edges
    );

    // Bridge function: builds a dynamic Network topology and executes BFS or DFS traversal
    TraversalResult findTraversal(
        const std::string &type,
        const std::string &start,
        const std::vector<RawNode> &rawNodes,
        const std::vector<RawEdge> &edges
    );

} // namespace routing
