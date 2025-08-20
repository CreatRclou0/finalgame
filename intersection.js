import { CONFIG } from "./config.js";
export class Intersection {
    getPathEntryPoint(direction) {
        // Entry point for Bezier curve (lane center at intersection edge)
        const halfRoad = this.roadWidth / 2;
        const laneOffset = this.laneWidth / 2;
        switch (direction) {
            case CONFIG.DIRECTIONS.NORTH:
                return { x: this.centerX - laneOffset, y: this.centerY - halfRoad };
            case CONFIG.DIRECTIONS.EAST:
                return { x: this.centerX + halfRoad, y: this.centerY - laneOffset };
            case CONFIG.DIRECTIONS.SOUTH:
                return { x: this.centerX + laneOffset, y: this.centerY + halfRoad };
            case CONFIG.DIRECTIONS.WEST:
                return { x: this.centerX - halfRoad, y: this.centerY + laneOffset };
            default:
                return { x: this.centerX, y: this.centerY };
        }
    }
    constructor(centerX, centerY) {
        this.centerX = 600;
        this.centerY = 600;
        this.size = 120; // px
        this.roadWidth = 60; // px
        this.laneWidth = 30; // px
        this.calculatePositions();

        // Lane centerlines for each approach (2 lanes per road)
        this.laneCenters = {
            north: [this.centerX - this.laneWidth / 2, this.centerX + this.laneWidth / 2],
            south: [this.centerX + this.laneWidth / 2, this.centerX - this.laneWidth / 2],
            east:  [this.centerY - this.laneWidth / 2, this.centerY + this.laneWidth / 2],
            west:  [this.centerY + this.laneWidth / 2, this.centerY - this.laneWidth / 2]
        };

        // Precompute all 12 trajectories (from each direction, left/straight/right)
        this.trajectories = {};
        const dirs = ['north', 'east', 'south', 'west'];
        for (const from of dirs) {
            for (const turn of ['left', 'straight', 'right']) {
                const to = this.getToDirection(from, turn);
                this.trajectories[`${from}_${to}`] = this.computeTrajectory(from, to, turn);
            }
        }
    }
    // Helper to get destination direction for a turn
    getToDirection(from, turn) {
        const dirs = ['north', 'east', 'south', 'west'];
        const idx = dirs.indexOf(from);
        if (turn === 'straight') return dirs[(idx + 2) % 4];
        if (turn === 'right') return dirs[(idx + 1) % 4];
        if (turn === 'left') return dirs[(idx + 3) % 4];
        return from;
    }

    // Compute trajectory for a given movement
    computeTrajectory(from, to, turn) {
        // Entry/exit points for each direction
        const entry = this.getPathEntryPoint(from);
        const exit = this.exitPoints[to];
        if (turn === 'straight') {
            // Straight: simple line
            return [entry, exit];
        }
        // For left/right, use quarter-circle arc
        const radius = this.roadWidth; // 60 px
        let cx, cy, startAngle, endAngle;
        if (from === 'south' && to === 'east' && turn === 'right') {
            // Example: South→East right turn (quarter-circle)
            cx = this.centerX + radius;
            cy = this.centerY + radius;
            startAngle = Math.PI;
            endAngle = Math.PI * 1.5;
        } else if (from === 'north' && to === 'west' && turn === 'left') {
            // Example: North→West left turn (quarter-circle)
            cx = this.centerX - radius;
            cy = this.centerY - radius;
            startAngle = 0;
            endAngle = Math.PI * 0.5;
        } else {
            // Generalize for other turns
            // Use entry/exit and intersection center to estimate arc
            const midAngle = Math.atan2(exit.y - this.centerY, exit.x - this.centerX);
            cx = this.centerX;
            cy = this.centerY;
            startAngle = Math.atan2(entry.y - cy, entry.x - cx);
            endAngle = Math.atan2(exit.y - cy, exit.x - cx);
        }
        // Generate points along arc
        const points = [];
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const angle = startAngle + (endAngle - startAngle) * t;
            points.push({
                x: cx + radius * Math.cos(angle),
                y: cy + radius * Math.sin(angle)
            });
        }
        return points;
    }

    // Get trajectory for a route
    getTrajectory(from, to) {
        return this.trajectories[`${from}_${to}`];
    }

    initialize() {
        this.calculatePositions();
    }

    calculatePositions() {
        const halfSize = this.size / 2;
        const halfRoad = this.roadWidth / 2;
        const laneOffset = this.laneWidth / 2;
        
        // Stop line positions (before intersection)
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

    getSpawnPoint(direction) {
        const offset = 300; // Adjust as needed for your canvas
        switch (direction) {
            case 'north': return { x: this.centerX, y: this.centerY - offset };
            case 'south': return { x: this.centerX, y: this.centerY + offset };
            case 'east':  return { x: this.centerX + offset, y: this.centerY };
            case 'west':  return { x: this.centerX - offset, y: this.centerY };
            default: return undefined;
        }
    }

    getExitPoint(direction) {
        const offset = 300; // Adjust as needed for your canvas
        switch (direction) {
            case 'north': return { x: this.centerX, y: this.centerY - offset };
            case 'south': return { x: this.centerX, y: this.centerY + offset };
            case 'east':  return { x: this.centerX + offset, y: this.centerY };
            case 'west':  return { x: this.centerX - offset, y: this.centerY };
            default: return undefined;
        }
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

    // Get proper exit point based on turn type to ensure correct lane usage
    // ...existing code...
    getProperExitPoint(fromDirection, toDirection, turnType) {
        const laneOffset = this.laneWidth / 2;

        // Improved turn logic based on your description
        // Removed turning logic
        return this.exitPoints[toDirection];
    }

    // Get turning path for straight-line turns (no curves)
    // Example: get path for left, right, straight
    // intersection.getTrajectory('north', 'west') // left
    // intersection.getTrajectory('south', 'east') // right
        // intersection.getTrajectory('east', 'west') // straight
    setCarManager(carManager) {
        this.carManager = carManager;
    }
}