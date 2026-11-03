let cvs = document.getElementsByTagName("canvas")[0];
let ctx = cvs.getContext("2d");

function resize() {
    cvs.width = window.innerWidth;
    cvs.height = window.innerHeight;
}

resize();
window.addEventListener('resize', resize);

let prevTime = 0;

function animation(currentTime) {
    const diff = currentTime - prevTime;
    prevTime = currentTime;
    console.clear();
    console.log(1/diff*1000);
    window.requestAnimationFrame(animation);
}

window.requestAnimationFrame(animation);