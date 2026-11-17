const cvsArr = document.getElementsByTagName("canvas");
const cvs = cvsArr[1];
const cvsBg = cvsArr[0];
const ctx = cvs.getContext("2d");
const ctxBg = cvsBg.getContext("2d");
const leftPanel = document.getElementById("side-panel");
const sideBtns = document.querySelectorAll("div#side-panel>span");
const lockImgs = document.querySelectorAll("div#side-panel>span#lock-unlock>span");
let sideBarLocked = true;

// Lock-unlock button functionality
sideBtns[0].addEventListener("click", () => {
    sideBarLocked = !sideBarLocked;
    if (sideBarLocked) {
        leftPanel.classList.add("active");
        lockImgs[0].classList.remove("hide");
        lockImgs[1].classList.add("hide");
    } else {
        leftPanel.classList.remove("active");
        lockImgs[0].classList.add("hide");
        lockImgs[1].classList.remove("hide");
    }
});

const TOOLS = {
    MOUSE: 1,
    CLIENT: 2,
    ROUTER: 3,
    LINK: 4,
    DELETE: 5
};
let activeSideBtn = TOOLS.MOUSE;

// Main side panel buttons functionality
for (let i = 1; i < 6; i++) {
    sideBtns[i].addEventListener("click", () => {
        sideBtns[activeSideBtn].classList.remove("active");
        sideBtns[i].classList.add("active");
        activeSideBtn = i;
        interaction.linkStartNode = null;
    });
}

// Upload/save buttons functionality
const fileInput = document.getElementById("config-file-input");

// Upload button (sideBtns[6])
sideBtns[6].addEventListener("click", () => {
    if (network.isDirty && network.nodes.length > 0) {
        const proceed = confirm(
            "You have unsaved changes since your last download. Uploading will overwrite your current configuration. Continue?"
        );
        if (!proceed) return;
    }
    fileInput.value = ""; // Allows re-uploading the same file if modified
    fileInput.click();
});

fileInput.addEventListener("change", (eve) => {
    const file = eve.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const parsed = JSON.parse(event.target.result);
            network.importConfig(parsed);
        } catch (err) {
            alert("Failed to load config: " + err.message);
        }
    };
    reader.readAsText(file);
});

// Download / Save button (sideBtns[7])
sideBtns[7].addEventListener("click", () => {
    const jsonStr = JSON.stringify(network.exportConfig(), null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `network-topology-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url); // Free memory immediately
    network.isDirty = false; // Reset dirty flag after download
});

class Dimensions {
    constructor() {
        this.height = window.innerHeight;
        this.width = window.innerWidth;
        this.zoom = 1;
        this.x = this.width / 2;
        this.y = this.height / 2;
        this.resize();
    }

    resize() {
        this.height = window.innerHeight;
        this.width = window.innerWidth;
        cvsBg.width = cvs.width = this.width;
        cvsBg.height = cvs.height = this.height;
    }

    screenToWorld(screenX, screenY) {
        return {
            x: (screenX - this.x) / this.zoom,
            y: (screenY - this.y) / this.zoom
        };
    }

    worldToScreen(worldX, worldY) {
        return {
            x: worldX * this.zoom + this.x,
            y: worldY * this.zoom + this.y
        };
    }
}
let dimension = new Dimensions();

// ==========================================
// 1. NETWORK DOMAIN CLASSES
// ==========================================
class NetworkNode {
    constructor(id, type, x, y) {
        this.id = id;
        this.type = type; // "client" | "router"
        this.x = x;
        this.y = y;
        this.label = id;
        this.broken = false;
        this.edges = []; // References to connected Edge instances
        this.queue = []; // FIFO packet buffer waiting to depart from this node
    }
}

class Client extends NetworkNode {
    constructor(id, x, y) {
        super(id, "client", x, y);
        this.ip = `192.168.1.${id.slice(1)}`;
    }
}

class Router extends NetworkNode {
    constructor(id, x, y) {
        super(id, "router", x, y);
    }
}

class Edge {
    constructor(id, nodeA, nodeB, weight = 1) {
        this.id = id;
        this.nodeA = nodeA;
        this.nodeB = nodeB;
        this.weight = weight;
        this.broken = false;
    }

    connects(n1, n2) {
        return (
            (this.nodeA === n1 && this.nodeB === n2) ||
            (this.nodeA === n2 && this.nodeB === n1)
        );
    }
}

// Packet class to manage packet transit state, hop-by-hop animation, and failure handling
class Packet {
    constructor(pathNodeIds, options = {}) {
        this.path = pathNodeIds; // e.g. ["C1", "R1", "R2", "C2"]
        this.hopIndex = 0;       // Current starting node index in this.path
        this.progress = 0.0;     // Progress along current edge: [0.0 -> 1.0]
        this.speed = options.speed || 0.035; // Speed of movement per animation frame
        this.color = options.color || "#38bdf8"; // Default cyan packet glow
        this.isDone = false;
        this.isDropped = false;  // True when packet encountered a broken node or link
        this.dropFade = 1.0;     // Fade-out opacity when dropped
        this.payload = options.payload || "PING";
        this.onComplete = options.onComplete || null;
        this.onDrop = options.onDrop || null;

        // Discrete step-animation state: animates smoothly to target hop when stepped
        this.targetHopIndex = null;

        // Edge transmission lock state: true when packet has acquired the physical edge
        this.isTransmitting = false;
    }

    // Returns the edge object between the current hop's endpoints
    getCurrentEdge() {
        if (this.hopIndex >= this.path.length - 1) return null;
        const u = this.path[this.hopIndex];
        const v = this.path[this.hopIndex + 1];
        return network.edges.find(e => (e.nodeA.id === u && e.nodeB.id === v) || (e.nodeA.id === v && e.nodeB.id === u)) || null;
    }

    // Schedules a smooth travel animation forward to the next router/node
    stepHop() {
        if (this.isDone || this.path.length < 2) return;
        if (this.targetHopIndex === null) {
            this.targetHopIndex = this.hopIndex + 1;
        } else {
            this.targetHopIndex++;
        }
    }

    // Advances the packet along the path; returns true when packet has finished or vanished
    update(allowContinuous = true) {
        if (this.isDone) return true;

        // If the packet has been dropped, animate a quick fade-out
        if (this.isDropped) {
            this.dropFade -= 0.05;
            if (this.dropFade <= 0) {
                this.isDone = true;
                return true;
            }
            return false;
        }

        if (this.path.length < 2) {
            this.isDone = true;
            return true;
        }

        const fromNode = network.getNodeById(this.path[this.hopIndex]);
        const toNode = network.getNodeById(this.path[this.hopIndex + 1]);
        const edge = this.getCurrentEdge();

        // If the cable itself was cut/deleted or source node was destroyed, drop immediately
        if (!fromNode || !edge || edge.broken) {
            this.isDropped = true;
            this.color = "#ef4444";
            if (typeof this.onDrop === "function") {
                this.onDrop(this, fromNode ? fromNode.id : "link");
            }
            return false;
        }

        // Router Queue & Link Reservation: only one packet can transmit on an edge at a time
        if (!this.isTransmitting) {
            const edgeInUseByOther = packetManager.isEdgeTransmitting(edge, this);
            if (edgeInUseByOther) {
                // Another packet is currently occupying this link -> wait in current node's queue!
                if (!fromNode.queue.includes(this)) {
                    fromNode.queue.push(this);
                }
                return false;
            }
            // Link is free: remove from node's queue and start transmission
            fromNode.queue = fromNode.queue.filter(p => p !== this);
            this.isTransmitting = true;
        }

        // When paused and not in the middle of a step hop, don't move
        if (!allowContinuous && this.targetHopIndex === null) {
            return false;
        }

        const effectiveSpeed = this.speed * packetManager.speedMultiplier;
        this.progress += effectiveSpeed;

        // Once the packet completes traversal across the wire and reaches the destination node:
        if (this.progress >= 1.0) {
            this.progress = 0.0;
            this.hopIndex++;
            this.isTransmitting = false; // Release the edge so queued packets can use it

            const arrivedNode = network.getNodeById(this.path[this.hopIndex]);

            // If the node the packet just arrived at is broken or non-existent, drop it right here!
            if (!arrivedNode || arrivedNode.broken) {
                this.isDropped = true;
                this.color = "#ef4444";
                if (typeof this.onDrop === "function") {
                    this.onDrop(this, arrivedNode ? arrivedNode.id : "unknown");
                }
                return false;
            }

            // If we reached our stepped destination hop, pause movement until next step or play
            if (this.targetHopIndex !== null && this.hopIndex >= this.targetHopIndex) {
                this.targetHopIndex = null;
            }

            if (this.hopIndex >= this.path.length - 1) {
                this.isDone = true;
                if (typeof this.onComplete === "function") {
                    this.onComplete(this);
                }
                return true;
            }
        }
        return false;
    }

    // Calculates the current world coordinates of the packet
    getCurrentPosition() {
        if (this.path.length < 2) return null;
        const fromNode = network.getNodeById(this.path[this.hopIndex]);
        const toNode = network.getNodeById(this.path[this.hopIndex + 1]);
        if (!fromNode || !toNode) return null;

        const x = fromNode.x + (toNode.x - fromNode.x) * this.progress;
        const y = fromNode.y + (toNode.y - fromNode.y) * this.progress;
        return { x, y };
    }

    // Draws the packet on the canvas (including outer glow and inner core)
    draw(context) {
        const pos = this.getCurrentPosition();
        if (!pos) return;

        context.save();
        if (this.isDropped) {
            context.globalAlpha = Math.max(0, this.dropFade);
        }

        // Outer pulsing glow
        context.shadowColor = this.color;
        context.shadowBlur = this.isDropped ? 18 : 12;
        context.beginPath();
        context.arc(pos.x, pos.y, this.isDropped ? 8 : 7, 0, Math.PI * 2);
        context.fillStyle = this.color;
        context.fill();

        // Bright inner core
        context.shadowBlur = 0;
        context.beginPath();
        context.arc(pos.x, pos.y, 3.5, 0, Math.PI * 2);
        context.fillStyle = this.isDropped ? "#fee2e2" : "#ffffff";
        context.fill();

        context.restore();
    }
}

// Active packet manager holding packets in transit and per-packet route highlights
const packetManager = {
    packets: [],
    isPaused: false, // Global simulation pause state
    stepRequested: false, // True when user triggers a single tick step
    speedMultiplier: 1.0, // Global simulation speed factor

    add(packet) {
        this.packets.push(packet);
    },

    setSpeed(multiplier) {
        this.speedMultiplier = Math.max(0.1, multiplier);
    },

    // Checks whether another packet is currently actively transmitting across this edge
    isEdgeTransmitting(edge, currentPacket) {
        if (!edge) return false;
        return this.packets.some(p => p !== currentPacket && p.isTransmitting && !p.isDone && !p.isDropped && p.getCurrentEdge() === edge);
    },

    // Checks whether an edge connects consecutive nodes in ANY active packet's route
    isEdgeInHighlightedPath(nodeAId, nodeBId) {
        for (const p of this.packets) {
            if (p.isDropped) continue; // Don't highlight for dropped packets
            for (let i = 0; i < p.path.length - 1; i++) {
                const u = p.path[i];
                const v = p.path[i + 1];
                if ((u === nodeAId && v === nodeBId) || (u === nodeBId && v === nodeAId)) {
                    return true;
                }
            }
        }
        return false;
    },

    togglePause() {
        this.isPaused = !this.isPaused;
        const playIcon = document.getElementById("icon-play");
        const pauseIcon = document.getElementById("icon-pause");
        if (playIcon && pauseIcon) {
            if (this.isPaused) {
                playIcon.classList.remove("hide");
                pauseIcon.classList.add("hide");
            } else {
                playIcon.classList.add("hide");
                pauseIcon.classList.remove("hide");
            }
        }
        return this.isPaused;
    },

    step() {
        // If simulation was running, pause it so user is in step mode
        if (!this.isPaused) {
            this.togglePause();
        }

        // Trigger each packet to animate travel to its next hop
        for (const p of this.packets) {
            p.stepHop();
        }
    },

    updateAndDraw(context) {
        for (let i = this.packets.length - 1; i >= 0; i--) {
            const p = this.packets[i];
            p.draw(context);

            // If not paused, allow continuous flow. If paused, only advance if stepping to next hop.
            if (p.update(!this.isPaused)) {
                this.packets.splice(i, 1);
            }
        }
    }
};

// Graph Traversal Manager (handles BFS & DFS visual step animation)
const traversalManager = {
    isRunning: false,
    type: "BFS",
    startNodeId: null,
    order: [],
    steps: [],
    stepIndex: 0,
    progress: 0.0,
    visitedNodes: new Set(),
    visitedEdges: new Set(),
    nodeOrderMap: new Map(),
    finishCooldown: 0,

    start(type, startId, order, steps) {
        // Guarantee clean exclusive state: cancel any in-flight packets and clear queues
        packetManager.packets = [];
        for (const n of network.nodes) {
            n.queue = [];
        }

        this.isRunning = true;
        this.type = type.toUpperCase();
        this.startNodeId = startId;
        this.order = order || [];
        this.steps = steps || [];
        this.stepIndex = 0;
        this.progress = 0.0;
        this.visitedNodes = new Set();
        this.visitedEdges = new Set();
        this.nodeOrderMap = new Map();
        this.finishCooldown = 0;

        // Build 1-based order map: nodeId -> order number
        for (let i = 0; i < this.order.length; i++) {
            this.nodeOrderMap.set(this.order[i], i + 1);
        }

        // If step 0 has no source parent, immediately mark start root as visited
        if (this.steps.length > 0 && (!this.steps[0].from || this.steps[0].from === "")) {
            this.visitedNodes.add(this.steps[0].to);
            this.stepIndex = 1;
        } else if (startId) {
            this.visitedNodes.add(startId);
        }

        this.updateButtonsUI();
    },

    stop() {
        this.isRunning = false;
        this.visitedNodes.clear();
        this.visitedEdges.clear();
        this.nodeOrderMap.clear();
        this.finishCooldown = 0;
        this.updateButtonsUI();
    },

    updateButtonsUI() {
        const bfsBtn = document.getElementById("btn-bfs");
        const dfsBtn = document.getElementById("btn-dfs");
        if (bfsBtn && dfsBtn) {
            if (this.isRunning) {
                if (this.type === "BFS") {
                    bfsBtn.classList.add("active");
                    dfsBtn.classList.remove("active");
                } else {
                    dfsBtn.classList.add("active");
                    bfsBtn.classList.remove("active");
                }
            } else {
                bfsBtn.classList.remove("active");
                dfsBtn.classList.remove("active");
            }
        }
    },

    isEdgeHighlighted(edge) {
        if (!this.isRunning && this.visitedEdges.size === 0) return false;
        if (this.visitedEdges.has(edge)) return true;

        // Also highlight current step edge in progress
        if (this.isRunning && this.stepIndex < this.steps.length) {
            const step = this.steps[this.stepIndex];
            if (step && step.from && step.to) {
                if ((edge.nodeA.id === step.from && edge.nodeB.id === step.to) ||
                    (edge.nodeA.id === step.to && edge.nodeB.id === step.from)) {
                    return true;
                }
            }
        }
        return false;
    },

    isNodeVisited(nodeId) {
        return this.visitedNodes.has(nodeId);
    },

    getNodeOrderNumber(nodeId) {
        return this.nodeOrderMap.get(nodeId) || null;
    },

    step() {
        if (!this.isRunning) return;

        // If currently in cooldown after finishing, finish immediately
        if (this.stepIndex >= this.steps.length) {
            this.stop();
            return;
        }

        // Advance current step immediately to completion
        const step = this.steps[this.stepIndex];
        if (step) {
            this.visitedNodes.add(step.to);
            const edge = network.edges.find(e =>
                (e.nodeA.id === step.from && e.nodeB.id === step.to) ||
                (e.nodeA.id === step.to && e.nodeB.id === step.from)
            );
            if (edge) this.visitedEdges.add(edge);
        }

        this.stepIndex++;
        this.progress = 0.0;
    },

    update() {
        if (!this.isRunning) return;

        // All traversal steps completed -> stay lit for 1.5 seconds then resume
        if (this.stepIndex >= this.steps.length) {
            if (this.finishCooldown === 0) {
                this.finishCooldown = Date.now();
                activityLogger.log("TRAVERSAL", `${this.type} traversal complete. Order: ${this.order.join(" -> ")}`);
            } else if (Date.now() - this.finishCooldown > 1500) {
                this.stop();
            }
            return;
        }

        // When paused, wait for Step button or Resume
        if (packetManager.isPaused) return;

        const effectiveSpeed = 0.035 * packetManager.speedMultiplier;
        this.progress += effectiveSpeed;

        if (this.progress >= 1.0) {
            this.progress = 0.0;
            const step = this.steps[this.stepIndex];
            if (step) {
                this.visitedNodes.add(step.to);
                const edge = network.edges.find(e =>
                    (e.nodeA.id === step.from && e.nodeB.id === step.to) ||
                    (e.nodeA.id === step.to && e.nodeB.id === step.from)
                );
                if (edge) this.visitedEdges.add(edge);
            }
            this.stepIndex++;
        }
    },

    draw(context) {
        if (!this.isRunning) return;

        // Draw animated traveling golden energy pulse across current step's edge
        if (this.stepIndex < this.steps.length) {
            const step = this.steps[this.stepIndex];
            if (step && step.from && step.to) {
                const fromNode = network.getNodeById(step.from);
                const toNode = network.getNodeById(step.to);
                if (fromNode && toNode) {
                    const px = fromNode.x + (toNode.x - fromNode.x) * this.progress;
                    const py = fromNode.y + (toNode.y - fromNode.y) * this.progress;

                    context.save();
                    context.shadowColor = "#facc15";
                    context.shadowBlur = 18;
                    context.beginPath();
                    context.arc(px, py, 9, 0, Math.PI * 2);
                    context.fillStyle = "#eab308";
                    context.fill();

                    context.shadowBlur = 0;
                    context.beginPath();
                    context.arc(px, py, 4.5, 0, Math.PI * 2);
                    context.fillStyle = "#ffffff";
                    context.fill();
                    context.restore();
                }
            }
        }
    }
};

// ==========================================
// 2. CENTRALIZED NETWORK & INTERACTION STATE
// ==========================================
const CONFIG = {
    NODE_SIZE: 50,
    HALF_NODE: 25,
    EDGE_HIT_THRESHOLD: 8
};

const network = {
    nodes: [],
    edges: [],
    counters: { client: 1, router: 1, edge: 1 },
    spare: { client: [], router: [], edge: [] },
    isDirty: false, // Tracks if the network has unsaved changes

    markDirty() {
        this.isDirty = true;
    },

    addClient(x, y) {
        let id = this.counters.client;
        if (this.spare.client.length) {
            id = this.spare.client.pop();
        } else { this.counters.client++; }
        const node = new Client(`C${id}`, x, y);
        this.nodes.push(node);
        this.markDirty();
        activityLogger.log("NODE_ADD", `Client ${node.label} (${node.ip}) deployed.`);
        if (typeof updateTraversalDropdown === "function") updateTraversalDropdown();
        return node;
    },

    addRouter(x, y) {
        let id = this.counters.router;
        if (this.spare.router.length) {
            id = this.spare.router.pop();
        } else { this.counters.router++; }
        const node = new Router(`R${id}`, x, y);
        this.nodes.push(node);
        this.markDirty();
        activityLogger.log("NODE_ADD", `Router ${node.label} deployed.`);
        if (typeof updateTraversalDropdown === "function") updateTraversalDropdown();
        return node;
    },

    addEdge(nodeA, nodeB, weight = 1) {
        if (!nodeA || !nodeB || nodeA === nodeB) return null;
        // Prevent duplicate edges between the same pair
        if (this.edges.some(e => e.connects(nodeA, nodeB))) return null;

        let id = this.counters.edge;
        if (this.spare.edge.length) {
            id = this.spare.edge.pop();
        } else { this.counters.edge++; }

        const edge = new Edge(`E${id}`, nodeA, nodeB, weight);
        nodeA.edges.push(edge);
        nodeB.edges.push(edge);
        this.edges.push(edge);
        this.markDirty();
        activityLogger.log("LINK_ADD", `Link ${edge.id} connected between ${nodeA.label} and ${nodeB.label} (cost: ${weight}).`);
        return edge;
    },

    removeEdge(edge) {
        if (!edge || !this.edges.includes(edge)) return;
        this.spare.edge.push(parseInt(edge.id.slice(1)));
        edge.nodeA.edges = edge.nodeA.edges.filter(e => e !== edge);
        edge.nodeB.edges = edge.nodeB.edges.filter(e => e !== edge);
        this.edges = this.edges.filter(e => e !== edge);
        this.markDirty();
        activityLogger.log("LINK_DEL", `Link ${edge.id} (${edge.nodeA.label} <-> ${edge.nodeB.label}) removed.`);
    },

    removeNode(node) {
        if (node.type === "client") {
            this.spare.client.push(parseInt(node.id.slice(1)));
        } else if (node.type === "router") {
            this.spare.router.push(parseInt(node.id.slice(1)));
        }
        // Remove all incident edges first
        [...node.edges].forEach(edge => this.removeEdge(edge));
        this.nodes = this.nodes.filter(n => n !== node);
        this.markDirty();
        activityLogger.log("NODE_DEL", `${node.type === "client" ? "Client" : "Router"} ${node.label} removed.`);
        if (typeof updateTraversalDropdown === "function") updateTraversalDropdown();
    },

    // Generates the stripped-down JSON payload for the C++ Crow backend
    toRoutingPayload(srcId, destId) {
        const validNodes = this.nodes.filter(n => {
            if (n.broken) return false;
            // Strip out all clients except the query's source and destination
            if (n.type === "client" && n.id !== srcId && n.id !== destId) {
                return false;
            }
            return true;
        });

        const validIds = new Set(validNodes.map(n => n.id));

        const validEdges = this.edges
            .filter(e => !e.broken && validIds.has(e.nodeA.id) && validIds.has(e.nodeB.id))
            .map(e => ({
                from: e.nodeA.id,
                to: e.nodeB.id,
                weight: e.weight
            }));

        return {
            src: srcId,
            dest: destId,
            nodes: validNodes.map(n => ({ id: n.id, type: n.type })),
            edges: validEdges
        };
    },

    // Helper to fetch a node object by its ID
    getNodeById(id) {
        return this.nodes.find(n => n.id === id) || null;
    },

    // Queries the C++ Crow backend for the shortest route using Dijkstra
    async findShortestRoute(srcId, destId) {
        const payload = this.toRoutingPayload(srcId, destId);
        try {
            const response = await fetch("/route", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data;
        } catch (err) {
            console.error("Routing request failed:", err);
            return { reachable: false, cost: -1, path: [], error: err.message };
        }
    },

    // Generates the graph topology payload for BFS/DFS traversal
    toTraversalPayload(startId, type) {
        const validNodes = this.nodes.filter(n => !n.broken);
        const validIds = new Set(validNodes.map(n => n.id));

        const validEdges = this.edges
            .filter(e => !e.broken && validIds.has(e.nodeA.id) && validIds.has(e.nodeB.id))
            .map(e => ({
                from: e.nodeA.id,
                to: e.nodeB.id,
                weight: e.weight
            }));

        return {
            type: type, // "bfs" or "dfs"
            start: startId,
            nodes: validNodes.map(n => ({ id: n.id, type: n.type })),
            edges: validEdges
        };
    },

    // Queries the C++ Crow backend for BFS or DFS traversal
    async findTraversal(startId, type) {
        const payload = this.toTraversalPayload(startId, type);
        try {
            const response = await fetch("/traverse", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data;
        } catch (err) {
            console.error("Traversal request failed:", err);
            return { type, start: startId, order: [], steps: [], error: err.message };
        }
    },

    // ==========================================
    // Import/Export Network Configuration for JSON Save/Load
    // ==========================================
    exportConfig() {
        return {
            version: 1,
            camera: {
                x: dimension.x,
                y: dimension.y,
                zoom: dimension.zoom
            },
            nodes: this.nodes.map(n => ({
                id: n.id,
                type: n.type,
                x: n.x,
                y: n.y,
                label: n.label,
                broken: n.broken
            })),
            edges: this.edges.map(e => ({
                id: e.id,
                from: e.nodeA.id,
                to: e.nodeB.id,
                weight: e.weight,
                broken: e.broken
            })),
            activityLog: activityLogger.exportData()
        };
    },

    importConfig(data) {
        if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
            throw new Error("Invalid network configuration format.");
        }

        // 1. Reset current state & close any open inspector
        inspector.close();
        interaction.linkStartNode = null;
        interaction.draggedNode = null;
        this.nodes = [];
        this.edges = [];
        this.counters = { client: 1, router: 1, edge: 1 };
        this.spare = { client: [], router: [], edge: [] };

        // Restore activity logs if present in JSON
        if (data.activityLog) {
            activityLogger.importData(data.activityLog);
        } else {
            activityLogger.clear();
        }

        // 2. Restore camera if present
        if (data.camera && typeof data.camera.x === "number") {
            dimension.x = data.camera.x;
            dimension.y = data.camera.y;
            dimension.zoom = Math.min(Math.max(data.camera.zoom || 1, 0.3), 3);
            dots();
        }

        // Track used numeric IDs to rebuild counters & spare stacks cleanly
        const usedIds = { client: new Set(), router: new Set(), edge: new Set() };
        const nodeMap = new Map(); // O(1) lookup: id -> Client/Router instance

        // 3. Reconstruct Nodes
        for (const rawNode of data.nodes) {
            if (!rawNode.id || (rawNode.type !== "client" && rawNode.type !== "router")) continue;
            const numId = parseInt(rawNode.id.slice(1), 10);
            if (isNaN(numId) || numId < 1) continue;

            const node = rawNode.type === "client"
                ? new Client(rawNode.id, Number(rawNode.x) || 0, Number(rawNode.y) || 0)
                : new Router(rawNode.id, Number(rawNode.x) || 0, Number(rawNode.y) || 0);

            node.label = typeof rawNode.label === "string" && rawNode.label.trim()
                ? rawNode.label.trim()
                : node.id;
            node.broken = Boolean(rawNode.broken);

            this.nodes.push(node);
            nodeMap.set(node.id, node);
            usedIds[rawNode.type].add(numId);
        }

        // 4. Reconstruct Edges using O(1) Map lookup
        for (const rawEdge of data.edges) {
            const nodeA = nodeMap.get(rawEdge.from);
            const nodeB = nodeMap.get(rawEdge.to);
            if (!nodeA || !nodeB || nodeA === nodeB) continue;
            if (this.edges.some(e => e.connects(nodeA, nodeB))) continue;

            const numId = rawEdge.id ? parseInt(rawEdge.id.slice(1), 10) : NaN;
            const edgeId = !isNaN(numId) && numId >= 1 ? rawEdge.id : `E${this.counters.edge++}`;
            const weight = Math.min(Math.max(parseInt(rawEdge.weight, 10) || 1, 1), 100);

            const edge = new Edge(edgeId, nodeA, nodeB, weight);
            edge.broken = Boolean(rawEdge.broken);

            nodeA.edges.push(edge);
            nodeB.edges.push(edge);
            this.edges.push(edge);

            if (!isNaN(numId) && numId >= 1) usedIds.edge.add(numId);
        }

        // 5. Rebuild monotonic counters & spare free-list stacks for each entity type
        for (const key of ["client", "router", "edge"]) {
            const used = usedIds[key];
            const maxId = used.size > 0 ? Math.max(...used) : 0;
            this.counters[key] = maxId + 1;
            for (let i = 1; i <= maxId; i++) {
                if (!used.has(i)) this.spare[key].push(i);
            }
        }

        this.isDirty = false; // Reset dirty flag after successful import
        if (typeof updateTraversalDropdown === "function") updateTraversalDropdown();
    }
};

const interaction = {
    isPanning: false,
    draggedNode: null,
    dragOffset: { x: 0, y: 0 },
    selectedNode: null,
    selectedEdge: null,
    hoveredNode: null,
    hoveredEdge: null,
    linkStartNode: null,
    mouseWorld: { x: 0, y: 0 }
};

// ==========================================
// 3. THREE-PANEL INSPECTOR CONTROLLER
// ==========================================
const inspector = {
    panels: {
        client: document.getElementById("client-inspect"),
        router: document.getElementById("router-inspect"),
        edge: document.getElementById("edge-inspect")
    },
    activeType: null, // "client" | "router" | "edge" | null

    init() {
        // Attach close button listeners once on the static header images
        Object.values(this.panels).forEach(panel => {
            const closeBtn = panel.querySelector("div.panel-header > img");
            closeBtn.addEventListener("click", () => this.close());
        });
    },

    switchPanel(targetType) {
        if (this.activeType && this.activeType !== targetType) {
            this.panels[this.activeType].classList.remove("active");
        }
        this.panels[targetType].classList.add("active");
        this.activeType = targetType;
    },

    close() {
        if (this.activeType) {
            this.panels[this.activeType].classList.remove("active");
            this.activeType = null;
        }
        interaction.selectedNode = null;
        interaction.selectedEdge = null;
    },

    refresh() {
        if (interaction.selectedNode) {
            this.openNode(interaction.selectedNode);
        } else if (interaction.selectedEdge) {
            this.openEdge(interaction.selectedEdge);
        }
    },

    buildConnectionsListHTML(node) {
        if (node.edges.length === 0) {
            return `<span style="color:#64748b;font-size:13px;">No active links</span>`;
        }
        const items = node.edges.map(edge => {
            const neighbor = edge.nodeA === node ? edge.nodeB : edge.nodeA;
            const isBroken = edge.broken || neighbor.broken;
            return `
                <li class="${isBroken ? "broken-link" : ""}">
                    <span>${neighbor.label} (${neighbor.id})</span>
                    <span>Cost: ${edge.weight}</span>
                </li>
            `;
        }).join("");
        return `<ul class="conn-list">${items}</ul>`;
    },

    bindLabelInput(inputEl, node) {
        const isClient = node.type === "client";
        const panel = isClient ? this.panels.client : this.panels.router;
        const headerIdSpan = panel.querySelector("div.panel-header h4 span");
        inputEl.value = node.label;
        inputEl.addEventListener("input", () => {
            node.label = inputEl.value.trim() || node.id;
            headerIdSpan.textContent = node.label === node.id ? node.id : `${node.id} (${node.label})`;
            if (typeof updateTraversalDropdown === "function") updateTraversalDropdown();
        });
        inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                inputEl.blur();
            }
        });
    },

    openNode(node) {
        const isClient = node.type === "client";
        const panel = isClient ? this.panels.client : this.panels.router;
        const headerIdSpan = panel.querySelector("div.panel-header h4 span");
        const body = panel.querySelector("div.panel-body");

        headerIdSpan.textContent = node.label === node.id ? node.id : `${node.id} (${node.label})`;
        this.switchPanel(node.type);

        // Other non-broken clients available as ping destinations
        const otherClients = isClient
            ? network.nodes.filter(n => n.type === "client" && n !== node && !n.broken)
            : [];

        body.innerHTML = `
            <div class="inspect-row">
                <span class="field-name">ID</span>
                <span class="field-val">${node.id}</span>
            </div>
            ${isClient ? `
            <div class="inspect-row">
                <span class="field-name">IP Address</span>
                <span class="field-val">${node.ip}</span>
            </div>` : ""}
            <div class="inspect-group">
                <label for="inspect-label-input">Label <span style="font-size:11px;">(Enter to apply)</span></label>
                <input type="text" id="inspect-label-input" maxlength="16" />
            </div>
            <div class="inspect-group">
                <label>Connections (${node.edges.length})</label>
                ${this.buildConnectionsListHTML(node)}
            </div>
            ${isClient ? `
            <div class="inspect-group">
                <label for="ping-target-select">Ping Destination</label>
                <select id="ping-target-select" ${node.broken || otherClients.length === 0 ? "disabled" : ""}>
                    ${otherClients.length
                    ? otherClients.map(c => `<option value="${c.id}">${c.label} (${c.ip})</option>`).join("")
                    : `<option value="">No active clients available</option>`}
                </select>
                <button id="send-ping-btn" class="panel-btn primary" ${node.broken || otherClients.length === 0 ? "disabled" : ""}>
                    Send Ping
                </button>
            </div>` : ""}
            <div class="inspect-group" style="margin-top:auto;">
                <div class="status-row">
                    <span class="status-badge ${node.broken ? "offline" : "online"}">
                        ${node.broken ? "OFFLINE" : "ONLINE"}
                    </span>
                    <button id="toggle-node-broken" class="panel-btn ${node.broken ? "success" : "danger"}">
                        ${node.broken ? "Enable Device" : "Disable Device"}
                    </button>
                </div>
            </div>
        `;

        this.bindLabelInput(body.querySelector("#inspect-label-input"), node);

        body.querySelector("#toggle-node-broken").addEventListener("click", () => {
            node.broken = !node.broken;
            this.openNode(node);
            activityLogger.log("NODE_STATE", `${node.type === "client" ? "Client" : "Router"} ${node.label} ${node.broken ? "DISABLED" : "ENABLED"}.`);
            if (typeof updateTraversalDropdown === "function") updateTraversalDropdown();
        });

        if (isClient) {
            const pingBtn = body.querySelector("#send-ping-btn");
            pingBtn.addEventListener("click", async () => {
                if (traversalManager.isRunning) {
                    alert("Graph traversal animation is currently running. Please wait for it to complete.");
                    return;
                }
                const targetId = body.querySelector("#ping-target-select").value;
                if (!targetId) return;

                const targetNode = network.getNodeById(targetId);
                const targetLabel = targetNode ? targetNode.label : targetId;

                pingBtn.disabled = true;
                const originalText = pingBtn.textContent;
                pingBtn.textContent = "Routing...";

                activityLogger.log("PING_REQ", `Ping dispatched: ${node.label} -> ${targetLabel}...`);
                const result = await network.findShortestRoute(node.id, targetId);
                console.log("Shortest route result:", result);

                if (result && result.reachable && result.path && result.path.length >= 2) {
                    pingBtn.textContent = `Sent (Cost: ${result.cost})`;
                    const pathStr = result.path.map(id => {
                        const n = network.getNodeById(id);
                        return n ? n.label : id;
                    }).join(" -> ");

                    activityLogger.log("ROUTE_FOUND", `Shortest route: ${pathStr} (Cost: ${result.cost}).`);
                    activityLogger.log("PING_TX", `Packet departing ${node.label} towards ${targetLabel}.`);

                    // Instantiate and launch the forward ping packet animation
                    const pingPacket = new Packet(result.path, {
                        payload: "PING",
                        color: "#38bdf8", // Cyan
                        onDrop: (p, atNodeId) => {
                            console.warn(`Packet dropped at ${atNodeId} due to link/node failure.`);
                            const atNode = network.getNodeById(atNodeId);
                            const atLabel = atNode ? atNode.label : atNodeId;
                            activityLogger.log("DROP", `Ping packet dropped at ${atLabel} (link/device offline).`);
                            pingBtn.textContent = "Packet Dropped!";
                            setTimeout(() => {
                                pingBtn.disabled = false;
                                pingBtn.textContent = originalText;
                            }, 1800);
                        },
                        onComplete: () => {
                            activityLogger.log("PING_RX", `Ping delivered at ${targetLabel}. Generating ACK packet...`);
                            activityLogger.log("PING_TX", `ACK reply departing ${targetLabel} towards ${node.label}.`);
                            // Automatically send a return PONG/ACK packet along reversed path
                            const returnPath = [...result.path].reverse();
                            const pongPacket = new Packet(returnPath, {
                                payload: "ACK",
                                color: "#22c55e", // Green
                                onDrop: (p, atNodeId) => {
                                    console.warn(`ACK packet dropped at ${atNodeId}.`);
                                    const atNode = network.getNodeById(atNodeId);
                                    const atLabel = atNode ? atNode.label : atNodeId;
                                    activityLogger.log("DROP", `ACK reply dropped at ${atLabel}.`);
                                    pingBtn.textContent = "ACK Dropped!";
                                    setTimeout(() => {
                                        pingBtn.disabled = false;
                                        pingBtn.textContent = originalText;
                                    }, 1800);
                                },
                                onComplete: () => {
                                    activityLogger.log("PING_RX", `ACK received at ${node.label}. Round-trip successful!`);
                                    pingBtn.disabled = false;
                                    pingBtn.textContent = originalText;
                                }
                            });
                            packetManager.add(pongPacket);
                        }
                    });
                    packetManager.add(pingPacket);
                } else {
                    activityLogger.log("ROUTE_FAIL", `Destination ${targetLabel} unreachable from ${node.label}.`);
                    pingBtn.textContent = "Unreachable";
                    setTimeout(() => {
                        pingBtn.disabled = false;
                        pingBtn.textContent = originalText;
                    }, 1500);
                }
            });
        }
    },

    openEdge(edge) {
        const panel = this.panels.edge;
        const headerIdSpan = panel.querySelector("div.panel-header h4 span");
        const body = panel.querySelector("div.panel-body");

        headerIdSpan.textContent = edge.id;
        this.switchPanel("edge");

        body.innerHTML = `
            <div class="inspect-row">
                <span class="field-name">ID</span>
                <span class="field-val">${edge.id}</span>
            </div>
            <div class="inspect-row">
                <span class="field-name">Endpoints</span>
                <span class="field-val">${edge.nodeA.label} &harr; ${edge.nodeB.label}</span>
            </div>
            <div class="inspect-group">
                <label for="edge-weight-slider">
                    <span>Link Weight (Cost)</span>
                    <span id="edge-weight-readout" style="color:#38bdf8;font-weight:700;font-size:15px;">${edge.weight}</span>
                </label>
                <input type="range" id="edge-weight-slider" min="1" max="100" value="${edge.weight}" />
            </div>
            <div class="inspect-group" style="margin-top:auto;">
                <div class="status-row">
                    <span class="status-badge ${edge.broken ? "offline" : "online"}">
                        ${edge.broken ? "DISABLED" : "ACTIVE"}
                    </span>
                    <button id="toggle-edge-broken" class="panel-btn ${edge.broken ? "success" : "danger"}">
                        ${edge.broken ? "Enable Link" : "Disable Link"}
                    </button>
                </div>
            </div>
        `;

        const slider = body.querySelector("#edge-weight-slider");
        const readout = body.querySelector("#edge-weight-readout");
        slider.addEventListener("change", () => {
            const oldWeight = edge.weight;
            edge.weight = parseInt(slider.value, 10);
            readout.textContent = edge.weight;
            network.markDirty();
            activityLogger.log("LINK_WEIGHT", `Link ${edge.id} weight updated from ${oldWeight} to ${edge.weight}.`);
        });
        slider.addEventListener("input", () => {
            edge.weight = parseInt(slider.value, 10);
            readout.textContent = edge.weight;
        });

        body.querySelector("#toggle-edge-broken").addEventListener("click", () => {
            edge.broken = !edge.broken;
            this.openEdge(edge);
            activityLogger.log("LINK_STATE", `Link ${edge.id} (${edge.nodeA.label} <-> ${edge.nodeB.label}) ${edge.broken ? "DISABLED" : "ENABLED"}.`);
        });
    }
};
inspector.init();

// ==========================================
// 4. GEOMETRY HIT-TESTING HELPERS
// ==========================================
function getNodeAt(wx, wy) {
    let discrepancy = 0;
    for (let i = network.nodes.length - 1; i >= 0; i--) {
        const n = network.nodes[i];
        if (n.type === "router") { discrepancy = 10; }
        else { discrepancy = 0; }
        if (
            wx >= n.x - CONFIG.HALF_NODE &&
            wx <= n.x + CONFIG.HALF_NODE &&
            wy >= n.y - CONFIG.HALF_NODE - discrepancy &&
            wy <= n.y + CONFIG.HALF_NODE - discrepancy
        ) {
            return n;
        }
    }
    return null;
}

// Shortest distance from point (px, py) to segment (x1, y1)-(x2, y2)
function pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);

    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
}

function getEdgeAt(wx, wy) {
    const threshold = CONFIG.EDGE_HIT_THRESHOLD / dimension.zoom;
    for (let i = network.edges.length - 1; i >= 0; i--) {
        const e = network.edges[i];
        const d = pointToSegmentDist(wx, wy, e.nodeA.x, e.nodeA.y, e.nodeB.x, e.nodeB.y);
        if (d <= threshold) return e;
    }
    return null;
}

// ==========================================
// 5. ASSETS & RENDERING LOOP
// ==========================================
let imgs = {
    client: new Image(),
    router: new Image(),
    server: new Image(),
    broken: new Image()
};
imgs.client.src = "./imgs/client.svg";
imgs.router.src = "./imgs/router.svg";
imgs.server.src = "./imgs/server.svg";
imgs.broken.src = "./imgs/broken.svg";

let prevTime = null;

function dots() {
    ctxBg.setTransform(1, 0, 0, 1, 0, 0);
    ctxBg.clearRect(0, 0, dimension.width, dimension.height);

    ctxBg.translate(dimension.x, dimension.y);
    ctxBg.scale(dimension.zoom, dimension.zoom);

    const left = -dimension.x / dimension.zoom;
    const top = -dimension.y / dimension.zoom;
    const right = (dimension.width - dimension.x) / dimension.zoom;
    const bottom = (dimension.height - dimension.y) / dimension.zoom;

    const startX = Math.floor(left / 50) * 50;
    const startY = Math.floor(top / 50) * 50;

    ctxBg.fillStyle = "#1f2a3d";
    let size = 3;
    if (dimension.zoom > 1) size /= dimension.zoom;

    for (let i = startX; i < right; i += 50) {
        for (let j = startY; j < bottom; j += 50) {
            ctxBg.beginPath();
            ctxBg.arc(i, j, size, 0, Math.PI * 2);
            ctxBg.fill();
        }
    }
}

function drawEdges() {
    for (const edge of network.edges) {
        const isSelected = interaction.selectedEdge === edge;
        const isHovered = interaction.hoveredEdge === edge;
        const isTraversalEdge = traversalManager.isEdgeHighlighted(edge);
        const isHighlighted = packetManager.isEdgeInHighlightedPath(edge.nodeA.id, edge.nodeB.id) || isTraversalEdge;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(edge.nodeA.x, edge.nodeA.y);
        ctx.lineTo(edge.nodeB.x, edge.nodeB.y);

        if (edge.broken) {
            ctx.strokeStyle = "#ef4444";
            ctx.setLineDash([6, 6]);
        } else if (isHighlighted) {
            // Bright animated highlight for the computed shortest path
            ctx.strokeStyle = "#eab308"; // Radiant Golden Yellow
            ctx.shadowColor = "rgba(234, 136, 8, 0.6)";
            ctx.shadowBlur = 10;
        } else if (isSelected) {
            ctx.strokeStyle = "#38bdf8";
        } else if (isHovered) {
            ctx.strokeStyle = "#94a3b8";
        } else {
            ctx.strokeStyle = "#475569";
        }

        ctx.lineWidth = isHighlighted ? 4 : (isSelected || isHovered ? 3.5 : 2.5);
        ctx.stroke();

        // Weight badge at midpoint
        const midX = (edge.nodeA.x + edge.nodeB.x) / 2;
        const midY = (edge.nodeA.y + edge.nodeB.y) / 2;
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        ctx.fillStyle = isHighlighted ? "#854d0e" : "#0f172a";
        ctx.beginPath();
        ctx.arc(midX, midY, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = edge.broken ? "#ef4444" : (isHighlighted ? "#eab308" : "#334155");
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = edge.broken ? "#fca5a5" : (isHighlighted ? "#fef08a" : "#e2e8f0");
        ctx.font = "bold 11px Roboto, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(edge.weight, midX, midY);
        ctx.restore();
    }

    // Rubber-band preview line while creating a link
    if (activeSideBtn === TOOLS.LINK && interaction.linkStartNode) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(interaction.linkStartNode.x, interaction.linkStartNode.y);
        ctx.lineTo(interaction.mouseWorld.x, interaction.mouseWorld.y);
        ctx.strokeStyle = "#8bc34a";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.restore();
    }
}

function drawNodes() {
    for (const node of network.nodes) {
        const isSelected = interaction.selectedNode === node || interaction.linkStartNode === node;
        const isHovered = interaction.hoveredNode === node;
        let discrepancy = 0;
        if (node.type === "router") { discrepancy = 10; }

        if (isSelected || isHovered) {
            ctx.save();
            ctx.strokeStyle = isSelected ? "#38bdf8" : "#64748b";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(
                node.x - CONFIG.HALF_NODE - 5,
                node.y - CONFIG.HALF_NODE - 5 - discrepancy,
                CONFIG.NODE_SIZE + 10,
                CONFIG.NODE_SIZE + 10,
                8
            );
            ctx.stroke();
            ctx.restore();
        }

        const img = node.type === "client" ? imgs.client : imgs.router;
        ctx.save();
        if (node.broken) ctx.globalAlpha = 0.45;

        if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(
                img,
                node.x - CONFIG.HALF_NODE,
                node.y - CONFIG.HALF_NODE - discrepancy,
                CONFIG.NODE_SIZE,
                CONFIG.NODE_SIZE
            );
        } else {
            ctx.fillStyle = node.type === "client" ? "#0284c7" : "#6366f1";
            ctx.fillRect(
                node.x - CONFIG.HALF_NODE,
                node.y - CONFIG.HALF_NODE - discrepancy,
                CONFIG.NODE_SIZE,
                CONFIG.NODE_SIZE
            );
        }

        // Overlay broken icon if device is down
        if (node.broken && imgs.broken.complete && imgs.broken.naturalWidth > 0) {
            ctx.globalAlpha = 1;
            ctx.drawImage(imgs.broken, node.x - 12, node.y - 12, 24, 24);
        }
        ctx.restore();

        // Label
        ctx.fillStyle = node.broken ? "#f87171" : "#e2e8f0";
        ctx.font = "12px Roboto, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(node.label, node.x, node.y + CONFIG.HALF_NODE + 15 - discrepancy);
        // IP address for clients
        if (node.type === "client") {
            ctx.fillStyle = node.broken ? "#f87171" : "#94a3b8";
            ctx.font = "11px Roboto, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "alphabetic";
            ctx.fillText(node.ip, node.x, node.y + CONFIG.HALF_NODE + 28);
        }

        // Draw FIFO Queue Badge on router if packets are waiting in buffer
        if (node.queue && node.queue.length > 0) {
            const badgeX = node.x + CONFIG.HALF_NODE - 5;
            const badgeY = node.y - CONFIG.HALF_NODE - discrepancy + 5;
            ctx.save();
            ctx.beginPath();
            ctx.arc(badgeX, badgeY, 10, 0, Math.PI * 2);
            ctx.fillStyle = "#f59e0b"; // Amber queue badge
            ctx.fill();
            ctx.strokeStyle = "#0f172a";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 10px Roboto, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(node.queue.length, badgeX, badgeY);
            ctx.restore();
        }

        // Draw Traversal Visited Highlight & Order Badge
        if (traversalManager.isNodeVisited(node.id)) {
            ctx.save();
            ctx.strokeStyle = "#eab308";
            ctx.lineWidth = 3;
            ctx.shadowColor = "rgba(234, 179, 8, 0.75)";
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.roundRect(
                node.x - CONFIG.HALF_NODE - 4,
                node.y - CONFIG.HALF_NODE - 4 - discrepancy,
                CONFIG.NODE_SIZE + 8,
                CONFIG.NODE_SIZE + 8,
                8
            );
            ctx.stroke();
            ctx.restore();

            const orderNum = traversalManager.getNodeOrderNumber(node.id);
            if (orderNum !== null) {
                const badgeX = node.x - CONFIG.HALF_NODE + 6;
                const badgeY = node.y - CONFIG.HALF_NODE - discrepancy + 6;
                ctx.save();
                ctx.beginPath();
                ctx.arc(badgeX, badgeY, 9, 0, Math.PI * 2);
                ctx.fillStyle = "#eab308";
                ctx.fill();
                ctx.strokeStyle = "#0f172a";
                ctx.lineWidth = 1.5;
                ctx.stroke();

                ctx.fillStyle = "#0f172a";
                ctx.font = "bold 9px Roboto, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(orderNum, badgeX, badgeY);
                ctx.restore();
            }
        }
    }
}

function animation(currentTime) {
    if (!prevTime) prevTime = currentTime;
    let diff = currentTime - prevTime;
    prevTime = currentTime;
    if (diff > 100) diff = 16.67;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    ctx.translate(dimension.x, dimension.y);
    ctx.scale(dimension.zoom, dimension.zoom);

    drawEdges();
    drawNodes();
    packetManager.updateAndDraw(ctx);
    traversalManager.update();
    traversalManager.draw(ctx);

    window.requestAnimationFrame(animation);
}
dots();
window.requestAnimationFrame(animation);

// ==========================================
// 6. EVENT LISTENERS
// ==========================================
window.addEventListener("resize", () => {
    dimension.resize();
    dots();
});

cvs.addEventListener("contextmenu", (eve) => {
    eve.preventDefault();
    const worldPos = dimension.screenToWorld(eve.clientX, eve.clientY);
    const hitNode = getNodeAt(worldPos.x, worldPos.y);
    const hitEdge = hitNode ? null : getEdgeAt(worldPos.x, worldPos.y);

    if (hitNode) {
        interaction.selectedNode = hitNode;
        interaction.selectedEdge = null;
        if (dimension.width - dimension.worldToScreen(hitNode.x, hitNode.y).x <= 420 || dimension.height - dimension.worldToScreen(hitNode.x, hitNode.y).y <= dimension.height / 3) {
            const int = setInterval(() => {
                dimension.x -= 7;
                if (dimension.width - dimension.worldToScreen(hitNode.x, hitNode.y).x >= 420) {
                    clearInterval(int);
                }
            }, 1);
            const int2 = setInterval(() => {
                dimension.y -= 7;
                if (dimension.height - dimension.worldToScreen(hitNode.x, hitNode.y).y >= dimension.height / 3) {
                    clearInterval(int2);
                }
            }, 1);
        }
        inspector.openNode(hitNode);
    } else if (hitEdge) {
        interaction.selectedEdge = hitEdge;
        interaction.selectedNode = null;
        inspector.openEdge(hitEdge);
    } else {
        inspector.close();
    }
});

cvs.addEventListener("mousedown", (eve) => {
    if (eve.button !== 0) return;
    const worldPos = dimension.screenToWorld(eve.clientX, eve.clientY);
    const hitNode = getNodeAt(worldPos.x, worldPos.y);
    const hitEdge = hitNode ? null : getEdgeAt(worldPos.x, worldPos.y);

    if (activeSideBtn === TOOLS.CLIENT) {
        network.addClient(worldPos.x, worldPos.y);
        inspector.refresh(); // Updates ping dropdown if a client panel is currently open
    } else if (activeSideBtn === TOOLS.ROUTER) {
        network.addRouter(worldPos.x, worldPos.y);
    } else if (activeSideBtn === TOOLS.LINK) {
        if (hitNode) {
            if (!interaction.linkStartNode) {
                interaction.linkStartNode = hitNode;
            } else {
                const newEdge = network.addEdge(interaction.linkStartNode, hitNode, 1);
                interaction.linkStartNode = null;
                if (newEdge) inspector.refresh();
            }
        } else {
            interaction.linkStartNode = null;
        }
    } else if (activeSideBtn === TOOLS.DELETE) {
        if (hitNode) {
            const wasInspected = interaction.selectedNode === hitNode;
            network.removeNode(hitNode);
            if (wasInspected) {
                inspector.close();
            } else {
                inspector.refresh(); // Removes deleted neighbor from any open connections/ping list
            }
        } else if (hitEdge) {
            const wasInspected = interaction.selectedEdge === hitEdge;
            network.removeEdge(hitEdge);
            if (wasInspected) {
                inspector.close();
            } else {
                inspector.refresh();
            }
        }
    } else if (activeSideBtn === TOOLS.MOUSE) {
        if (hitNode) {
            interaction.draggedNode = hitNode;
            interaction.dragOffset.x = worldPos.x - hitNode.x;
            interaction.dragOffset.y = worldPos.y - hitNode.y;
        } else if (!hitEdge) {
            // Clicking empty canvas closes any open inspect panel and starts panning
            inspector.close();
            interaction.isPanning = true;
        }
    }
});

cvs.addEventListener("mousemove", (eve) => {
    if (!sideBarLocked) {
        if (eve.clientX < 15) leftPanel.classList.add("active");
        else leftPanel.classList.remove("active");
    }

    const worldPos = dimension.screenToWorld(eve.clientX, eve.clientY);
    interaction.mouseWorld = worldPos;
    interaction.hoveredNode = getNodeAt(worldPos.x, worldPos.y);
    interaction.hoveredEdge = interaction.hoveredNode ? null : getEdgeAt(worldPos.x, worldPos.y);

    if (interaction.draggedNode) {
        interaction.draggedNode.x = worldPos.x - interaction.dragOffset.x;
        interaction.draggedNode.y = worldPos.y - interaction.dragOffset.y;
    } else if (interaction.isPanning) {
        dimension.x += eve.movementX;
        dimension.y += eve.movementY;
        dots();
    }
});

cvs.addEventListener("mouseup", () => {
    interaction.isPanning = false;
    interaction.draggedNode = null;
});

cvs.addEventListener("mouseleave", () => {
    interaction.isPanning = false;
    interaction.draggedNode = null;
});

cvs.addEventListener("wheel", (eve) => {
    eve.preventDefault();

    const oldZoom = dimension.zoom;
    const direction = Math.sign(eve.deltaY);
    let nextZoom = direction > 0 ? oldZoom / 1.1 : oldZoom * 1.1;
    nextZoom = Math.min(Math.max(nextZoom, 0.3), 3);

    if (nextZoom === oldZoom) return;
    dimension.zoom = nextZoom;

    const mouseX = eve.clientX;
    const mouseY = eve.clientY;
    const factor = dimension.zoom / oldZoom;

    dimension.x = mouseX - (mouseX - dimension.x) * factor;
    dimension.y = mouseY - (mouseY - dimension.y) * factor;
    dots();
}, { passive: false });

// Global convenience wrapper pointing to network.findShortestRoute
async function findShortestRoute(srcNode, destNode) {
    return await network.findShortestRoute(srcNode, destNode);
}

// ==========================================
// 7. PLAYBACK CONTROLS (PLAY/PAUSE, STEP & SPEED)
// ==========================================
const playPauseBtn = document.getElementById("sim-play-pause-btn");
const stepBtn = document.getElementById("sim-step-btn");
const speedSlider = document.getElementById("sim-speed-slider");
const speedLabel = document.getElementById("sim-speed-label");

if (playPauseBtn) {
    playPauseBtn.addEventListener("click", () => {
        packetManager.togglePause();
    });
}

if (stepBtn) {
    stepBtn.addEventListener("click", () => {
        // Step forward one animation tick (for traversal if active, otherwise packets)
        if (traversalManager.isRunning) {
            traversalManager.step();
        } else {
            packetManager.step();
        }
    });
}

if (speedSlider) {
    speedSlider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        packetManager.setSpeed(val);
        if (speedLabel) {
            speedLabel.textContent = `${val}x`;
        }
    });
}

// Keyboard shortcuts: Spacebar to toggle Pause/Resume
window.addEventListener("keydown", (e) => {
    // Only capture spacebar if not focused inside an input or editable field
    if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        packetManager.togglePause();
    }
});

// ==========================================
// 8. ACTIVITY LOGGER SYSTEM
// ==========================================
const activityLogger = {
    logs: [],
    stats: {
        tx: 0,
        rx: 0,
        drop: 0
    },
    panel: document.getElementById("activity-logger"),
    body: document.getElementById("logger-body"),
    countBadge: document.getElementById("logger-count-badge"),
    statTx: document.getElementById("stat-tx-val"),
    statRx: document.getElementById("stat-rx-val"),
    statDrop: document.getElementById("stat-drop-val"),
    dragHandle: document.getElementById("logger-drag-handle"),
    clearBtn: document.getElementById("logger-clear-btn"),
    maximizeBtn: document.getElementById("logger-maximize-btn"),
    isDragging: false,
    startY: 0,
    startHeight: 34,
    defaultExpandedHeight: 200,

    init() {
        if (!this.panel) return;

        // Clear button
        if (this.clearBtn) {
            this.clearBtn.addEventListener("click", () => this.clear());
        }

        // Toggle Maximize / Minimize button
        if (this.maximizeBtn) {
            this.maximizeBtn.addEventListener("click", () => {
                const currentH = this.panel.offsetHeight;
                if (currentH <= 45) {
                    this.panel.style.height = `${this.defaultExpandedHeight}px`;
                    this.panel.classList.add("expanded");
                } else {
                    this.panel.style.height = `34px`;
                    this.panel.classList.remove("expanded");
                }
            });
        }

        // Drag-to-resize handle
        if (this.dragHandle) {
            this.dragHandle.addEventListener("mousedown", (e) => {
                this.isDragging = true;
                this.startY = e.clientY;
                this.startHeight = this.panel.offsetHeight;
                this.panel.classList.add("resizing");
                document.body.style.cursor = "row-resize";
                e.preventDefault();
            });

            window.addEventListener("mousemove", (e) => {
                if (!this.isDragging) return;
                const deltaY = this.startY - e.clientY; // Dragging UP increases height
                let newHeight = this.startHeight + deltaY;
                newHeight = Math.max(34, Math.min(newHeight, window.innerHeight * 0.75));
                this.panel.style.height = `${newHeight}px`;

                if (newHeight > 45) {
                    this.panel.classList.add("expanded");
                    this.defaultExpandedHeight = newHeight;
                } else {
                    this.panel.classList.remove("expanded");
                }
            });

            window.addEventListener("mouseup", () => {
                if (this.isDragging) {
                    this.isDragging = false;
                    this.panel.classList.remove("resizing");
                    document.body.style.cursor = "default";
                }
            });
        }
    },

    log(type, message) {
        const now = new Date();
        const timeStr = now.toTimeString().split(" ")[0]; // "HH:MM:SS"
        const entry = { time: timeStr, type, message };
        this.logs.push(entry);

        // Update statistics based on event type
        if (type === "PING_TX") this.stats.tx++;
        else if (type === "PING_RX") this.stats.rx++;
        else if (type === "DROP") this.stats.drop++;

        this.updateStatsDisplay();
        this.renderEntry(entry);
    },

    renderEntry(entry) {
        if (!this.body) return;

        // Remove placeholder if it's the first log
        const emptyMsg = this.body.querySelector(".logger-empty");
        if (emptyMsg) emptyMsg.remove();

        const row = document.createElement("div");
        row.className = "log-entry";

        let tagClass = "tag-node";
        let displayTag = entry.type;

        if (entry.type.includes("NODE")) tagClass = "tag-node";
        else if (entry.type.includes("LINK")) tagClass = "tag-link";
        else if (entry.type.includes("ROUTE")) tagClass = "tag-route";
        else if (entry.type.includes("PING")) tagClass = "tag-ping";
        else if (entry.type.includes("DROP")) tagClass = "tag-drop";
        else if (entry.type.includes("QUEUE")) tagClass = "tag-queue";

        row.innerHTML = `
            <span class="log-time">[${entry.time}]</span>
            <span class="log-tag ${tagClass}">${displayTag}</span>
            <span class="log-msg">${entry.message}</span>
        `;

        this.body.appendChild(row);
        // Auto-scroll to bottom of log terminal
        this.body.scrollTop = this.body.scrollHeight;
    },

    updateStatsDisplay() {
        if (this.countBadge) this.countBadge.textContent = `${this.logs.length} events`;
        if (this.statTx) this.statTx.textContent = this.stats.tx;
        if (this.statRx) this.statRx.textContent = this.stats.rx;
        if (this.statDrop) this.statDrop.textContent = this.stats.drop;
    },

    clear() {
        this.logs = [];
        this.stats = { tx: 0, rx: 0, drop: 0 };
        this.updateStatsDisplay();
        if (this.body) {
            this.body.innerHTML = `<div class="logger-empty">No activity recorded yet.</div>`;
        }
    },

    exportData() {
        return {
            logs: this.logs,
            stats: this.stats
        };
    },

    importData(data) {
        this.clear();
        if (!data || !Array.isArray(data.logs)) return;

        if (data.stats) {
            this.stats.tx = Number(data.stats.tx) || 0;
            this.stats.rx = Number(data.stats.rx) || 0;
            this.stats.drop = Number(data.stats.drop) || 0;
        }

        for (const entry of data.logs) {
            this.logs.push(entry);
            this.renderEntry(entry);
        }
        this.updateStatsDisplay();
    }
};

// Initialize logger on load
activityLogger.init();

// ==========================================
// 9. GRAPH TRAVERSAL CONTROLS (BFS & DFS)
// ==========================================
function updateTraversalDropdown() {
    const select = document.getElementById("traversal-start-select");
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = `<option value="">Start Node</option>`;

    // Include all active nodes (routers and clients)
    const sortedNodes = [...network.nodes].filter(n => !n.broken).sort((a, b) => {
        if (a.type !== b.type) return a.type === "router" ? -1 : 1;
        return a.id.localeCompare(b.id, undefined, { numeric: true });
    });

    for (const node of sortedNodes) {
        const opt = document.createElement("option");
        opt.value = node.id;
        opt.textContent = `${node.label} (${node.type === "router" ? "Router" : "Client"})`;
        select.appendChild(opt);
    }

    if (currentVal && network.nodes.some(n => n.id === currentVal && !n.broken)) {
        select.value = currentVal;
    }
}

const btnBfs = document.getElementById("btn-bfs");
const btnDfs = document.getElementById("btn-dfs");
const traversalSelect = document.getElementById("traversal-start-select");

async function handleStartTraversal(type) {
    inspector.close();
    if (!traversalSelect || !traversalSelect.value) {
        alert("Please select a starting node from the dropdown first.");
        return;
    }

    const startId = traversalSelect.value;
    const startNode = network.getNodeById(startId);
    if (!startNode || startNode.broken) {
        alert("Selected start node is offline or invalid.");
        return;
    }

    // Ensure no packets are running or queued
    packetManager.packets = [];
    for (const n of network.nodes) {
        n.queue = [];
    }

    const typeUpper = type.toUpperCase();
    activityLogger.log("TRAVERSAL", `Starting ${typeUpper} traversal from ${startNode.label}...`);

    const data = await network.findTraversal(startId, type);
    if (data && data.order && data.order.length > 0) {
        const orderLabels = data.order.map(id => {
            const n = network.getNodeById(id);
            return n ? n.label : id;
        });
        activityLogger.log("TRAVERSAL", `${typeUpper} order: ${orderLabels.join(" -> ")}`);
        traversalManager.start(type, startId, data.order, data.steps || []);
    } else {
        activityLogger.log("TRAVERSAL", `${typeUpper} found no reachable connections from ${startNode.label}.`);
    }
}

if (btnBfs) {
    btnBfs.addEventListener("click", () => handleStartTraversal("bfs"));
}

if (btnDfs) {
    btnDfs.addEventListener("click", () => handleStartTraversal("dfs"));
}

// Populate dropdown initially
updateTraversalDropdown();