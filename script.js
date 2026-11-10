const cvsArr = document.getElementsByTagName("canvas");
const cvs = cvsArr[1];
const cvsBg = cvsArr[0];
const ctx = cvs.getContext("2d");
const ctxBg = cvsBg.getContext("2d");
const leftPanel = document.getElementById("side-panel");
const sideBtns = document.querySelectorAll("div#side-panel span");
let activeSideBtn = 0;

for (let i = 0; i < 5; i++) {
    sideBtns[i].addEventListener("click", () => {
        sideBtns[activeSideBtn].classList.remove("active");
        sideBtns[i].classList.add("active");
        activeSideBtn = i;
    });
}

class Dimensions {
    constructor() {
        this.height = window.innerHeight;
        this.width = window.innerWidth;
        this.zoom = 1;
        // Changed to tracking camera offsets in world coordinates
        this.x = this.width / 2;
        this.y = this.height / 2;
        this.mouseDown = false;
        this.resize();
    }

    resize() {
        this.height = window.innerHeight;
        this.width = window.innerWidth;
        cvsBg.width = cvs.width = this.width;
        cvsBg.height = cvs.height = this.height;
    }
};
let dimension = new Dimensions();

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
    // 1. Clear with completely reset transformations
    ctxBg.setTransform(1, 0, 0, 1, 0, 0);
    ctxBg.clearRect(0, 0, dimension.width, dimension.height);

    // 2. Apply current camera position and zoom uniformly
    ctxBg.translate(dimension.x, dimension.y);
    ctxBg.scale(dimension.zoom, dimension.zoom);

    // 3. Convert screen bounds to world coordinates to know where to draw dots
    const left = -dimension.x / dimension.zoom;
    const top = -dimension.y / dimension.zoom;
    const right = (dimension.width - dimension.x) / dimension.zoom;
    const bottom = (dimension.height - dimension.y) / dimension.zoom;

    // 4. Align grid lines neatly to standard 50px increments
    const startX = Math.floor(left / 50) * 50;
    const startY = Math.floor(top / 50) * 50;

    ctxBg.fillStyle = "#1f2a3d";
    let size = 3;
    if (dimension.zoom > 1) size /= dimension.zoom; // Keep dots looking a consistent size regardless of zoom

    for (let i = startX; i < right; i += 50) {
        for (let j = startY; j < bottom; j += 50) {
            ctxBg.beginPath();
            ctxBg.arc(i, j, size, 0, Math.PI * 2);
            ctxBg.fill();
        }
    }
}

function animation(currentTime) {
    if (!prevTime) prevTime = currentTime;
    let diff = currentTime - prevTime;
    prevTime = currentTime;
    if (diff > 100) diff = 16.67;

    // Apply same camera matrix to your foreground active layer
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    ctx.translate(dimension.x, dimension.y);
    ctx.scale(dimension.zoom, dimension.zoom);

    // Foreground elements are now perfectly synced to camera movements
    ctx.drawImage(imgs.router, 0, 0, 50, 50);
    ctx.drawImage(imgs.client, 50, 0, 50, 50);

    window.requestAnimationFrame(animation);
}
dots();
window.requestAnimationFrame(animation);

// Initial draw sequence safely deferred after structural setup
window.addEventListener('resize', () => { dimension.resize(); dots(); });

cvs.addEventListener('mousedown', (eve) => { dimension.mouseDown = true; });

cvs.addEventListener('mousemove', (eve) => {
    if (eve.x < 15) { leftPanel.classList.add("active"); }
    else {leftPanel.classList.remove("active");}
    if (dimension.mouseDown) {
        // Simple, predictable translation adjustment
        dimension.x += eve.movementX;
        dimension.y += eve.movementY;
        dots();
    }
});

cvs.addEventListener("mouseup", (eve) => { dimension.mouseDown = false; });
cvs.addEventListener("mouseleave", (eve) => { dimension.mouseDown = false; }); // Prevents stuck drags

cvs.addEventListener("wheel", (eve) => {
    eve.preventDefault(); // Stop standard browser body scroll

    // Target zoom tracking parameters
    const oldZoom = dimension.zoom;
    const direction = Math.sign(eve.deltaY);

    if (direction > 0) {
        dimension.zoom /= 1.1;
    } else if (direction < 0) {
        dimension.zoom *= 1.1;
    }

    // Clamp constraints
    let max = 3;
    dimension.zoom = Math.min(Math.max(dimension.zoom, 0.3), max);

    if (dimension.zoom <= max) {
        // 5. ZOOM TO CURSOR MATH
        // Compute current mouse position relative to canvas
        const mouseX = eve.clientX;
        const mouseY = eve.clientY;
        const factor = dimension.zoom / oldZoom;

        // Adjust camera positions so the point directly under the pointer matches perfectly
        dimension.x = mouseX - (mouseX - dimension.x) * factor;
        dimension.y = mouseY - (mouseY - dimension.y) * factor;
        dots();
    }
}, { passive: false });
