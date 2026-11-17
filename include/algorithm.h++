#pragma once

#include <string>
#include <vector>
#include <limits>
#include <map>

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
        bool broken;   // Link operational status
        Edge(int t = -1, int w = 0, bool brk = false) : to(t), weight(w), broken(brk) {}
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

    // Packet structure for network packet transit simulation
    struct Packet {
        int id;
        std::string kind;     // "PING" or "ACK"
        std::string pingSrc;  // Original sender client
        std::string pingDst;  // Original target client
        std::vector<std::string> path; // Node label hop sequence
        size_t hop;           // Index of the node where packet is currently located
        int ttl;              // Time-To-Live hop counter
        bool isDropped;
        bool isDone;
        std::string dropReason;
        std::string dropNode;

        Packet();
        Packet(int pid, const std::string &k, const std::string &src, const std::string &dst,
               const std::vector<std::string> &p, int initialTtl = 16);
    };

    // Custom circular FIFO packet queue per router (bounded queue matching main.cpp)
    class PacketQueue {
    private:
        std::vector<Packet> buffer;
        int frontIndex;
        int rearIndex;
        int count;
        int capacity;

    public:
        PacketQueue(int cap = 20);
        bool isEmpty() const;
        bool isFull() const;
        bool enqueue(const Packet &pkt);
        bool dequeue(Packet &pkt);
        bool peek(Packet &pkt) const;
        int size() const;
        int getCapacity() const;
        void clear();
    };

    // Activity Log Entry
    struct LogEntry {
        std::string time;
        std::string type;
        std::string message;
    };

    // Activity Logger maintaining audit trail and packet metrics (matching main.cpp)
    class ActivityLogger {
    private:
        std::vector<LogEntry> logs;
        int tx;
        int rx;
        int drop;
        std::string logFilePath;

        std::string getTimestamp() const;

    public:
        ActivityLogger(const std::string &filePath = "activity_log.txt");
        void log(const std::string &type, const std::string &message);
        void clear();
        const std::vector<LogEntry>& getLogs() const;
        int getTx() const;
        int getRx() const;
        int getDrop() const;
        void setStats(int t, int r, int d);
        void appendToFile(const LogEntry &entry);
    };

    // Internal node record in the Network graph
    struct NodeInfo {
        std::string label;
        NodeType type;
        bool active;
        bool broken;
        PacketQueue queue; // Per-node circular FIFO packet buffer

        NodeInfo(const std::string &lbl = "", NodeType t = NodeType::ROUTER, int queueCap = 20);
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

    // Snapshot of a packet during simulation tick
    struct PacketState {
        int id;
        std::string kind;
        std::string from;
        std::string to;
        size_t hop;
        bool isDropped;
        bool isDone;
    };

    // Result of a simulation tick step
    struct SimulationTickResult {
        int tick;
        std::vector<PacketState> packets;
        std::vector<std::pair<std::string, int>> queueSizes;
        std::vector<LogEntry> newLogs;
        int tx;
        int rx;
        int drop;
    };

    // Core Network topology & simulation class
    // Manages dynamic vertices, undirected links, Dijkstra, BFS/DFS, PacketQueue buffers, and simulation ticks
    class Network {
    private:
        std::vector<std::vector<Edge>> adjacency;
        std::vector<NodeInfo> nodes;
        RouterHashTable registry;

        // Packet simulation state
        std::vector<Packet> activePackets;
        int nextPacketId;
        int tickCount;
        ActivityLogger logger;

        bool validLabel(const std::string &label) const;
        void removeAllEdges(int vertex);

    public:
        Network();

        int getIndex(const std::string &label) const;
        NodeType getNodeType(const std::string &label) const;
        bool isNodeBroken(const std::string &label) const;

        // Node management
        bool addNode(const std::string &label, NodeType type, bool broken = false);
        bool removeNode(const std::string &label);
        bool setNodeBroken(const std::string &label, bool broken);
        bool setNodeLabel(const std::string &oldLabel, const std::string &newLabel);

        // Link management
        bool addLink(const std::string &a, const std::string &b, int weight, bool broken = false);
        bool removeLink(const std::string &a, const std::string &b);
        bool setLinkWeight(const std::string &a, const std::string &b, int weight);
        bool setLinkBroken(const std::string &a, const std::string &b, bool broken);

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

        // Simulation engine methods
        bool injectPing(const std::string &src, const std::string &dest, Packet &outPkt, std::vector<std::string> &outPath, int &outCost);
        SimulationTickResult stepTick();
        void clearSimulation();
        void resetAll();

        ActivityLogger& getLogger();
        const std::vector<Packet>& getActivePackets() const;
        std::map<std::string, int> getQueueCounts() const;
    };

    // Input edge struct from JSON payload
    struct RawEdge {
        std::string from;
        std::string to;
        int weight;
        bool broken = false;
    };

    // Input node struct from JSON payload
    struct RawNode {
        std::string id;
        std::string type; // "router" or "client"
        bool broken = false;
    };

    // Result structure returned to Crow HTTP server
    struct RouteResult {
        bool reachable;
        int cost;
        std::vector<std::string> path;
    };

    // Bridge functions for stateless routing & traversal requests
    RouteResult findShortestRoute(
        const std::string &src,
        const std::string &dest,
        const std::vector<RawNode> &nodes,
        const std::vector<RawEdge> &edges
    );

    TraversalResult findTraversal(
        const std::string &type,
        const std::string &start,
        const std::vector<RawNode> &rawNodes,
        const std::vector<RawEdge> &edges
    );

    // Global in-memory authoritative Network instance
    Network& getGlobalNetwork();

} // namespace routing
