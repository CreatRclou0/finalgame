import { CONFIG } from "./config.js";
import { utils } from './utils.js';
import { buildPath, withCumulativeLengths, getTurnType, N, E, S, W } from './intersection.js';
import { STRAIGHT, LEFT, RIGHT } from './constants.js';

export class Car {
    constructor({ id, direction, intersection, route = null, lane = 0, turnType = null }) {
        this.id = id;
        this.fromDirection = direction;
        this.intersection = intersection;
        
        // Generate random destination if not provided
        if (!route) {
            const destinations = [N, E, S, W].filter(d => d !== direction);
            const randomDestination = destinations[Math.floor(Math.random() * destinations.length)];
            this.route = { from: direction, to: randomDestination };
        } else {
            this.route = route;
        }
        
        this.lane = lane; // 0 = left, 1 = right
        this.lateralPosition = 0;
        this.turnType = turnType || getTurnType(this.route.from, this.route.to);
        this.toDirection = this.route.to;

        // Path following for turns
        this.path = null;
        this.pathProgress = 0;
        this.pathProfile = null;
        this.hasAssignedPath = false;

        // Position and movement
        const spawnPoint = intersection.spawnPoints[direction];
        this.x = spawnPoint.x;
        this.y = spawnPoint.y;
        this.angle = this.getInitialAngle();

        // Properties
        this.speed = 0;
        this.maxSpeed = CONFIG.DEFAULT_SETTINGS?.CAR_SPEED || 80;
        this.width = CONFIG.CAR_WIDTH;
        this.height = CONFIG.CAR_HEIGHT;
        this.color = CONFIG.CAR_COLORS[Math.floor(Math.random() * CONFIG.CAR_COLORS.length)];

        // State
        this.state = 'approaching';
        this.waitStartTime = null;
        this.totalWaitTime = 0;
        this.isInIntersection = false;
        this.pathProgress = 0;

        this.calculateTargetPosition();
    }

    beginTurnIfNeeded() {
        if (this.hasAssignedPath) return;
        
        const turnType = getTurnType(this.route.from, this.route.to);
        if (!turnType) return;

        if (turnType === STRAIGHT) {
            // For straight, we can use existing angle-based movement or assign a path
            // Let's use a path for consistency
            const p = buildPath(this.route.from, this.route.to, this.lane);
            this.pathProfile = withCumulativeLengths(p);
            this.path = p;
            this.pathProgress = 0;
            this.hasAssignedPath = true;
            return;
        }

        // For LEFT/RIGHT, assign a path
        const p = buildPath(this.route.from, this.route.to, this.lane);
        this.pathProfile = withCumulativeLengths(p);
        this.path = p;
        this.pathProgress = 0;
        this.hasAssignedPath = true;
    }

    prepareForTurn() {
        // Tactical lane change before intersection
        if (this.turnType === LEFT) this.lane = 0;
        else if (this.turnType === RIGHT) this.lane = 1;
        // For straight, stay in current lane
    }

    update(deltaTime, lightStates) {
        const dt = deltaTime / 1000; // Convert to seconds
        
        // Handle state transitions
        switch (this.state) {
            case 'approaching':
                this.updateApproaching(dt, lightStates);
                break;
            case 'waiting':
                this.updateWaiting(dt, lightStates);
                break;
            case 'crossing':
                this.updateCrossing(dt);
                break;
            case 'exiting':
                this.updateExiting(dt);
                break;
        }

        // Update position based on path or angle
        if (this.path) {
            // --- Turning along a polyline with cumulative lengths ---
            const prof = this.pathProfile;
            // Advance distance along the path by speed*dt
            const advance = this.speed * dt;
            // Convert current pathProgress (0..1) to absolute distance s:
            const sCurrent = prof.total * this.pathProgress;
            let sNew = sCurrent + advance;

            if (sNew >= prof.total) {
                // Reached end of path
                const last = prof.path[prof.path.length - 1];
                this.x = last.x;
                this.y = last.y;

                // Snap heading to exit lane direction (compute from last segment)
                const prev = prof.path[prof.path.length - 2] || last;
                this.angle = Math.atan2(last.y - prev.y, last.x - prev.x);

                // Clear path & resume straight driving
                this.path = null;
                this.pathProfile = null;
                this.pathProgress = 0;
                return;
            }

            // Find segment index for sNew
            const lens = prof.lens;
            let i = 0;
            while (i < lens.length && lens[i] < sNew) i++;
            const i1 = Math.min(i, lens.length - 1);
            const i0 = Math.max(0, i1 - 1);

            const s0 = lens[i0], s1 = lens[i1];
            const segT = s1 > s0 ? (sNew - s0) / (s1 - s0) : 0;

            const p0 = prof.path[i0], p1 = prof.path[i1];
            this.x = p0.x + segT * (p1.x - p0.x);
            this.y = p0.y + segT * (p1.y - p0.y);
            this.angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);

            // Normalize back to [0..1]
            this.pathProgress = sNew / prof.total;
        } else {
            // --- Existing straight-line motion ---
            this.x += Math.cos(this.angle) * this.speed * dt;
            this.y += Math.sin(this.angle) * this.speed * dt;
        }

        // Check if car is in intersection
        this.isInIntersection = this.intersection.isInIntersection(this.x, this.y);
    }
    
    getInitialAngle() {
        switch (this.fromDirection) {
            case CONFIG.DIRECTIONS.NORTH: return Math.PI / 2; // Facing south (down)
            case CONFIG.DIRECTIONS.EAST: return Math.PI; // Facing west (left)
            case CONFIG.DIRECTIONS.SOUTH: return -Math.PI / 2; // Facing north (up)
            case CONFIG.DIRECTIONS.WEST: return 0; // Facing east (right)
            default: return 0;
        }
    }

    calculateTargetPosition() {
        // Make sure intersection and fromDirection are valid
        if (this.intersection && this.fromDirection) {
            // Target is now based on the route destination
            const target = this.intersection.exitPoints[this.toDirection];
            if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
                console.warn("Target position is undefined or invalid for car", this.id);
                return;
            }
            this.targetX = target.x;
            this.targetY = target.y;
        } else {
            console.warn("intersection or direction is missing");
        }
    }

    updateApproaching(dt, lightStates) {
        this.prepareForTurn();
        
        const stopLine = this.intersection.getStopLinePosition(this.fromDirection);
        const distanceToStop = this.getDistanceToStopLine(stopLine);
        
        // Check for cars ahead to maintain spacing
        const carAhead = this.checkForCarAhead();
        const shouldStop = carAhead && this.getDistanceToCarAhead(carAhead) < 35;
        
        if (distanceToStop <= 30 || shouldStop) {
            // Close to stop line, check if we should stop
            if (lightStates[this.fromDirection] === CONFIG.LIGHT_STATES.RED || shouldStop) {
                this.state = 'waiting';
                this.speed = 0;
                if (!shouldStop) {
                    this.waitStartTime = Date.now();
                }
                return;
            }
        }
        
        // Continue approaching
        this.speed = Math.min(this.maxSpeed, this.speed + 30 * dt); // Gradual acceleration
        
        // Check if we've reached the intersection
        if (this.isInIntersection) {
            this.state = 'crossing';
            // Assign path when entering intersection
            if (!this.hasAssignedPath) {
                this.beginTurnIfNeeded();
            }
        }
    }

    updateWaiting(dt, lightStates) {
        this.speed = 0;
        
        if (this.waitStartTime) {
            this.totalWaitTime = Date.now() - this.waitStartTime;
        }
        
        // Check if light turned green
        if (lightStates[this.fromDirection] === CONFIG.LIGHT_STATES.GREEN || 
            lightStates[this.fromDirection] === CONFIG.LIGHT_STATES.YELLOW) {
            this.state = 'crossing';
            this.waitStartTime = null;
        }
    }

    updateCrossing(dt) {
        // Accelerate through intersection
        this.speed = Math.min(this.maxSpeed * 1.2, this.speed + 40 * dt);
        
        // Check if we've exited the intersection
        if (!this.isInIntersection) {
            this.state = 'exiting';
        }
    }

    getTargetExitAngle() {
        switch (this.toDirection) {
            case CONFIG.DIRECTIONS.NORTH: return -Math.PI / 2; // Facing up
            case CONFIG.DIRECTIONS.EAST: return 0; // Facing right
            case CONFIG.DIRECTIONS.SOUTH: return Math.PI / 2; // Facing down
            case CONFIG.DIRECTIONS.WEST: return Math.PI; // Facing left
            default: return this.angle;
        }
    }

    updateExiting(dt) {
        // Assign lane after turn
        if (this.turnType === LEFT) this.lane = 0;
        else if (this.turnType === RIGHT) this.lane = 1;
        // For straight, keep lane
        this.lateralPosition = 0; // Center in lane

        // Update route to next segment (simulate route progression)
        if (this.route && this.route.length > 1) {
            this.route = this.route.slice(1);
        }

        // Continue moving at normal speed in the direction we're facing
        this.speed = this.maxSpeed;

        // Check if we've reached the edge of the canvas
        let hasExited = false;

        // Check if car has exited based on canvas boundaries
        hasExited = this.x < -50 || this.x > CONFIG.CANVAS_WIDTH + 50 || 
                   this.y < -50 || this.y > CONFIG.CANVAS_HEIGHT + 50;

        if (hasExited) {
            this.state = 'completed';
        }
    }

    getDistanceToStopLine(stopLine) {
        // Calculate distance from car to stop line
        switch (this.fromDirection) {
            case CONFIG.DIRECTIONS.NORTH:
                return Math.abs(this.y - stopLine.y1);
            case CONFIG.DIRECTIONS.EAST:
                return Math.abs(this.x - stopLine.x1);
            case CONFIG.DIRECTIONS.SOUTH:
                return Math.abs(this.y - stopLine.y1);
            case CONFIG.DIRECTIONS.WEST:
                return Math.abs(this.x - stopLine.x1);
            default:
                return 0;
        }
    }

    render(ctx) {
        ctx.save();
        // Move to car position and rotate
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        // Draw car body
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
        // Draw car details
        ctx.fillStyle = '#333333';
        ctx.fillRect(-this.width / 2 + 2, -this.height / 2 + 2, this.width - 4, 3); // Windshield
        ctx.fillRect(-this.width / 2 + 2, this.height / 2 - 5, this.width - 4, 3); // Rear window
        ctx.restore();
    }

    // Getters for external systems
    isWaiting() {
        return this.state === 'waiting';
    }

    isCompleted() {
        return this.state === 'completed';
    }

    getWaitTime() {
        return this.totalWaitTime;
    }

    getDirection() {
        return this.fromDirection;
    }

    checkForCarAhead() {
        // Get all cars from the car manager through intersection
        const allCars = this.intersection.carManager ? this.intersection.carManager.getCars() : [];
        
        let closestCar = null;
        let closestDistance = Infinity;
        
        for (const otherCar of allCars) {
            if (otherCar.id === this.id || otherCar.fromDirection !== this.fromDirection) {
                continue; // Skip self and cars from different directions
            }
            
            // Check if the other car is ahead of this car
            let isAhead = false;
            let distance = 0;
            
            switch (this.fromDirection) {
                case CONFIG.DIRECTIONS.NORTH:
                    isAhead = otherCar.y > this.y;
                    distance = otherCar.y - this.y;
                    break;
                case CONFIG.DIRECTIONS.EAST:
                    isAhead = otherCar.x < this.x;
                    distance = this.x - otherCar.x;
                    break;
                case CONFIG.DIRECTIONS.SOUTH:
                    isAhead = otherCar.y < this.y;
                    distance = this.y - otherCar.y;
                    break;
                case CONFIG.DIRECTIONS.WEST:
                    isAhead = otherCar.x > this.x;
                    distance = otherCar.x - this.x;
                    break;
            }
            
            if (isAhead && distance > 0 && distance < closestDistance) {
                closestDistance = distance;
                closestCar = otherCar;
            }
        }
        
        return closestCar;
    }

    getDistanceToCarAhead(carAhead) {
        if (!carAhead) return Infinity;
        
        switch (this.fromDirection) {
            case CONFIG.DIRECTIONS.NORTH:
                return carAhead.y - this.y;
            case CONFIG.DIRECTIONS.EAST:
                return this.x - carAhead.x;
            case CONFIG.DIRECTIONS.SOUTH:
                return this.y - carAhead.y;
            case CONFIG.DIRECTIONS.WEST:
                return carAhead.x - this.x;
            default:
                return Infinity;
        }
    }
}

export class CarManager {
    constructor(intersection) {
        this.intersection = intersection;
        this.cars = [];
        this.nextCarId = 1;
        this.spawnTimer = 0;
        this.settings = { ...CONFIG.DEFAULT_SETTINGS };
        
        // Callbacks
        this.onCarCompleted = null;
        
        // Set reference in intersection for car-to-car communication
        this.intersection.carManager = this;
    }

    initialize(settings) {
        this.settings = { ...settings };
        this.cars = [];
        this.nextCarId = 1;
        this.spawnTimer = 0;
    }

    update(deltaTime, lightStates) {
        // Update spawn timer
        this.spawnTimer += deltaTime;
        
        // Spawn new cars
        const spawnInterval = (10000 / this.settings.CAR_SPAWN_RATE); // Convert rate to interval
        if (this.spawnTimer >= spawnInterval) {
            this.spawnCar();
            this.spawnTimer = 0;
        }

        // Update existing cars
        this.cars.forEach(car => {
            car.maxSpeed = this.settings.CAR_SPEED;
            car.update(deltaTime, lightStates);
        });

        // Remove completed cars
        const completedCars = this.cars.filter(car => car.isCompleted());
        completedCars.forEach(car => {
            if (this.onCarCompleted) {
                this.onCarCompleted(car);
            }
        });

        this.cars = this.cars.filter(car => !car.isCompleted());
    }

    spawnCar() {
        // Randomly choose a direction to spawn from
        const directions = [CONFIG.DIRECTIONS.NORTH, CONFIG.DIRECTIONS.EAST, CONFIG.DIRECTIONS.SOUTH, CONFIG.DIRECTIONS.WEST];
        const direction = directions[Math.floor(Math.random() * directions.length)];
        
        // Randomly choose a destination (different from origin)
        const destinations = directions.filter(d => d !== direction);
        const destination = destinations[Math.floor(Math.random() * destinations.length)];
        
        // Choose lane based on turn type
        const turnType = getTurnType(direction, destination);
        let lane = Math.floor(Math.random() * 2); // Default random
        if (turnType === LEFT) lane = 0; // Left turns from left lane
        else if (turnType === RIGHT) lane = 1; // Right turns from right lane
        
        // Check if there's space to spawn (no car too close to spawn point)
        const spawnPoint = this.intersection.spawnPoints[direction];
        const tooClose = this.cars.some(car => {
            const distance = utils.getDistance(car.x, car.y, spawnPoint.x, spawnPoint.y);
            return car.fromDirection === direction && distance < 60;
        });

        if (!tooClose) {
            const car = new Car({
                id: this.nextCarId++,
                direction: direction,
                intersection: this.intersection,
                route: { from: direction, to: destination },
                lane: lane
            });
            this.cars.push(car);
        }
    }

    render(ctx) {
        this.cars.forEach(car => car.render(ctx));
    }

    reset() {
        this.cars = [];
        this.nextCarId = 1;
        this.spawnTimer = 0;
    }

    updateSettings(settings) {
        this.settings = { ...settings };
    }

    // Getters for external systems
    getCars() {
        return [...this.cars];
    }

    getWaitingCars(direction) {
        return this.cars.filter(car => car.getDirection() === direction && car.isWaiting());
    }

    getCurrentCarCount() {
        return this.cars.length;
    }
}