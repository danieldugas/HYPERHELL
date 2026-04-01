import { Transform4D, Vector4D } from '../../4d_creatures/hyperengine/transform4d.js';
import { createBullet } from '../models/bullet.js';
import { createCrawler } from '../models/crawler.js';
import { createOphane } from '../models/ophane.js';
import { createDamned, Hitbox } from '../models/damned.js';
import { createGem } from '../models/gem.js';
import { AudioManager } from './audio_manager.js';
// TODOs:
// Jump down / Falling logic [DONE]
// Lava damage [DONE]
// Enemy placements [DONE]
// Enemy models [DONE]
// Visible enemy damage [DONE]
// Boss healthbar [DONE]
// Door close [DONE]
// Dialogue [DONE]
// Tips [DONE]
// Texturing [DONE]
// Per room Floor shader [DONE]
// Audio
// Powerups
// Particles / Glow shaders
// Clipping bugs

// Custom controls
//      (3D / 4D upgrade)
//       Shooting and guns
//       Jumping and multiple heights
// Enemy spawning logic and AI
// Environment logic (doors, keys, floor damage)
// Inventory
// Player Health
// Dialogue overlays
// Game Over 

const DEBUG_MODE = false;

const AUDIO_ASSETS = {
    mainMusic: "../audio/main_theme.mp3",
    bossMusic: "../audio/boss_theme.mp3",
    sfx: {
        shoot: "../audio/shoot.mp3",
        enemyDeath: "../audio/enemy_death.mp3",
        ophanimDeath: "../audio/ophanim_death.mp3",
        playerHit: "../audio/player_hit.mp3",
        playerDeath: "../audio/player_death.mp3",
        enemyHit: "../audio/enemy_hit.mp3",
        ophanimHit: "../audio/ophanim_hit.mp3",
        ophanimHit2: "../audio/ophanim_hit_2.mp3",
        doorClose: "../audio/door_close.mp3",
    },
};

function playGameSfx(gameState, sfxKey, volumeScale = 1.0) {
    if (!gameState.audioManager) {
        return;
    }
    gameState.audioManager.playSfx(sfxKey, volumeScale);
}


class FiredBullet {
    constructor(scene, primitiveIndex, firedOrigin, firedDirection, firedSimTime) {
        this.scene = scene;
        this.primitiveIndex = primitiveIndex;
        this.firedOrigin = firedOrigin;
        this.firedDirection = firedDirection;
        this.firedSimTime = firedSimTime;

        this.lastUpdateTime = firedSimTime;

        let newPos = firedOrigin.add(firedDirection.multiply_by_scalar(2.0));
        this.lastUpdatePos = newPos;

        this.bulletVelocity = 10.0;
        this.bulletRadius = 0.5;

        // Move primitive to origin
        this.scene.visibleHyperobjects[primitiveIndex].pose.setTranslation(newPos);
        this.scene.visibleHyperobjects[primitiveIndex].pose.matrix[0][0] = this.bulletRadius;
        this.scene.visibleHyperobjects[primitiveIndex].pose.matrix[1][1] = this.bulletRadius;
        this.scene.visibleHyperobjects[primitiveIndex].pose.matrix[2][2] = this.bulletRadius;
        this.scene.visibleHyperobjects[primitiveIndex].pose.matrix[3][3] = this.bulletRadius;
    }

    currentPos() {
        return this.scene.visibleHyperobjects[this.primitiveIndex].pose.origin();
    }

    updateBullet(physics_time_s, bulletPrimitives, parentList, indexInParentList) {
        // move by direction * velocity * dt
        let newPos = this.lastUpdatePos.add(this.firedDirection.multiply_by_scalar(this.bulletVelocity * (physics_time_s - this.lastUpdateTime)));
        this.scene.visibleHyperobjects[this.primitiveIndex].pose.setTranslation(newPos);

        this.lastUpdateTime = physics_time_s;
        this.lastUpdatePos = newPos;

        // Bullets destroy themselves after 100 sec
        if (physics_time_s - this.firedSimTime > 100.0) {
            this.destroyBullet(bulletPrimitives, parentList, indexInParentList);
        }

        // Check colliders, do damage, etc

    }

    destroyBullet(bulletPrimitives, parentList, indexInParentList) {
        // Move pose to far away
        this.scene.visibleHyperobjects[this.primitiveIndex].pose.setTranslation(new Vector4D(0, 0, -10000, 0));
        // Return primitive to pool
        bulletPrimitives.push(this.primitiveIndex);
        // Remove self from parentList
        parentList.splice(indexInParentList, 1);
    }
}

class ShadeEnemy {
    constructor(primitiveIndex, returnToPose) {
        this.primitiveIndex = primitiveIndex;
        this.returnToPose = returnToPose;

        // enemy state
        this.hp = 50;
        this.isDead = false;
    }

    updateShade(gameState, engineState) {
        // Check own hitbox against player bullets
        let primitive = engineState.scene.visibleHyperobjects[this.primitiveIndex];
        let i = 0;
        while (true) {
            if (i >= gameState.playerBullets.length) { break; }
            let playerBullet = gameState.playerBullets[i];
            if (primitive.hitbox.checkBulletCollision(playerBullet.currentPos(), primitive.pose, playerBullet.bulletRadius)) {
                this.hp -= 10; // hit
                playGameSfx(gameState, "enemyHit");
                primitive.animState.damageTakenTime = engineState.physics_time_s;
                playerBullet.destroyBullet(gameState.bulletPrimitives, gameState.playerBullets, i);
            }
            i++;
        }

        // Check own hitbox against player
        const playerRadius = 1.0; // TODO use more precise hitbox
        if (primitive.hitbox.checkBulletCollision(engineState.hypercamera_T.origin(), primitive.pose, playerRadius)) {
            if (!gameState.GOD_MODE && gameState.playerHealth > 0 && gameState.playerInvulnLastHitTime + gameState.playerInvulnTime < engineState.physics_time_s) {
                gameState.playerHealth -= 10;
                gameState.playerInvulnLastHitTime = engineState.physics_time_s;
                playGameSfx(gameState, "playerHit");
                // Request camstand to smoothly turn toward the shade
                gameState.forceLookAtPos = primitive.pose.origin();
                gameState.forceLookAtStartTime = engineState.physics_time_s;
                gameState.forceLookAtOriginalPose = engineState.camstand_T.clone();
                // Force player out of unblink and lock it for 2 seconds
                if (gameState.playerEyeMode === "WideOpen" || gameState.playerEyeMode === "Lidded->WideOpen") {
                    gameState.playerEyeMode = "WideOpen->Lidded";
                    gameState.eyeAnimationProgress = 0;
                    gameState.unblinkLockoutUntil = engineState.physics_time_s + 2.0;
                    // Show tutorial the first time a shade forces the player out of unblink
                    if (!gameState.tutorialsShown.has("shade_unblink_hit")) {
                        gameState.shadeUnblinkTutorialPending = true;
                    }
                }
            }
        }

        const shadeMoveSpeed = 0.05;
        const shadeRotationSpeed = 0.01;
        const shadeAggroDistance = 10.0;
        const smolDist = 0.01;
        // Move towards the player
        let playerPos = engineState.camstand_T.origin();
        let delta = playerPos.subtract(primitive.pose.origin());
        if (delta.magnitude() < playerRadius) { // do nothing if close to the player
        } else if (delta.magnitude() < shadeAggroDistance) {
            let direction = delta.normalize();
            direction.z = 0;
            // Slowly rotate along XY plane towards the player (until creature X is aligned with direction)
            let angle = Math.atan2(direction.y, direction.x);
            let otherAngle = Math.atan2(primitive.pose.matrix[1][0], primitive.pose.matrix[0][0]);
            let rotation = angle - otherAngle;
            if (rotation > Math.PI) { rotation -= Math.PI * 2; }
            if (rotation < -Math.PI) { rotation += Math.PI * 2; }
            if (Math.abs(rotation) < smolDist) { rotation = 0; }
            let newRotation = Math.sign(rotation) * shadeRotationSpeed;
            primitive.pose.rotate_self_by_delta('XY', newRotation, false);
            // Translate towards player
            let speedModifier = 1.0 - Math.max(0.0, Math.min(1.0, Math.abs(rotation / Math.PI)));
            let newPos = primitive.pose.origin().add(direction.multiply_by_scalar(shadeMoveSpeed * speedModifier));
            primitive.pose.setTranslation(newPos);
            // Apply colliders to self
            for (let i = 0; i < engineState.scene.visibleHyperobjects.length; i++) {
                const obj = engineState.scene.visibleHyperobjects[i];
                if (obj.collider) {
                    obj.collider.constrainTransform(primitive.pose);
                }
            }
        } else {
            // return home
            let homeDelta = this.returnToPose.origin().subtract(primitive.pose.origin());
            if (homeDelta.magnitude() < smolDist) {
            } else {
                let direction = homeDelta.normalize();
                let newPos = primitive.pose.origin().add(direction.multiply_by_scalar(shadeMoveSpeed));
                primitive.pose.setTranslation(newPos);
            }
        }

        // Change animation state if hp < 20
        if (this.hp < 20) {
            primitive.animState.isHurt = false;
            primitive.animState.isCrawling = true;
        } else if (this.hp < 40) {
            primitive.animState.isHurt = true;
        }

        // Die if hp <= 0
        if (this.hp <= 0) {
            if (!this.isDead) {
                this.isDead = true;
                gameState.enemiesKilled++;
                playGameSfx(gameState, "enemyDeath");
            }
            primitive.pose.setTranslation(new Vector4D(0, 0, -10000, 0));
        }

        if (false) {
            // Debug div: shade vs player rotation/translation
            const debugId = `shade_debug_${this.primitiveIndex}`;
            if (!document.getElementById(debugId)) {
                const div = document.createElement("div");
                div.id = debugId;
                div.style.position = "absolute";
                div.style.top = "10px";
                div.style.left = "10px";
                div.style.color = "#80ffcc";
                div.style.fontFamily = "monospace";
                div.style.fontSize = "12px";
                div.style.backgroundColor = "rgba(0,0,0,0.6)";
                div.style.padding = "6px";
                div.style.borderRadius = "4px";
                div.style.zIndex = "1001";
                div.style.whiteSpace = "pre";
                document.body.appendChild(div);
            }
            const shadePos = primitive.pose.origin();
            const pPos = engineState.camstand_T.origin();
            const dlt = pPos.subtract(shadePos);
            const dist = dlt.magnitude();
            const angleToPlayer = Math.atan2(dlt.y, dlt.x);
            const shadeFacing = Math.atan2(primitive.pose.matrix[1][0], primitive.pose.matrix[0][0]);
            let rotDiff = angleToPlayer - shadeFacing;
            if (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
            if (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
            const deg = (r) => (r * 180 / Math.PI).toFixed(1);
            const f2 = (v) => v.toFixed(2);
            const debugDiv = document.getElementById(debugId);
            debugDiv.innerHTML =
                `--- Shade #${this.primitiveIndex} (hp:${this.hp}) ---\n` +
                `Shade pos : (${f2(shadePos.x)}, ${f2(shadePos.y)}, ${f2(shadePos.z)}, ${f2(shadePos.w)})\n` +
                `Player pos: (${f2(pPos.x)}, ${f2(pPos.y)}, ${f2(pPos.z)}, ${f2(pPos.w)})\n` +
                `Delta     : (${f2(dlt.x)}, ${f2(dlt.y)}, ${f2(dlt.z)}, ${f2(dlt.w)})\n` +
                `Distance  : ${f2(dist)}\n` +
                `Shade facing : ${deg(shadeFacing)}°\n` +
                `Angle to plyr: ${deg(angleToPlayer)}°\n` +
                `Rotation diff: ${deg(rotDiff)}°\n` +
                `Shade matrix row0: [${primitive.pose.matrix[0].map(v => f2(v)).join(', ')}]\n` +
                `Shade matrix row1: [${primitive.pose.matrix[1].map(v => f2(v)).join(', ')}]`;
        }

    }
} // ShadeEnemy

class CrawlerEnemy {
    constructor(primitiveIndex, homePose, volumeMin, volumeMax) {
        this.primitiveIndex = primitiveIndex;
        this.homePose = homePose;
        this.volumeMin = volumeMin;
        this.volumeMax = volumeMax;

        this.hp = 80;
        this.isDead = false;
        this.state = 'idle'; // 'idle', 'moving', 'shooting'
        this.lastActionTime = 0;
        this.idleDuration = 2.0; // seconds between actions
        this.moveSpeed = 0.03;
        this.rotateSpeed = 0.01;
        this.targetPos = null;
    }

    updateCrawler(gameState, engineState) {
        let primitive = engineState.scene.visibleHyperobjects[this.primitiveIndex];

        // Check own hitbox against player bullets
        let i = 0;
        while (i < gameState.playerBullets.length) {
            let playerBullet = gameState.playerBullets[i];
            if (primitive.hitbox && primitive.hitbox.checkBulletCollision(playerBullet.currentPos(), primitive.pose, playerBullet.bulletRadius)) {
                this.hp -= 10;
                playGameSfx(gameState, "enemyHit");
                primitive.animState.damageTakenTime = engineState.physics_time_s;
                playerBullet.destroyBullet(gameState.bulletPrimitives, gameState.playerBullets, i);
            } else {
                i++;
            }
        }

        // Check own hitbox against player
        const playerRadius = 1.0;
        if (primitive.hitbox && primitive.hitbox.checkBulletCollision(engineState.hypercamera_T.origin(), primitive.pose, playerRadius)) {
            if (gameState.playerHealth > 0 && gameState.playerInvulnLastHitTime + gameState.playerInvulnTime < engineState.physics_time_s) {
                gameState.playerHealth -= 10;
                gameState.playerInvulnLastHitTime = engineState.physics_time_s;
                playGameSfx(gameState, "playerHit");
            }
        }

        // Update leg-loss animation state based on HP
        if (primitive.animState) {
            const maxLegs = primitive.bones.length;
            const hpFraction = Math.max(0, this.hp) / 80;
            primitive.animState.targetLegsLost = Math.floor((1 - hpFraction) * maxLegs);
        }

        // Die if hp <= 0
        if (this.hp <= 0) {
            if (!this.isDead) {
                this.isDead = true;
                gameState.enemiesKilled++;
                playGameSfx(gameState, "enemyDeath");
            }
            primitive.pose.setTranslation(new Vector4D(0, 0, -10000, 0));
            return;
        }

        const smolDist = 0.5;
        const crawlerAggroDistance = 15.0;

        if (this.state === 'idle') {
            if (engineState.physics_time_s - this.lastActionTime > this.idleDuration) {
                // Pick a random point in the constrained volume
                this.targetPos = new Vector4D(
                    this.volumeMin.x + Math.random() * (this.volumeMax.x - this.volumeMin.x),
                    this.volumeMin.y + Math.random() * (this.volumeMax.y - this.volumeMin.y),
                    0,
                    this.volumeMin.w + Math.random() * (this.volumeMax.w - this.volumeMin.w)
                );
                this.state = 'moving';
            }
        } else if (this.state === 'moving') {
            let delta = this.targetPos.subtract(primitive.pose.origin());
            delta.z = 0;
            if (delta.magnitude() < smolDist) {
                // Arrived at target, switch to shooting
                this.state = 'shooting';
                this.lastActionTime = engineState.physics_time_s;
            } else {
                let direction = delta.normalize();
                let newPos = primitive.pose.origin().add(direction.multiply_by_scalar(this.moveSpeed));
                primitive.pose.setTranslation(newPos);

                // Rotate towards movement direction in XY plane
                let angle = Math.atan2(direction.y, direction.x);
                let otherAngle = Math.atan2(primitive.pose.matrix[1][0], primitive.pose.matrix[0][0]);
                let rotation = angle - otherAngle;
                if (rotation > Math.PI) rotation -= Math.PI * 2;
                if (rotation < -Math.PI) rotation += Math.PI * 2;
                if (Math.abs(rotation) > 0.01) {
                    primitive.pose.rotate_self_by_delta('XY', -Math.sign(rotation) * this.rotateSpeed, false);
                }

                // Apply colliders
                for (let j = 0; j < engineState.scene.visibleHyperobjects.length; j++) {
                    const obj = engineState.scene.visibleHyperobjects[j];
                    if (obj.collider) {
                        obj.collider.constrainTransform(primitive.pose);
                    }
                }
            }
        } else if (this.state === 'shooting') {
            // Rotate towards player
            let playerPos = engineState.hypercamera_T.origin();
            let delta = playerPos.subtract(primitive.pose.origin());
            delta.z = 0;
            if (delta.magnitude() > 0.01) {
                let direction = delta.normalize();
                let angle = Math.atan2(direction.y, direction.x);
                let otherAngle = Math.atan2(primitive.pose.matrix[1][0], primitive.pose.matrix[0][0]);
                let rotation = angle - otherAngle;
                if (rotation > Math.PI) rotation -= Math.PI * 2;
                if (rotation < -Math.PI) rotation += Math.PI * 2;
                if (Math.abs(rotation) > 0.01) {
                    primitive.pose.rotate_self_by_delta('XY', -Math.sign(rotation) * this.rotateSpeed, false);
                }
            }

            // Fire bullet at player after aiming delay
            if (engineState.physics_time_s - this.lastActionTime > 0.5) {
                if (delta.magnitude() < crawlerAggroDistance) {
                    this.fireBulletAtPlayer(gameState, engineState);
                }
                this.state = 'idle';
                this.lastActionTime = engineState.physics_time_s;
            }
        }
    }

    fireBulletAtPlayer(gameState, engineState) {
        let primitive = engineState.scene.visibleHyperobjects[this.primitiveIndex];
        let playerPos = engineState.hypercamera_T.origin();
        let bulletOrigin = primitive.pose.origin();
        let direction = playerPos.subtract(bulletOrigin);
        direction.z = 0;
        if (direction.magnitude() < 0.01) return;
        direction = direction.normalize();

        if (gameState.enemyBulletPrimitives.length === 0) return;
        let primIndex = gameState.enemyBulletPrimitives.pop();
        let newBullet = new FiredBullet(
            engineState.scene, primIndex,
            bulletOrigin, direction,
            engineState.physics_time_s
        );
        newBullet.bulletVelocity = 5.0; // slower than player bullets
        gameState.enemyBullets.push(newBullet);
    }
} // CrawlerEnemy

class OphaneEnemy {
    constructor(primitiveIndex, homePose, volumeCenter, volumeRadius, floorZ, flyZ) {
        this.primitiveIndex = primitiveIndex;
        this.homePose = homePose;
        this.volumeCenter = volumeCenter;
        this.volumeRadius = volumeRadius;

        this.hp = 1000;
        this.maxHp = 1000;
        this.isDead = false;
        this.state = 'idle'; // 'idle', 'moving', 'shooting'
        this.lastActionTime = 0;
        this.idleDuration = 2.0; // seconds between actions
        this.moveSpeed = 0.06;
        this.rotateSpeed = 0.01;
        this.targetPos = null;

        // Boss entrance state
        this.bossState = 'dormant'; // 'dormant', 'rising', 'active', 'falling'
        this.bossPhase = 1; // 1 = first encounter, 2 = second encounter
        this.riseStartTime = 0;
        this.fallStartTime = 0;
        this.fallStartPos = null; // captured when falling begins
        this.floorZ = floorZ;
        this.flyZ = flyZ;
    }

    startRising(gameState, engineState) {
        let primitive = engineState.scene.visibleHyperobjects[this.primitiveIndex];
        primitive.animState.ringsRotating = true;
        primitive.animState.ringsStartTime = engineState.physics_time_s;
        this.bossState = 'rising';
        this.riseStartTime = engineState.physics_time_s;
        // Force the camera to look at the ophane as it rises
        gameState.forceLookAtPos = primitive.pose.origin();
        gameState.forceLookAtPos.z = this.flyZ;
        gameState.forceLookAtStartTime = engineState.physics_time_s;
        gameState.forceLookAtOriginalPose = engineState.camstand_T.clone();
    }

    startFalling(engineState) {
        let primitive = engineState.scene.visibleHyperobjects[this.primitiveIndex];
        this.bossState = 'falling';
        this.fallStartTime = engineState.physics_time_s;
        this.fallStartPos = primitive.pose.origin();
    }

    updateOphane(gameState, engineState) {
        let primitive = engineState.scene.visibleHyperobjects[this.primitiveIndex];

        // Dormant: sit on floor, no AI
        if (this.bossState === 'dormant') {
            return;
        }

        // Rising: lerp from current Z to fly height
        if (this.bossState === 'rising') {
            const riseDuration = 7.0;
            let t = (engineState.physics_time_s - this.riseStartTime) / riseDuration;
            if (t >= 1.0) {
                t = 1.0;
                this.bossState = 'active';
                this.lastActionTime = engineState.physics_time_s;
            }
            const easeInOut = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
            let eased = easeInOut(t);
            let newZ = this.floorZ + (this.flyZ - this.floorZ) * eased;
            primitive.pose.matrix[2][4] = newZ;
            return;
        }

        // Falling: lerp back to center + floor
        if (this.bossState === 'falling') {
            const fallDuration = 3.0;
            let t = (engineState.physics_time_s - this.fallStartTime) / fallDuration;
            if (t >= 1.0) {
                t = 1.0;
                if (!this.bossDefeated) {
                    this.bossState = 'dormant';
                    this.bossPhase = 2;
                    gameState.bossPhase = 2; // waiting for phase 2 trigger
                }
            }
            const easeInOut = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
            let eased = easeInOut(t);
            let startPos = this.fallStartPos;
            let fallToPos = this.volumeCenter;
            fallToPos.z = this.floorZ;
            if (this.bossDefeated) { fallToPos.z = -30.0; }
            let newX = startPos.x + (fallToPos.x - startPos.x) * eased;
            let newY = startPos.y + (fallToPos.y - startPos.y) * eased;
            let newZ = startPos.z + (fallToPos.z - startPos.z) * eased;
            let newW = startPos.w + (fallToPos.w - startPos.w) * eased;
            primitive.pose.setTranslation(new Vector4D(newX, newY, newZ, newW));
            return;
        }

        // Active: full AI below

        // Check if phase 1 half-HP threshold reached
        if (this.bossPhase === 1 && this.hp <= this.maxHp / 2) {
            this.bossDefeated = false;
            primitive.animState.ringsStopTime = engineState.physics_time_s;
            primitive.animState.ringsRotating = false;
            this.startFalling(engineState);
            return;
        }

        // Check own hitbox against player bullets
        let i = 0;
        while (i < gameState.playerBullets.length) {
            let playerBullet = gameState.playerBullets[i];
            if (primitive.hitbox && primitive.hitbox.checkBulletCollision(playerBullet.currentPos(), primitive.pose, playerBullet.bulletRadius)) {
                // invulnerable during cutscenes
                if (this.bossState === 'active') {
                    this.hp -= 10;
                    if (this.hp % 100 === 0) { playGameSfx(gameState, "ophanimHit2"); }
                    else if (this.hp % 50 === 0) { playGameSfx(gameState, "ophanimHit"); }
                    primitive.animState.damageTakenTime = engineState.physics_time_s;
                }
                playerBullet.destroyBullet(gameState.bulletPrimitives, gameState.playerBullets, i);
            } else {
                i++;
            }
        }

        // Check own hitbox against player
        const playerRadius = 1.0;
        if (primitive.hitbox && primitive.hitbox.checkBulletCollision(engineState.hypercamera_T.origin(), primitive.pose, playerRadius)) {
            if (gameState.playerHealth > 0 && gameState.playerInvulnLastHitTime + gameState.playerInvulnTime < engineState.physics_time_s) {
                gameState.playerHealth -= 10;
                gameState.playerInvulnLastHitTime = engineState.physics_time_s;
                playGameSfx(gameState, "playerHit");
            }
        }

        // Die if hp <= 0
        if (this.hp <= 0) {
            if (!this.isDead) {
                this.isDead = true;
                gameState.enemiesKilled++;
                playGameSfx(gameState, "ophanimDeath");
            }
            // Capture death position for gem spawn before teleporting away
            if (gameState.gemState === 'hidden') {
                gameState.gemState = 'lerping';
                gameState.gemLerpStartTime = engineState.physics_time_s;
                gameState.gemLerpStartPos = primitive.pose.origin();
            }
            this.bossDefeated = true;
            this.bossPhase = 4;
            this.startFalling(engineState);
            return;
        }

        const smolDist = 0.5;
        const ophaneAggroDistance = this.volumeRadius*2;

        if (this.state === 'idle') {
            if (engineState.physics_time_s - this.lastActionTime > this.idleDuration) {
                // Pick a random point in the constrained volume
                // this.targetPos = new Vector4D(
                //     this.volumeCenter.x + Math.random() * this.volumeRadius,
                //     this.volumeCenter.y + Math.random() * this.volumeRadius,
                //     0,
                //     this.volumeCenter.w + Math.random() * this.volumeRadius
                // );
                // Pick point closest to player within the radius
                let playerPos = engineState.hypercamera_T.origin();
                let delta = playerPos.subtract(this.volumeCenter);
                let dist = delta.magnitude();
                if (dist > this.volumeRadius) { delta = delta.normalize().multiply_by_scalar(this.volumeRadius); }
                this.targetPos = this.volumeCenter.add(delta);
                this.targetPos.z = primitive.pose.origin().z;
                // if target pos is too close to current pos, move in camera W direction instead
                let tomovedist = this.targetPos.subtract(primitive.pose.origin()).magnitude();
                if (tomovedist < 10.0) {
                    delta = delta.add(engineState.hypercamera_T.transform_vector(new Vector4D(0, 0, 0, 1)).multiply_by_scalar(-50.0));
                    delta = delta.normalize().multiply_by_scalar(this.volumeRadius);
                    this.targetPos = this.volumeCenter.add(delta);
                    this.targetPos.z = primitive.pose.origin().z;
                }

                this.state = 'moving';
            }
        } else if (this.state === 'moving') {
            let delta = this.targetPos.subtract(primitive.pose.origin());
            delta.z = 0;
            if (delta.magnitude() < smolDist) {
                // Arrived at target, switch to reorient
                this.state = 'reorienting';
                this.lastActionTime = engineState.physics_time_s;
            } else {
                let direction = delta.normalize();
                let newPos = primitive.pose.origin().add(direction.multiply_by_scalar(this.moveSpeed));
                primitive.pose.setTranslation(newPos);

                // Rotate towards movement direction in XY plane
                let angle = Math.atan2(direction.y, direction.x);
                let otherAngle = Math.atan2(primitive.pose.matrix[1][0], primitive.pose.matrix[0][0]);
                let rotation = angle - otherAngle;
                if (rotation > Math.PI) rotation -= Math.PI * 2;
                if (rotation < -Math.PI) rotation += Math.PI * 2;
                if (Math.abs(rotation) > 0.01) {
                    primitive.pose.rotate_self_by_delta('XY', -Math.sign(rotation) * this.rotateSpeed, false);
                }

                // Apply colliders
                for (let j = 0; j < engineState.scene.visibleHyperobjects.length; j++) {
                    const obj = engineState.scene.visibleHyperobjects[j];
                    if (obj.collider) {
                        obj.collider.constrainTransform(primitive.pose);
                    }
                }
                
                // Fire bullet at player every 0.5 seconds
                if (engineState.physics_time_s - this.lastActionTime > 1.0) {
                    if (delta.magnitude() < ophaneAggroDistance) {
                        this.fireBulletAtPlayer(gameState, engineState);
                    }
                    this.lastActionTime = engineState.physics_time_s;
                }
            }
        } else if (this.state === 'reorienting') {
            // Rotate towards player
            let playerPos = engineState.hypercamera_T.origin();
            let delta = playerPos.subtract(primitive.pose.origin());
            delta.z = 0;
            if (delta.magnitude() > 0.01) {
                let direction = delta.normalize();
                let angle = Math.atan2(direction.y, direction.x);
                let otherAngle = Math.atan2(primitive.pose.matrix[1][0], primitive.pose.matrix[0][0]);
                let rotation = angle - otherAngle;
                if (rotation > Math.PI) rotation -= Math.PI * 2;
                if (rotation < -Math.PI) rotation += Math.PI * 2;
                if (Math.abs(rotation) > 0.01) {
                    primitive.pose.rotate_self_by_delta('XY', -Math.sign(rotation) * this.rotateSpeed, false);
                }
            }

            // after delay, switch back to moving
            if (engineState.physics_time_s - this.lastActionTime > 2.0) {
                this.state = 'idle';
                this.lastActionTime = engineState.physics_time_s;
            }

        }
    }

    fireBulletAtPlayer(gameState, engineState) {
        let primitive = engineState.scene.visibleHyperobjects[this.primitiveIndex];
        let playerPos = engineState.hypercamera_T.origin();
        let bulletOrigin = primitive.pose.origin();
        let direction = playerPos.subtract(bulletOrigin);
        if (direction.magnitude() < 0.01) return;
        direction = direction.normalize();

        if (gameState.ophaneBulletPrimitives.length === 0) return;
        let primIndex = gameState.ophaneBulletPrimitives.pop();
        let newBullet = new FiredBullet(
            engineState.scene, primIndex,
            bulletOrigin, direction,
            engineState.physics_time_s
        );
        newBullet.bulletVelocity = 10.0; // slower than player bullets
        gameState.ophaneBullets.push(newBullet);
    }
} // OphaneEnemy

class GameState {
    constructor() {
        // state
        this.GOD_MODE = false;
        this.playerSpeed = 0.1;
        this.isFirstStep = true; // Used for debugging
        this.bulletCooldownLastFiredTime = 0;
        // Player stats
        this.playerHealth = 100;
        this.playerMaxHealth = 100;
        this.playerAmmo = 10;
        this.playerMaxAmmo = 10;
        this.ammoReloading = false;
        this.ammoReloadStartTime = 0;
        this.ammoReloadDuration = 3.0;
        this.playerInvulnLastHitTime = 0;
        this.playerInvulnTime = 1.0;
        // Movement mode
        this.playerMoveMode = "Human";
        // Eye opening animation state
        this.playerEyeMode = "Human";
        this.eyeAnimationProgress = 0; // 0 to 1 within current phase
        this.eyeAnimationSpeed = 4.0; // How fast the animation progresses
        this.lastEyeUpdateTime = 0;
        this.rKeyWasPressed = false;
        this.unblinkLockoutUntil = 0; // timestamp until which unblink is disabled (shade hit)
        this.forceLookAtPos = null; // when set, camstand smoothly turns to face this position
        this.forceLookAtStartTime = 0;
        this.forceLookAtDuration = 0.5; // seconds
        this.forceLookAtOriginalPose = null; // camstand rotation rows [X,Y,Z,W] at moment of hit
        // Dialog state
        this.dialogState = 'none'; // 'none', 'showing', 'choosing', 'sealed'
        this.dialogLineIndex = 0;
        this.bargainCompleted = false; // true after first bargain
        this.bargainRefused = false; // true after refusing bargain
        this.bargainTriggered = false; // true once proximity triggers dialog
        this.room2WallShown = false; // true once player enters room 2
        // Tutorial state
        this.tutorialsShown = new Set(); // IDs of tutorials already shown
        this.tutorialActive = false; // true while a tutorial overlay is visible
        this.shootingUnlocked = false; // true after combat tutorial
        this.shadeUnblinkTutorialPending = false; // set when shade hits player out of unblink
        // bullets
        this.playerBullets = [];
        this.bulletPrimitives = [];
        // enemies
        this.shadeEnemies = [];
        this.crawlerEnemies = [];
        this.ophaneEnemies = [];
        // enemy bullets
        this.enemyBullets = [];
        this.enemyBulletPrimitives = [];
        // ophane bullets (separate pool, yellow)
        this.ophaneBullets = [];
        this.ophaneBulletPrimitives = [];
        // Fall tracking
        this.previousFloorHeight = 0;
        this.playerIsFalling = false;
        this.fallStartTime = 0;
        this.fallFromZ = 0; // absolute Z at start of fall
        // Lava tracking
        this.lavaTime = 0; // seconds the player has been standing in lava (not on bridge)
        this.burnLevel = 0; // Increases when in lava, decreases when outside
        this.lastLavaCheckTime = 0;
        // Boss: 0=not started, 1=phase1 active, 2=intermission, 3=phase2 active
        this.bossPhase = 0;
        this.bossDefeated = false;
        // End gem: 'hidden', 'lerping', 'arrived'
        this.gemState = 'hidden';
        this.gemLerpStartTime = 0;
        this.gemLerpStartPos = null;
        // Level stats
        this.levelStartTime = null;
        this.enemiesKilled = 0;
        this.levelComplete = false;
        this.gameOver = false;
        // Debug
        this.pendingTeleport = null;
    }
}

export class TheBargainManager {
    constructor(scene, poIs) {
        this.scene = scene;
        this.poIs = poIs;
        // State
        this.gameState = new GameState();
        this.audioManager = new AudioManager(AUDIO_ASSETS);
        this.gameState.audioManager = this.audioManager;

        // Pre-allocate 100 bullets
        // createHypersphere(size, color)
        for (let i = 0; i < 100; i++) {
            let dx = Math.random() * 20 - 10;
            let dy = Math.random() * 20 - 10;
            let dw = Math.random() * 20 - 10;
            let pose = new Transform4D([
                [1, 0, 0, 0, 0],
                [0, 1, 0, 0, 0],
                [0, 0, 1, 0, -10000],
                [0, 0, 0, 1, 0],
                [0, 0, 0, 0, 1]
            ])
            let sphere = createBullet(1, 0xff0000, pose);
            this.gameState.bulletPrimitives.push(this.scene.visibleHyperobjects.length);
            this.scene.visibleHyperobjects.push(sphere);
        }
        
        // Pre-allocate 10 Shades, 10 Crawlers, 5 Ophanes
        for (let i = 0; i < this.poIs.shadeSpawns.length; i++) {
            let p = this.poIs.shadeSpawns[i];
            let pose = new Transform4D([
                [1, 0, 0, 0, p.x],
                [0, 1, 0, 0, p.y],
                [0, 0, 1, 0, p.z],
                [0, 0, 0, 1, p.w],
                [0, 0, 0, 0, 1]
            ])
            let creature = createDamned();
            creature.pose = pose;
            let primitiveIndex = this.scene.visibleHyperobjects.length; // this line must be before pushing to scene
            this.gameState.shadeEnemies.push(new ShadeEnemy(primitiveIndex, pose.clone()));
            this.scene.visibleHyperobjects.push(creature);
        }

        // Pre-allocate 50 enemy bullets (red)
        for (let i = 0; i < 50; i++) {
            let pose = new Transform4D([
                [1, 0, 0, 0, 0],
                [0, 1, 0, 0, 0],
                [0, 0, 1, 0, -10000],
                [0, 0, 0, 1, 0],
                [0, 0, 0, 0, 1]
            ]);
            let sphere = createBullet(1, 0xff0000, pose);
            this.gameState.enemyBulletPrimitives.push(this.scene.visibleHyperobjects.length);
            this.scene.visibleHyperobjects.push(sphere);
        }

        // Pre-allocate 50 ophane bullets (yellow)
        for (let i = 0; i < 50; i++) {
            let pose = new Transform4D([
                [1, 0, 0, 0, 0],
                [0, 1, 0, 0, 0],
                [0, 0, 1, 0, -10000],
                [0, 0, 0, 1, 0],
                [0, 0, 0, 0, 1]
            ]);
            let sphere = createBullet(1, 0xffcc00, pose);
            this.gameState.ophaneBulletPrimitives.push(this.scene.visibleHyperobjects.length);
            this.scene.visibleHyperobjects.push(sphere);
        }

        // Pre-allocate Crawlers
        for (let i = 0; i < this.poIs.crawlerSpawns.length; i++) {
            let spawn = this.poIs.crawlerSpawns[i];
            let p = spawn.pos;
            let pose = new Transform4D([
                [1, 0, 0, 0, p.x],
                [0, 1, 0, 0, p.y],
                [0, 0, 1, 0, p.z],
                [0, 0, 0, 1, p.w],
                [0, 0, 0, 0, 1]
            ]);
            let creature = createCrawler();
            creature.pose = pose;
            creature.hitbox = new Hitbox(new Vector4D(-2, -2, -1, -2), new Vector4D(2, 2, 2, 2));
            let primitiveIndex = this.scene.visibleHyperobjects.length;
            this.gameState.crawlerEnemies.push(new CrawlerEnemy(primitiveIndex, pose.clone(), spawn.volumeMin, spawn.volumeMax));
            this.scene.visibleHyperobjects.push(creature);
        }

        // Pre-allocate Ophanes
        for (let i = 0; i < this.poIs.ophaneSpawns.length; i++) {
            let spawn = this.poIs.ophaneSpawns[i];
            let p = spawn.pos;
            let flyZ = p.z;
            let floorZ = spawn.volumeCenter.z;
            let pose = new Transform4D([
                [8, 0, 0, 0, p.x],
                [0, 8, 0, 0, p.y],
                [0, 0, 8, 0, floorZ],
                [0, 0, 0, 8, p.w],
                [0, 0, 0, 0, 1]
            ]);
            let creature = createOphane();
            creature.pose = pose;
            creature.hitbox = new Hitbox(new Vector4D(-2, -2, -3, -2), new Vector4D(2, 2, 2, 2));
            let primitiveIndex = this.scene.visibleHyperobjects.length;
            this.gameState.ophaneEnemies.push(new OphaneEnemy(primitiveIndex, pose.clone(), spawn.volumeCenter, spawn.volumeRadius, floorZ, flyZ));
            this.scene.visibleHyperobjects.push(creature);
        }

        // End gem (starts hidden, appears when boss dies)
        if (true) {
            const EndGemH = 4.0;
            const EndGemZ = 3.0;
            const EndGemW = 1.0;
            const EndGemC = this.poIs.room6Center.add(new Vector4D(0, 0, EndGemZ, 0));
            let gemPose = new Transform4D([
                [EndGemW/2.0, 0, 0, 0, EndGemC.x],
                [0, EndGemW/2.0, 0, 0, EndGemC.y],
                [0, 0, EndGemH/6.0, 0, -10000],
                [0, 0, 0, 1, EndGemC.w],
                [0, 0, 0, 0, 1]
            ]);
            let gem = createGem(gemPose, 0xffff00);
            this.endGemPrimitiveIndex = this.scene.visibleHyperobjects.length;
            this.endGemTargetPos = EndGemC;
            this.endGemBaseZ = EndGemC.z;
            this.scene.visibleHyperobjects.push(gem);
        }

        // Debug panel
        this.createDebugPanel();
        this.createHUDBar();
        this.createBossHealthBar();
        this.createDialogOverlay();
        this.createTutorialOverlay();
        this.createLevelCompleteOverlay();
        this.createGameOverOverlay();
    }

    createDebugPanel() {
        if (!DEBUG_MODE) return;
        // Create container
        const panel = document.createElement("div");
        panel.id = "debug_panel";
        panel.style.position = "absolute";
        panel.style.bottom = "10px";
        panel.style.left = "10px";
        panel.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
        panel.style.color = "#9c9c9c";
        panel.style.fontFamily = "monospace";
        panel.style.fontSize = "12px";
        panel.style.padding = "8px";
        panel.style.borderRadius = "4px";
        panel.style.zIndex = "1000";
        panel.style.userSelect = "none";

        // Create header (collapsible toggle)
        const header = document.createElement("div");
        header.style.cursor = "pointer";
        header.style.fontWeight = "bold";
        header.style.marginBottom = "8px";
        header.innerHTML = "▼ Debug Panel";

        // Create content container
        const content = document.createElement("div");
        content.id = "debug_panel_content";

        // Toggle collapse
        let collapsed = false;
        header.addEventListener("click", () => {
            collapsed = !collapsed;
            content.style.display = collapsed ? "none" : "block";
            header.innerHTML = collapsed ? "▶ Debug Panel" : "▼ Debug Panel";
        });

        // Accept bargain debug button
        const acceptBargainButton = document.createElement("button");
        acceptBargainButton.id = "debug-accept-bargain";
        acceptBargainButton.style.backgroundColor = "#333";
        acceptBargainButton.style.color = "#f88";
        acceptBargainButton.style.border = "1px solid #666";
        acceptBargainButton.style.padding = "4px 8px";
        acceptBargainButton.style.cursor = "pointer";
        acceptBargainButton.style.fontSize = "11px";
        acceptBargainButton.innerHTML = "Debug: Accept Bargain";
        acceptBargainButton.addEventListener("click", () => {
            // this.gameState.dialogState = 'sealed';
            this.gameState.bargainCompleted = true;
            this.gameState.playerMoveMode = "4D";
            this.gameState.playerEyeMode = "WideOpen->Lidded";
            // if (this.poIs.bargainerIndex !== undefined) {
                // this.scene.visibleHyperobjects[this.poIs.bargainerIndex].pose.setTranslation(new Vector4D(0, 0, -10000, 0));
            // }
            console.log("Debug: bargain accepted");
        });
        content.appendChild(acceptBargainButton);

        // GOD_MODE toggle
        const godModeRow = document.createElement("div");
        godModeRow.style.marginBottom = "8px";
        const godModeCheckbox = document.createElement("input");
        godModeCheckbox.type = "checkbox";
        godModeCheckbox.id = "god_mode_checkbox";
        godModeCheckbox.checked = this.gameState.GOD_MODE;
        godModeCheckbox.addEventListener("change", (e) => {
            this.gameState.GOD_MODE = e.target.checked;
        });
        const godModeLabel = document.createElement("label");
        godModeLabel.htmlFor = "god_mode_checkbox";
        godModeLabel.innerHTML = " GOD_MODE";
        godModeRow.appendChild(godModeCheckbox);
        godModeRow.appendChild(godModeLabel);
        content.appendChild(godModeRow);

        // Player speed slider
        const speedRow = document.createElement("div");
        speedRow.style.marginBottom = "8px";
        const speedLabel = document.createElement("label");
        speedLabel.innerHTML = "Speed: ";
        const speedValue = document.createElement("span");
        speedValue.innerHTML = this.gameState.playerSpeed.toFixed(2);
        const speedSlider = document.createElement("input");
        speedSlider.type = "range";
        speedSlider.min = "0.01";
        speedSlider.max = "1.0";
        speedSlider.step = "0.01";
        speedSlider.value = this.gameState.playerSpeed;
        speedSlider.style.width = "100%";
        speedSlider.style.marginTop = "4px";
        speedSlider.addEventListener("input", (e) => {
            this.gameState.playerSpeed = parseFloat(e.target.value);
            speedValue.innerHTML = this.gameState.playerSpeed.toFixed(2);
        });
        speedRow.appendChild(speedLabel);
        speedRow.appendChild(speedValue);
        speedRow.appendChild(speedSlider);
        content.appendChild(speedRow);

        // Teleport section
        const teleportLabel = document.createElement("div");
        teleportLabel.innerHTML = "Teleport to:";
        teleportLabel.style.marginBottom = "4px";
        content.appendChild(teleportLabel);

        // Room positions (x, y, z, w)
        const rooms = this.poIs.roomCenters;

        rooms.forEach(room => {
            const btn = document.createElement("button");
            btn.innerHTML = room.name;
            btn.style.display = "block";
            btn.style.marginBottom = "4px";
            btn.style.padding = "4px 8px";
            btn.style.cursor = "pointer";
            btn.style.backgroundColor = "#333";
            btn.style.color = "#9c9c9c";
            btn.style.border = "1px solid #555";
            btn.style.borderRadius = "2px";
            btn.style.width = "100%";
            btn.addEventListener("click", () => {
                this.teleportTo(room.pos.x, room.pos.y, room.pos.z, room.pos.w);
            });
            content.appendChild(btn);
        });

        panel.appendChild(header);
        panel.appendChild(content);
        document.body.appendChild(panel);

        this.debugPanel = panel;
    }

    createHUDBar() {
        // Main HUD container
        const hud = document.createElement("div");
        hud.id = "hud_bar";
        hud.style.position = "absolute";
        hud.style.bottom = "20px";
        hud.style.left = "50%";
        hud.style.transform = "translateX(-50%)";
        hud.style.backgroundColor = "rgba(20, 20, 20, 0.85)";
        hud.style.border = "2px solid #444";
        hud.style.borderRadius = "4px";
        hud.style.padding = "8px 16px";
        hud.style.display = "flex";
        hud.style.alignItems = "center";
        hud.style.gap = "16px";
        hud.style.zIndex = "999";
        hud.style.fontFamily = "monospace";
        hud.style.color = "#ccc";
        hud.style.userSelect = "none";

        // Left icon (player face/status)
        const leftIcon = document.createElement("div");
        leftIcon.id = "hud_left_icon";
        leftIcon.style.width = "64px";
        leftIcon.style.height = "64px";
        leftIcon.style.backgroundColor = "#333";
        leftIcon.style.border = "1px solid #555";
        leftIcon.style.borderRadius = "4px";
        leftIcon.style.display = "flex";
        leftIcon.style.alignItems = "center";
        leftIcon.style.justifyContent = "center";
        leftIcon.style.fontSize = "24px";
        leftIcon.innerHTML = `<img src="../icons/dimensional_eye_half_lidded_64x64.png"></img>`;
        hud.appendChild(leftIcon);

        // Health bar container
        const healthContainer = document.createElement("div");
        healthContainer.style.display = "flex";
        healthContainer.style.flexDirection = "column";
        healthContainer.style.gap = "2px";

        const healthLabel = document.createElement("div");
        healthLabel.style.fontSize = "10px";
        healthLabel.style.color = "#888";
        healthLabel.innerHTML = "HEALTH";

        const healthBarOuter = document.createElement("div");
        healthBarOuter.style.width = "120px";
        healthBarOuter.style.height = "16px";
        healthBarOuter.style.backgroundColor = "#222";
        healthBarOuter.style.border = "1px solid #555";
        healthBarOuter.style.borderRadius = "2px";
        healthBarOuter.style.overflow = "hidden";
        healthBarOuter.style.position = "relative";

        const healthBarInner = document.createElement("div");
        healthBarInner.id = "hud_health_bar";
        healthBarInner.style.width = "100%";
        healthBarInner.style.height = "100%";
        healthBarInner.style.backgroundColor = "#c22";
        healthBarInner.style.transition = "width 0.2s";

        const healthValue = document.createElement("div");
        healthValue.id = "hud_health_value";
        healthValue.style.position = "absolute";
        healthValue.style.top = "0";
        healthValue.style.left = "0";
        healthValue.style.width = "100%";
        healthValue.style.height = "100%";
        healthValue.style.display = "flex";
        healthValue.style.alignItems = "center";
        healthValue.style.justifyContent = "center";
        healthValue.style.fontSize = "11px";
        healthValue.style.fontWeight = "bold";
        healthValue.style.color = "#fff";
        healthValue.style.textShadow = "1px 1px 1px #000";
        healthValue.innerHTML = "100";

        healthBarOuter.appendChild(healthBarInner);
        healthBarOuter.appendChild(healthValue);
        healthContainer.appendChild(healthLabel);
        healthContainer.appendChild(healthBarOuter);

        // Burn bar (below health bar, hidden by default)
        const burnBarOuter = document.createElement("div");
        burnBarOuter.id = "hud_burn_bar_outer";
        burnBarOuter.style.width = "120px";
        burnBarOuter.style.height = "8px";
        burnBarOuter.style.backgroundColor = "#222";
        burnBarOuter.style.border = "1px solid #555";
        burnBarOuter.style.borderRadius = "2px";
        burnBarOuter.style.overflow = "hidden";
        burnBarOuter.style.display = "none";

        const burnBarInner = document.createElement("div");
        burnBarInner.id = "hud_burn_bar";
        burnBarInner.style.width = "0%";
        burnBarInner.style.height = "100%";
        burnBarInner.style.backgroundColor = "#f80";
        burnBarInner.style.transition = "width 0.1s";

        burnBarOuter.appendChild(burnBarInner);
        healthContainer.appendChild(burnBarOuter);

        hud.appendChild(healthContainer);

        // Ammo bar container (hidden until combat tutorial)
        const ammoContainer = document.createElement("div");
        ammoContainer.id = "hud_ammo_container";
        ammoContainer.style.display = "none";
        ammoContainer.style.flexDirection = "column";
        ammoContainer.style.gap = "2px";

        const ammoLabel = document.createElement("div");
        ammoLabel.style.fontSize = "10px";
        ammoLabel.style.color = "#888";
        ammoLabel.innerHTML = "AMMO";

        const ammoBarOuter = document.createElement("div");
        ammoBarOuter.style.width = "120px";
        ammoBarOuter.style.height = "16px";
        ammoBarOuter.style.backgroundColor = "#222";
        ammoBarOuter.style.border = "1px solid #555";
        ammoBarOuter.style.borderRadius = "2px";
        ammoBarOuter.style.overflow = "hidden";
        ammoBarOuter.style.position = "relative";

        const ammoBarInner = document.createElement("div");
        ammoBarInner.id = "hud_ammo_bar";
        ammoBarInner.style.width = "100%";
        ammoBarInner.style.height = "100%";
        ammoBarInner.style.backgroundColor = "#c90";
        ammoBarInner.style.transition = "width 0.2s";

        const ammoValue = document.createElement("div");
        ammoValue.id = "hud_ammo_value";
        ammoValue.style.position = "absolute";
        ammoValue.style.top = "0";
        ammoValue.style.left = "0";
        ammoValue.style.width = "100%";
        ammoValue.style.height = "100%";
        ammoValue.style.display = "flex";
        ammoValue.style.alignItems = "center";
        ammoValue.style.justifyContent = "center";
        ammoValue.style.fontSize = "11px";
        ammoValue.style.fontWeight = "bold";
        ammoValue.style.color = "#fff";
        ammoValue.style.textShadow = "1px 1px 1px #000";
        ammoValue.innerHTML = "10";

        ammoBarOuter.appendChild(ammoBarInner);
        ammoBarOuter.appendChild(ammoValue);
        ammoContainer.appendChild(ammoLabel);
        ammoContainer.appendChild(ammoBarOuter);
        hud.appendChild(ammoContainer);

        // Weapon icon (right side, hidden until combat tutorial)
        const weaponIcon = document.createElement("div");
        weaponIcon.id = "hud_weapon_icon";
        weaponIcon.style.width = "64px";
        weaponIcon.style.height = "64px";
        weaponIcon.style.backgroundColor = "#333";
        weaponIcon.style.border = "1px solid #555";
        weaponIcon.style.borderRadius = "4px";
        weaponIcon.style.display = "none";
        weaponIcon.style.alignItems = "center";
        weaponIcon.style.justifyContent = "center";
        weaponIcon.innerHTML = `<img src="../icons/blood_pistol.png" style="width: 64px; height: 64px">`;
        hud.appendChild(weaponIcon);

        document.body.appendChild(hud);
        this.hudBar = hud;
    }

    createBossHealthBar() {
        const container = document.createElement("div");
        container.id = "boss_health_container";
        container.style.position = "absolute";
        container.style.top = "20px";
        container.style.left = "50%";
        container.style.transform = "translateX(-50%)";
        container.style.display = "none";
        container.style.flexDirection = "column";
        container.style.alignItems = "center";
        container.style.gap = "4px";
        container.style.zIndex = "999";
        container.style.fontFamily = "monospace";
        container.style.userSelect = "none";

        const label = document.createElement("div");
        label.style.fontSize = "14px";
        label.style.fontWeight = "bold";
        label.style.color = "#ff6644";
        label.style.textShadow = "1px 1px 2px #000";
        label.style.letterSpacing = "4px";
        label.innerHTML = "OPHANIM";
        container.appendChild(label);

        const barOuter = document.createElement("div");
        barOuter.style.width = "400px";
        barOuter.style.height = "20px";
        barOuter.style.backgroundColor = "rgba(20, 20, 20, 0.85)";
        barOuter.style.border = "2px solid #666";
        barOuter.style.borderRadius = "2px";
        barOuter.style.overflow = "hidden";
        barOuter.style.position = "relative";

        const barInner = document.createElement("div");
        barInner.id = "boss_health_bar";
        barInner.style.width = "100%";
        barInner.style.height = "100%";
        barInner.style.backgroundColor = "#c44";
        barInner.style.transition = "width 0.3s";

        const barValue = document.createElement("div");
        barValue.id = "boss_health_value";
        barValue.style.position = "absolute";
        barValue.style.top = "0";
        barValue.style.left = "0";
        barValue.style.width = "100%";
        barValue.style.height = "100%";
        barValue.style.display = "flex";
        barValue.style.alignItems = "center";
        barValue.style.justifyContent = "center";
        barValue.style.fontSize = "12px";
        barValue.style.fontWeight = "bold";
        barValue.style.color = "#fff";
        barValue.style.textShadow = "1px 1px 1px #000";
        barValue.innerHTML = "";

        barOuter.appendChild(barInner);
        barOuter.appendChild(barValue);
        container.appendChild(barOuter);
        document.body.appendChild(container);
    }

    createDialogOverlay() {
        // Dialog lines for first encounter
        this.dialogLinesFirst = [
            "You were not supposed to be here.",
            "You will never be able to leave this place.",
            "Unless...",
            "I could make you more, let you see through their eyes. Move in their dimensions.",
            "But there is a price.",
            "Oh, you may lose your sanity.",
            "But that is not what I will require of you.",
            "Parts of you must be abandoned. Exchanged. Irreversibly.",
        ];
        // Dialog lines for returning
        this.dialogLinesReturn = [
            "You have returned.",
            "I could make you more, let you see through their eyes. Move in their dimensions.",
            "But there is a price.",
            "Oh, you may lose your sanity.",
            "But that is not what I will require of you.",
            "Parts of you must be abandoned. Exchanged. Irreversibly.",
        ];
        this.dialogLineSealed = "Your decision. The bargain is sealed.";
        this.dialogLineRefused = "Then leave. If you can.";

        // Dialog overlay: positioned over the game canvas
        const canvas = this.scene.mainCanvas;
        // Wrap canvas in a relative container so the overlay can sit on top
        const wrapper = document.createElement("div");
        wrapper.style.position = "relative";
        wrapper.style.display = "inline-block";
        canvas.parentNode.insertBefore(wrapper, canvas);
        wrapper.appendChild(canvas);

        const overlay = document.createElement("div");
        overlay.id = "dialog_overlay";
        overlay.style.position = "absolute";
        overlay.style.top = "16px";
        overlay.style.left = "16px";
        overlay.style.right = "16px";
        overlay.style.bottom = "16px";
        overlay.style.display = "none";
        overlay.style.zIndex = "2000";
        overlay.style.cursor = "pointer";
        overlay.style.boxSizing = "border-box";
        overlay.style.padding = "20px";
        overlay.style.flexDirection = "column";
        overlay.style.justifyContent = "center";
        overlay.style.backgroundColor = "#0f0505";
        overlay.style.border = "1px solid #442222";
        overlay.style.borderRadius = "4px";
        // Load pixel font
        if (!document.getElementById('pixel-font-link')) {
            const link = document.createElement("link");
            link.id = "pixel-font-link";
            link.rel = "stylesheet";
            link.href = "https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap";
            document.head.appendChild(link);
        }
        overlay.style.fontFamily = "'Press Start 2P', monospace";
        overlay.style.fontSize = "12px";
        overlay.style.color = "#ccaaaa";
        overlay.style.lineHeight = "1.6";
        overlay.style.textShadow = "0 0 8px rgba(150, 50, 50, 0.3)";
        overlay.style.overflow = "auto";

        // Header row: character icon + speaker name
        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.gap = "12px";
        header.style.marginBottom = "16px";

        // Character icon
        const icon = document.createElement("img");
        icon.id = "dialog_icon";
        icon.src = "../icons/bargainer_1_128x128.png";
        icon.style.width = "128px";
        icon.style.height = "128px";
        icon.style.minWidth = "128px";
        icon.style.imageRendering = "pixelated";

        // Speaker name
        const speaker = document.createElement("div");
        speaker.id = "dialog_speaker";
        speaker.style.fontSize = "12px";
        speaker.style.color = "#886666";
        speaker.style.letterSpacing = "3px";
        speaker.innerHTML = "THE BARGAINER";

        header.appendChild(icon);
        header.appendChild(speaker);

        // Text content
        const text = document.createElement("div");
        text.id = "dialog_text";
        text.innerHTML = "";

        // Continue hint
        const hint = document.createElement("div");
        hint.id = "dialog_hint";
        hint.style.fontSize = "11px";
        hint.style.color = "#554444";
        hint.style.marginTop = "12px";
        hint.style.textAlign = "right";
        hint.innerHTML = "click to continue...";

        // Choice container (hidden by default)
        const choices = document.createElement("div");
        choices.id = "dialog_choices";
        choices.style.display = "none";
        choices.style.marginTop = "16px";

        // Inner content frame with white border
        const contentFrame = document.createElement("div");
        contentFrame.id = "dialog_content_frame";
        contentFrame.style.border = "6px solid #ccaaaa";
        contentFrame.style.padding = "20px";

        contentFrame.appendChild(header);
        contentFrame.appendChild(text);
        contentFrame.appendChild(hint);
        contentFrame.appendChild(choices);
        overlay.appendChild(contentFrame);
        wrapper.appendChild(overlay);

        // Click handler for advancing dialog
        overlay.addEventListener("click", (e) => {
            // Don't advance if clicking on a choice button
            if (e.target.classList.contains('dialog-choice-btn')) return;
            this.advanceDialog();
        });
    }

    startDialog() {
        const lines = this.gameState.bargainRefused ? this.dialogLinesReturn : this.dialogLinesFirst;
        this.gameState.dialogState = 'showing';
        this.gameState.dialogLineIndex = 0;

        const overlay = document.getElementById("dialog_overlay");
        const text = document.getElementById("dialog_text");
        const hint = document.getElementById("dialog_hint");
        const choices = document.getElementById("dialog_choices");

        overlay.style.display = "flex";
        text.innerHTML = lines[0];
        hint.style.display = "block";
        choices.style.display = "none";
    }

    advanceDialog() {
        if (this.gameState.dialogState === 'sealed') {
            // Show icon number 4 for a very short time
            const icon = document.getElementById("dialog_icon");
            icon.src = "../icons/bargainer_4_128x128.png";
            setTimeout(() => {
                this.closeDialog();
                const icon = document.getElementById("dialog_icon");
                icon.src = "../icons/bargainer_2_128x128.png";
            }, 100);
            // this.closeDialog();
            return;
        }
        if (this.gameState.dialogState === 'refused') {
            this.closeDialog();
            return;
        }
        if (this.gameState.dialogState !== 'showing') return;

        const lines = this.gameState.bargainRefused ? this.dialogLinesReturn : this.dialogLinesFirst;
        this.gameState.dialogLineIndex++;

        if (this.gameState.dialogLineIndex >= lines.length) {
            // Show choices
            this.showChoices();
        } else {
            const text = document.getElementById("dialog_text");
            text.innerHTML = lines[this.gameState.dialogLineIndex];
            const icon = document.getElementById("dialog_icon");
            icon.src = "../icons/bargainer_2_128x128.png";
        }
    }

    showChoices() {
        this.gameState.dialogState = 'choosing';
        const hint = document.getElementById("dialog_hint");
        const choices = document.getElementById("dialog_choices");
        const text = document.getElementById("dialog_text");

        text.innerHTML = "";
        hint.style.display = "none";
        choices.style.display = "block";
        choices.innerHTML = "";

        const choiceData = [
            // { label: "> Surrender your spleen, eyes and heart", action: 'spleen_eyes_and_heart' },
            { label: "> Surrender your spleen, and eyes", action: 'spleen_and_eyes' },
            // { label: "> Surrender your spleen", action: 'spleen' },
            { label: "> Refuse", action: 'refuse' },
        ];

        choiceData.forEach(c => {
            const btn = document.createElement("div");
            btn.className = "dialog-choice-btn";
            btn.style.padding = "8px 16px";
            btn.style.marginBottom = "6px";
            btn.style.cursor = "pointer";
            btn.style.color = "#aa8888";
            btn.style.fontFamily = "'Press Start 2P', monospace";
            btn.style.fontSize = "12px";
            btn.style.borderLeft = "2px solid transparent";
            btn.style.transition = "all 0.15s";
            btn.innerHTML = c.label;

            btn.addEventListener("mouseenter", () => {
                btn.style.color = "#eecccc";
                btn.style.borderLeftColor = "#aa4444";
                btn.style.paddingLeft = "24px";
            });
            btn.addEventListener("mouseleave", () => {
                btn.style.color = "#aa8888";
                btn.style.borderLeftColor = "transparent";
                btn.style.paddingLeft = "16px";
            });
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.selectChoice(c.action);
            });

            choices.appendChild(btn);
        });
    }

    selectChoice(action) {
        const text = document.getElementById("dialog_text");
        const hint = document.getElementById("dialog_hint");
        const choices = document.getElementById("dialog_choices");
        const icon = document.getElementById("dialog_icon");

        choices.style.display = "none";
        hint.style.display = "block";
        hint.innerHTML = "click to close...";

        if (action === 'refuse') {
            text.innerHTML = this.dialogLineRefused;
            this.gameState.dialogState = 'refused';
            this.gameState.bargainRefused = true;
        } else {
            text.innerHTML = this.dialogLineSealed;
            icon.src = "../icons/bargainer_2_128x128.png";
            this.gameState.dialogState = 'sealed';
            this.gameState.bargainCompleted = true;
            // Apply the bargain
            this.gameState.playerMoveMode = "4D";
            this.gameState.playerEyeMode = "WideOpen->Lidded";
            // Hide the bargainer
            if (this.poIs.bargainerIndex !== undefined) {
                this.scene.visibleHyperobjects[this.poIs.bargainerIndex].pose.setTranslation(new Vector4D(0, 0, -10000, 0));
            }
        }
    }

    closeDialog() {
        const overlay = document.getElementById("dialog_overlay");
        overlay.style.display = "none";
        this.gameState.dialogState = 'none';
    }

    createTutorialOverlay() {
        const canvas = this.scene.mainCanvas;
        const wrapper = canvas.parentNode; // reuse wrapper created by createDialogOverlay

        const overlay = document.createElement("div");
        overlay.id = "tutorial_overlay";
        overlay.style.position = "absolute";
        overlay.style.top = "16px";
        overlay.style.left = "16px";
        overlay.style.right = "16px";
        overlay.style.bottom = "16px";
        overlay.style.display = "none";
        overlay.style.zIndex = "2000";
        overlay.style.cursor = "pointer";
        overlay.style.boxSizing = "border-box";
        overlay.style.padding = "20px";
        overlay.style.flexDirection = "column";
        overlay.style.justifyContent = "center";
        overlay.style.backgroundColor = "transparent";
        overlay.style.border = "none";
        overlay.style.borderRadius = "4px";
        overlay.style.fontFamily = "'Press Start 2P', monospace";
        overlay.style.fontSize = "12px";
        overlay.style.color = "#ccaaaa";
        overlay.style.lineHeight = "1.6";
        overlay.style.textShadow = "0 0 8px rgba(150, 50, 50, 0.3)";
        overlay.style.overflow = "auto";

        // Inner content frame with border
        const contentFrame = document.createElement("div");
        contentFrame.id = "tutorial_content_frame";
        contentFrame.style.border = "6px solid #ccaaaa";
        contentFrame.style.padding = "20px";
        contentFrame.style.display = "flex";
        contentFrame.style.flexDirection = "column";
        contentFrame.style.alignItems = "center";
        contentFrame.style.backgroundColor = "#0f0505";

        // Title
        const title = document.createElement("div");
        title.id = "tutorial_title";
        title.style.fontSize = "16px";
        title.style.color = "#886666";
        title.style.letterSpacing = "3px";
        title.style.marginBottom = "16px";
        title.style.textAlign = "center";
        title.innerHTML = "";

        // Text (above gif)
        const text = document.createElement("div");
        text.id = "tutorial_text";
        text.style.marginBottom = "16px";
        text.style.textAlign = "center";
        text.innerHTML = "";

        // GIF placeholder
        const gifContainer = document.createElement("div");
        gifContainer.id = "tutorial_gif";
        gifContainer.style.width = "320px";
        gifContainer.style.height = "200px";
        // gifContainer.style.border = "2px solid #442222";
        gifContainer.style.backgroundColor = "#1a0808";
        gifContainer.style.display = "flex";
        gifContainer.style.alignItems = "center";
        gifContainer.style.justifyContent = "center";
        gifContainer.style.marginBottom = "16px";
        gifContainer.style.imageRendering = "pixelated";
        gifContainer.innerHTML = '<div style="color: #554444; font-size: 10px;"></div>';

        // Continue hint
        const hint = document.createElement("div");
        hint.style.fontSize = "11px";
        hint.style.color = "#554444";
        hint.style.marginTop = "12px";
        hint.style.textAlign = "right";
        hint.style.alignSelf = "stretch";
        hint.innerHTML = "click to continue...";

        contentFrame.appendChild(title);
        contentFrame.appendChild(text);
        contentFrame.appendChild(gifContainer);
        contentFrame.appendChild(hint);
        overlay.appendChild(contentFrame);
        wrapper.appendChild(overlay);

        // Click handler to close
        overlay.addEventListener("click", () => {
            this.closeTutorial();
        });
    }

    showTutorial(zone) {
        // Ignore tutorials in GOD MODE
        if (this.gameState.GOD_MODE) return;

        // Reveal ammo bar, weapon icon, and unlock shooting when combat tutorial is reached
        if (zone.id === "corridor3_shooting") {
            this.gameState.shootingUnlocked = true;
            const ammoContainer = document.getElementById("hud_ammo_container");
            const weaponIcon = document.getElementById("hud_weapon_icon");
            if (ammoContainer) ammoContainer.style.display = "flex";
            if (weaponIcon) weaponIcon.style.display = "flex";
        }

        this.gameState.tutorialsShown.add(zone.id);
        this.gameState.tutorialActive = true;
        this.gameState.dialogState = 'tutorial';
        if (this.engineState) { this.engineState.paused = true; }

        const overlay = document.getElementById("tutorial_overlay");
        const title = document.getElementById("tutorial_title");
        const text = document.getElementById("tutorial_text");
        const gifContainer = document.getElementById("tutorial_gif");

        title.innerHTML = zone.title;
        text.innerHTML = zone.text;

        // Populate gif container with video + overlay image if provided
        if (zone.video) {
            gifContainer.innerHTML = "";
            gifContainer.style.position = "relative";
            gifContainer.style.overflow = "hidden";

            const video = document.createElement("video");
            video.src = zone.video;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.style.width = "100%";
            video.style.height = "100%";
            video.style.objectFit = "cover";
            video.style.imageRendering = "pixelated";
            gifContainer.appendChild(video);

            if (zone.overlay) {
                const img = document.createElement("img");
                img.src = zone.overlay;
                img.style.position = "absolute";
                img.style.top = "0";
                img.style.left = "0";
                img.style.width = "100%";
                img.style.height = "100%";
                img.style.objectFit = "contain";
                img.style.pointerEvents = "none";
                img.style.imageRendering = "pixelated";
                gifContainer.appendChild(img);

                // Resize container to match overlay aspect ratio
                img.onload = () => {
                    const aspect = img.naturalWidth / img.naturalHeight;
                    const w = gifContainer.offsetWidth;
                    gifContainer.style.height = Math.round(w / aspect) + "px";
                };
            }
        } else {
            if (zone.overlay) {
                gifContainer.innerHTML = "";
                gifContainer.style.position = "relative";
                gifContainer.style.overflow = "hidden";

                const img = document.createElement("img");
                img.src = zone.overlay;
                img.style.position = "absolute";
                img.style.top = "0";
                img.style.left = "0";
                img.style.width = "100%";
                img.style.height = "100%";
                img.style.objectFit = "contain";
                img.style.pointerEvents = "none";
                img.style.imageRendering = "pixelated";
                gifContainer.appendChild(img);

                // Resize container to match overlay aspect ratio
                img.onload = () => {
                    const aspect = img.naturalWidth / img.naturalHeight;
                    const w = gifContainer.offsetWidth;
                    gifContainer.style.height = Math.round(w / aspect) + "px";
                };
            } else {
                gifContainer.innerHTML = '<div style="color: #554444; font-size: 10px;">[ GIF ]</div>';
            }
        }

        overlay.style.display = "flex";
    }

    closeTutorial() {
        const overlay = document.getElementById("tutorial_overlay");
        overlay.style.display = "none";
        this.gameState.tutorialActive = false;
        this.gameState.dialogState = 'none';
        if (this.engineState) { this.engineState.paused = false; }

        // Stop and remove any tutorial video
        const gifContainer = document.getElementById("tutorial_gif");
        const video = gifContainer.querySelector("video");
        if (video) {
            video.pause();
            video.src = "";
        }
        gifContainer.innerHTML = '<div style="color: #554444; font-size: 10px;">[ GIF ]</div>';
    }

    createLevelCompleteOverlay() {
        const canvas = this.scene.mainCanvas;
        const wrapper = canvas.parentNode; // reuse wrapper created by createDialogOverlay

        const overlay = document.createElement("div");
        overlay.id = "level_complete_overlay";
        overlay.style.position = "absolute";
        overlay.style.top = "16px";
        overlay.style.left = "16px";
        overlay.style.right = "16px";
        overlay.style.bottom = "16px";
        overlay.style.display = "none";
        overlay.style.zIndex = "2000";
        overlay.style.cursor = "pointer";
        overlay.style.boxSizing = "border-box";
        overlay.style.padding = "20px";
        overlay.style.flexDirection = "column";
        overlay.style.justifyContent = "center";
        overlay.style.backgroundColor = "#0f0505";
        overlay.style.border = "1px solid #442222";
        overlay.style.borderRadius = "4px";
        overlay.style.fontFamily = "'Press Start 2P', monospace";
        overlay.style.fontSize = "12px";
        overlay.style.color = "#ccaaaa";
        overlay.style.lineHeight = "1.6";
        overlay.style.textShadow = "0 0 8px rgba(150, 50, 50, 0.3)";
        overlay.style.overflow = "auto";

        // Header row
        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.gap = "12px";
        header.style.marginBottom = "16px";

        // Gem icon (yellow diamond shape using CSS)
        const icon = document.createElement("div");
        icon.style.width = "64px";
        icon.style.height = "64px";
        icon.style.minWidth = "64px";
        icon.style.backgroundColor = "#ffff00";
        icon.style.transform = "rotate(45deg)";
        icon.style.boxShadow = "0 0 20px rgba(255, 255, 0, 0.5)";

        // Title
        const title = document.createElement("div");
        title.style.fontSize = "16px";
        title.style.color = "#ffdd44";
        title.style.letterSpacing = "3px";
        title.style.marginLeft = "10px";
        title.innerHTML = "LEVEL COMPLETE";

        header.appendChild(icon);
        header.appendChild(title);

        // Stats content
        const stats = document.createElement("div");
        stats.id = "level_complete_stats";
        stats.style.marginTop = "16px";
        stats.style.lineHeight = "2.4";
        stats.innerHTML = "";

        // Continue hint
        const hint = document.createElement("div");
        hint.style.fontSize = "11px";
        hint.style.color = "#554444";
        hint.style.marginTop = "24px";
        hint.style.textAlign = "right";
        hint.innerHTML = "More Levels in the Works...";

        // Content frame
        const contentFrame = document.createElement("div");
        contentFrame.style.border = "6px solid #ccaaaa";
        contentFrame.style.padding = "20px";

        contentFrame.appendChild(header);
        contentFrame.appendChild(stats);
        contentFrame.appendChild(hint);
        overlay.appendChild(contentFrame);
        wrapper.appendChild(overlay);

        // Click to close
        overlay.addEventListener("click", () => {
            // overlay.style.display = "none";
            // this.gameState.dialogState = 'none';
        });
    }

    showLevelComplete(engineState) {
        // Calculate stats
        const elapsedTime = engineState.physics_time_s - (this.gameState.levelStartTime || 0);
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = Math.floor(elapsedTime % 60);
        const timeStr = String(minutes).padStart(2, '0') + ":" + String(seconds).padStart(2, '0');

        const totalEnemies = this.gameState.shadeEnemies.length
            + this.gameState.crawlerEnemies.length
            + this.gameState.ophaneEnemies.length;
        const killed = this.gameState.enemiesKilled;

        const bargainStatus = this.gameState.bargainCompleted ? "Accepted" : "Refused";

        // Populate stats
        const stats = document.getElementById("level_complete_stats");
        stats.innerHTML =
            `> Time ........... ${timeStr}<br>` +
            `> Kills .......... ${killed} / ${totalEnemies}<br>` +
            `> The Bargain .... ${bargainStatus}`;

        // Show overlay and block input
        const overlay = document.getElementById("level_complete_overlay");
        overlay.style.display = "flex";
        this.gameState.dialogState = 'levelcomplete';
    }

    createGameOverOverlay() {
        const canvas = this.scene.mainCanvas;
        const wrapper = canvas.parentNode;

        const overlay = document.createElement("div");
        overlay.id = "game_over_overlay";
        overlay.style.position = "absolute";
        overlay.style.top = "16px";
        overlay.style.left = "16px";
        overlay.style.right = "16px";
        overlay.style.bottom = "16px";
        overlay.style.display = "none";
        overlay.style.zIndex = "2000";
        overlay.style.cursor = "pointer";
        overlay.style.boxSizing = "border-box";
        overlay.style.padding = "20px";
        overlay.style.flexDirection = "column";
        overlay.style.justifyContent = "center";
        overlay.style.backgroundColor = "#0f0505";
        overlay.style.border = "1px solid #442222";
        overlay.style.borderRadius = "4px";
        overlay.style.fontFamily = "'Press Start 2P', monospace";
        overlay.style.fontSize = "12px";
        overlay.style.color = "#ccaaaa";
        overlay.style.lineHeight = "1.6";
        overlay.style.textShadow = "0 0 8px rgba(150, 50, 50, 0.3)";
        overlay.style.overflow = "auto";

        // Header row
        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.gap = "12px";
        header.style.marginBottom = "16px";

        // Skull icon (red X shape using CSS)
        const icon = document.createElement("div");
        icon.style.width = "64px";
        icon.style.height = "64px";
        icon.style.minWidth = "64px";
        icon.style.backgroundColor = "#cc2222";
        icon.style.transform = "rotate(45deg)";
        icon.style.boxShadow = "0 0 20px rgba(255, 50, 50, 0.5)";

        // Title
        const title = document.createElement("div");
        title.style.fontSize = "16px";
        title.style.color = "#ff4444";
        title.style.letterSpacing = "3px";
        title.style.marginLeft = "10px";
        title.innerHTML = "GAME OVER";

        header.appendChild(icon);
        header.appendChild(title);

        // Stats content
        const stats = document.createElement("div");
        stats.id = "game_over_stats";
        stats.style.marginTop = "16px";
        stats.style.lineHeight = "2.4";
        stats.innerHTML = "";

        // Continue hint
        const hint = document.createElement("div");
        hint.style.fontSize = "11px";
        hint.style.color = "#554444";
        hint.style.marginTop = "24px";
        hint.style.textAlign = "right";
        hint.innerHTML = "Reload the page to try again...";

        // Content frame
        const contentFrame = document.createElement("div");
        contentFrame.style.border = "6px solid #cc4444";
        contentFrame.style.padding = "20px";

        contentFrame.appendChild(header);
        contentFrame.appendChild(stats);
        contentFrame.appendChild(hint);
        overlay.appendChild(contentFrame);
        wrapper.appendChild(overlay);

        // Click to close
        overlay.addEventListener("click", () => {
            // overlay.style.display = "none";
            // this.gameState.dialogState = 'none';
        });
    }

    showGameOver(engineState) {
        // Calculate stats
        const elapsedTime = engineState.physics_time_s - (this.gameState.levelStartTime || 0);
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = Math.floor(elapsedTime % 60);
        const timeStr = String(minutes).padStart(2, '0') + ":" + String(seconds).padStart(2, '0');

        const totalEnemies = this.gameState.shadeEnemies.length
            + this.gameState.crawlerEnemies.length
            + this.gameState.ophaneEnemies.length;
        const killed = this.gameState.enemiesKilled;

        const bargainStatus = this.gameState.bargainCompleted ? "Accepted" : "Refused";

        // Populate stats
        const stats = document.getElementById("game_over_stats");
        stats.innerHTML =
            `> Time ........... ${timeStr}<br>` +
            `> Kills .......... ${killed} / ${totalEnemies}<br>` +
            `> The Bargain .... ${bargainStatus}`;

        // Show overlay and block input
        const overlay = document.getElementById("game_over_overlay");
        overlay.style.display = "flex";
        this.gameState.dialogState = 'gameover';
    }

    updateDialog(engineState) {
        // Check proximity to bargainer
        if (this.gameState.dialogState === 'none' && !this.gameState.bargainCompleted && this.poIs.bargainerPos) {
            let playerPos = engineState.camstand_T.origin();
            let bargainerPos = this.poIs.bargainerPos;
            let dx = playerPos.x - bargainerPos.x;
            let dy = playerPos.y - bargainerPos.y;
            let dw = playerPos.w - bargainerPos.w;
            let dist = Math.sqrt(dx * dx + dy * dy + dw * dw);

            const triggerDistance = 3.0;
            if (dist < triggerDistance) {
                if (!this.gameState.bargainTriggered) {
                    this.gameState.bargainTriggered = true;
                    this.startDialog();
                }
            } else {
                // Reset trigger when player walks away
                this.gameState.bargainTriggered = false;
            }
        }

        // Check tutorial zone AABBs
        if (this.gameState.dialogState === 'none' && this.poIs.tutorialZones) {
            let playerPos = engineState.camstand_T.origin();
            for (let i = 0; i < this.poIs.tutorialZones.length; i++) {
                let zone = this.poIs.tutorialZones[i];
                if (this.gameState.tutorialsShown.has(zone.id)) continue;
                if (zone.requireBargain && !this.gameState.bargainCompleted) continue;
                let min = zone.aabbMin;
                let max = zone.aabbMax;
                if (playerPos.x >= min.x && playerPos.x <= max.x &&
                    playerPos.y >= min.y && playerPos.y <= max.y &&
                    playerPos.z >= min.z && playerPos.z <= max.z &&
                    playerPos.w >= min.w && playerPos.w <= max.w) {
                    this.showTutorial(zone);
                    break;
                }
            }
        }

        // Show shade-unblink tutorial once eye finishes closing
        if (this.gameState.shadeUnblinkTutorialPending
            && this.gameState.dialogState === 'none'
            && (this.gameState.playerEyeMode === "Lidded" || this.gameState.playerEyeMode === "Human")) {
            this.showTutorial({
                id: "shade_unblink_hit",
                title: "MADE YOU BLINK",
                text: "Getting hurt by an enemy while in Unblink will force you back to the normal view for a short time.<br>Make sure to switch often between views and watch your surroundings.",
            });
            this.gameState.shadeUnblinkTutorialPending = false;
        }
    }

    updateHUD() {
        const healthBar = document.getElementById("hud_health_bar");
        const healthValue = document.getElementById("hud_health_value");
        const ammoBar = document.getElementById("hud_ammo_bar");
        const ammoValue = document.getElementById("hud_ammo_value");

        if (healthBar && healthValue) {
            const healthPercent = (this.gameState.playerHealth / this.gameState.playerMaxHealth) * 100;
            healthBar.style.width = healthPercent + "%";
            healthValue.innerHTML = Math.round(this.gameState.playerHealth);
        }

        const burnBarOuter = document.getElementById("hud_burn_bar_outer");
        const burnBar = document.getElementById("hud_burn_bar");
        if (burnBarOuter && burnBar) {
            const burnLevel = this.gameState.burnLevel;
            if (burnLevel > 0) {
                burnBarOuter.style.display = "block";
                const maxBurnTime = 1.0;
                const burnPercent = Math.min(burnLevel / maxBurnTime, 1.0) * 100;
                burnBar.style.width = burnPercent + "%";
            } else {
                burnBarOuter.style.display = "none";
            }
        }

        if (ammoBar && ammoValue) {
            if (this.gameState.ammoReloading) {
                const reloadPercent = this.gameState.ammoReloadProgress * 100;
                ammoBar.style.width = reloadPercent + "%";
                ammoBar.style.backgroundColor = "#888";
                ammoValue.innerHTML = "RELOADING";
            } else {
                const ammoPercent = (this.gameState.playerAmmo / this.gameState.playerMaxAmmo) * 100;
                ammoBar.style.width = ammoPercent + "%";
                ammoBar.style.backgroundColor = "#c90";
                ammoValue.innerHTML = Math.round(this.gameState.playerAmmo);
            }
        }

        if (this.gameState.playerEyeMode === "Human") {
            const eyeIcon = document.getElementById("hud_left_icon");
            if (eyeIcon) {
                eyeIcon.innerHTML = `<img src="../icons/human_eye_256x256.png" style="width: 64px; height: 64px"></img>`;
            }
        }
        if (this.gameState.playerEyeMode === "Lidded") {
            const eyeIcon = document.getElementById("hud_left_icon");
            if (eyeIcon) {
                eyeIcon.innerHTML = `<img src="../icons/dimensional_eye_half_lidded_64x64.png"></img>`;
            }
        }
        if (this.gameState.playerEyeMode === "WideOpen") {
            const eyeIcon = document.getElementById("hud_left_icon");
            if (eyeIcon) {
                eyeIcon.innerHTML = `<img src="../icons/dimensional_eye_wideopen_4D_64x64.png"></img>`;
            }
        }
        if (this.gameState.playerEyeMode === "Lidded->WideOpen" || this.gameState.playerEyeMode === "WideOpen->Lidded") {
            const eyeIcon = document.getElementById("hud_left_icon");
            if (eyeIcon) {
                eyeIcon.innerHTML = `<img src="../icons/dimensional_eye_lidded_64x64.png"></img>`;
            }
        }

        // Boss health bar
        const bossContainer = document.getElementById("boss_health_container");
        const bossBar = document.getElementById("boss_health_bar");
        const bossValue = document.getElementById("boss_health_value");
        if (bossContainer && bossBar && bossValue) {
            if (this.gameState.ophaneEnemies.length > 0) {
                let boss = this.gameState.ophaneEnemies[0];
                let showBar = boss.hp > 0 && (boss.bossState === 'rising' || boss.bossState === 'active');
                if (showBar) {
                    bossContainer.style.display = "flex";
                    const bossPercent = (boss.hp / boss.maxHp) * 100;
                    bossBar.style.width = bossPercent + "%";
                    bossValue.innerHTML = Math.round(boss.hp) + " / " + boss.maxHp;
                } else {
                    bossContainer.style.display = "none";
                }
            }
        }
    }

    teleportTo(x, y, z, w) {
        this.gameState.pendingTeleport = { x, y, z, w };
    }

    updateEnemies(engineState) {
        // Shades:
        for (let i = 0; i < this.gameState.shadeEnemies.length; i++) {
            this.gameState.shadeEnemies[i].updateShade(this.gameState, engineState);
        }

        // Crawlers:
        for (let i = 0; i < this.gameState.crawlerEnemies.length; i++) {
            this.gameState.crawlerEnemies[i].updateCrawler(this.gameState, engineState);
        }

        // Boss activation: two-phase proximity trigger
        if (this.poIs.room6Center) {
            let playerPos = engineState.camstand_T.origin();
            let room6C = this.poIs.room6Center;
            let dx = playerPos.x - room6C.x;
            let dy = playerPos.y - room6C.y;
            let dw = playerPos.w - room6C.w;
            let distXYW = Math.sqrt(dx * dx + dy * dy + dw * dw);

            // Phase 1: player enters outer room radius
            if (this.gameState.bossPhase === 0 && distXYW < this.poIs.room6OuterRadius) {
                this.gameState.bossPhase = 1;
                this.audioManager.playMusic("boss");
                for (let i = 0; i < this.gameState.ophaneEnemies.length; i++) {
                    if (this.gameState.ophaneEnemies[i].bossState === 'dormant') {
                        this.gameState.ophaneEnemies[i].startRising(this.gameState, engineState);
                    }
                }
                // Show boss entrance magic wall to trap player in the arena
                if (this.poIs.bossEntranceWallIdx !== null && this.bossEntranceWallOriginalPose) {
                    let wall = this.scene.visibleHyperobjects[this.poIs.bossEntranceWallIdx];
                    wall.pose = this.bossEntranceWallOriginalPose;
                    wall.collider.updateParentPose(wall.pose);
                    this.audioManager.playSfx("doorClose");
                }
            }

            // Phase 2: player enters inner bridge shell radius
            if (this.gameState.bossPhase === 2 && distXYW < this.poIs.room6InnerRadius) {
                this.gameState.bossPhase = 3;
                for (let i = 0; i < this.gameState.ophaneEnemies.length; i++) {
                    if (this.gameState.ophaneEnemies[i].bossState === 'dormant') {
                        this.gameState.ophaneEnemies[i].startRising(this.gameState, engineState);
                    }
                }
            }
        }

        // Ophanes
        for (let i = 0; i < this.gameState.ophaneEnemies.length; i++) {
            this.gameState.ophaneEnemies[i].updateOphane(this.gameState, engineState);
        }

        // Update enemy bullets
        let eb_i = 0;
        while (eb_i < this.gameState.enemyBullets.length) {
            this.gameState.enemyBullets[eb_i].updateBullet(
                engineState.physics_time_s,
                this.gameState.enemyBulletPrimitives,
                this.gameState.enemyBullets,
                eb_i
            );
            eb_i++;
        }

        // Check enemy bullets against player
        eb_i = 0;
        while (eb_i < this.gameState.enemyBullets.length) {
            let enemyBullet = this.gameState.enemyBullets[eb_i];
            let bulletPos = enemyBullet.currentPos();
            let playerPos = engineState.hypercamera_T.origin();
            let dist = bulletPos.subtract(playerPos).magnitude();
            if (dist < 1.0 + enemyBullet.bulletRadius) {
                if (this.gameState.playerHealth > 0 && this.gameState.playerInvulnLastHitTime + this.gameState.playerInvulnTime < engineState.physics_time_s) {
                    this.gameState.playerHealth -= 10;
                    this.gameState.playerInvulnLastHitTime = engineState.physics_time_s;
                    this.audioManager.playSfx("playerHit");
                }
                enemyBullet.destroyBullet(this.gameState.enemyBulletPrimitives, this.gameState.enemyBullets, eb_i);
            } else {
                eb_i++;
            }
        }

        // Update ophane bullets
        let ob_i = 0;
        while (ob_i < this.gameState.ophaneBullets.length) {
            this.gameState.ophaneBullets[ob_i].updateBullet(
                engineState.physics_time_s,
                this.gameState.ophaneBulletPrimitives,
                this.gameState.ophaneBullets,
                ob_i
            );
            ob_i++;
        }

        // Check ophane bullets against player
        ob_i = 0;
        while (ob_i < this.gameState.ophaneBullets.length) {
            let ophaneBullet = this.gameState.ophaneBullets[ob_i];
            let bulletPos = ophaneBullet.currentPos();
            let playerPos = engineState.hypercamera_T.origin();
            let dist = bulletPos.subtract(playerPos).magnitude();
            if (dist < 1.0 + ophaneBullet.bulletRadius) {
                if (this.gameState.playerHealth > 0 && this.gameState.playerInvulnLastHitTime + this.gameState.playerInvulnTime < engineState.physics_time_s) {
                    this.gameState.playerHealth -= 10;
                    this.gameState.playerInvulnLastHitTime = engineState.physics_time_s;
                    this.audioManager.playSfx("playerHit");
                }
                ophaneBullet.destroyBullet(this.gameState.ophaneBulletPrimitives, this.gameState.ophaneBullets, ob_i);
            } else {
                ob_i++;
            }
        }
    }

    //Called by the hyperengine at every timestep
    updatePlayerControls(engineState) {
        this.engineState = engineState; // store ref for tutorial pause/unpause

        // Apply pending teleport from debug panel
        if (this.gameState.pendingTeleport) {
            engineState.camstand_T.matrix[0][4] = this.gameState.pendingTeleport.x;
            engineState.camstand_T.matrix[1][4] = this.gameState.pendingTeleport.y;
            engineState.camstand_T.matrix[2][4] = this.gameState.pendingTeleport.z;
            engineState.camstand_T.matrix[3][4] = this.gameState.pendingTeleport.w;
            // Reset fall state so we don't trigger a spurious fall after teleport
            this.gameState.previousFloorHeight = engineState.scene.floor_heightmap(
                this.gameState.pendingTeleport.x,
                this.gameState.pendingTeleport.y,
                this.gameState.pendingTeleport.w
            );
            this.gameState.playerIsFalling = false;
            engineState.player_is_jumping = false;
            this.gameState.pendingTeleport = null;
        }

        // First Step callback
        if (this.gameState.isFirstStep) {
            this.gameState.isFirstStep = false;

            // Hide loading div
            document.getElementById('loading-div').style.display = 'none';

            // DEBUG Remove before flight: debugging quick init
            // -----
            if (DEBUG_MODE) {
                this.gameState.GOD_MODE = true;
                document.getElementById('god_mode_checkbox').checked = true;
                // Bargain accepted
                this.gameState.bargainCompleted = true;
                this.gameState.playerMoveMode = "4D";
                this.gameState.playerEyeMode = "WideOpen->Lidded";
            } else {
                // Hide the help div from hyperengine
                const help_div = document.getElementById("help-div");
                if (help_div) { help_div.style.display = "none"; }
            }
            // -----

            // Set a few things
            engineState.SENSOR_MODE = 0;
            // Record level start time
            this.gameState.levelStartTime = engineState.physics_time_s;
            this.audioManager.playMusic("main");
            // Initialize floor height tracking
            this.gameState.previousFloorHeight = engineState.scene.floor_heightmap(
                engineState.camstand_T.matrix[0][4],
                engineState.camstand_T.matrix[1][4],
                engineState.camstand_T.matrix[3][4]
            );
            // Hide boss entrance magic wall initially (save original pose to restore later)
            if (this.poIs.bossEntranceWallIdx !== null) {
                let wall = this.scene.visibleHyperobjects[this.poIs.bossEntranceWallIdx];
                this.bossEntranceWallOriginalPose = wall.pose.clone();
                wall.pose.setTranslation(new Vector4D(0, 0, -10000, 0));
                wall.collider.updateParentPose(wall.pose);
            }
            // Hide room 2 magic wall initially (save original pose to restore later)
            if (this.poIs.room2MagicWallIdx !== null) {
                let wall = this.scene.visibleHyperobjects[this.poIs.room2MagicWallIdx];
                this.room2WallOriginalPose = wall.pose.clone();
                wall.pose.setTranslation(new Vector4D(0, 0, -10000, 0));
                wall.collider.updateParentPose(wall.pose);
            }
        }

        // Update enemies
        this.updateEnemies(engineState);

        // Check if player HP has reached 0
        if (!this.gameState.gameOver && !this.gameState.GOD_MODE && this.gameState.playerHealth <= 0) {
            this.gameState.gameOver = true;
            this.gameState.playerHealth = 0;
            playGameSfx(this.gameState, "playerDeath");
            this.showGameOver(engineState);
        }

        // Check if player touches end gem
        if (this.gameState.gemState === 'arrived' && !this.gameState.levelComplete && this.endGemPrimitiveIndex !== undefined) {
            let playerPos = engineState.camstand_T.origin();
            let gemPos = this.scene.visibleHyperobjects[this.endGemPrimitiveIndex].pose.origin();
            let dx = playerPos.x - gemPos.x;
            let dy = playerPos.y - gemPos.y;
            let dw = playerPos.w - gemPos.w;
            let dist = Math.sqrt(dx * dx + dy * dy + dw * dw);
            if (dist < 5.0) {
                this.gameState.levelComplete = true;
                this.showLevelComplete(engineState);
            }
        }

        // Room 2 magic wall: appears when player enters room 2
        if (!this.gameState.room2WallShown && this.poIs.room2MagicWallIdx !== null && this.poIs.room2MagicWallCenter) {
            let playerPos = engineState.camstand_T.origin();
            let wallC = this.poIs.room2MagicWallCenter;
            if (playerPos.x < wallC.x - 1.0) {
                this.gameState.room2WallShown = true;
                let wall = this.scene.visibleHyperobjects[this.poIs.room2MagicWallIdx];
                wall.pose = this.room2WallOriginalPose;
                wall.collider.updateParentPose(wall.pose);
                this.audioManager.playSfx("doorClose");
            }
        }

        // Dialog system
        this.updateDialog(engineState);
        if (this.gameState.dialogState !== 'none') {
            // Block all player input during dialog - skip to camera/floor computation
            this.updateCameraAndFloor(engineState);
            this.updateHUD();
            return;
        }

        // Smooth forced look-at (e.g. after shade hit)
        if (this.gameState.forceLookAtPos !== null) {
            let elapsed = engineState.physics_time_s - this.gameState.forceLookAtStartTime;
            let t = Math.min(1.0, elapsed / this.gameState.forceLookAtDuration);
            let m = engineState.camstand_T.matrix;
            let op = this.gameState.forceLookAtOriginalPose;
            let toTarget = this.gameState.forceLookAtPos.subtract(engineState.camstand_T.origin());
            if (toTarget.magnitude() > 0.001 && op) {
                let ex = new Vector4D(1, 0, 0, 0);
                let ey = new Vector4D(0, 1, 0, 0);
                let ez = new Vector4D(0, 0, 1, 0);
                let ew = new Vector4D(0, 0, 0, 1);
                let oX = op.transform_vector(ex);
                let oY = op.transform_vector(ey);
                let oZ = op.transform_vector(ez);
                let oW = op.transform_vector(ew);
                // Target X: direction to shade, projected orthogonal to Z
                let dir = toTarget.normalize();
                let targetX = dir.subtract(oZ.multiply_by_scalar(dir.dot(oZ))).normalize();
                // Target Y: original Y, re-orthogonalized against targetX and Z
                let ty = oY.subtract(targetX.multiply_by_scalar(oY.dot(targetX)));
                let targetY = ty.subtract(oZ.multiply_by_scalar(ty.dot(oZ))).normalize();
                // Target W: original W, re-orthogonalized against targetX, targetY, Z
                let tw = oW.subtract(targetX.multiply_by_scalar(oW.dot(targetX)));
                tw = tw.subtract(targetY.multiply_by_scalar(tw.dot(targetY)));
                let targetW = tw.subtract(oZ.multiply_by_scalar(tw.dot(oZ))).normalize();
                // Lerp from original to target
                let newX = oX.multiply_by_scalar(1 - t).add(targetX.multiply_by_scalar(t)).normalize();
                let newY = oY.multiply_by_scalar(1 - t).add(targetY.multiply_by_scalar(t));
                let newW = oW.multiply_by_scalar(1 - t).add(targetW.multiply_by_scalar(t));
                // Re-orthogonalize interpolated Y and W against newX and Z
                newY = newY.subtract(newX.multiply_by_scalar(newY.dot(newX)));
                newY = newY.subtract(oZ.multiply_by_scalar(newY.dot(oZ))).normalize();
                newW = newW.subtract(newX.multiply_by_scalar(newW.dot(newX)));
                newW = newW.subtract(newY.multiply_by_scalar(newW.dot(newY)));
                newW = newW.subtract(oZ.multiply_by_scalar(newW.dot(oZ))).normalize();
                let isZero = (v) => v.x === 0 && v.y === 0 && v.z === 0 && v.w === 0;
                if (isNaN(newX.x) || isNaN(newY.x) || isNaN(newW.x) ||
                    isZero(newX) || isZero(newY) || isZero(oZ) || isZero(newW)) {
                    console.log("singularity in forced lookat");
                    console.log(newX, newY, newW);
                    // this happens most when facing ophanim, so reset to that view direction
                    m[0][0]=0; m[0][1]=0; m[0][2]=0; m[0][3]=1;
                    m[1][0]=0; m[1][1]=1; m[1][2]=0; m[1][3]=0;
                    m[2][0]=0; m[2][1]=0; m[2][2]=1; m[2][3]=0;
                    m[3][0]=-1; m[3][1]=0; m[3][2]=0; m[3][3]=0;
                } else {
                    m[0][0]=newX.x; m[0][1]=newY.x; m[0][2]=oZ.x; m[0][3]=newW.x;
                    m[1][0]=newX.y; m[1][1]=newY.y; m[1][2]=oZ.y; m[1][3]=newW.y;
                    m[2][0]=newX.z; m[2][1]=newY.z; m[2][2]=oZ.z; m[2][3]=newW.z;
                    m[3][0]=newX.w; m[3][1]=newY.w; m[3][2]=oZ.w; m[3][3]=newW.w;
                }
            }
            if (t >= 1.0) {
                this.gameState.forceLookAtPos = null;
                this.gameState.forceLookAtOriginalPose = null;
            }
        }

        // Mouse
        if (engineState.isDraggingLeftClick) {
            const deltaX = engineState.mouseCurrentClickedX - engineState.lastX;
            const deltaY = engineState.mouseCurrentClickedY - engineState.lastY;
            
            engineState.camstand_T.rotate_self_by_delta('XY', deltaX * 0.01, true);
            if (this.gameState.playerMoveMode === "4D") {
                engineState.camstand_T.rotate_self_by_delta('XW', deltaY * 0.01, true);
            }
            
            engineState.lastX = engineState.mouseCurrentClickedX;
            engineState.lastY = engineState.mouseCurrentClickedY;
        }
        if (engineState.isDraggingRightClick) {
            const deltaX = engineState.mouseCurrentClickedX - engineState.lastXRight;
            const deltaY = engineState.mouseCurrentClickedY - engineState.lastYRight;
            if (this.gameState.playerMoveMode === "4D") {
                engineState.camstand_T.rotate_self_by_delta('YW', deltaX * 0.01, true);
            }
            // engineState.camstandswivel_angle += deltaY * 0.01;
            engineState.lastXRight = engineState.mouseCurrentClickedX;
            engineState.lastYRight = engineState.mouseCurrentClickedY;
        }
        if (engineState.isDraggingMiddleClick) {
            const deltaX = engineState.mouseCurrentClickedX - engineState.lastXMiddle;
            const deltaY = engineState.mouseCurrentClickedY - engineState.lastYMiddle;
            engineState.sensorCamRotY += deltaY * 0.01;
            engineState.sensorCamRotX += deltaX * 0.01;
            engineState.lastXMiddle = engineState.mouseCurrentClickedX;
            engineState.lastYMiddle = engineState.mouseCurrentClickedY;
        }
        if (engineState.mouseScrollActive) {
            engineState.sensorCamDist = engineState.mouseScroll01 * 100 + 1;
            engineState.mouseScrollActive = false;
        }

        const moveSpeed = this.gameState.playerSpeed;
        const RELATIVE_MOVEMENT = true;
        if (engineState.keys['w']) {
            engineState.camstand_T.translate_self_by_delta(moveSpeed, 0, 0, 0, RELATIVE_MOVEMENT);
        }
        if (engineState.keys['s']) {
            engineState.camstand_T.translate_self_by_delta(-moveSpeed, 0, 0, 0, RELATIVE_MOVEMENT);
        }
        if (engineState.keys['a']) {
            engineState.camstand_T.translate_self_by_delta(0, moveSpeed, 0, 0, RELATIVE_MOVEMENT);
        }
        if (engineState.keys['d']) {
            engineState.camstand_T.translate_self_by_delta(0,-moveSpeed, 0, 0, RELATIVE_MOVEMENT);
        }
        if (this.gameState.playerMoveMode === "4D") {
            if (engineState.keys['q']) {
                engineState.camstand_T.translate_self_by_delta(0, 0, 0, -moveSpeed, RELATIVE_MOVEMENT);
            }
            if (engineState.keys['e']) {
                engineState.camstand_T.translate_self_by_delta(0, 0, 0, +moveSpeed, RELATIVE_MOVEMENT);
            }
        }

        const rotateSpeed = 0.05;
        if (this.gameState.playerEyeMode === "Lidded" || this.gameState.playerEyeMode === "Human") { // only allow z swivel in lidded mode
            if (engineState.keys['i']) {
                engineState.camstandswivel_angle -= rotateSpeed;
            }
            if (engineState.keys['k']) {
                engineState.camstandswivel_angle += rotateSpeed;
            }
        }
        if (engineState.keys['j']) {
            engineState.camstand_T.rotate_self_by_delta('XY', rotateSpeed, true);
        }
        if (engineState.keys['l']) {
            engineState.camstand_T.rotate_self_by_delta('XY', -rotateSpeed, true);
        }
        if (this.gameState.playerMoveMode === "4D") {
            if (engineState.keys['u']) {
                engineState.camstand_T.rotate_self_by_delta('XW', rotateSpeed, true);
            }
            if (engineState.keys['o']) {
                engineState.camstand_T.rotate_self_by_delta('XW', -rotateSpeed, true);
            }
            if (engineState.keys['y']) {
                engineState.camstand_T.rotate_self_by_delta('YW', -rotateSpeed, true);
            }
            if (engineState.keys['p']) {
                engineState.camstand_T.rotate_self_by_delta('YW', rotateSpeed, true);
            }
        }

        // Constrain player position to w = 0 if in human mode
        if (this.gameState.playerMoveMode === "Human") {
            engineState.camstand_T.matrix[3][4] = 0.0;
        }

        // Constrain swivel angle
        if (engineState.camstandswivel_angle < -0.25 * Math.PI) {
            engineState.camstandswivel_angle = -0.25 * Math.PI;
        }
        if (engineState.camstandswivel_angle > 0.25 * Math.PI) {
            engineState.camstandswivel_angle = 0.25 * Math.PI;
        }

        // R key: "Unblink" - Eye mode toggle with easing animation
        this.updateEyeMode(engineState);

        // c to jump (can't jump while falling)
        if (engineState.keys['c']) {
            if (!engineState.player_is_jumping && !this.gameState.playerIsFalling) {
                engineState.last_player_jump_time = engineState.physics_time_s;
                engineState.player_is_jumping = true;
            }
        }

        // Ammo reload logic
        if (this.gameState.ammoReloading) {
            let reloadElapsed = engineState.physics_time_s - this.gameState.ammoReloadStartTime;
            this.gameState.ammoReloadProgress = Math.min(reloadElapsed / this.gameState.ammoReloadDuration, 1.0);
            if (reloadElapsed >= this.gameState.ammoReloadDuration) {
                this.gameState.playerAmmo = this.gameState.playerMaxAmmo;
                this.gameState.ammoReloading = false;
                this.gameState.ammoReloadProgress = 0;
            }
        }

        // space to shoot (only after combat tutorial)
        const pistolCooldown = 0.20;
        if (engineState.keys[' '] && this.gameState.shootingUnlocked) {
            let timeSinceCooldown = engineState.physics_time_s - this.gameState.bulletCooldownLastFiredTime;
            if (timeSinceCooldown > pistolCooldown && this.gameState.playerAmmo > 0 && !this.gameState.ammoReloading) {
                if (this.gameState.bulletPrimitives.length == 0) {
                    this.gameState.playerBullets[0].destroyBullet(this.gameState.bulletPrimitives, this.gameState.playerBullets, 0); // Clear the first (oldest)
                }
                // pop first available primitive
                let primIndex = this.gameState.bulletPrimitives.pop();
                let newBullet = new FiredBullet(this.scene, primIndex, engineState.hypercamera_T.origin(), engineState.hypercamera_T.transform_vector(new Vector4D(1, 0, 0, 0)), engineState.physics_time_s);
                newBullet.bulletVelocity = 20.0;
                this.gameState.playerBullets.push(newBullet);
                this.gameState.bulletCooldownLastFiredTime = engineState.physics_time_s;
                this.gameState.playerAmmo--;
                this.audioManager.playSfx("shoot", 0.9);
                if (this.gameState.playerAmmo <= 0) {
                    this.gameState.playerAmmo = 0;
                    this.gameState.ammoReloading = true;
                    this.gameState.ammoReloadStartTime = engineState.physics_time_s;
                }
            }
        }
        // Update all live bullets (while as the list size changes mid loop)
        let bullet_i = 0;
        while (true) {
            if (bullet_i >= this.gameState.playerBullets.length) {
                break;
            }
            // this may delete the bullet
            this.gameState.playerBullets[bullet_i].updateBullet(engineState.physics_time_s, this.gameState.bulletPrimitives, this.gameState.playerBullets, bullet_i);
            // increment
            bullet_i++;
        }


        // Remove magic wall once boss enters phase 2 (half HP reached)
        if (this.gameState.bossPhase >= 2 && this.poIs.magicWallIndex !== undefined) {
            let wall = engineState.scene.visibleHyperobjects[this.poIs.magicWallIndex];
            if (wall.collider) {
                wall.collider = null;
            }
            wall.pose.setTranslation(new Vector4D(0, 0, -10000, 0));
        }

        // Remove boss entrance wall once boss is fully defeated
        if (this.gameState.bossPhase >= 4 && this.poIs.bossEntranceWallIdx !== null) {
            let wall = engineState.scene.visibleHyperobjects[this.poIs.bossEntranceWallIdx];
            if (wall.collider) {
                wall.collider = null;
            }
            wall.pose.setTranslation(new Vector4D(0, 0, -10000, 0));
        }

        // Box Colliders
        let collidingObjects = [];
        if (!this.gameState.GOD_MODE) {
            for (let i = 0; i < engineState.scene.visibleHyperobjects.length; i++) {
                const obj = engineState.scene.visibleHyperobjects[i];
                if (obj.collider) {
                    let isCollided = obj.collider.constrainTransform(engineState.camstand_T);
                    if (isCollided) { collidingObjects.push(`${obj.name || 'unnamed'}[${i}]`); }
                }
            }

            // Boss arena repulsion sphere: keep player outside R6_BridgeShellR until phase 2
            if (this.gameState.bossPhase < 2 && this.poIs.room6Center) {
                let playerPos = engineState.camstand_T.origin();
                let room6C = this.poIs.room6Center;
                let dx = playerPos.x - room6C.x;
                let dy = playerPos.y - room6C.y;
                let dw = playerPos.w - room6C.w;
                let distXYW = Math.sqrt(dx * dx + dy * dy + dw * dw);
                let radius = this.poIs.room6InnerRadius + 4.0;
                if (distXYW < radius && distXYW > 0.01) {
                    let pushFactor = radius / distXYW;
                    engineState.camstand_T.matrix[0][4] = room6C.x + dx * pushFactor;
                    engineState.camstand_T.matrix[1][4] = room6C.y + dy * pushFactor;
                    engineState.camstand_T.matrix[3][4] = room6C.w + dw * pushFactor;
                }
            }
        }

                // Debug: collision info
                if (DEBUG_MODE) {
                    if (!document.getElementById("collision_debug")) {
                        const div = document.createElement("div");
                        div.id = "collision_debug";
                        document.body.appendChild(div);
                        div.style.position = "absolute";
                        div.style.top = "10px";
                        div.style.left = "320px";
                        div.style.color = "rgb(255, 200, 100)";
                        div.style.fontFamily = "monospace";
                        div.style.fontSize = "12px";
                    }
                    const collDiv = document.getElementById("collision_debug");
                    if (collidingObjects.length > 0) {
                        collDiv.innerHTML = `Colliding:<br>` + collidingObjects.join('<br>');
                    } else {
                        collDiv.innerHTML = `Colliding:<br>(none)`;
                    }
                }

                // Debug: lava/bridge info
                if (DEBUG_MODE) {
                    if (!document.getElementById("lava_bridge_debug")) {
                        const div = document.createElement("div");
                        div.id = "lava_bridge_debug";
                        document.body.appendChild(div);
                        div.style.position = "absolute";
                        div.style.top = "60px";
                        div.style.left = "320px";
                        div.style.color = "rgb(255, 200, 100)";
                        div.style.fontFamily = "monospace";
                        div.style.fontSize = "12px";
                    }
                }
                const px = engineState.camstand_T.matrix[0][4];
                const py = engineState.camstand_T.matrix[1][4];
                const pw = engineState.camstand_T.matrix[3][4];
                const onLava = this.isPlayerOnLava(px, py, pw);
                const onBridge = this.isPlayerOnBridge(px, py, pw);
                const inDangerousLava = onLava && !onBridge;
                const dt = engineState.physics_time_s - this.gameState.lastLavaCheckTime;
                this.gameState.lastLavaCheckTime = engineState.physics_time_s;
                if (inDangerousLava) {
                    this.gameState.lavaTime += dt;
                    this.gameState.burnLevel = Math.max(0.0, Math.min(1.0, this.gameState.burnLevel + dt/ 3.0));
                    // Apply lava damage
                    if (!this.gameState.GOD_MODE && this.gameState.playerHealth > 0 && this.gameState.playerInvulnLastHitTime + this.gameState.playerInvulnTime < engineState.physics_time_s) {
                        if (this.gameState.burnLevel >= 1.0) { this.gameState.playerHealth = 0; }
                        if (this.gameState.burnLevel >= 0.3) {
                            this.gameState.playerHealth -= 10;
                            playGameSfx(this.gameState, "playerHit");
                            this.gameState.playerInvulnLastHitTime = engineState.physics_time_s;
                            // Force player out of unblink and lock it for 2 seconds
                            if (this.gameState.playerEyeMode === "WideOpen" || this.gameState.playerEyeMode === "Lidded->WideOpen") {
                                this.gameState.playerEyeMode = "WideOpen->Lidded";
                                this.gameState.eyeAnimationProgress = 0;
                                this.gameState.unblinkLockoutUntil = engineState.physics_time_s + 2.0;
                                // Show tutorial the first time a shade forces the player out of unblink
                                if (!this.gameState.tutorialsShown.has("shade_unblink_hit")) {
                                    this.gameState.shadeUnblinkTutorialPending = true;
                                }
                            }
                        }
                    }
                } else {
                    this.gameState.lavaTime = 0;
                    this.gameState.burnLevel = Math.max(0.0, Math.min(1.0, this.gameState.burnLevel - dt/ 3.0));
                }
                const lbDiv = document.getElementById("lava_bridge_debug");
                if (lbDiv) {
                    lbDiv.innerHTML =
                        `Lava: <span style="color:${onLava ? '#ff4444' : '#88ff88'}">${onLava ? 'YES' : 'no'}</span><br>` +
                        `Bridge: <span style="color:${onBridge ? '#88ff88' : '#aaaaaa'}">${onBridge ? 'YES' : 'no'}</span><br>` +
                        `Lava time: <span style="color:${inDangerousLava ? '#ff4444' : '#aaaaaa'}">${this.gameState.lavaTime.toFixed(2)}s</span>`;
                }

                // Debug: print the player pose to a div
                // create div if it doesn't exist
                if (DEBUG_MODE) {
                    if (!document.getElementById("player_pose")) {
                        const div = document.createElement("div");
                        div.id = "player_pose";
                        document.body.appendChild(div);
                        div.style.position = "absolute";
                        div.style.top = "10px";
                        div.style.right = "10px";
                        div.style.color = "rgb(156, 156, 156)";
                        div.style.fontFamily = "monospace";
                        div.style.fontSize = "12px";
                        console.log("created div");
                    }
                    // update div
                    document.getElementById("player_pose").innerHTML = `Player:<br>`;
                    document.getElementById("player_pose").innerHTML += `[${engineState.camstand_T.matrix[0][0].toFixed(2)}, ${engineState.camstand_T.matrix[0][1].toFixed(2)}, ${engineState.camstand_T.matrix[0][2].toFixed(2)}, ${engineState.camstand_T.matrix[0][3].toFixed(2)}, ${engineState.camstand_T.matrix[0][4].toFixed(2)}]<br>`;
                    document.getElementById("player_pose").innerHTML += `[${engineState.camstand_T.matrix[1][0].toFixed(2)}, ${engineState.camstand_T.matrix[1][1].toFixed(2)}, ${engineState.camstand_T.matrix[1][2].toFixed(2)}, ${engineState.camstand_T.matrix[1][3].toFixed(2)}, ${engineState.camstand_T.matrix[1][4].toFixed(2)}]<br>`;
                    document.getElementById("player_pose").innerHTML += `[${engineState.camstand_T.matrix[2][0].toFixed(2)}, ${engineState.camstand_T.matrix[2][1].toFixed(2)}, ${engineState.camstand_T.matrix[2][2].toFixed(2)}, ${engineState.camstand_T.matrix[2][3].toFixed(2)}, ${engineState.camstand_T.matrix[2][4].toFixed(2)}]<br>`;
                    document.getElementById("player_pose").innerHTML += `[${engineState.camstand_T.matrix[3][0].toFixed(2)}, ${engineState.camstand_T.matrix[3][1].toFixed(2)}, ${engineState.camstand_T.matrix[3][2].toFixed(2)}, ${engineState.camstand_T.matrix[3][3].toFixed(2)}, ${engineState.camstand_T.matrix[3][4].toFixed(2)}]<br>`;
                }

        // Camera, floor, gem, HUD
        this.updateCameraAndFloor(engineState);
        this.updateHUD();
    }

    isPlayerOnLava(x, y, w) {
        if (!this.poIs.lavaRegions) return false;
        for (const region of this.poIs.lavaRegions) {
            if (region.type === 'box') {
                if (Math.abs(x - region.cx) < region.hx &&
                    Math.abs(y - region.cy) < region.hy &&
                    Math.abs(w - region.cw) < region.hw) {
                    return true;
                }
            } else if (region.type === 'sphere') {
                const dx = x - region.cx;
                const dy = y - region.cy;
                const dw = w - region.cw;
                if (dx * dx + dy * dy + dw * dw < region.r * region.r) {
                    return true;
                }
            }
        }
        return false;
    }

    isPlayerOnBridge(x, y, w) {
        if (!this.poIs.bridgeRegions) return false;
        for (const region of this.poIs.bridgeRegions) {
            if (region.type === 'box') {
                if (Math.abs(x - region.cx) < region.hx &&
                    Math.abs(y - region.cy) < region.hy &&
                    Math.abs(w - region.cw) < region.hw) {
                    return true;
                }
            } else if (region.type === 'shell') {
                const dx = x - region.cx;
                const dy = y - region.cy;
                const dw = w - region.cw;
                const dist = Math.sqrt(dx * dx + dy * dy + dw * dw);
                if (dist >= region.innerR && dist <= region.outerR) {
                    return true;
                }
            } else if (region.type === 'sphere') {
                const dx = x - region.cx;
                const dy = y - region.cy;
                const dw = w - region.cw;
                if (dx * dx + dy * dy + dw * dw < region.r * region.r) {
                    return true;
                }
            }
        }
        return false;
    }

    updateCameraAndFloor(engineState) {
        // Compute final camera transform from intermediate poses
        // Floor height, jumping, and falling
        const currentFloorHeight = engineState.scene.floor_heightmap(
            engineState.camstand_T.matrix[0][4],
            engineState.camstand_T.matrix[1][4],
            engineState.camstand_T.matrix[3][4]
        );
        const floorDelta = currentFloorHeight - this.gameState.previousFloorHeight;

        // Detect floor transitions
        if (floorDelta < -0.01 && !this.gameState.playerIsFalling) {
            // Floor dropped (high → low): start falling from current absolute Z
            let currentAbsoluteZ;
            if (engineState.player_is_jumping) {
                const tend = 1;
                const jump_height = 1;
                let jdt = engineState.physics_time_s - engineState.last_player_jump_time;
                let jp01 = Math.min(jdt / tend, 1.0);
                let jump_z = jump_height * (1.0 - (2.0 * jp01 - 1.0) ** 2);
                currentAbsoluteZ = this.gameState.previousFloorHeight + jump_z;
            } else {
                currentAbsoluteZ = this.gameState.previousFloorHeight;
            }
            this.gameState.playerIsFalling = true;
            this.gameState.fallStartTime = engineState.physics_time_s;
            this.gameState.fallFromZ = currentAbsoluteZ;
            engineState.player_is_jumping = false;
        } else if (floorDelta > 0.01 && this.gameState.playerIsFalling) {
            // Floor rose while falling: check if new floor catches us
            const FALL_GRAVITY = 40.0;
            const fdt = engineState.physics_time_s - this.gameState.fallStartTime;
            const fallingZ = this.gameState.fallFromZ - 0.5 * FALL_GRAVITY * fdt * fdt;
            if (fallingZ <= currentFloorHeight) {
                this.gameState.playerIsFalling = false;
            }
        }

        // Compute player Z
        let playerAbsoluteZ;
        if (this.gameState.playerIsFalling) {
            const FALL_GRAVITY = 40.0;
            const fdt = engineState.physics_time_s - this.gameState.fallStartTime;
            playerAbsoluteZ = this.gameState.fallFromZ - 0.5 * FALL_GRAVITY * fdt * fdt;
            if (playerAbsoluteZ <= currentFloorHeight) {
                playerAbsoluteZ = currentFloorHeight;
                this.gameState.playerIsFalling = false;
            }
        } else {
            // Normal: on ground or jumping
            let jump_z = 0;
            if (engineState.player_is_jumping) {
                const tend = 1;
                const jump_height = 1;
                let jdt = engineState.physics_time_s - engineState.last_player_jump_time;
                let jp01 = jdt / tend;
                if (jdt > tend) {
                    engineState.player_is_jumping = false;
                } else {
                    jump_z = jump_height * (1.0 - (2.0 * jp01 - 1.0) ** 2);
                }
            }
            playerAbsoluteZ = currentFloorHeight + jump_z;
        }

        engineState.camstand_T.matrix[2][4] = playerAbsoluteZ;
        this.gameState.previousFloorHeight = currentFloorHeight;
        // sine and cosine of swivel angle
        let ss = Math.sin(engineState.camstandswivel_angle);
        let cs = Math.cos(engineState.camstandswivel_angle);
        let h = engineState.camstand_height;
        let hypercam_in_camstand = new Transform4D([
            [cs, 0, ss, 0, 0],
            [0, 1, 0, 0, 0],
            [-ss, 0, cs, 0, h],
            [0, 0, 0, 1, 0],
            [0, 0, 0, 0, 1]
        ]);
        engineState.hypercamera_T = engineState.camstand_T.transform_transform(hypercam_in_camstand);

        // Animate end gem
        if (this.endGemPrimitiveIndex !== undefined) {
            let gem = this.scene.visibleHyperobjects[this.endGemPrimitiveIndex];

            if (this.gameState.gemState === 'lerping') {
                const lerpDuration = 4.0;
                let t = (engineState.physics_time_s - this.gameState.gemLerpStartTime) / lerpDuration;
                if (t >= 1.0) {
                    t = 1.0;
                    this.gameState.gemState = 'arrived';
                }
                const easeInOut = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
                let eased = easeInOut(t);
                let startPos = this.gameState.gemLerpStartPos;
                let targetPos = this.endGemTargetPos;
                gem.pose.matrix[0][4] = startPos.x + (targetPos.x - startPos.x) * eased;
                gem.pose.matrix[1][4] = startPos.y + (targetPos.y - startPos.y) * eased;
                gem.pose.matrix[2][4] = startPos.z + (targetPos.z - startPos.z) * eased;
                gem.pose.matrix[3][4] = startPos.w + (targetPos.w - startPos.w) * eased;
                gem.pose.rotate_self_by_delta('XY', 0.04, false);
            } else if (this.gameState.gemState === 'arrived') {
                gem.pose.rotate_self_by_delta('XY', 0.02, false);
                const bobAmplitude = 0.5;
                const bobSpeed = 2.0;
                const bobZ = this.endGemBaseZ + Math.sin(engineState.physics_time_s * bobSpeed) * bobAmplitude;
                gem.pose.matrix[2][4] = bobZ;
            }
        }
    }

    updateEyeMode(engineState) {
        let liddedCamRot = [-Math.PI / 2.0, 0.1, 40];
        let wideOpenCamRot = [-Math.PI / 2.0, 0.9, 80];

        if (engineState.scene.custom_vox_resolution != null) {
            liddedCamRot = [-Math.PI / 2.0, 0.1, 40 * engineState.scene.custom_vox_resolution / 96];
            wideOpenCamRot = [-Math.PI / 2.0, 0.9, 80 * engineState.scene.custom_vox_resolution / 96];
        }

        const dt = engineState.physics_time_s - this.gameState.lastEyeUpdateTime;
        this.gameState.lastEyeUpdateTime = engineState.physics_time_s;
        
        // Human mode
        if (this.gameState.playerEyeMode === "Human") {
            this.gameState.eyeAnimationProgress = 0.0;
            engineState.SENSOR_MODE = 0;
            return;
        }

        // Block unblink during lockout (e.g. after shade hit)
        const unblinkLocked = engineState.physics_time_s < this.gameState.unblinkLockoutUntil;
        const rKeyPressed = engineState.keys['r'];

        let changed = false;

        // Detect key press/release transitions
        if (rKeyPressed && !this.gameState.rKeyWasPressed && !unblinkLocked) {
            // R just pressed - start opening animation
            this.gameState.playerEyeMode = "Lidded->WideOpen";
            // If we were closing, open from the current progress
            if (this.gameState.eyeAnimationProgress !== 0) {
                this.gameState.eyeAnimationProgress = 1.0 - this.gameState.eyeAnimationProgress;
            }
            changed = true;
        } else if (!rKeyPressed && this.gameState.rKeyWasPressed) {
            // R just released - start closing animation
            this.gameState.playerEyeMode = "WideOpen->Lidded";
            // If we were opening, close from the current progress
            if (this.gameState.eyeAnimationProgress !== 0) {
                this.gameState.eyeAnimationProgress = 1.0 - this.gameState.eyeAnimationProgress;
            }
            changed = true;
        }
        this.gameState.rKeyWasPressed = rKeyPressed;

        // Progress the animation
        if (this.gameState.playerEyeMode === "Lidded->WideOpen" || this.gameState.playerEyeMode === "WideOpen->Lidded") {
            this.gameState.eyeAnimationProgress += dt * this.gameState.eyeAnimationSpeed;


            if (this.gameState.eyeAnimationProgress >= 1.0) {
                this.gameState.eyeAnimationProgress = 0;
                // Advance to next phase
                if (this.gameState.playerEyeMode === "Lidded->WideOpen") {
                    this.gameState.playerEyeMode = "WideOpen";
                    engineState.SENSOR_MODE = 3.0;
                    engineState.sensorCamRotX = wideOpenCamRot[0];
                    engineState.sensorCamRotY = wideOpenCamRot[1];
                    engineState.sensorCamDist = wideOpenCamRot[2];
                } else if (this.gameState.playerEyeMode === "WideOpen->Lidded") {
                    this.gameState.playerEyeMode = "Lidded";
                    engineState.SENSOR_MODE = 2.0;
                    engineState.sensorCamRotX = liddedCamRot[0];
                    engineState.sensorCamRotY = liddedCamRot[1];
                    engineState.sensorCamDist = liddedCamRot[2];
                }
            } else {
                // Set the sensor mode according to current anim
                const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                if (this.gameState.playerEyeMode === "Lidded->WideOpen") {
                    // Cam moves linearly, lid only starts moving after half the time
                    const easedProgressCam = easeInOut(this.gameState.eyeAnimationProgress);
                    let lid01 = Math.min(Math.max(this.gameState.eyeAnimationProgress - 0.5, 0), 1);
                    const easedProgressLid = easeInOut(lid01);
                    engineState.SENSOR_MODE = 2.0 + 2.99 * easedProgressLid;
                    // update camera 
                    engineState.sensorCamRotX = liddedCamRot[0] + (wideOpenCamRot[0] - liddedCamRot[0]) * easedProgressCam;
                    engineState.sensorCamRotY = liddedCamRot[1] + (wideOpenCamRot[1] - liddedCamRot[1]) * easedProgressCam;
                    engineState.sensorCamDist = liddedCamRot[2] + (wideOpenCamRot[2] - liddedCamRot[2]) * easedProgressCam;
                } else if (this.gameState.playerEyeMode === "WideOpen->Lidded") {
                    // Cam moves linearly, lid only starts moving after half the time
                    const easedProgressCam = easeInOut(this.gameState.eyeAnimationProgress);
                    let lid01 = Math.min(Math.max(this.gameState.eyeAnimationProgress / 0.5, 0), 1);
                    const easedProgressLid = easeInOut(lid01);
                    engineState.SENSOR_MODE = 2.99 - 0.99 * easedProgressLid;
                    // update Camera
                    engineState.sensorCamRotX = wideOpenCamRot[0] + (liddedCamRot[0] - wideOpenCamRot[0]) * easedProgressCam;
                    engineState.sensorCamRotY = wideOpenCamRot[1] + (liddedCamRot[1] - wideOpenCamRot[1]) * easedProgressCam;
                    engineState.sensorCamDist = wideOpenCamRot[2] + (liddedCamRot[2] - wideOpenCamRot[2]) * easedProgressCam;
                }
            }

            changed = true;
        }

        // Debug
        if (true && changed) {
            // log mode, progress, and sensormode
            console.log(this.gameState.playerEyeMode, this.gameState.eyeAnimationProgress, engineState.SENSOR_MODE);

        }
    }

}
