#include "./include/crow_all.h"
#include <fstream>
#include <sstream>
#include <string>

// Helper to read static files (HTML, CSS, JS, SVG) from ./static/
std::string readFile(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file.is_open()) return "";
    std::ostringstream ss;
    ss << file.rdbuf();
    return ss.str();
}

int main() {
    crow::SimpleApp app;

    // 1. GET "/" -> Serve index.html
    CROW_ROUTE(app, "/")([]() {
        crow::response res(readFile("static/index.html"));
        res.set_header("Content-Type", "text/html");
        return res;
    });

    // 2. GET "/<path>" -> Serve style.css, script.js, and imgs/*.svg
    CROW_ROUTE(app, "/<path>")([](const std::string& path) {
        // Basic directory traversal guard
        if (path.find("..") != std::string::npos) {
            return crow::response(403);
        }

        std::string content = readFile("static/" + path);
        if (content.empty()) return crow::response(404);

        crow::response res(content);
        if (path.ends_with(".css"))       res.set_header("Content-Type", "text/css");
        else if (path.ends_with(".js"))   res.set_header("Content-Type", "application/javascript");
        else if (path.ends_with(".svg"))  res.set_header("Content-Type", "image/svg+xml");
        return res;
    });

    // 3. POST "/route" -> Receives stripped network JSON, returns shortest path JSON
    CROW_ROUTE(app, "/route").methods(crow::HTTPMethod::POST)([](const crow::request& req) {
        auto body = crow::json::load(req.body);
        if (!body) {
            return crow::response(400, "Invalid JSON payload");
        }

        std::string src = body["src"].s();
        std::string dest = body["dest"].s();

        // Build response JSON (Dijkstra will plug in right here!)
        crow::json::wvalue result;
        result["reachable"] = true;
        result["src"] = src;
        result["dest"] = dest;
        result["cost"] = 0;
        result["path"] = crow::json::wvalue::list({src, dest});

        return crow::response(result);
    });

    // Start multi-threaded HTTP server on port 8080
    app.port(8080).multithreaded().run();
    return 0;
}