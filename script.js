let cvs = document.getElementsByTagName("canvas")[0];
let ctx = cvs.getContext("2d");

function resize() {
    cvs.width = window.innerWidth;
    cvs.height = window.innerHeight;
}

resize();
window.addEventListener('resize', resize);

let speed = 0.25;
let prevTime = null
let i = Math.floor(Math.random() * (cvs.width - 50)), j = Math.floor(Math.random() * (cvs.height - 50))
let vecI = 1, vecJ = 1;

function animation(currentTime) {
    const diff = currentTime - prevTime;
    prevTime = currentTime;
    // console.clear();
    // console.log(1 / diff * 1000);
    ctx.clearRect(0, 0, cvs.width, cvs.height); // remove this line to see trails
    ctx.fillStyle = `hsl(${(i + j) % 360}, 100%, 50%)`;
    ctx.fillRect(i, j, 50, 50);
    i += vecI * diff * speed;
    j += vecJ * diff * speed;
    if (i + 50 >= cvs.width)
        vecI = -1;
    else if (i <= 0)
        vecI = 1;
    if (j + 50 >= cvs.height)
        vecJ = -1;
    else if (j <= 0)
        vecJ = 1;
    window.requestAnimationFrame(animation);
}

window.requestAnimationFrame(animation);