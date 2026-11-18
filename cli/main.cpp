#include <iostream>
#include <vector>
#include <string>
#include <limits>
#include <utility>
#include <fstream>
#include <ctime>
#include <cstdlib>
#include <sstream>
using namespace std;

const int MAX_ROUTERS = 26;
const int HASH_SIZE = 53;
const int MAX_WEIGHT = 1000000;                    // FIX 3: cap link cost
const int INF = numeric_limits<int>::max() / 4;    // 25 hops * 1e6 is far below INF
const int QUEUE_CAP = 5;                           // small so congestion is visible
const int DEFAULT_TTL = 16;
const string LOG_FILE = "activity_log.txt";
const string USERS_FILE = "users.txt";           // accounts (passwords stored only as salted hashes)

struct Edge {
    int to;
    int weight;
    Edge(int t = -1, int w = 0) : to(t), weight(w) {}
};

struct HeapNode {
    int vertex;
    int distance;
    HeapNode(int v = -1, int d = 0) : vertex(v), distance(d) {}
};

// Custom min-heap used by Dijkstra's algorithm.
class MinHeap {
private:
    vector<HeapNode> heap;

    void siftUp(int i) {
        while (i > 0) {
            int parent = (i - 1) / 2;
            if (heap[parent].distance <= heap[i].distance) break;
            HeapNode temp = heap[parent];
            heap[parent] = heap[i];
            heap[i] = temp;
            i = parent;
        }
    }

    void siftDown(int i) {
        int n = (int)heap.size();
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

public:
    bool empty() const { return heap.empty(); }

    void push(int vertex, int distance) {
        heap.push_back(HeapNode(vertex, distance));
        siftUp((int)heap.size() - 1);
    }

    HeapNode pop() {
        HeapNode result = heap[0];
        heap[0] = heap.back();
        heap.pop_back();
        if (!heap.empty()) siftDown(0);
        return result;
    }
};

// Custom linear-probing hash table: router label -> internal vertex index.
class RouterHashTable {
private:
    struct Entry {
        string key;
        int value;
        int state; // 0 = empty, 1 = occupied, 2 = deleted
        Entry() : key(""), value(-1), state(0) {}
    };

    Entry table[HASH_SIZE];

    int hashFunction(const string &key) const {
        unsigned int hash = 0;
        for (size_t i = 0; i < key.size(); ++i)
            hash = (hash * 31 + (unsigned char)key[i]) % HASH_SIZE;
        return (int)hash;
    }

public:
    bool insert(const string &key, int value) {
        int start = hashFunction(key);
        int firstDeleted = -1;

        for (int step = 0; step < HASH_SIZE; ++step) {
            int pos = (start + step) % HASH_SIZE;

            if (table[pos].state == 1 && table[pos].key == key)
                return false;

            if (table[pos].state == 2 && firstDeleted == -1)
                firstDeleted = pos;

            if (table[pos].state == 0) {
                int target = (firstDeleted == -1) ? pos : firstDeleted;
                table[target].key = key;
                table[target].value = value;
                table[target].state = 1;
                return true;
            }
        }

        if (firstDeleted != -1) {
            table[firstDeleted].key = key;
            table[firstDeleted].value = value;
            table[firstDeleted].state = 1;
            return true;
        }
        return false;
    }

    int find(const string &key) const {
        int start = hashFunction(key);

        for (int step = 0; step < HASH_SIZE; ++step) {
            int pos = (start + step) % HASH_SIZE;
            if (table[pos].state == 0) return -1;
            if (table[pos].state == 1 && table[pos].key == key)
                return table[pos].value;
        }
        return -1;
    }

    bool remove(const string &key) {
        int start = hashFunction(key);

        for (int step = 0; step < HASH_SIZE; ++step) {
            int pos = (start + step) % HASH_SIZE;
            if (table[pos].state == 0) return false;
            if (table[pos].state == 1 && table[pos].key == key) {
                table[pos].state = 2;
                table[pos].key = "";
                table[pos].value = -1;
                return true;
            }
        }
        return false;
    }
};

struct Packet {
    int id;
    string source;
    string destination;
    string payload;
    int ttl;
    int hops;
    Packet() : id(0), ttl(0), hops(0) {}
    Packet(int i, const string &s, const string &d, const string &p, int t = DEFAULT_TTL)
        : id(i), source(s), destination(d), payload(p), ttl(t), hops(0) {}
};

// Custom circular queue for packets (FIFO, bounded).
class PacketQueue {
private:
    vector<Packet> data;
    int frontIndex;
    int rearIndex;
    int count;

public:
    PacketQueue(int capacity = 100)
        : data(capacity), frontIndex(0), rearIndex(-1), count(0) {}

    bool isEmpty() const { return count == 0; }
    bool isFull() const { return count == (int)data.size(); }

    bool enqueue(const Packet &packet) {
        if (isFull()) return false;
        rearIndex = (rearIndex + 1) % (int)data.size();
        data[rearIndex] = packet;
        ++count;
        return true;
    }

    bool dequeue(Packet &packet) {
        if (isEmpty()) return false;
        packet = data[frontIndex];
        frontIndex = (frontIndex + 1) % (int)data.size();
        --count;
        return true;
    }

    int size() const { return count; }
};

// ---------- Logging ----------
string currentTimestamp() {
    time_t now = time(0);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", localtime(&now));
    return string(buf);
}

// Appends one line to the shared log: [time] [user] ACTION | details
void appendLog(const string &user, const string &action, const string &details) {
    ofstream out(LOG_FILE.c_str(), ios::app);
    if (out) out << "[" << currentTimestamp() << "] [" << user << "] " << action << " | " << details << "\n";
}

// Records one user's actions and keeps that user's session counters.
class ActivityLogger {
private:
    string user;
    int routersAdded, routersRemoved;
    int linksAdded, linksUpdated, linksRemoved;
    int packetsInjected, packetsDelivered, packetsDropped;
    int failedActions;

    void write(const string &action, const string &details) { appendLog(user, action, details); }

    static string num(int x) {
        ostringstream o;
        o << x;
        return o.str();
    }

public:
    ActivityLogger(const string &u)
        : user(u), routersAdded(0), routersRemoved(0), linksAdded(0), linksUpdated(0),
          linksRemoved(0), packetsInjected(0), packetsDelivered(0),
          packetsDropped(0), failedActions(0) {
        write("SESSION_START", "user logged in");
    }

    ~ActivityLogger() {
        write("SESSION_END", "routers +" + num(routersAdded) + "/-" + num(routersRemoved) +
              ", links +" + num(linksAdded) + "/~" + num(linksUpdated) + "/-" + num(linksRemoved) +
              ", packets sent " + num(packetsInjected) + " delivered " + num(packetsDelivered) +
              " dropped " + num(packetsDropped) + ", failed actions " + num(failedActions));
    }

    const string &userName() const { return user; }

    void routerAdded(const string &l) { ++routersAdded; write("ADD_ROUTER", l); }
    void routerRemoved(const string &l, int lost) {
        ++routersRemoved;
        packetsDropped += lost;
        write("REMOVE_ROUTER", l + " (" + num(lost) + " queued packet(s) lost)");
    }
    void linkAdded(const string &a, const string &b, int w) {
        ++linksAdded; write("ADD_LINK", a + " <-> " + b + " cost " + num(w));
    }
    void linkUpdated(const string &a, const string &b, int oldW, int newW) {
        ++linksUpdated; write("UPDATE_LINK", a + " <-> " + b + " cost " + num(oldW) + " -> " + num(newW));
    }
    void linkRemoved(const string &a, const string &b) {
        ++linksRemoved; write("REMOVE_LINK", a + " <-> " + b);
    }
    void packetInjected(int id, const string &s, const string &d, const string &payload) {
        ++packetsInjected;
        write("PACKET_SENT", "#" + num(id) + " " + s + " -> " + d + " payload '" + payload + "'");
    }
    void packetDelivered(int id, const string &s, const string &d, int hops) {
        ++packetsDelivered;
        write("PACKET_DELIVERED", "#" + num(id) + " " + s + " -> " + d + " in " + num(hops) + " hop(s)");
    }
    void packetDropped(int id, const string &reason) {
        ++packetsDropped; write("PACKET_DROPPED", "#" + num(id) + " " + reason);
    }
    void failed(const string &action, const string &reason) {
        ++failedActions; write("FAILED_" + action, reason);
    }
    void topologyLoaded(int r, int l) {
        write("LOAD_TOPOLOGY", num(r) + " router(s), " + num(l) + " link(s) restored from saved network");
    }
    void viewedLog(const string &target) {
        write("VIEW_LOG", target.empty() ? "all users" : "log of " + target);
    }

    void showSummary() const {
        cout << "\n========== YOUR SESSION SUMMARY ==========\n"
             << "Routers added    : " << routersAdded << "\n"
             << "Routers removed  : " << routersRemoved << "\n"
             << "Links added      : " << linksAdded << "\n"
             << "Links updated    : " << linksUpdated << "\n"
             << "Links removed    : " << linksRemoved << "\n"
             << "Packets sent     : " << packetsInjected << "\n"
             << "Packets delivered: " << packetsDelivered << "\n"
             << "Packets dropped  : " << packetsDropped << "\n"
             << "Failed actions   : " << failedActions << "\n"
             << "==========================================\n";
    }

    // Prints log lines. filterUser == "" prints everyone's lines.
    static void showLog(const string &filterUser) {
        ifstream in(LOG_FILE.c_str());
        string line;
        int shown = 0;
        while (getline(in, line)) {
            if (!filterUser.empty()) {
                // Line layout: "[YYYY-MM-DD HH:MM:SS] [user] ..." -> user tag starts at index 22.
                string tag = "[" + filterUser + "] ";
                if (line.size() < 22 + tag.size() || line.compare(22, tag.size(), tag) != 0) continue;
            }
            cout << line << "\n";
            ++shown;
        }
        if (shown == 0) cout << "(no activity recorded)\n";
    }
};

class Network {
private:
    vector<Edge> adjacency[MAX_ROUTERS];
    bool active[MAX_ROUTERS];
    string labels[MAX_ROUTERS];
    RouterHashTable registry;
    string saveFile;          // each user has their own saved network
    ActivityLogger logger;    // each user has their own logger

    // Packet simulation state: one FIFO queue per router.
    vector<PacketQueue> routerQueues;
    int nextPacketId, delivered, dropped;

    bool validLabel(const string &label) const {
        return !label.empty() && label.size() <= 12;
    }

    // FIX 4: only visit the neighbours instead of scanning every router.
    void removeAllEdges(int vertex) {
        for (size_t k = 0; k < adjacency[vertex].size(); ++k) {
            vector<Edge> &nb = adjacency[adjacency[vertex][k].to];
            for (size_t j = 0; j < nb.size();) {
                if (nb[j].to == vertex) nb.erase(nb.begin() + j);
                else ++j;
            }
        }
        adjacency[vertex].clear();
    }

    void printPath(const vector<int> &path) const {
        for (size_t i = 0; i < path.size(); ++i) {
            cout << labels[path[i]];
            if (i + 1 < path.size()) cout << " -> ";
        }
    }

public:
    Network(const string &user)
        : saveFile("network_" + user + ".txt"), logger(user),
          routerQueues(MAX_ROUTERS, PacketQueue(QUEUE_CAP)),
          nextPacketId(1), delivered(0), dropped(0) {
        for (int i = 0; i < MAX_ROUTERS; ++i) {
            active[i] = false;
            labels[i] = "";
        }
    }

    int getIndex(const string &label) const {
        return registry.find(label);
    }

    bool addRouter(const string &label) {
        if (!validLabel(label)) {
            cout << "Router name must contain 1 to 12 characters.\n";
            logger.failed("ADD_ROUTER", "invalid name '" + label + "'");
            return false;
        }
        if (registry.find(label) != -1) {
            cout << "A router with that name already exists.\n";
            logger.failed("ADD_ROUTER", "duplicate name '" + label + "'");
            return false;
        }

        int slot = -1;
        for (int i = 0; i < MAX_ROUTERS; ++i) {
            if (!active[i]) { slot = i; break; }
        }
        if (slot == -1) {
            cout << "Network is full (maximum " << MAX_ROUTERS << " routers).\n";
            logger.failed("ADD_ROUTER", "network full, tried '" + label + "'");
            return false;
        }

        if (!registry.insert(label, slot)) {
            cout << "Could not register router.\n";
            return false;
        }

        active[slot] = true;
        labels[slot] = label;
        cout << "Router " << label << " added successfully.\n";
        logger.routerAdded(label);
        return true;
    }

    bool removeRouter(const string &label) {
        int index = registry.find(label);
        if (index == -1) {
            cout << "Router not found.\n";
            logger.failed("REMOVE_ROUTER", "router '" + label + "' not found");
            return false;
        }
        removeAllEdges(index);

        // Packets waiting in the removed router's queue are lost.
        Packet tmp;
        int lost = 0;
        while (routerQueues[index].dequeue(tmp)) { ++dropped; ++lost; }

        registry.remove(label);
        active[index] = false;
        labels[index] = "";
        cout << "Router " << label << " and its connections removed.";
        if (lost > 0) cout << " " << lost << " queued packet(s) lost.";
        cout << "\n";
        logger.routerRemoved(label, lost);
        return true;
    }

    bool addEdge(const string &a, const string &b, int weight) {
        int u = registry.find(a);
        int v = registry.find(b);

        if (u == -1 || v == -1) {
            string missing = (u == -1 && v == -1) ? a + " and " + b : (u == -1 ? a : b);
            cout << "Router not found: " << missing << ". Add it first (menu option 1).\n";
            logger.failed("ADD_LINK", a + " <-> " + b + " (missing: " + missing + ")");
            return false;
        }
        if (u == v) {
            cout << "A router cannot connect to itself in this simulation.\n";
            logger.failed("ADD_LINK", "self-link on " + a);
            return false;
        }
        if (weight <= 0 || weight > MAX_WEIGHT) {
            cout << "Link cost must be between 1 and " << MAX_WEIGHT << ".\n";
            logger.failed("ADD_LINK", a + " <-> " + b + " (invalid cost)");
            return false;
        }

        for (size_t i = 0; i < adjacency[u].size(); ++i) {
            if (adjacency[u][i].to == v) {
                int oldWeight = adjacency[u][i].weight;
                adjacency[u][i].weight = weight;
                for (size_t j = 0; j < adjacency[v].size(); ++j) {
                    if (adjacency[v][j].to == u) {
                        adjacency[v][j].weight = weight;
                        break;
                    }
                }
                cout << "Existing link cost updated.\n";
                logger.linkUpdated(a, b, oldWeight, weight);
                return true;
            }
        }

        adjacency[u].push_back(Edge(v, weight));
        adjacency[v].push_back(Edge(u, weight));
        cout << "Link " << a << " <-> " << b << " added with cost " << weight << ".\n";
        logger.linkAdded(a, b, weight);
        return true;
    }

    bool removeEdge(const string &a, const string &b) {
        int u = registry.find(a);
        int v = registry.find(b);
        if (u == -1 || v == -1) {
            cout << "Both routers must exist.\n";
            logger.failed("REMOVE_LINK", a + " <-> " + b + " (router missing)");
            return false;
        }

        bool removed = false;
        for (size_t i = 0; i < adjacency[u].size();) {
            if (adjacency[u][i].to == v) {
                adjacency[u].erase(adjacency[u].begin() + i);
                removed = true;
            } else ++i;
        }
        for (size_t i = 0; i < adjacency[v].size();) {
            if (adjacency[v][i].to == u)
                adjacency[v].erase(adjacency[v].begin() + i);
            else ++i;
        }

        if (removed) {
            cout << "Link " << a << " <-> " << b << " removed.\n";
            logger.linkRemoved(a, b);
        } else {
            cout << "No direct link exists between those routers.\n";
            logger.failed("REMOVE_LINK", a + " <-> " + b + " (no such link)");
        }
        return removed;
    }

    void displayNetwork() const {
        cout << "\n========== NETWORK TOPOLOGY ==========\n";
        bool any = false;
        for (int i = 0; i < MAX_ROUTERS; ++i) {
            if (!active[i]) continue;
            any = true;
            cout << labels[i] << " -> ";
            if (adjacency[i].empty()) cout << "(no links)";
            for (size_t j = 0; j < adjacency[i].size(); ++j) {
                int to = adjacency[i][j].to;
                cout << labels[to] << "(" << adjacency[i][j].weight << ")";
                if (j + 1 < adjacency[i].size()) cout << "  ";
            }
            cout << "\n";
        }
        if (!any) cout << "No routers have been added yet.\n";
        cout << "======================================\n";
    }

    void searchDirectLink(const string &a, const string &b) const {
        int u = registry.find(a);
        int v = registry.find(b);
        if (u == -1 || v == -1) {
            cout << "Router not found.\n";
            return;
        }
        for (size_t i = 0; i < adjacency[u].size(); ++i) {
            if (adjacency[u][i].to == v) {
                cout << "Direct link exists. Cost: " << adjacency[u][i].weight << "\n";
                return;
            }
        }
        cout << "No direct link exists.\n";
    }

    void bfs(const string &startLabel) const {
        int start = registry.find(startLabel);
        if (start == -1) { cout << "Starting router not found.\n"; return; }

        bool visited[MAX_ROUTERS] = {false};
        int q[MAX_ROUTERS];     // safe: each vertex is enqueued at most once
        int front = 0, rear = 0;
        q[rear++] = start;
        visited[start] = true;

        cout << "BFS traversal: ";
        while (front < rear) {
            int current = q[front++];
            cout << labels[current] << " ";

            for (size_t i = 0; i < adjacency[current].size(); ++i) {
                int next = adjacency[current][i].to;
                if (!visited[next]) {
                    visited[next] = true;
                    q[rear++] = next;
                }
            }
        }
        cout << "\n";
    }

    // FIX 2: vector-based stack (the same vertex can be pushed several times).
    void dfs(const string &startLabel) const {
        int start = registry.find(startLabel);
        if (start == -1) { cout << "Starting router not found.\n"; return; }

        bool visited[MAX_ROUTERS] = {false};
        vector<int> stack;
        stack.push_back(start);

        cout << "DFS traversal: ";
        while (!stack.empty()) {
            int current = stack.back();
            stack.pop_back();
            if (visited[current]) continue;
            visited[current] = true;
            cout << labels[current] << " ";

            // Reverse insertion order so traversal is easier to follow.
            for (int i = (int)adjacency[current].size() - 1; i >= 0; --i) {
                int next = adjacency[current][i].to;
                if (!visited[next]) stack.push_back(next);
            }
        }
        cout << "\n";
    }

    bool shortestPath(const string &source, const string &destination,
                      vector<int> &path, int &totalCost) const {
        int s = registry.find(source);
        int d = registry.find(destination);
        if (s == -1 || d == -1) return false;

        int dist[MAX_ROUTERS];
        int parent[MAX_ROUTERS];
        bool settled[MAX_ROUTERS];

        for (int i = 0; i < MAX_ROUTERS; ++i) {
            dist[i] = INF;
            parent[i] = -1;
            settled[i] = false;
        }

        MinHeap minHeap;
        dist[s] = 0;
        minHeap.push(s, 0);

        while (!minHeap.empty()) {
            HeapNode node = minHeap.pop();
            int u = node.vertex;

            if (settled[u]) continue;
            settled[u] = true;
            if (u == d) break;

            for (size_t i = 0; i < adjacency[u].size(); ++i) {
                int v = adjacency[u][i].to;
                int w = adjacency[u][i].weight;

                if (!settled[v] && dist[u] + w < dist[v]) {
                    dist[v] = dist[u] + w;
                    parent[v] = u;
                    minHeap.push(v, dist[v]);
                }
            }
        }

        if (dist[d] == INF) return false;

        path.clear();
        for (int at = d; at != -1; at = parent[at])
            path.push_back(at);

        for (size_t i = 0; i < path.size() / 2; ++i) {
            int temp = path[i];
            path[i] = path[path.size() - 1 - i];
            path[path.size() - 1 - i] = temp;
        }

        totalCost = dist[d];
        return true;
    }

    void findShortestRoute(const string &source, const string &destination) const {
        vector<int> path;
        int cost = 0;
        if (!shortestPath(source, destination, path, cost)) {
            cout << "No route found (or one of the routers does not exist).\n";
            return;
        }
        cout << "Lowest-cost route: ";
        printPath(path);
        cout << "\nTotal route cost: " << cost << "\n";
    }

    // ---------------- Packet simulation ----------------

    void enqueuePacket(const string &src, const string &dst, const string &payload) {
        int s = registry.find(src);
        if (s == -1 || registry.find(dst) == -1) {
            cout << "Source and destination routers must both exist.\n";
            logger.failed("SEND_PACKET", src + " -> " + dst + " (router missing)");
            return;
        }
        Packet p(nextPacketId++, src, dst, payload);
        if (!routerQueues[s].enqueue(p)) {
            ++dropped;
            cout << "Router " << src << " queue full - packet #" << p.id << " dropped.\n";
            logger.packetInjected(p.id, src, dst, payload);
            logger.packetDropped(p.id, "queue full at " + src + " on injection");
        } else {
            cout << "Packet #" << p.id << " injected at " << src << ".\n";
            logger.packetInjected(p.id, src, dst, payload);
        }
    }

    bool hasPackets() const {
        for (int i = 0; i < MAX_ROUTERS; ++i)
            if (active[i] && !routerQueues[i].isEmpty()) return true;
        return false;
    }

    // One time step: every router forwards at most one packet, one hop.
    void tick() {
        vector<pair<int, Packet> > moving;   // collect first so a packet moves 1 hop/tick

        for (int r = 0; r < MAX_ROUTERS; ++r) {
            if (!active[r]) continue;
            Packet p;
            if (!routerQueues[r].dequeue(p)) continue;

            if (labels[r] == p.destination) {
                ++delivered;
                logger.packetDelivered(p.id, p.source, p.destination, p.hops);
                cout << "  [#" << p.id << "] DELIVERED at " << labels[r]
                     << " after " << p.hops << " hop(s)\n";
                continue;
            }
            if (--p.ttl <= 0) {
                ++dropped;
                cout << "  [#" << p.id << "] DROPPED at " << labels[r] << " (TTL expired)\n";
                logger.packetDropped(p.id, "TTL expired at " + labels[r]);
                continue;
            }
            vector<int> path;
            int cost = 0;
            if (!shortestPath(labels[r], p.destination, path, cost) || path.size() < 2) {
                ++dropped;
                cout << "  [#" << p.id << "] DROPPED at " << labels[r] << " (no route)\n";
                logger.packetDropped(p.id, "no route at " + labels[r]);
                continue;
            }
            moving.push_back(make_pair(path[1], p));   // path[1] = next hop
        }

        for (size_t i = 0; i < moving.size(); ++i) {
            int next = moving[i].first;
            Packet &p = moving[i].second;
            ++p.hops;
            if (!routerQueues[next].enqueue(p)) {
                ++dropped;
                cout << "  [#" << p.id << "] DROPPED at " << labels[next] << " (queue full)\n";
                logger.packetDropped(p.id, "queue full at " + labels[next]);
            } else {
                cout << "  [#" << p.id << "] forwarded to " << labels[next] << "\n";
            }
        }
    }

    void stepOnce() {
        if (!hasPackets()) { cout << "No packets in the network.\n"; return; }
        cout << "--- Single tick ---\n";
        tick();
        showStats();
    }

    void runSimulation(int maxTicks = 100) {
        if (!hasPackets()) { cout << "No packets in the network.\n"; return; }
        for (int t = 1; t <= maxTicks && hasPackets(); ++t) {
            cout << "--- Tick " << t << " ---\n";
            tick();
        }
        showStats();
    }

    void showStats() const {
        cout << "\nDelivered: " << delivered << " | Dropped: " << dropped << "\n";
        cout << "Queues: ";
        bool any = false;
        for (int i = 0; i < MAX_ROUTERS; ++i) {
            if (active[i] && !routerQueues[i].isEmpty()) {
                cout << labels[i] << "(" << routerQueues[i].size() << ") ";
                any = true;
            }
        }
        if (!any) cout << "all empty";
        cout << "\n";
    }

    // Saves routers and links to saveFile (queued packets are temporary and not saved).
    void saveTopology() const {
        ofstream f(saveFile.c_str());
        if (!f) {
            cout << "Warning: could not save network to " << saveFile << ".\n";
            return;
        }
        for (int i = 0; i < MAX_ROUTERS; ++i)
            if (active[i]) f << "R " << labels[i] << "\n";
        for (int i = 0; i < MAX_ROUTERS; ++i) {
            if (!active[i]) continue;
            for (size_t j = 0; j < adjacency[i].size(); ++j) {
                int to = adjacency[i][j].to;
                if (i < to)   // write each undirected link once
                    f << "L " << labels[i] << " " << labels[to] << " " << adjacency[i][j].weight << "\n";
            }
        }
    }

    // Restores the network saved by the previous run (silent, validates every line).
    void loadTopology() {
        ifstream f(saveFile.c_str());
        if (!f) return;
        string type;
        int r = 0, l = 0;
        while (f >> type) {
            if (type == "R") {
                string name;
                f >> name;
                if (!validLabel(name) || registry.find(name) != -1) continue;
                int slot = -1;
                for (int i = 0; i < MAX_ROUTERS; ++i)
                    if (!active[i]) { slot = i; break; }
                if (slot == -1 || !registry.insert(name, slot)) continue;
                active[slot] = true;
                labels[slot] = name;
                ++r;
            } else if (type == "L") {
                string a, b;
                int w;
                f >> a >> b >> w;
                int u = registry.find(a), v = registry.find(b);
                if (u == -1 || v == -1 || u == v || w <= 0 || w > MAX_WEIGHT) continue;
                bool exists = false;
                for (size_t i = 0; i < adjacency[u].size(); ++i)
                    if (adjacency[u][i].to == v) exists = true;
                if (exists) continue;
                adjacency[u].push_back(Edge(v, w));
                adjacency[v].push_back(Edge(u, w));
                ++l;
            }
        }
        if (r > 0 || l > 0) {
            cout << "Loaded saved network: " << r << " router(s), " << l << " link(s).\n";
            logger.topologyLoaded(r, l);
        }
    }

    // A user's own summary + log.
    void showMyActivity() {
        logger.viewedLog(logger.userName());
        logger.showSummary();
        cout << "\n========== YOUR ACTIVITY LOG ==========\n";
        ActivityLogger::showLog(logger.userName());
        cout << "=======================================\n";
    }

    // Owner only (checked in the menu): one user's log, or all users when target is "".
    void showLogOf(const string &target) {
        logger.viewedLog(target);
        cout << "\n========== ACTIVITY LOG: " << (target.empty() ? "ALL USERS" : target) << " ==========\n";
        ActivityLogger::showLog(target);
        cout << "=======================================\n";
    }

    void showRouters() const {
        cout << "Available routers: ";
        bool any = false;
        for (int i = 0; i < MAX_ROUTERS; ++i) {
            if (active[i]) {
                cout << labels[i] << " ";
                any = true;
            }
        }
        if (!any) cout << "(none)";
        cout << "\n";
    }
};

// ---------- User accounts ----------
struct User {
    string name, role, salt, hash;
};

class UserManager {
private:
    vector<User> users;

    static string toHex(unsigned long long v) {
        const char *digits = "0123456789abcdef";
        string s(16, '0');
        for (int i = 15; i >= 0; --i) { s[i] = digits[v & 15]; v >>= 4; }
        return s;
    }

    // Salted, repeated FNV-1a hash. Good enough for a class project, NOT for production.
    static string hashPassword(const string &salt, const string &password) {
        unsigned long long h = 1469598103934665603ULL;
        string data = salt + password;
        for (int round = 0; round < 2000; ++round)
            for (size_t i = 0; i < data.size(); ++i) {
                h ^= (unsigned char)data[i];
                h *= 1099511628211ULL;
            }
        return toHex(h);
    }

    static string makeSalt() {
        static unsigned long long counter = 0;
        unsigned long long v = (unsigned long long)time(0) * 6364136223846793005ULL
                             + (unsigned long long)clock() * 1442695040888963407ULL
                             + (unsigned long long)rand() + (++counter);
        return toHex(v);
    }

    int findIndex(const string &name) const {
        for (size_t i = 0; i < users.size(); ++i)
            if (users[i].name == name) return (int)i;
        return -1;
    }

    void save() const {
        ofstream f(USERS_FILE.c_str());
        for (size_t i = 0; i < users.size(); ++i)
            f << users[i].name << " " << users[i].role << " " << users[i].salt << " " << users[i].hash << "\n";
    }

    void load() {
        ifstream f(USERS_FILE.c_str());
        User u;
        while (f >> u.name >> u.role >> u.salt >> u.hash) users.push_back(u);
    }

public:
    UserManager() { load(); }

    static string normalize(const string &s) {
        string r = s;
        for (size_t i = 0; i < r.size(); ++i)
            if (r[i] >= 'A' && r[i] <= 'Z') r[i] = (char)(r[i] - 'A' + 'a');
        return r;
    }

    // Only a-z, 0-9, _ : keeps usernames safe to use inside file names and log lines.
    static bool validUsername(const string &s) {
        if (s.size() < 3 || s.size() > 12) return false;
        for (size_t i = 0; i < s.size(); ++i) {
            char c = s[i];
            if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')) return false;
        }
        return true;
    }

    static bool validPassword(const string &s) { return s.size() >= 4 && s.size() <= 20; }

    bool exists(const string &name) const { return findIndex(name) != -1; }

    bool hasOwner() const {
        for (size_t i = 0; i < users.size(); ++i)
            if (users[i].role == "owner") return true;
        return false;
    }

    bool addUser(const string &name, const string &password, const string &role) {
        if (!validUsername(name) || !validPassword(password) || exists(name)) return false;
        User u;
        u.name = name;
        u.role = role;
        u.salt = makeSalt();
        u.hash = hashPassword(u.salt, password);
        users.push_back(u);
        save();
        return true;
    }

    bool authenticate(const string &name, const string &password, string &roleOut) const {
        int i = findIndex(name);
        if (i == -1) return false;
        if (hashPassword(users[i].salt, password) != users[i].hash) return false;
        roleOut = users[i].role;
        return true;
    }

    void listUsers() const {
        cout << "\n========== REGISTERED USERS ==========\n";
        for (size_t i = 0; i < users.size(); ++i)
            cout << users[i].name << "  (" << users[i].role << ")\n";
        cout << "Total: " << users.size() << "\n======================================\n";
    }
};

string toStr(int x) {
    ostringstream o;
    o << x;
    return o.str();
}

// Used outside a session: if input ends, just quit.
void readWord(string &s) {
    if (!(cin >> s)) exit(0);
}

void printMenu(const string &user, bool owner) {
    cout << "\n========== DATA ROUTING SIMULATOR  [user: " << user << "] ==========\n"
         << " 1. Add router\n"
         << " 2. Remove router\n"
         << " 3. Add / update network link\n"
         << " 4. Remove network link\n"
         << " 5. Display network topology\n"
         << " 6. Search for a direct link\n"
         << " 7. BFS traversal\n"
         << " 8. DFS traversal\n"
         << " 9. Find lowest-cost route (Dijkstra)\n"
         << "10. Inject packet at source router\n"
         << "11. Run packet simulation to completion\n"
         << "12. Show available routers\n"
         << "13. Step simulation by one tick\n"
         << "14. Show delivery statistics / queues\n";
    if (owner) {
        cout << "15. [Owner] View ALL users' activity log\n"
             << "16. [Owner] View one user's activity log\n"
             << "17. [Owner] List all users\n";
    } else {
        cout << "15. View my activity log\n";
    }
    cout << " 0. Logout\n"
         << "=====================================================\n"
         << "Enter choice: ";
}

void runSession(UserManager &users, const string &user, const string &role) {
    bool owner = (role == "owner");
    Network network(user);          // this user's own network + logger
    network.loadTopology();         // restore this user's saved routers/links
    cout << "\nWelcome, " << user << "! Note: your activity in this program is recorded.\n";

    int choice = -1;
    do {
        printMenu(user, owner);
        if (!(cin >> choice)) {
            if (cin.eof()) return;
            cin.clear();
            cin.ignore(numeric_limits<streamsize>::max(), '\n');
            cout << "Invalid input. Please enter a menu number.\n";
            choice = -1;
            continue;
        }

        string a, b, payload;
        int weight;

        switch (choice) {
            case 1:
                cout << "Enter router name (up to 12 characters): ";
                cin >> a;
                network.addRouter(a);
                break;
            case 2:
                cout << "Enter router name to remove: ";
                cin >> a;
                network.removeRouter(a);
                break;
            case 3:
                cout << "Enter first router: ";
                cin >> a;
                cout << "Enter second router: ";
                cin >> b;
                cout << "Enter link cost (1 to " << MAX_WEIGHT << "): ";
                if (cin >> weight) network.addEdge(a, b, weight);
                else {
                    cin.clear();
                    cin.ignore(numeric_limits<streamsize>::max(), '\n');
                    cout << "Invalid cost.\n";
                }
                break;
            case 4:
                cout << "Enter first router: ";
                cin >> a;
                cout << "Enter second router: ";
                cin >> b;
                network.removeEdge(a, b);
                break;
            case 5:
                network.displayNetwork();
                break;
            case 6:
                cout << "Enter first router: ";
                cin >> a;
                cout << "Enter second router: ";
                cin >> b;
                network.searchDirectLink(a, b);
                break;
            case 7:
                cout << "Enter starting router: ";
                cin >> a;
                network.bfs(a);
                break;
            case 8:
                cout << "Enter starting router: ";
                cin >> a;
                network.dfs(a);
                break;
            case 9:
                cout << "Enter source router: ";
                cin >> a;
                cout << "Enter destination router: ";
                cin >> b;
                network.findShortestRoute(a, b);
                break;
            case 10:
                cout << "Enter source router: ";
                cin >> a;
                cout << "Enter destination router: ";
                cin >> b;
                cout << "Enter one-word packet payload: ";
                cin >> payload;
                network.enqueuePacket(a, b, payload);
                break;
            case 11:
                network.runSimulation();
                break;
            case 12:
                network.showRouters();
                break;
            case 13:
                network.stepOnce();
                break;
            case 14:
                network.showStats();
                break;
            case 15:
                if (owner) network.showLogOf("");      // everyone's activity
                else network.showMyActivity();         // only this user's activity
                break;
            case 16:
                if (!owner) { cout << "Invalid choice. Select a number from the menu.\n"; break; }
                cout << "Enter username to inspect: ";
                cin >> a;
                a = UserManager::normalize(a);
                if (users.exists(a)) network.showLogOf(a);
                else cout << "No such user.\n";
                break;
            case 17:
                if (!owner) { cout << "Invalid choice. Select a number from the menu.\n"; break; }
                users.listUsers();
                break;
            case 0:
                cout << "Logged out. Goodbye, " << user << "!\n";
                break;
            default:
                cout << "Invalid choice. Select a number from the menu.\n";
        }

        // Auto-save this user's network after any router/link change (options 1-4).
        if (choice >= 1 && choice <= 4) network.saveTopology();

    } while (choice != 0);
}

// Asks for a new username + password (twice). Returns true if the account was created.
bool createAccount(UserManager &users, const string &role) {
    string u, p1, p2;
    cout << "Choose a username (3-12 characters: letters, numbers, _): ";
    readWord(u);
    u = UserManager::normalize(u);
    if (!UserManager::validUsername(u)) {
        cout << "Invalid username. Use 3-12 letters, numbers or underscores.\n";
        return false;
    }
    if (users.exists(u)) {
        cout << "That username is already taken.\n";
        return false;
    }
    cout << "Choose a password (4-20 characters, no spaces): ";
    readWord(p1);
    if (!UserManager::validPassword(p1)) {
        cout << "Password must be 4 to 20 characters.\n";
        return false;
    }
    cout << "Confirm password: ";
    readWord(p2);
    if (p1 != p2) {
        cout << "Passwords do not match.\n";
        return false;
    }
    if (!users.addUser(u, p1, role)) {
        cout << "Could not create account.\n";
        return false;
    }
    appendLog(u, "ACCOUNT_CREATED", role + " account created");
    cout << "Account '" << u << "' created successfully.\n";
    return true;
}

// Up to 3 attempts. The message never says whether the username or the password was wrong.
bool doLogin(UserManager &users, string &userOut, string &roleOut) {
    for (int attempt = 1; attempt <= 3; ++attempt) {
        string u, p;
        cout << "Username: ";
        readWord(u);
        u = UserManager::normalize(u);
        cout << "Password: ";
        readWord(p);

        if (users.authenticate(u, p, roleOut)) {
            userOut = u;
            return true;
        }
        if (users.exists(u))
            appendLog(u, "LOGIN_FAILED", "wrong password (attempt " + toStr(attempt) + ")");
        else
            appendLog("SYSTEM", "LOGIN_FAILED", "unknown username " +
                      (UserManager::validUsername(u) ? u : string("(invalid)")));
        cout << "Incorrect username or password.\n";
    }
    appendLog("SYSTEM", "LOGIN_BLOCKED", "3 failed attempts in one login");
    cout << "Too many failed attempts. Returning to the main screen.\n";
    return false;
}

int main() {
    srand((unsigned)time(0));
    UserManager users;

    cout << "DATA ROUTING: INTERACTIVE NETWORK ROUTING & PACKET SIMULATOR\n";
    cout << "Educational simulation only - does not send real network traffic.\n";

    if (!users.hasOwner()) {
        cout << "\nFirst-time setup: create the OWNER account (this account can view all activity).\n";
        while (!createAccount(users, "owner")) {}
    }

    int choice = -1;
    do {
        cout << "\n========== WELCOME ==========\n"
             << " 1. Login\n"
             << " 2. Register new account\n"
             << " 0. Exit program\n"
             << "=============================\n"
             << "Enter choice: ";
        if (!(cin >> choice)) {
            if (cin.eof()) return 0;
            cin.clear();
            cin.ignore(numeric_limits<streamsize>::max(), '\n');
            cout << "Invalid input. Please enter a menu number.\n";
            choice = -1;
            continue;
        }

        if (choice == 1) {
            string user, role;
            if (doLogin(users, user, role)) runSession(users, user, role);
        } else if (choice == 2) {
            createAccount(users, "customer");
        } else if (choice == 0) {
            cout << "Exiting program. Goodbye!\n";
        } else {
            cout << "Invalid choice. Select a number from the menu.\n";
        }
    } while (choice != 0);

    return 0;
}
