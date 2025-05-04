document.addEventListener('dragstart', e => e.preventDefault());

let isCutting = false;
let oldCutPath = new WeakMap(); // Stores elements as keys automatically
let cutPath = new WeakMap(); // Stores elements as keys automatically
const cutElements = new Set(); // Track which elements were cut

document.addEventListener('mousedown', startCut);
document.addEventListener('mousemove', duringCut);
document.addEventListener('mouseup', finishCut);

function isCuttable(element) {
    // Small element (either width or height < 100px)
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width > 200 || height > 200) {
        return false;
    }
    // TODO: ensure most of this space is the element and not its child elements
    return true;
}

function startCut(e) {
    if (isCutting) {  // should not happen, but sometimes it does, because of bugs
        finishCut(e);
        return;
    }
    console.debug('Start cut');
    isCutting = true;
}

function duringCut(e) {
    if (!isCutting) return;
    if (!e.target || !isCuttable(e.target)) return;
    // console.log(e.target);

    // store the new point in the cut path
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const point = { x, y};

    // Get or create path data for this element
    if (!cutPath.has(e.target)) {
        cutPath.set(e.target, {
            element: e.target,
            points: []
        });
        cutElements.add(e.target); // Track new element
    }
    cutPath.get(e.target).points.push(point);
    
    // Visual feedback while cutting
    document.body.style.cursor = 'crosshair';
}

function finishCut(e) {
    if (!isCutting) return;

    console.debug('Finish cut');
    isCutting = false;
    document.body.style.cursor = 'default';

    cutElements.forEach(element => {
        const pathData = cutPath.get(element);
        if (pathData.points.length >= 2) { // Need at least 2 points to cut
            const oldCutPoints = oldCutPath.get(element)?.points;
            splitElement(element, pathData.points, oldCutPoints);
        }
    });

    // save cut path to oldCutPath
    cutElements.forEach(element => {
        const pathData = cutPath.get(element);
        if (pathData) {
            oldCutPath.set(element, {
                element: element,
                points: pathData.points
            });
        }
    });
    cutPath = new WeakMap(); // Clear the path data
    cutElements.clear(); // Clear the set of cut elements
}

function pointsToPolygon(points) {
    return `polygon(${points.map(p => `${p.x}% ${p.y}%`).join(",")})`;
}

function splitElement(element, cutPoints, oldCutPoints) {
    // TODO: the question is not really whether the new cut is smaller, but rather whether it is inscribed in the old cut
    // if (oldCutPoints) {
    //     const oldArea = calculatePolygonArea(pointsToPolygon(oldCutPoints));
    //     const newArea = calculatePolygonArea(pointsToPolygon(cutPoints));
    //     if (newArea < oldArea) {
    //         console.log("Cutting area is smaller than old area, skipping cut");
    //         return;
    //     }
    // }

    const rect = element.getBoundingClientRect();

    // Convert points to percentages relative to element size
    const pathPoints = cutPoints.map(p => ({
        x: (p.x / rect.width) * 100,
        y: (p.y / rect.height) * 100
    }));
    
    // Create a new part
    const part1 = element.cloneNode(true);

    // Create polygon paths
    const startEdge = getNearestEdge(pathPoints[0], rect);
    const endEdge = getNearestEdge(pathPoints[pathPoints.length - 1], rect);

    // Get projections before creating polygons
    const startProj = projectToEdge(pathPoints[0], startEdge);
    const endProj = projectToEdge(pathPoints[pathPoints.length - 1], endEdge);

    // First part polygon
    const polygonPath = createPathPolygon(pathPoints, startEdge, endEdge, startProj, endProj);
    part1.style.clipPath = polygonPath;
    
    // Second part gets inverse path
    element.style.clipPath = createInversePathPolygon(pathPoints, startEdge, endEdge, startProj, endProj);

    const style = getComputedStyle(element);
    const width = parseFloat(style.width);
    const height = parseFloat(style.height);
    const top = rect.top + window.scrollY;
    const left = rect.left + window.scrollX;
    const paddingLeft = parseFloat(style.paddingLeft);
    const paddingTop = parseFloat(style.paddingTop);
    const borderLeft = parseFloat(style.borderLeftWidth);
    const borderTop = parseFloat(style.borderTopWidth);
    const contentLeft = left - borderLeft - paddingLeft; // + borderLeft + paddingLeft;
    const contentTop = top - borderTop - paddingTop; // + borderTop + paddingTop;

    // Position parts
    [part1].forEach(part => {         
        part.classList.add('part');
        part.style.left = `${contentLeft}px`;
        part.style.top = `${contentTop}px`;
        part.style.width = `${width}px`;
        part.style.height = `${height}px`;
    });

    // Add to document
    document.body.appendChild(part1);
    const fallingPart = part1;  // area1 < area2 ? part1 : part2;
    
    // Create a falling animation (slow translation down)
    // https://chatgpt.com/share/68167b11-7c8c-8011-aadd-5fe15a2a2a5d
    // Set initial styles
    fallingPart.style.transform = 'translateY(0)';
    fallingPart.style.transition = 'transform 3s ease-in-out';

    // Force reflow to apply initial styles
    void fallingPart.offsetWidth; // or fallingPart.getBoundingClientRect();

    // Apply the transformation
    fallingPart.style.transform = `translateY(${window.innerHeight}px)`;

    // Remove elements after animation
    setTimeout(() => {
        part1.remove();
    }, 10000);
}

// New projection helper
function projectToEdge(point, edge) {
    return {
        left: {x: 0, y: point.y},
        right: {x: 100, y: point.y},
        top: {x: point.x, y: 0},
        bottom: {x: point.x, y: 100}
    }[edge];
}

function getNearestEdge(point, rect) {
    const distances = {
        left: point.x,
        right: 100 - point.x,
        top: point.y,
        bottom: 100 - point.y
    };
    return Object.keys(distances).reduce((a, b) => 
        distances[a] < distances[b] ? a : b
    );
}

function createPathPolygon(points, startEdge, endEdge, startProj, endProj) {
    // if startEdge and endEdge are the same, we can use a simple polygon
    if (startEdge === endEdge) {
        return `polygon(
            ${startProj.x}% ${startProj.y}%,
            ${points.map(p => `${p.x}% ${p.y}%`).join(",")},
            ${endProj.x}% ${endProj.y}%
        )`;
    }

    const startCorner = getCornerPoints(startEdge);
    const endCorner = getCornerPoints(endEdge);

    // if startCorner and endCorner share a corner, we can use a simple polygon
    const sharedCorner = startCorner.find(c => endCorner.includes(c));
    if (sharedCorner) {
        return `polygon(
            ${startProj.x}% ${startProj.y}%,
            ${points.map(p => `${p.x}% ${p.y}%`).join(",")},
            ${endProj.x}% ${endProj.y}%,
            ${sharedCorner}
        )`;
    }

    // Otherwise, we need to create a more complex polygon
    const polygon1 = `polygon(
        ${startCorner[1]},
        ${startProj.x}% ${startProj.y}%,
        ${points.map(p => `${p.x}% ${p.y}%`).join(",")},
        ${endProj.x}% ${endProj.y}%,
        ${endCorner[1]}
    )`;

    const polygon0 = `polygon(
        ${startCorner[0]},
        ${startProj.x}% ${startProj.y}%,
        ${points.map(p => `${p.x}% ${p.y}%`).join(",")},
        ${endProj.x}% ${endProj.y}%,
        ${endCorner[0]}
    )`;
    const area1 = calculatePolygonArea(polygon1);
    const area0 = calculatePolygonArea(polygon0);

    return area1 < area0 ? polygon1 : polygon0;
}

function createInversePathPolygon(points, startEdge, endEdge, startProj, endProj) {
    // if startEdge and endEdge are the same, we need to add all other corners
    if (startEdge === endEdge) {
        const otherCorners = getCornersStartingFrom(startEdge);
        const polygon1 = `polygon(
            ${startProj.x}% ${startProj.y}%,
            ${points.map(p => `${p.x}% ${p.y}%`).join(",")},
            ${endProj.x}% ${endProj.y}%,
            ${otherCorners.join(",")}
        )`;
        const polygon0 = `polygon(
            ${startProj.x}% ${startProj.y}%,
            ${points.map(p => `${p.x}% ${p.y}%`).join(",")},
            ${endProj.x}% ${endProj.y}%,
            ${otherCorners.reverse().join(",")}
        )`;
        // keep the one with the smallest area
        const area1 = calculatePolygonArea(polygon1);
        const area0 = calculatePolygonArea(polygon0);
        return area1 < area0 ? polygon1 : polygon0;
    }

    const startCorner = getCornerPoints(startEdge);
    const endCorner = getCornerPoints(endEdge);

    // if startCorner and endCorner share a corner, we can use a simple polygon
    const sharedCorner = startCorner.find(c => endCorner.includes(c));
    if (sharedCorner) {
        const otherCorners = getCornersStartingFrom(startEdge).filter(c => c !== sharedCorner);
        const polygon1 =  `polygon(
            ${startProj.x}% ${startProj.y}%,
            ${points.map(p => `${p.x}% ${p.y}%`).join(",")},
            ${endProj.x}% ${endProj.y}%,
            ${otherCorners.join(",")}
        )`;
        const polygon0 = `polygon(
            ${startProj.x}% ${startProj.y}%,
            ${points.map(p => `${p.x}% ${p.y}%`).join(",")},
            ${endProj.x}% ${endProj.y}%,
            ${otherCorners.reverse().join(",")}
        )`;
        // keep the one with the largest area
        const area1 = calculatePolygonArea(polygon1);
        const area0 = calculatePolygonArea(polygon0);
        return area1 > area0 ? polygon1 : polygon0;
    }

    // Otherwise, we need to create a more complex polygon
    // TODO: bug for cuts on the left or top of objects with this mode: where nothing is hidden
    const polygon1 = `polygon(
        ${startCorner[1]},
        ${startProj.x}% ${startProj.y}%,
        ${points.map(p => `${p.x}% ${p.y}%`).join(",")},
        ${endProj.x}% ${endProj.y}%,
        ${endCorner[1]}
    )`;

    const polygon0 = `polygon(
        ${startCorner[0]},
        ${startProj.x}% ${startProj.y}%,
        ${points.map(p => `${p.x}% ${p.y}%`).join(",")},
        ${endProj.x}% ${endProj.y}%,
        ${endCorner[0]}
    )`;
    const area1 = calculatePolygonArea(polygon1);
    const area0 = calculatePolygonArea(polygon0);
    
    return area1 > area0 ? polygon1 : polygon0;
}

function getCornerPoints(edge) {
    const corners = {
        left: ["0% 0%", "0% 100%"],
        right: ["100% 0%", "100% 100%"],
        top: ["0% 0%", "100% 0%"],
        bottom: ["0% 100%", "100% 100%"]
    };
    return corners[edge];
}
function getCornersStartingFrom(startEdge) {
    const corners = {
        left: ["0% 0%", "100% 0%", "100% 100%", "0% 100%"],
        right: ["100% 100%", "0% 100%", "0% 0%", "100% 0%"],
        top: ["100% 0%", "100% 100%", "0% 100%", "0% 0%"],
        bottom: ["0% 100%", "0% 0%", "100% 0%", "100% 100%"]
    };
    return corners[startEdge];
}

function calculateArea(element) {
    const polygon = element.style.clipPath;
    return calculatePolygonArea(polygon);
}

function calculatePolygonArea(polygon) {
    const points = polygon.match(/[\d.]+%/g).map(v => parseFloat(v));
    // group points into pairs
    const pairs = [];
    for (let i = 0; i < points.length; i += 2) {
        pairs.push({ x: points[i], y: points[i + 1] });
    }
    // calculate area using the shoelace formula
    let area = 0;
    for (let i = 0; i < pairs.length; i++) {
        const j = (i + 1) % pairs.length;
        area += pairs[i].x * pairs[j].y;
        area -= pairs[j].x * pairs[i].y;
    }
    area = Math.abs(area) / 2;
    return area;
}