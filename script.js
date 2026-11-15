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

// Upload/save buttons functionality under construction
for (let i = 6; i < sideBtns.length; i++) {
    sideBtns[i].addEventListener("click", () => {
        sideBtns[i].classList.toggle("active");
    });
}

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

    addClient(x, y) {
        let id = this.counters.client;
        if (this.spare.client.length) {
            id = this.spare.client.pop();
        } else { this.counters.client++; }
        const node = new Client(`C${id}`, x, y);
        this.nodes.push(node);
        return node;
    },

    addRouter(x, y) {
        let id = this.counters.router;
        if (this.spare.router.length) {
            id = this.spare.router.pop();
        } else { this.counters.router++; }
        const node = new Router(`R${id}`, x, y);
        this.nodes.push(node);
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
        return edge;
    },

    removeEdge(edge) {
        if (!edge || !this.edges.includes(edge)) return;
        this.spare.edge.push(parseInt(edge.id.slice(1)));
        edge.nodeA.edges = edge.nodeA.edges.filter(e => e !== edge);
        edge.nodeB.edges = edge.nodeB.edges.filter(e => e !== edge);
        this.edges = this.edges.filter(e => e !== edge);
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
// 3. GEOMETRY HIT-TESTING HELPERS
// ==========================================
function getNodeAt(wx, wy) {
    for (let i = network.nodes.length - 1; i >= 0; i--) {
        const n = network.nodes[i];
        if (
            wx >= n.x - CONFIG.HALF_NODE &&
            wx <= n.x + CONFIG.HALF_NODE &&
            wy >= n.y - CONFIG.HALF_NODE &&
            wy <= n.y + CONFIG.HALF_NODE
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
// 4. ASSETS & RENDERING LOOP
// ==========================================
let imgs = {
    client: new Image(),
    router: new Image(),
    server: new Image(),
    broken: new Image()
};
imgs.client.src = "./imgs/Client.svg";
imgs.router.src = "./imgs/Router.svg";
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

        if (isSelected || isHovered) {
            ctx.save();
            ctx.strokeStyle = isSelected ? "#38bdf8" : "#64748b";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(
                node.x - CONFIG.HALF_NODE - 5,
                node.y - CONFIG.HALF_NODE - 5,
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
                node.y - CONFIG.HALF_NODE,
                CONFIG.NODE_SIZE,
                CONFIG.NODE_SIZE
            );
        } else {
            ctx.fillStyle = node.type === "client" ? "#0284c7" : "#6366f1";
            ctx.fillRect(
                node.x - CONFIG.HALF_NODE,
                node.y - CONFIG.HALF_NODE,
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
        ctx.fillText(node.label, node.x, node.y + CONFIG.HALF_NODE + 15);
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
// 5. EVENT LISTENERS
// ==========================================
window.addEventListener("resize", () => {
    dimension.resize();
    dots();
});

cvs.addEventListener("contextmenu", (eve) => {eve.preventDefault();});

cvs.addEventListener("mousedown", (eve) => {
    if (eve.button !== 0) return;
    const worldPos = dimension.screenToWorld(eve.clientX, eve.clientY);
    const hitNode = getNodeAt(worldPos.x, worldPos.y);
    const hitEdge = hitNode ? null : getEdgeAt(worldPos.x, worldPos.y);

    if (activeSideBtn === TOOLS.CLIENT) {
        network.addClient(worldPos.x, worldPos.y);
    } else if (activeSideBtn === TOOLS.ROUTER) {
        network.addRouter(worldPos.x, worldPos.y);
    } else if (activeSideBtn === TOOLS.LINK) {
        if (hitNode) {
            if (!interaction.linkStartNode) {
                interaction.linkStartNode = hitNode;
            } else {
                network.addEdge(interaction.linkStartNode, hitNode, 1);
                interaction.linkStartNode = null;
            }
        } else {
            interaction.linkStartNode = null;
        }
    } else if (activeSideBtn === TOOLS.DELETE) {
        if (hitNode) {
            network.removeNode(hitNode);
            if (interaction.selectedNode === hitNode) interaction.selectedNode = null;
        } else if (hitEdge) {
            network.removeEdge(hitEdge);
            if (interaction.selectedEdge === hitEdge) interaction.selectedEdge = null;
        }
    } else if (activeSideBtn === TOOLS.MOUSE) {
        if (hitNode) {
            interaction.selectedNode = hitNode;
            interaction.selectedEdge = null;
            interaction.draggedNode = hitNode;
            interaction.dragOffset.x = worldPos.x - hitNode.x;
            interaction.dragOffset.y = worldPos.y - hitNode.y;
        } else if (hitEdge) {
            interaction.selectedEdge = hitEdge;
            interaction.selectedNode = null;
        } else {
            interaction.selectedNode = null;
            interaction.selectedEdge = null;
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