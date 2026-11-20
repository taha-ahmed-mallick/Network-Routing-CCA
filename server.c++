#include "./include/crow_all.h"
#include "./include/algorithm.h++"
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <map>

// Helper to read static files (HTML, CSS, JS, SVG) from ./static/
std::string readFile(const std::string &path)
{
    std::ifstream file(path, std::ios::binary);
    if (!file.is_open())
        return "";
    std::ostringstream ss;
    ss << file.rdbuf();
    return ss.str();
}

int main()
{
    crow::SimpleApp app;

    // 1. GET "/" -> Serve index.html
    CROW_ROUTE(app, "/")([]()
                         {
        crow::response res(readFile("static/index.html"));
        res.set_header("Content-Type", "text/html");
        return res; });

    // 2. GET "/<path>" -> Serve style.css, script.js, and imgs/*.svg
    CROW_ROUTE(app, "/<path>")([](const std::string &path)
                               {
        // Basic directory traversal guard
        if (path.find("..") != std::string::npos) {
            return crow::response(403);
        }

        std::string content = readFile("static/" + path);
        if (content.empty()) return crow::response(404);

        crow::response res(content);
        if (path.ends_with(".css"))
            res.set_header("Content-Type", "text/css");
        else if (path.ends_with(".js"))
            res.set_header("Content-Type", "application/javascript");
        else if (path.ends_with(".svg"))
            res.set_header("Content-Type", "image/svg+xml");
        return res; });

    // 3. POST "/route" -> Receives stripped network JSON, returns shortest path JSON
    CROW_ROUTE(app, "/route").methods(crow::HTTPMethod::POST)([](const crow::request &req)
                                                              {
        auto body = crow::json::load(req.body);
        if (!body) {
            return crow::response(400, "Invalid JSON payload");
        }

        std::string src = body["src"].s();
        std::string dest = body["dest"].s();

        // Parse nodes and edges from the stateless payload
        std::vector<routing::RawNode> nodes;
        if (body.has("nodes")) {
            for (const auto &nodeItem : body["nodes"]) {
                std::string id = std::string(nodeItem["id"].s());
                std::string type = nodeItem.has("type") ? std::string(nodeItem["type"].s()) : "router";
                bool broken = nodeItem.has("broken") ? nodeItem["broken"].b() : false;
                nodes.push_back({id, type, broken});
            }
        }

        std::vector<routing::RawEdge> edges;
        if (body.has("edges")) {
            for (const auto &edgeItem : body["edges"]) {
                std::string from = edgeItem["from"].s();
                std::string to = edgeItem["to"].s();
                int weight = edgeItem["weight"].i();
                bool broken = edgeItem.has("broken") ? edgeItem["broken"].b() : false;
                edges.push_back({from, to, weight, broken});
            }
        }

        // Compute shortest route using Dijkstra algorithm
        routing::RouteResult routeRes = routing::findShortestRoute(src, dest, nodes, edges);

        // Build response JSON (Dijkstra will plug in right here!)
        crow::json::wvalue result;
        result["reachable"] = routeRes.reachable;
        result["src"] = src;
        result["dest"] = dest;
        result["cost"] = routeRes.cost;
        
        std::vector<crow::json::wvalue> pathList;
        for (const auto &nodeId : routeRes.path) {
            pathList.push_back(nodeId);
        }
        result["path"] = crow::json::wvalue::list(pathList);

        return crow::response(result); });

    // 4. POST "/traverse" -> Receives network JSON + traversal type ("bfs"/"dfs") + start node, returns visited order & steps
    CROW_ROUTE(app, "/traverse").methods(crow::HTTPMethod::POST)([](const crow::request &req)
                                                                 {
        auto body = crow::json::load(req.body);
        if (!body) {
            return crow::response(400, "Invalid JSON payload");
        }

        std::string type = body.has("type") ? std::string(body["type"].s()) : "bfs";
        std::string start = body.has("start") ? std::string(body["start"].s()) : "";

        // Parse nodes and edges from the stateless payload
        std::vector<routing::RawNode> nodes;
        if (body.has("nodes")) {
            for (const auto &nodeItem : body["nodes"]) {
                std::string id = std::string(nodeItem["id"].s());
                std::string nodeType = nodeItem.has("type") ? std::string(nodeItem["type"].s()) : "router";
                bool broken = nodeItem.has("broken") ? nodeItem["broken"].b() : false;
                nodes.push_back({id, nodeType, broken});
            }
        }

        std::vector<routing::RawEdge> edges;
        if (body.has("edges")) {
            for (const auto &edgeItem : body["edges"]) {
                std::string from = edgeItem["from"].s();
                std::string to = edgeItem["to"].s();
                int weight = edgeItem["weight"].i();
                bool broken = edgeItem.has("broken") ? edgeItem["broken"].b() : false;
                edges.push_back({from, to, weight, broken});
            }
        }

        // Execute BFS or DFS traversal on Network graph
        routing::TraversalResult travRes = routing::findTraversal(type, start, nodes, edges);

        crow::json::wvalue result;
        result["type"] = travRes.type;
        result["start"] = travRes.start;

        std::vector<crow::json::wvalue> orderList;
        for (const auto &id : travRes.order) {
            orderList.push_back(id);
        }
        result["order"] = crow::json::wvalue::list(orderList);

        std::vector<crow::json::wvalue> stepsList;
        for (const auto &step : travRes.steps) {
            crow::json::wvalue s;
            s["from"] = step.from;
            s["to"] = step.to;
            stepsList.push_back(std::move(s));
        }
        result["steps"] = crow::json::wvalue::list(stepsList);

        return crow::response(result); });

    // =========================================================================
    // 5. PERSISTENT IN-MEMORY C++ SIMULATION & ACTIVITY LOGGING ENGINE ENDPOINTS
    // =========================================================================

    // POST "/api/sync" -> Authoritative state synchronization from client canvas to C++ engine
    CROW_ROUTE(app, "/api/sync").methods(crow::HTTPMethod::POST)([](const crow::request &req)
    {
        auto body = crow::json::load(req.body);
        if (!body) {
            return crow::response(400, "Invalid JSON payload");
        }

        auto &net = routing::getGlobalNetwork();
        net.resetAll();

        int nodeCount = 0;
        if (body.has("nodes")) {
            for (const auto &n : body["nodes"]) {
                std::string id = std::string(n["id"].s());
                std::string type = n.has("type") ? std::string(n["type"].s()) : "router";
                bool broken = n.has("broken") ? n["broken"].b() : false;
                routing::NodeType nt = (type == "client") ? routing::NodeType::CLIENT : routing::NodeType::ROUTER;
                net.addNode(id, nt, broken);
                nodeCount++;
            }
        }

        int edgeCount = 0;
        if (body.has("edges")) {
            for (const auto &e : body["edges"]) {
                std::string from = std::string(e["from"].s());
                std::string to = std::string(e["to"].s());
                int weight = e["weight"].i();
                bool broken = e.has("broken") ? e["broken"].b() : false;
                net.addLink(from, to, weight, broken);
                edgeCount++;
            }
        }

        crow::json::wvalue res;
        res["status"] = "ok";
        res["nodesSynchronized"] = nodeCount;
        res["edgesSynchronized"] = edgeCount;
        return crow::response(res);
    });

    // POST "/api/ping" -> Injects a ping packet into C++ Network simulation engine with per-router FIFO queueing
    CROW_ROUTE(app, "/api/ping").methods(crow::HTTPMethod::POST)([](const crow::request &req)
    {
        auto body = crow::json::load(req.body);
        if (!body || !body.has("src") || !body.has("dest")) {
            return crow::response(400, "Missing src or dest in request payload");
        }

        std::string src = body["src"].s();
        std::string dest = body["dest"].s();

        auto &net = routing::getGlobalNetwork();
        routing::Packet outPkt;
        std::vector<std::string> outPath;
        int outCost = 0;

        bool success = net.injectPing(src, dest, outPkt, outPath, outCost);

        crow::json::wvalue res;
        res["success"] = success;

        if (success) {
            res["pktId"] = outPkt.id;
            res["kind"] = outPkt.kind;
            res["cost"] = outCost;

            std::vector<crow::json::wvalue> pathList;
            for (const auto &hop : outPath) {
                pathList.push_back(hop);
            }
            res["path"] = crow::json::wvalue::list(pathList);

            // Log ping injection in C++ ActivityLogger and persistent activity_log.txt.
            // Uses PING_INJECT (not PING_TX) because the browser already logs the
            // PING_TX for this packet; logging it twice would double-count TX.
            net.getLogger().log("PING_INJECT", "Packet #" + std::to_string(outPkt.id) +
                                           " departing " + src + " towards " + dest + ".");
        } else {
            // Log drop event if destination unreachable or device broken
            net.getLogger().log("DROP", "Ping failed: No operational path from " + src + " to " + dest + ".");
            res["error"] = "Destination unreachable or device broken";
        }

        // Return authoritative metrics
        res["tx"] = net.getLogger().getTx();
        res["rx"] = net.getLogger().getRx();
        res["drop"] = net.getLogger().getDrop();

        return crow::response(res);
    });

    // POST "/api/sim/tick" -> Advances C++ simulation engine by one discrete hop tick
    CROW_ROUTE(app, "/api/sim/tick").methods(crow::HTTPMethod::POST)([](const crow::request &)
    {
        auto &net = routing::getGlobalNetwork();
        routing::SimulationTickResult tickRes = net.stepTick();

        crow::json::wvalue res;
        res["tick"] = tickRes.tick;
        res["tx"] = tickRes.tx;
        res["rx"] = tickRes.rx;
        res["drop"] = tickRes.drop;

        // Active packets snapshot
        std::vector<crow::json::wvalue> packetList;
        for (const auto &pkt : tickRes.packets) {
            crow::json::wvalue p;
            p["id"] = pkt.id;
            p["kind"] = pkt.kind;
            p["from"] = pkt.from;
            p["to"] = pkt.to;
            p["hop"] = static_cast<int>(pkt.hop);
            p["isDropped"] = pkt.isDropped;
            p["isDone"] = pkt.isDone;
            packetList.push_back(std::move(p));
        }
        res["packets"] = crow::json::wvalue::list(packetList);

        // Per-node queue buffer depths
        std::vector<crow::json::wvalue> qList;
        for (const auto &q : tickRes.queueSizes) {
            crow::json::wvalue item;
            item["node"] = q.first;
            item["count"] = q.second;
            qList.push_back(std::move(item));
        }
        res["queues"] = crow::json::wvalue::list(qList);

        // Newly generated log entries from this discrete step
        std::vector<crow::json::wvalue> logList;
        for (const auto &log : tickRes.newLogs) {
            crow::json::wvalue l;
            l["time"] = log.time;
            l["type"] = log.type;
            l["message"] = log.message;
            logList.push_back(std::move(l));
        }
        res["newLogs"] = crow::json::wvalue::list(logList);

        return crow::response(res);
    });

    // POST "/api/sim/clear" -> Clears active packets and flushes per-router queues
    CROW_ROUTE(app, "/api/sim/clear").methods(crow::HTTPMethod::POST)([](const crow::request &)
    {
        auto &net = routing::getGlobalNetwork();
        net.clearSimulation();
        crow::json::wvalue res;
        res["status"] = "ok";
        return crow::response(res);
    });

    // GET "/api/logs" -> Returns full audit log trail and TX/RX/DROP statistics
    CROW_ROUTE(app, "/api/logs").methods(crow::HTTPMethod::GET)([](const crow::request &)
    {
        auto &net = routing::getGlobalNetwork();
        const auto &logs = net.getLogger().getLogs();

        crow::json::wvalue res;
        res["tx"] = net.getLogger().getTx();
        res["rx"] = net.getLogger().getRx();
        res["drop"] = net.getLogger().getDrop();

        std::vector<crow::json::wvalue> logList;
        for (const auto &l : logs) {
            crow::json::wvalue item;
            item["time"] = l.time;
            item["type"] = l.type;
            item["message"] = l.message;
            logList.push_back(std::move(item));
        }
        res["logs"] = crow::json::wvalue::list(logList);

        return crow::response(res);
    });

    // POST "/api/logs/clear" -> Resets the ActivityLogger in memory
    CROW_ROUTE(app, "/api/logs/clear").methods(crow::HTTPMethod::POST)([](const crow::request &)
    {
        auto &net = routing::getGlobalNetwork();
        net.getLogger().clear();
        crow::json::wvalue res;
        res["status"] = "ok";
        res["tx"] = 0;
        res["rx"] = 0;
        res["drop"] = 0;
        return crow::response(res);
    });

    // POST "/api/log" -> Writes a custom topology event into C++ ActivityLogger and activity_log.txt
    CROW_ROUTE(app, "/api/log").methods(crow::HTTPMethod::POST)([](const crow::request &req)
    {
        auto body = crow::json::load(req.body);
        if (!body || !body.has("type") || !body.has("message")) {
            return crow::response(400, "Missing type or message in log payload");
        }

        std::string type = body["type"].s();
        std::string message = body["message"].s();

        auto &net = routing::getGlobalNetwork();
        net.getLogger().log(type, message);

        crow::json::wvalue res;
        res["status"] = "ok";
        res["tx"] = net.getLogger().getTx();
        res["rx"] = net.getLogger().getRx();
        res["drop"] = net.getLogger().getDrop();
        return crow::response(res);
    });

    // GET "/api/queues" -> Queries all active router packet queue depths
    CROW_ROUTE(app, "/api/queues").methods(crow::HTTPMethod::GET)([](const crow::request &)
    {
        auto &net = routing::getGlobalNetwork();
        std::map<std::string, int> queueCounts = net.getQueueCounts();

        crow::json::wvalue res;
        std::vector<crow::json::wvalue> list;
        for (const auto &pair : queueCounts) {
            crow::json::wvalue item;
            item["node"] = pair.first;
            item["count"] = pair.second;
            list.push_back(std::move(item));
        }
        res["queues"] = crow::json::wvalue::list(list);
        return crow::response(res);
    });

    // Start multi-threaded HTTP server on port 8000
    app.port(8000).multithreaded().run();
    return 0;
}
