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
        return edge;
    },

    removeEdge(edge) {
        if (!edge || !this.edges.includes(edge)) return;
        this.spare.edge.push(parseInt(edge.id.slice(1)));
        edge.nodeA.edges = edge.nodeA.edges.filter(e => e !== edge);
        edge.nodeB.edges = edge.nodeB.edges.filter(e => e !== edge);
        this.edges = this.edges.filter(e => e !== edge);
        this.markDirty();
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
            }))
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
        });

        if (isClient) {
            const pingBtn = body.querySelector("#send-ping-btn");
            pingBtn.addEventListener("click", () => {
                const targetId = body.querySelector("#ping-target-select").value;
                if (!targetId) return;
                // Routing payload hook will connect here in the next step
                console.log(`Ping requested: ${node.id} -> ${targetId}`);
                findShortestRoute(node.id, targetId).then(result => {
                    console.log("Shortest route:", result);
                });
                console.log("A");
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
        slider.addEventListener("input", () => {
            edge.weight = parseInt(slider.value, 10);
            readout.textContent = edge.weight;
        });

        body.querySelector("#toggle-edge-broken").addEventListener("click", () => {
            edge.broken = !edge.broken;
            this.openEdge(edge);
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

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(edge.nodeA.x, edge.nodeA.y);
        ctx.lineTo(edge.nodeB.x, edge.nodeB.y);

        if (edge.broken) {
            ctx.strokeStyle = "#ef4444";
            ctx.setLineDash([6, 6]);
        } else if (isSelected) {
            ctx.strokeStyle = "#38bdf8";
        } else if (isHovered) {
            ctx.strokeStyle = "#94a3b8";
        } else {
            ctx.strokeStyle = "#475569";
        }

        ctx.lineWidth = isSelected || isHovered ? 3.5 : 2.5;
        ctx.stroke();

        // Weight badge at midpoint
        const midX = (edge.nodeA.x + edge.nodeB.x) / 2;
        const midY = (edge.nodeA.y + edge.nodeB.y) / 2;
        ctx.setLineDash([]);
        ctx.fillStyle = "#0f172a";
        ctx.beginPath();
        ctx.arc(midX, midY, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = edge.broken ? "#ef4444" : "#334155";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = edge.broken ? "#fca5a5" : "#e2e8f0";
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

async function findShortestRoute(srcNode, destNode) {
    try {
        const response = await fetch("/route", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                src: srcNode,
                dest: destNode
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log("Route response:", data);
        // data -> { reachable: true, src: "...", dest: "...", cost: 0, path: [...] }
        return data;

    } catch (err) {
        console.error("Request failed:", err);
    }
}