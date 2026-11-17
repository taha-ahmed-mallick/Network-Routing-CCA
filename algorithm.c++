#include "include/algorithm.h++"
#include <algorithm>

namespace routing {

    // -------------------------------------------------------------
    // MinHeap Implementation (Dynamic binary min-heap)
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

    void MinHeap::clear() {
        heap.clear();
    }

    // -------------------------------------------------------------
    // RouterHashTable Implementation (Dynamic Open Addressing)
    // -------------------------------------------------------------

    RouterHashTable::RouterHashTable(int initialCap)
        : capacity(initialCap > 7 ? initialCap : 31), occupiedCount(0) {
        table.assign(capacity, Entry());
    }

    int RouterHashTable::hashFunction(const std::string &key, int cap) const {
        unsigned int hash = 0;
        for (size_t i = 0; i < key.size(); ++i)
            hash = (hash * 31 + static_cast<unsigned char>(key[i])) % cap;
        return static_cast<int>(hash);
    }

    void RouterHashTable::rehash() {
        int oldCap = capacity;
        std::vector<Entry> oldTable = table;

        // Double the capacity plus one (preferring odd sizes to improve distribution)
        capacity = oldCap * 2 + 1;
        table.assign(capacity, Entry());
        occupiedCount = 0;

        for (int i = 0; i < oldCap; ++i) {
            if (oldTable[i].state == 1) {
                insert(oldTable[i].key, oldTable[i].value);
            }
        }
    }

    bool RouterHashTable::insert(const std::string &key, int value) {
        // Automatically rehash when load factor exceeds 0.70
        if ((occupiedCount + 1) * 10 >= capacity * 7) {
            rehash();
        }

        int start = hashFunction(key, capacity);
        int firstDeleted = -1;

        for (int step = 0; step < capacity; ++step) {
            int pos = (start + step) % capacity;

            // Key already exists; do not allow duplicates
            if (table[pos].state == 1 && table[pos].key == key)
                return false;

            // Track first tombstone encountered for reuse
            if (table[pos].state == 2 && firstDeleted == -1)
                firstDeleted = pos;

            // Empty slot reached: key is not in table
            if (table[pos].state == 0) {
                int target = (firstDeleted == -1) ? pos : firstDeleted;
                table[target].key = key;
                table[target].value = value;
                table[target].state = 1;
                ++occupiedCount;
                return true;
            }
        }

        // If table looped around and saw tombstones
        if (firstDeleted != -1) {
            table[firstDeleted].key = key;
            table[firstDeleted].value = value;
            table[firstDeleted].state = 1;
            ++occupiedCount;
            return true;
        }

        return false;
    }

    int RouterHashTable::find(const std::string &key) const {
        if (capacity == 0) return -1;
        int start = hashFunction(key, capacity);

        for (int step = 0; step < capacity; ++step) {
            int pos = (start + step) % capacity;
            if (table[pos].state == 0) return -1; // Not found
            if (table[pos].state == 1 && table[pos].key == key)
                return table[pos].value;
        }
        return -1;
    }

    bool RouterHashTable::remove(const std::string &key) {
        if (capacity == 0) return false;
        int start = hashFunction(key, capacity);

        for (int step = 0; step < capacity; ++step) {
            int pos = (start + step) % capacity;
            if (table[pos].state == 0) return false;
            if (table[pos].state == 1 && table[pos].key == key) {
                table[pos].state = 2; // Mark as deleted (tombstone)
                table[pos].key = "";
                table[pos].value = -1;
                --occupiedCount;
                return true;
            }
        }
        return false;
    }

    void RouterHashTable::clear() {
        table.assign(capacity, Entry());
        occupiedCount = 0;
    }

    int RouterHashTable::size() const {
        return occupiedCount;
    }

    // -------------------------------------------------------------
    // Network Class Implementation (Dynamic Topology & Routing)
    // -------------------------------------------------------------

    Network::Network() : registry(31) {}

    bool Network::validLabel(const std::string &label) const {
        return !label.empty() && label.size() <= 64;
    }

    int Network::getIndex(const std::string &label) const {
        return registry.find(label);
    }

    NodeType Network::getNodeType(const std::string &label) const {
        int idx = getIndex(label);
        if (idx >= 0 && idx < static_cast<int>(nodes.size())) {
            return nodes[idx].type;
        }
        return NodeType::ROUTER;
    }

    bool Network::addNode(const std::string &label, NodeType type) {
        if (!validLabel(label)) return false;
        if (registry.find(label) != -1) return false; // Duplicate check

        // Check if there is an inactive slot to recycle
        int slot = -1;
        for (size_t i = 0; i < nodes.size(); ++i) {
            if (!nodes[i].active) {
                slot = static_cast<int>(i);
                break;
            }
        }

        if (slot == -1) {
            // Allocate new vertex index dynamically
            slot = static_cast<int>(nodes.size());
            nodes.push_back(NodeInfo(label, type));
            adjacency.push_back(std::vector<Edge>());
        } else {
            nodes[slot] = NodeInfo(label, type);
            adjacency[slot].clear();
        }

        registry.insert(label, slot);
        return true;
    }

    void Network::removeAllEdges(int vertex) {
        // Remove all references to `vertex` in its neighbours' adjacency lists
        for (const auto &edge : adjacency[vertex]) {
            int neighbor = edge.to;
            auto &nbEdges = adjacency[neighbor];
            for (size_t j = 0; j < nbEdges.size();) {
                if (nbEdges[j].to == vertex) {
                    nbEdges.erase(nbEdges.begin() + j);
                } else {
                    ++j;
                }
            }
        }
        adjacency[vertex].clear();
    }

    bool Network::removeNode(const std::string &label) {
        int index = registry.find(label);
        if (index == -1) return false;

        removeAllEdges(index);
        registry.remove(label);
        nodes[index].active = false;
        nodes[index].label = "";
        return true;
    }

    bool Network::addLink(const std::string &a, const std::string &b, int weight) {
        int u = registry.find(a);
        int v = registry.find(b);
        if (u == -1 || v == -1 || u == v) return false;

        // If link already exists, update its weight in both directions
        for (auto &edge : adjacency[u]) {
            if (edge.to == v) {
                edge.weight = weight;
                for (auto &revEdge : adjacency[v]) {
                    if (revEdge.to == u) {
                        revEdge.weight = weight;
                        return true;
                    }
                }
                return true;
            }
        }

        // Add undirected edge symmetrically to both adjacency lists
        adjacency[u].push_back(Edge(v, weight));
        adjacency[v].push_back(Edge(u, weight));
        return true;
    }

    bool Network::removeLink(const std::string &a, const std::string &b) {
        int u = registry.find(a);
        int v = registry.find(b);
        if (u == -1 || v == -1) return false;

        bool found = false;
        for (size_t i = 0; i < adjacency[u].size();) {
            if (adjacency[u][i].to == v) {
                adjacency[u].erase(adjacency[u].begin() + i);
                found = true;
            } else {
                ++i;
            }
        }
        for (size_t i = 0; i < adjacency[v].size();) {
            if (adjacency[v][i].to == u) {
                adjacency[v].erase(adjacency[v].begin() + i);
                found = true;
            } else {
                ++i;
            }
        }
        return found;
    }

    // -------------------------------------------------------------
    // Dijkstra Shortest Path Computation
    // -------------------------------------------------------------

    bool Network::shortestPath(const std::string &source, const std::string &destination,
                              std::vector<int> &path, int &totalCost) const {
        int s = registry.find(source);
        int d = registry.find(destination);
        if (s == -1 || d == -1) return false;

        int numVertices = static_cast<int>(nodes.size());
        std::vector<int> dist(numVertices, INF);
        std::vector<int> parent(numVertices, -1);
        std::vector<bool> settled(numVertices, false);

        MinHeap minHeap;
        dist[s] = 0;
        minHeap.push(s, 0);

        while (!minHeap.empty()) {
            HeapNode current = minHeap.pop();
            int u = current.vertex;

            if (settled[u]) continue;
            settled[u] = true;

            // Target destination reached
            if (u == d) break;

            // Client Rule: A client cannot forward packets to other nodes
            // If an intermediate node is a CLIENT and is not source or destination, skip relaxing its edges
            if (u != s && u != d && nodes[u].type == NodeType::CLIENT) {
                continue;
            }

            for (const auto &edge : adjacency[u]) {
                int v = edge.to;
                int w = edge.weight;

                if (!nodes[v].active) continue;

                // If neighbor is a CLIENT and is not our target destination, we cannot route through it
                if (v != d && nodes[v].type == NodeType::CLIENT) {
                    continue;
                }

                if (!settled[v] && dist[u] + w < dist[v]) {
                    dist[v] = dist[u] + w;
                    parent[v] = u;
                    minHeap.push(v, dist[v]);
                }
            }
        }

        // If destination remains unreachable
        if (dist[d] == INF) return false;

        // Reconstruct path backwards from destination to source
        path.clear();
        for (int at = d; at != -1; at = parent[at]) {
            path.push_back(at);
        }

        // Reverse path so it starts at source and ends at destination
        std::reverse(path.begin(), path.end());

        totalCost = dist[d];
        return true;
    }

    std::vector<std::string> Network::getPathLabels(const std::vector<int> &path) const {
        std::vector<std::string> labelList;
        labelList.reserve(path.size());
        for (int v : path) {
            if (v >= 0 && v < static_cast<int>(nodes.size()) && nodes[v].active) {
                labelList.push_back(nodes[v].label);
            }
        }
        return labelList;
    }

    std::vector<std::string> Network::bfs(const std::string &startLabel) const {
        std::vector<std::string> order;
        int start = registry.find(startLabel);
        if (start == -1) return order;

        int numVertices = static_cast<int>(nodes.size());
        std::vector<bool> visited(numVertices, false);
        std::vector<int> queue;
        size_t front = 0;

        queue.push_back(start);
        visited[start] = true;

        while (front < queue.size()) {
            int current = queue[front++];
            order.push_back(nodes[current].label);

            for (const auto &edge : adjacency[current]) {
                int next = edge.to;
                if (nodes[next].active && !visited[next]) {
                    visited[next] = true;
                    queue.push_back(next);
                }
            }
        }
        return order;
    }

    std::vector<std::string> Network::dfs(const std::string &startLabel) const {
        std::vector<std::string> order;
        int start = registry.find(startLabel);
        if (start == -1) return order;

        int numVertices = static_cast<int>(nodes.size());
        std::vector<bool> visited(numVertices, false);
        std::vector<int> stack;

        stack.push_back(start);

        while (!stack.empty()) {
            int current = stack.back();
            stack.pop_back();

            if (visited[current]) continue;
            visited[current] = true;
            order.push_back(nodes[current].label);

            // Traverse adjacent neighbors in reverse order for consistent traversal
            for (int i = static_cast<int>(adjacency[current].size()) - 1; i >= 0; --i) {
                int next = adjacency[current][i].to;
                if (nodes[next].active && !visited[next]) {
                    stack.push_back(next);
                }
            }
        }
        return order;
    }

    // -------------------------------------------------------------
    // Bridge Function: findShortestRoute
    // -------------------------------------------------------------

    RouteResult findShortestRoute(
        const std::string &src,
        const std::string &dest,
        const std::vector<RawNode> &rawNodes,
        const std::vector<RawEdge> &edges
    ) {
        RouteResult result;
        result.reachable = false;
        result.cost = 0;
        result.path = {};

        Network net;

        // Populate nodes with their specific NodeType (Router or Client)
        for (const auto &rn : rawNodes) {
            NodeType type = (rn.type == "client") ? NodeType::CLIENT : NodeType::ROUTER;
            net.addNode(rn.id, type);
        }

        // Add undirected links symmetrically
        for (const auto &e : edges) {
            net.addLink(e.from, e.to, e.weight);
        }

        std::vector<int> pathIndices;
        int totalCost = 0;
        if (net.shortestPath(src, dest, pathIndices, totalCost)) {
            result.reachable = true;
            result.cost = totalCost;
            result.path = net.getPathLabels(pathIndices);
        }

        return result;
    }

} // namespace routing
