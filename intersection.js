import { CONFIG, CENTER, HALF_INTER, LANE_WIDTH, N, E, S, W, LEFT, RIGHT, STRAIGHT } from "./constants.js";

const { x: CX, y: CY } = CENTER;
const DEFAULT_STEPS = 28;

// Lane offset from road centerline: lane 0 (left) = -15, lane 1 (right) = +15 (when facing the intersection)
function laneOffset(laneIndex) {
    return (laneIndex === 0 ? -1 : +1) * (LANE_WIDTH / 2); // -15 or +15
}

// Given approach road + laneIndex, return the (x,y) of the lane center at the intersection edge (entry)
export function entryPoint(roadID, laneIndex) {
    const o = laneOffset(laneIndex);
    switch (roadID) {
        case N: return { x: CX + o, y: CY - HALF_INTER }; // coming down (+y)
        case S: return { x: CX - o, y: CY + HALF_INTER }; // going up (-y)
        case E: return { x: CX + HALF_INTER, y: CY + o }; // going left (-x)
        case W: return { x: CX - HALF_INTER, y: CY - o }; // going right (+x)
        default: throw new Error('Bad roadID');
    }
}

// Given exit road + laneIndex, return the (x,y) just outside the intersection (exit point to land on)
export function exitPoint(roadID, laneIndex) {
    const o = laneOffset(laneIndex);
    switch (roadID) {
        case N: return { x: CX - o, y: CY - HALF_INTER }; // up
        case S: return { x: CX + o, y: CY + HALF_INTER }; // down
        case E: return { x: CX + HALF_INTER, y: CY - o }; // right
        case W: return { x: CX - HALF_INTER, y: CY + o }; // left
        default: throw new Error('Bad roadID');
    }
}

// Utility: build an arc path by center (cx,cy), radius R, from angle A0 to A1 inclusive.
function buildArcPath(cx, cy, R, A0, A1, steps = DEFAULT_STEPS) {
    const path = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = A0 + t * (A1 - A0);
        path.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
    }
    return path;
}

// Utility: build straight line path from P0 to P1
function buildLinePath(x0, y0, x1, y1, steps = DEFAULT_STEPS) {
    const path = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        path.push({ x: x0 + t * (x1 - x0), y: y0 + t * (y1 - y0) });
    }
    return path;
}

const R_RIGHT = HALF_INTER - (LANE_WIDTH / 2); // 45
const R_LEFT = HALF_INTER + (LANE_WIDTH / 2); // 75

const NE = { cx: CX + HALF_INTER, cy: CY - HALF_INTER };
const SE = { cx: CX + HALF_INTER, cy: CY + HALF_INTER };
const SW = { cx: CX - HALF_INTER, cy: CY + HALF_INTER };
const NW = { cx: CX - HALF_INTER, cy: CY - HALF_INTER };

// Build a path and hard-append the exact exit lane point as the final node for snapping.
function withExitSnap(path, roadOut, laneOut) {
    const ep = exitPoint(roadOut, laneOut);
    const last = path[path.length - 1];
    const dx = ep.x - last.x, dy = ep.y - last.y;
    // If not already very close, append a short straight segment to land exactly on the lane center
    if (dx * dx + dy * dy > 1) {
        const tail = buildLinePath(last.x, last.y, ep.x, ep.y, 4);
        tail.shift(); // avoid duplicate
        return path.concat(tail);
    }
    return path;
}

// Straight paths (N↔S, E↔W) for each lane (0,1)
function straightPath(from, to, laneIndex) {
    const a = entryPoint(from, laneIndex);
    // For straight, exit lane index = same index, but opposite side horizontally mirrored
    const b = exitPoint(to, laneIndex);
    return buildLinePath(a.x, a.y, b.x, b.y);
}

// Right-turn paths (quarter-circle, radius 45)
function rightTurnPath(from, laneIndex) {
    switch (from) {
        case N: {
            const base = buildArcPath(NE.cx, NE.cy, R_RIGHT, Math.PI, 1.5 * Math.PI);
            return withExitSnap(base, E, /* right lane by default */ 1);
        }
        case E: {
            const base = buildArcPath(SE.cx, SE.cy, R_RIGHT, -0.5 * Math.PI, 0);
            return withExitSnap(base, S, 1);
        }
        case S: {
            const base = buildArcPath(SW.cx, SW.cy, R_RIGHT, 0, 0.5 * Math.PI);
            return withExitSnap(base, W, 1);
        }
        case W: {
            const base = buildArcPath(NW.cx, NW.cy, R_RIGHT, 0.5 * Math.PI, Math.PI);
            return withExitSnap(base, N, 1);
        }
        default: throw new Error('Bad road for right turn');
    }
}

// Left-turn paths (quarter-circle, radius 75)
function leftTurnPath(from, laneIndex) {
    switch (from) {
        case N: {
            const base = buildArcPath(NW.cx, NW.cy, R_LEFT, 0, -0.5 * Math.PI);
            return withExitSnap(base, W, /* target lane default */ 0);
        }
        case E: {
            const base = buildArcPath(NE.cx, NE.cy, R_LEFT, 0.5 * Math.PI, Math.PI);
            return withExitSnap(base, N, 0);
        }
        case S: {
            const base = buildArcPath(SE.cx, SE.cy, R_LEFT, -Math.PI, -0.5 * Math.PI);
            return withExitSnap(base, E, 0);
        }
        case W: {
            const base = buildArcPath(SW.cx, SW.cy, R_LEFT, Math.PI, 0.5 * Math.PI);
            return withExitSnap(base, S, 0);
        }
        default: throw new Error('Bad road for left turn');
    }
}

// Registry: get path by origin/destination
export function getTurnType(from, to) {
    if (from === to) return null;
    if ((from === N && to === E) || (from === E && to === S) || (from === S && to === W) || (from === W && to === N)) return RIGHT;
    if ((from === N && to === W) || (from === W && to === S) || (from === S && to === E) || (from === E && to === N)) return LEFT;
    return STRAIGHT; // N<->S or E<->W
}

export function buildPath(from, to, laneIndex = 1) {
    const t = getTurnType(from, to);
    if (t === RIGHT) return rightTurnPath(from, laneIndex);
    if (t === LEFT) return leftTurnPath(from, laneIndex);
    // Straight
    return straightPath(from, to, laneIndex);
}

export function withCumulativeLengths(path) {
    let total = 0;
    const lens = [0];
    for (let i = 1; i < path.length; i++) {
        const dx = path[i].x - path[i - 1].x;
        const dy = path[i].y - path[i - 1].y;
        total += Math.hypot(dx, dy);
        lens.push(total);
    }
    return { path, lens, total };
}

export class Intersection {
    constructor(centerX, centerY) {
        this.centerX = centerX;
        this.centerY = centerY;
        this.size = CONFIG.INTERSECTION_SIZE;
        this.roadWidth = CONFIG.ROAD_WIDTH;
        this.laneWidth = CONFIG.LANE_WIDTH;
        this.calculatePositions();
    }

    initialize() {
        this.calculatePositions();
    }

    calculatePositions() {
        const halfSize = this.size / 2;
        const halfRoad = this.roadWidth / 2;
        const laneOffset = this.laneWidth / 2;

        // Stop line positions (before intersection, always close to center)
        const stopLineOffset = halfSize + 5;
        this.stopLines = {
            [CONFIG.DIRECTIONS.NORTH]: {
                x1: this.centerX - halfRoad,
                y1: this.centerY - stopLineOffset,
                x2: this.centerX + halfRoad,
                y2: this.centerY - stopLineOffset
            },
            [CONFIG.DIRECTIONS.EAST]: {
                x1: this.centerX + stopLineOffset,
                y1: this.centerY - halfRoad,
                x2: this.centerX + stopLineOffset,
                y2: this.centerY + halfRoad
            },
            [CONFIG.DIRECTIONS.SOUTH]: {
                x1: this.centerX - halfRoad,
                y1: this.centerY + stopLineOffset,
                x2: this.centerX + halfRoad,
                y2: this.centerY + stopLineOffset
            },
            [CONFIG.DIRECTIONS.WEST]: {
                x1: this.centerX - stopLineOffset,
                y1: this.centerY - halfRoad,
                x2: this.centerX - stopLineOffset,
                y2: this.centerY + halfRoad
            }
        };

        // Traffic light positions
        this.lightPositions = {
            [CONFIG.DIRECTIONS.NORTH]: {
                x: this.centerX - 25,
                y: this.centerY - halfSize - 40
            },
            [CONFIG.DIRECTIONS.EAST]: {
                x: this.centerX + halfSize + 15,
                y: this.centerY - 25
            },
            [CONFIG.DIRECTIONS.SOUTH]: {
                x: this.centerX + 25,
                y: this.centerY + halfSize + 15
            },
            [CONFIG.DIRECTIONS.WEST]: {
                x: this.centerX - halfSize - 40,
                y: this.centerY + 25
            }
        };

        // Car spawn points
        this.spawnPoints = {
            [CONFIG.DIRECTIONS.NORTH]: {
                x: this.centerX - laneOffset, // Right lane for cars going south
                y: 0
            },
            [CONFIG.DIRECTIONS.EAST]: {
                x: CONFIG.CANVAS_WIDTH,
                y: this.centerY - laneOffset // Right lane for cars going west
            },
            [CONFIG.DIRECTIONS.SOUTH]: {
                x: this.centerX + laneOffset, // Right lane for cars going north
                y: CONFIG.CANVAS_HEIGHT
            },
            [CONFIG.DIRECTIONS.WEST]: {
                x: 0,
                y: this.centerY + laneOffset // Right lane for cars going east
            }
        };

        // Exit points - these are for straight-through traffic
        this.exitPoints = {
            [CONFIG.DIRECTIONS.NORTH]: {
                x: this.centerX + laneOffset,
                y: 0
            },
            [CONFIG.DIRECTIONS.EAST]: {
                x: CONFIG.CANVAS_WIDTH,
                y: this.centerY + laneOffset
            },
            [CONFIG.DIRECTIONS.SOUTH]: {
                x: this.centerX - laneOffset,
                y: CONFIG.CANVAS_HEIGHT
            },
            [CONFIG.DIRECTIONS.WEST]: {
                x: 0,
                y: this.centerY - laneOffset
            }
        };
    }

    render(ctx) {
        this.drawRoads(ctx);
        this.drawIntersection(ctx);
        this.drawLaneMarkings(ctx);
        this.drawStopLines(ctx);
    }

    drawRoads(ctx) {
        const halfRoad = this.roadWidth / 2;

        ctx.fillStyle = '#444444';

        // Vertical road (North-South)
        ctx.fillRect(
            this.centerX - halfRoad,
            0,
            this.roadWidth,
            CONFIG.CANVAS_HEIGHT
        );

        // Horizontal road (East-West)
        ctx.fillRect(
            0,
            this.centerY - halfRoad,
            CONFIG.CANVAS_WIDTH,
            this.roadWidth
        );
    }

    drawIntersection(ctx) {
        const halfRoad = this.roadWidth / 2;
        const curveRadius = halfRoad; // Makes the inward curve meet nicely

        ctx.fillStyle = '#666666';
        ctx.beginPath();

        // Start top middle going clockwise
        ctx.moveTo(this.centerX - halfRoad, this.centerY - halfRoad - curveRadius);

        // Top left inward curve
        ctx.quadraticCurveTo(
            this.centerX - halfRoad, this.centerY - halfRoad,
            this.centerX - halfRoad - curveRadius, this.centerY - halfRoad
        );

        // Left top to left bottom
        ctx.lineTo(this.centerX - halfRoad - curveRadius, this.centerY + halfRoad);

        // Bottom left inward curve
        ctx.quadraticCurveTo(
            this.centerX - halfRoad, this.centerY + halfRoad,
            this.centerX - halfRoad, this.centerY + halfRoad + curveRadius
        );

        // Bottom middle to bottom right
        ctx.lineTo(this.centerX + halfRoad, this.centerY + halfRoad + curveRadius);

        // Bottom right inward curve
        ctx.quadraticCurveTo(
            this.centerX + halfRoad, this.centerY + halfRoad,
            this.centerX + halfRoad + curveRadius, this.centerY + halfRoad
        );

        // Right bottom to right top
        ctx.lineTo(this.centerX + halfRoad + curveRadius, this.centerY - halfRoad);

        // Top right inward curve
        ctx.quadraticCurveTo(
            this.centerX + halfRoad, this.centerY - halfRoad,
            this.centerX + halfRoad, this.centerY - halfRoad - curveRadius
        );

        // Back to start
        ctx.closePath();
        ctx.fill();

        // Restore normal drawing mode for anything after
        ctx.globalCompositeOperation = 'source-over';
    }

    drawLaneMarkings(ctx) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 10]);

        const halfRoad = this.roadWidth / 2;

        // Vertical center line (North-South road)
        ctx.beginPath();
        ctx.moveTo(this.centerX, 0);
        ctx.lineTo(this.centerX, this.centerY - halfRoad);
        ctx.moveTo(this.centerX, this.centerY + halfRoad);
        ctx.lineTo(this.centerX, CONFIG.CANVAS_HEIGHT);
        ctx.stroke();

        // Horizontal center line (East-West road)
        ctx.beginPath();
        ctx.moveTo(0, this.centerY);
        ctx.lineTo(this.centerX - halfRoad, this.centerY);
        ctx.moveTo(this.centerX + halfRoad, this.centerY);
        ctx.lineTo(CONFIG.CANVAS_WIDTH, this.centerY);
        ctx.stroke();

        ctx.setLineDash([]);
    }

    drawStopLines(ctx) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;

        Object.values(this.stopLines).forEach(line => {
            ctx.beginPath();
            ctx.moveTo(line.x1, line.y1);
            ctx.lineTo(line.x2, line.y2);
            ctx.stroke();
        });
    }

    // Helper methods for car navigation
    getStopLinePosition(direction) {
        return this.stopLines[direction];
    }

    getLightPosition(direction) {
        if (!direction || typeof direction !== 'string') {
            console.warn("Invalid direction for getLightPosition:", direction);
            return undefined;
        }
        return this.lightPositions[direction];
    }

    // Check if a point is within the intersection
    isInIntersection(x, y) {
        const halfRoad = this.roadWidth / 2;
        return (
            x >= this.centerX - halfRoad &&
            x <= this.centerX + halfRoad &&
            y >= this.centerY - halfRoad &&
            y <= this.centerY + halfRoad
        );
    }

    setCarManager(carManager) {
        this.carManager = carManager;
    }

    getAllCars() {
        return this.carManager ? this.carManager.getCars() : [];
    }
}