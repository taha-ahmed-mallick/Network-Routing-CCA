#include "./include/crow_all.h"
#include "./include/algorithm.h++"
#include <fstream>
#include <sstream>
#include <string>

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
                nodes.push_back({id, type});
            }
        }

        std::vector<routing::RawEdge> edges;
        if (body.has("edges")) {
            for (const auto &edgeItem : body["edges"]) {
                std::string from = edgeItem["from"].s();
                std::string to = edgeItem["to"].s();
                int weight = edgeItem["weight"].i();
                edges.push_back({from, to, weight});
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
                nodes.push_back({id, nodeType});
            }
        }

        std::vector<routing::RawEdge> edges;
        if (body.has("edges")) {
            for (const auto &edgeItem : body["edges"]) {
                std::string from = edgeItem["from"].s();
                std::string to = edgeItem["to"].s();
                int weight = edgeItem["weight"].i();
                edges.push_back({from, to, weight});
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

    // Start multi-threaded HTTP server on port 8000
    app.port(8000).multithreaded().run();
    return 0;
}