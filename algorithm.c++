#include "include/algorithm.h++"
#include <algorithm>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <set>

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
        if ((occupiedCount + 1) * 10 >= capacity * 7) {
            rehash();
        }

        int start = hashFunction(key, capacity);
        int firstDeleted = -1;

        for (int step = 0; step < capacity; ++step) {
            int pos = (start + step) % capacity;

            if (table[pos].state == 1 && table[pos].key == key)
                return false;

            if (table[pos].state == 2 && firstDeleted == -1)
                firstDeleted = pos;

            if (table[pos].state == 0) {
                int target = (firstDeleted == -1) ? pos : firstDeleted;
                table[target].key = key;
                table[target].value = value;
                table[target].state = 1;
                ++occupiedCount;
                return true;
            }
        }

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
            if (table[pos].state == 0) return -1;
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
                table[pos].state = 2;
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
    // Packet & PacketQueue Implementation (Ported from main.cpp)
    // -------------------------------------------------------------

    Packet::Packet()
        : id(0), kind("PING"), pingSrc(""), pingDst(""), hop(0),
          ttl(16), isDropped(false), isDone(false), dropReason(""), dropNode("") {}

    Packet::Packet(int pid, const std::string &k, const std::string &src, const std::string &dst,
                   const std::vector<std::string> &p, int initialTtl)
        : id(pid), kind(k), pingSrc(src), pingDst(dst), path(p), hop(0),
          ttl(initialTtl), isDropped(false), isDone(false), dropReason(""), dropNode("") {}

    PacketQueue::PacketQueue(int cap)
        : buffer(cap > 2 ? cap : 20), frontIndex(0), rearIndex(-1), count(0), capacity(cap > 2 ? cap : 20) {}

    bool PacketQueue::isEmpty() const {
        return count == 0;
    }

    bool PacketQueue::isFull() const {
        return count >= capacity;
    }

    bool PacketQueue::enqueue(const Packet &pkt) {
        if (isFull()) return false;
        rearIndex = (rearIndex + 1) % capacity;
        buffer[rearIndex] = pkt;
        ++count;
        return true;
    }

    bool PacketQueue::dequeue(Packet &pkt) {
        if (isEmpty()) return false;
        pkt = buffer[frontIndex];
        frontIndex = (frontIndex + 1) % capacity;
        --count;
        return true;
    }

    bool PacketQueue::peek(Packet &pkt) const {
        if (isEmpty()) return false;
        pkt = buffer[frontIndex];
        return true;
    }

    int PacketQueue::size() const {
        return count;
    }

    int PacketQueue::getCapacity() const {
        return capacity;
    }

    void PacketQueue::clear() {
        frontIndex = 0;
        rearIndex = -1;
        count = 0;
    }

    // -------------------------------------------------------------
    // ActivityLogger Implementation (Ported from main.cpp)
    // -------------------------------------------------------------

    ActivityLogger::ActivityLogger(const std::string &filePath)
        : tx(0), rx(0), drop(0), logFilePath(filePath) {}

    std::string ActivityLogger::getTimestamp() const {
        std::time_t now = std::time(nullptr);
        std::tm tmNow{};
#if defined(_WIN32) || defined(_WIN64)
        localtime_s(&tmNow, &now);
#else
        localtime_r(&now, &tmNow);
#endif
        char buf[32];
        std::strftime(buf, sizeof(buf), "%H:%M:%S", &tmNow);
        return std::string(buf);
    }

    void ActivityLogger::log(const std::string &type, const std::string &message) {
        LogEntry entry{getTimestamp(), type, message};
        logs.push_back(entry);

        if (type == "PING_TX") ++tx;
        else if (type == "PING_RX") ++rx;
        else if (type == "DROP") ++drop;

        appendToFile(entry);
    }

    void ActivityLogger::clear() {
        logs.clear();
        tx = 0;
        rx = 0;
        drop = 0;
    }

    const std::vector<LogEntry>& ActivityLogger::getLogs() const {
        return logs;
    }

    int ActivityLogger::getTx() const { return tx; }
    int ActivityLogger::getRx() const { return rx; }
    int ActivityLogger::getDrop() const { return drop; }

    void ActivityLogger::setStats(int t, int r, int d) {
        tx = t;
        rx = r;
        drop = d;
    }

    void ActivityLogger::appendToFile(const LogEntry &entry) {
        if (logFilePath.empty()) return;
        std::ofstream out(logFilePath, std::ios::app);
        if (out.is_open()) {
            out << "[" << entry.time << "] [" << std::left << std::setw(12) << entry.type << "] " << entry.message << "\n";
        }
    }

    // -------------------------------------------------------------
    // NodeInfo Implementation
    // -------------------------------------------------------------

    NodeInfo::NodeInfo(const std::string &lbl, NodeType t, int queueCap)
        : label(lbl), type(t), active(true), broken(false), queue(queueCap) {}

    // -------------------------------------------------------------
    // Network Class Implementation
    // -------------------------------------------------------------

    Network::Network()
        : registry(31), nextPacketId(1), tickCount(0), logger("activity_log.txt") {}

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

    bool Network::isNodeBroken(const std::string &label) const {
        int idx = getIndex(label);
        if (idx >= 0 && idx < static_cast<int>(nodes.size())) {
            return nodes[idx].broken;
        }
        return false;
    }

    bool Network::addNode(const std::string &label, NodeType type, bool broken) {
        if (!validLabel(label)) return false;
        if (registry.find(label) != -1) return false;

        int slot = -1;
        for (size_t i = 0; i < nodes.size(); ++i) {
            if (!nodes[i].active) {
                slot = static_cast<int>(i);
                break;
            }
        }

        if (slot == -1) {
            slot = static_cast<int>(nodes.size());
            nodes.push_back(NodeInfo(label, type, 20));
            adjacency.push_back(std::vector<Edge>());
        } else {
            nodes[slot] = NodeInfo(label, type, 20);
            adjacency[slot].clear();
        }

        nodes[slot].broken = broken;
        registry.insert(label, slot);
        return true;
    }

    void Network::removeAllEdges(int vertex) {
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
        nodes[index].queue.clear();
        return true;
    }

    bool Network::setNodeBroken(const std::string &label, bool broken) {
        int idx = getIndex(label);
        if (idx == -1) return false;
        nodes[idx].broken = broken;
        return true;
    }

    bool Network::setNodeLabel(const std::string &oldLabel, const std::string &newLabel) {
        if (!validLabel(newLabel)) return false;
        int idx = getIndex(oldLabel);
        if (idx == -1) return false;
        if (oldLabel != newLabel && registry.find(newLabel) != -1) return false;

        registry.remove(oldLabel);
        nodes[idx].label = newLabel;
        registry.insert(newLabel, idx);
        return true;
    }

    bool Network::addLink(const std::string &a, const std::string &b, int weight, bool broken) {
        int u = registry.find(a);
        int v = registry.find(b);
        if (u == -1 || v == -1 || u == v) return false;

        for (auto &edge : adjacency[u]) {
            if (edge.to == v) {
                edge.weight = weight;
                edge.broken = broken;
                for (auto &revEdge : adjacency[v]) {
                    if (revEdge.to == u) {
                        revEdge.weight = weight;
                        revEdge.broken = broken;
                        return true;
                    }
                }
                return true;
            }
        }

        adjacency[u].push_back(Edge(v, weight, broken));
        adjacency[v].push_back(Edge(u, weight, broken));
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

    bool Network::setLinkWeight(const std::string &a, const std::string &b, int weight) {
        int u = registry.find(a);
        int v = registry.find(b);
        if (u == -1 || v == -1) return false;

        for (auto &e : adjacency[u]) {
            if (e.to == v) {
                e.weight = weight;
                for (auto &re : adjacency[v]) {
                    if (re.to == u) re.weight = weight;
                }
                return true;
            }
        }
        return false;
    }

    bool Network::setLinkBroken(const std::string &a, const std::string &b, bool broken) {
        int u = registry.find(a);
        int v = registry.find(b);
        if (u == -1 || v == -1) return false;

        for (auto &e : adjacency[u]) {
            if (e.to == v) {
                e.broken = broken;
                for (auto &re : adjacency[v]) {
                    if (re.to == u) re.broken = broken;
                }
                return true;
            }
        }
        return false;
    }

    // -------------------------------------------------------------
    // Dijkstra Shortest Path Computation
    // -------------------------------------------------------------

    bool Network::shortestPath(const std::string &source, const std::string &destination,
                              std::vector<int> &path, int &totalCost) const {
        int s = registry.find(source);
        int d = registry.find(destination);
        if (s == -1 || d == -1) return false;
        if (nodes[s].broken || nodes[d].broken) return false;

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

            if (u == d) break;

            if (u != s && u != d && nodes[u].type == NodeType::CLIENT) {
                continue;
            }

            for (const auto &edge : adjacency[u]) {
                int v = edge.to;
                int w = edge.weight;

                if (!nodes[v].active || nodes[v].broken || edge.broken) continue;

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

        if (dist[d] == INF) return false;

        path.clear();
        for (int at = d; at != -1; at = parent[at]) {
            path.push_back(at);
        }
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

    // -------------------------------------------------------------
    // Graph Traversals (BFS & DFS)
    // -------------------------------------------------------------

    TraversalResult Network::runBFS(const std::string &startLabel) const {
        TraversalResult res;
        res.type = "bfs";
        res.start = startLabel;

        int start = registry.find(startLabel);
        if (start == -1 || nodes[start].broken) return res;

        int numVertices = static_cast<int>(nodes.size());
        std::vector<bool> visited(numVertices, false);
        std::vector<int> queue;
        size_t front = 0;

        queue.push_back(start);
        visited[start] = true;
        res.steps.push_back({"", nodes[start].label});

        while (front < queue.size()) {
            int current = queue[front++];
            res.order.push_back(nodes[current].label);

            for (const auto &edge : adjacency[current]) {
                int next = edge.to;
                if (nodes[next].active && !nodes[next].broken && !edge.broken && !visited[next]) {
                    visited[next] = true;
                    queue.push_back(next);
                    res.steps.push_back({nodes[current].label, nodes[next].label});
                }
            }
        }
        return res;
    }

    std::vector<std::string> Network::bfs(const std::string &startLabel) const {
        return runBFS(startLabel).order;
    }

    TraversalResult Network::runDFS(const std::string &startLabel) const {
        TraversalResult res;
        res.type = "dfs";
        res.start = startLabel;

        int start = registry.find(startLabel);
        if (start == -1 || nodes[start].broken) return res;

        int numVertices = static_cast<int>(nodes.size());
        std::vector<bool> visited(numVertices, false);

        struct StackItem {
            int vertex;
            int parent;
        };

        std::vector<StackItem> stack;
        stack.push_back({start, -1});

        while (!stack.empty()) {
            StackItem item = stack.back();
            stack.pop_back();

            int current = item.vertex;
            if (visited[current]) continue;
            visited[current] = true;

            res.order.push_back(nodes[current].label);
            if (item.parent == -1) {
                res.steps.push_back({"", nodes[current].label});
            } else {
                res.steps.push_back({nodes[item.parent].label, nodes[current].label});
            }

            for (int i = static_cast<int>(adjacency[current].size()) - 1; i >= 0; --i) {
                int next = adjacency[current][i].to;
                if (nodes[next].active && !nodes[next].broken && !adjacency[current][i].broken && !visited[next]) {
                    stack.push_back({next, current});
                }
            }
        }
        return res;
    }

    std::vector<std::string> Network::dfs(const std::string &startLabel) const {
        return runDFS(startLabel).order;
    }

    // -------------------------------------------------------------
    // Simulation Engine (PacketQueue, Link Contention, & Ticks)
    // -------------------------------------------------------------

    bool Network::injectPing(const std::string &src, const std::string &dest, Packet &outPkt,
                             std::vector<std::string> &outPath, int &outCost) {
        int s = getIndex(src);
        int d = getIndex(dest);
        if (s == -1 || d == -1) return false;
        if (nodes[s].broken || nodes[d].broken) return false;

        std::vector<int> pathIndices;
        int cost = 0;
        if (!shortestPath(src, dest, pathIndices, cost) || pathIndices.size() < 2) {
            return false;
        }

        outPath = getPathLabels(pathIndices);
        outCost = cost;

        outPkt = Packet(nextPacketId++, "PING", src, dest, outPath);
        activePackets.push_back(outPkt);

        // Enqueue into source node's circular PacketQueue
        nodes[s].queue.enqueue(outPkt);

        return true;
    }

    SimulationTickResult Network::stepTick() {
        ++tickCount;
        SimulationTickResult result;
        result.tick = tickCount;

        size_t initialLogCount = logger.getLogs().size();
        std::set<std::pair<std::string, std::string>> busyEdges;
        std::vector<Packet> remaining;
        std::vector<Packet> spawned;

        for (auto &pkt : activePackets) {
            if (pkt.isDone || pkt.isDropped) continue;

            if (pkt.hop + 1 >= pkt.path.size()) {
                pkt.isDone = true;
                continue;
            }

            std::string fromId = pkt.path[pkt.hop];
            std::string toId = pkt.path[pkt.hop + 1];

            int u = getIndex(fromId);
            int v = getIndex(toId);

            // Failure checks: source node down or link broken
            bool linkBroken = false;
            if (u != -1 && v != -1) {
                for (const auto &edge : adjacency[u]) {
                    if (edge.to == v && edge.broken) {
                        linkBroken = true;
                        break;
                    }
                }
            }

            if (u == -1 || nodes[u].broken || linkBroken) {
                pkt.isDropped = true;
                pkt.dropNode = fromId;
                pkt.dropReason = "link/device offline";
                logger.log("DROP", (pkt.kind == "PING" ? "Ping packet dropped at " : "ACK reply dropped at ") +
                                   fromId + " (link/device offline).");
                continue;
            }

            // Check if link is currently busy carrying another packet this tick
            std::pair<std::string, std::string> edgeKey = {std::min(fromId, toId), std::max(fromId, toId)};
            if (busyEdges.count(edgeKey)) {
                // Link is busy: packet must wait in this node's PacketQueue buffer!
                if (!nodes[u].queue.isFull()) {
                    nodes[u].queue.enqueue(pkt);
                }
                remaining.push_back(pkt);
                continue;
            }

            // Transmit across link
            busyEdges.insert(edgeKey);
            ++pkt.hop;
            std::string arrivedId = pkt.path[pkt.hop];
            int arrivedIdx = getIndex(arrivedId);

            // Dequeue packet from previous router's queue buffer
            Packet tmp;
            nodes[u].queue.dequeue(tmp);

            // Verify if arriving node is operational
            if (arrivedIdx == -1 || nodes[arrivedIdx].broken) {
                pkt.isDropped = true;
                pkt.dropNode = arrivedId;
                pkt.dropReason = "destination device offline";
                logger.log("DROP", (pkt.kind == "PING" ? "Ping packet dropped at " : "ACK reply dropped at ") +
                                   arrivedId + " (device offline).");
                continue;
            }

            // If arrived at intermediate hop, continue in transit
            if (pkt.hop + 1 < pkt.path.size()) {
                remaining.push_back(pkt);
                continue;
            }

            // Reached destination endpoint!
            pkt.isDone = true;
            if (pkt.kind == "PING") {
                logger.log("PING_RX", "Ping delivered at " + arrivedId + ". Generating ACK packet...");
                logger.log("PING_TX", "ACK reply departing " + arrivedId + " towards " + pkt.pingSrc + ".");

                // Spawn return ACK packet
                std::vector<std::string> returnPath = pkt.path;
                std::reverse(returnPath.begin(), returnPath.end());
                Packet ack(nextPacketId++, "ACK", pkt.pingSrc, pkt.pingDst, returnPath);
                spawned.push_back(ack);
                nodes[arrivedIdx].queue.enqueue(ack);
            } else {
                logger.log("PING_RX", "ACK received at " + arrivedId + ". Round-trip successful!");
            }
        }

        activePackets = remaining;
        for (const auto &p : spawned) activePackets.push_back(p);

        // Build snapshot of all packets
        for (const auto &p : activePackets) {
            std::string from = (p.hop < p.path.size()) ? p.path[p.hop] : "";
            std::string to = (p.hop + 1 < p.path.size()) ? p.path[p.hop + 1] : "";
            result.packets.push_back({p.id, p.kind, from, to, p.hop, p.isDropped, p.isDone});
        }

        // Build queue sizes per node
        for (const auto &entry : getQueueCounts()) {
            result.queueSizes.push_back(entry);
        }

        // Collect new log entries produced during this tick
        const auto &allLogs = logger.getLogs();
        for (size_t i = initialLogCount; i < allLogs.size(); ++i) {
            result.newLogs.push_back(allLogs[i]);
        }

        result.tx = logger.getTx();
        result.rx = logger.getRx();
        result.drop = logger.getDrop();

        return result;
    }

    void Network::clearSimulation() {
        activePackets.clear();
        for (auto &node : nodes) {
            node.queue.clear();
        }
    }

    void Network::resetAll() {
        clearSimulation();
        for (size_t i = 0; i < nodes.size(); ++i) {
            nodes[i].active = false;
            nodes[i].label = "";
            nodes[i].broken = false;
            nodes[i].queue.clear();
            adjacency[i].clear();
        }
        registry.clear();
        logger.clear();
        tickCount = 0;
        nextPacketId = 1;
    }

    ActivityLogger& Network::getLogger() {
        return logger;
    }

    const std::vector<Packet>& Network::getActivePackets() const {
        return activePackets;
    }

    std::map<std::string, int> Network::getQueueCounts() const {
        std::map<std::string, int> counts;
        for (const auto &n : nodes) {
            if (n.active && n.queue.size() > 0) {
                counts[n.label] = n.queue.size();
            }
        }
        return counts;
    }

    // -------------------------------------------------------------
    // Bridge Functions for HTTP Requests
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
        for (const auto &rn : rawNodes) {
            NodeType type = (rn.type == "client") ? NodeType::CLIENT : NodeType::ROUTER;
            net.addNode(rn.id, type, rn.broken);
        }
        for (const auto &e : edges) {
            net.addLink(e.from, e.to, e.weight, e.broken);
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

    TraversalResult findTraversal(
        const std::string &type,
        const std::string &start,
        const std::vector<RawNode> &rawNodes,
        const std::vector<RawEdge> &edges
    ) {
        Network net;
        for (const auto &rn : rawNodes) {
            NodeType nt = (rn.type == "client") ? NodeType::CLIENT : NodeType::ROUTER;
            net.addNode(rn.id, nt, rn.broken);
        }
        for (const auto &e : edges) {
            net.addLink(e.from, e.to, e.weight, e.broken);
        }

        if (type == "dfs") {
            return net.runDFS(start);
        } else {
            return net.runBFS(start);
        }
    }

    Network& getGlobalNetwork() {
        static Network globalNet;
        return globalNet;
    }

} // namespace routing
