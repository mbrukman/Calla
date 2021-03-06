﻿import { TileMap } from "./tilemap.js";
import { User } from "./user.js";
import { Emote } from "./emote.js";
import { Canvas } from "./html/tags.js";
import {
    id,
    style,
    fillPageStyle
} from "./html/attrs.js";
import { lerp, clamp, project, unproject } from "./math.js";

const CAMERA_LERP = 0.01,
    CAMERA_ZOOM_MAX = 8,
    CAMERA_ZOOM_MIN = 0.1,
    CAMERA_ZOOM_SHAPE = 1 / 4,
    CAMERA_ZOOM_SPEED = 0.005,
    MAX_DRAG_DISTANCE = 5,
    isFirefox = typeof InstallTrigger !== "undefined",
    gameStartedEvt = new Event("gamestarted"),
    gameEndedEvt = new Event("gameended"),
    zoomChangedEvt = new Event("zoomchanged"),
    emojiNeededEvt = new Event("emojineeded"),
    audioMutedEvt = Object.assign(new Event("audiomuted"), {
        muted: true
    }),
    audioUnmutedEvt = Object.assign(new Event("audiomuted"), {
        muted: false
    }),
    videoMutedEvt = Object.assign(new Event("videomuted"), {
        muted: true
    }),
    videoUnmutedEvt = Object.assign(new Event("videomuted"), {
        muted: false
    }),
    emoteEvt = Object.assign(new Event("emote"), {
        participantID: null,
        emoji: null
    }),
    userJoinedEvt = Object.assign(new Event("userjoined", {
        user: null
    }));

export class Game extends EventTarget {

    constructor() {
        super();

        this.frontBuffer = Canvas(
            id("frontBuffer"),
            fillPageStyle,
            style({ touchAction: "none" }));
        this.gFront = this.frontBuffer.getContext("2d");

        this.me = null
        this.map = null;
        this.keys = {};
        this.userLookup = {};
        this.userList = [];

        this._loop = this.loop.bind(this);
        this.lastTime = 0;
        this.lastMove = Number.MAX_VALUE;
        this.gridOffsetX = 0;
        this.gridOffsetY = 0;
        this.cameraX = this.offsetCameraX = this.targetOffsetCameraX = 0;
        this.cameraY = this.offsetCameraY = this.targetOffsetCameraY = 0;
        this.cameraZ = this.targetCameraZ = 1.5;
        this.currentRoomName = null;
        this.fontSize = 10;

        this.drawHearing = false;
        this.audioDistanceMin = 2;
        this.audioDistanceMax = 10;
        this.rolloff = 5;

        this.pointers = [];
        this.lastPinchDistance = 0;
        this.canClick = false;

        this.currentEmoji = null;
        this.emotes = [];

        this.keyEmote = "e";
        this.keyToggleAudio = "a";
        this.keyUp = "ArrowUp";
        this.keyDown = "ArrowDown";
        this.keyLeft = "ArrowLeft";
        this.keyRight = "ArrowRight";

        this.gamepads = [];
        this.gamepadButtonPressedEvents = [];
        this.lastGamepadIndex = -1;
        this.gamepadIndex = -1;
        this.buttonEmote = 0;
        this.buttonToggleAudio = 1;
        this.buttonUp = 12;
        this.buttonDown = 13;
        this.buttonLeft = 14;
        this.buttonRight = 15;

        // ============= KEYBOARD =================

        addEventListener("keydown", (evt) => {
            this.keys[evt.key] = evt;
            if (!evt.ctrlKey
                && !evt.altKey
                && !evt.shiftKey
                && !evt.metaKey
                && evt.key === this.keyToggleAudio
                && !!this.me) {
                this.toggleMyAudio();
            }
        });

        addEventListener("keyup", (evt) => {
            if (!!this.keys[evt.key]) {
                delete this.keys[evt.key];
            }
        });

        // ============= KEYBOARD =================

        // ============= POINTERS =================

        this.frontBuffer.addEventListener("wheel", (evt) => {
            if (!evt.shiftKey
                && !evt.altKey
                && !evt.ctrlKey
                && !evt.metaKey) {
                // Chrome and Firefox report scroll values in completely different ranges.
                const deltaZ = evt.deltaY * (isFirefox ? 1 : 0.02);
                this.zoom(deltaZ);
            }
        }, { passive: true });

        function readPointer(evt) {
            return {
                id: evt.pointerId,
                buttons: evt.buttons,
                dragDistance: 0,
                x: evt.offsetX * devicePixelRatio,
                y: evt.offsetY * devicePixelRatio
            }
        }

        const findPointer = (pointer) => {
            return this.pointers.findIndex(p => p.id === pointer.id);
        };

        const replacePointer = (pointer) => {
            const idx = findPointer(pointer);
            if (idx > -1) {
                const last = this.pointers[idx];
                this.pointers[idx] = pointer;
                return last;
            }
            else {
                this.pointers.push(pointer);
                return null;
            }
        };

        const getPressCount = () => {
            let count = 0;
            for (let pointer of this.pointers) {
                if (pointer.buttons === 1) {
                    ++count;
                }
            }
            return count;
        }

        this.frontBuffer.addEventListener("pointerdown", (evt) => {
            const oldCount = getPressCount(),
                pointer = readPointer(evt),
                _ = replacePointer(pointer),
                newCount = getPressCount();

            this.canClick = oldCount === 0
                && newCount === 1;
        });

        const getPinchDistance = () => {
            const count = getPressCount();
            if (count !== 2) {
                return null;
            }

            const pressed = this.pointers.filter(p => p.buttons === 1),
                a = pressed[0],
                b = pressed[1],
                dx = b.x - a.x,
                dy = b.y - a.y;

            return Math.sqrt(dx * dx + dy * dy);
        };

        this.frontBuffer.addEventListener("pointermove", (evt) => {
            const oldPinchDistance = getPinchDistance(),
                pointer = readPointer(evt),
                last = replacePointer(pointer),
                count = getPressCount(),
                newPinchDistance = getPinchDistance();

            if (count === 1) {

                if (!!last
                    && pointer.buttons === 1
                    && last.buttons === pointer.buttons) {
                    const dx = pointer.x - last.x,
                        dy = pointer.y - last.y,
                        dist = Math.sqrt(dx * dx + dy * dy);
                    pointer.dragDistance = last.dragDistance + dist;

                    if (pointer.dragDistance > MAX_DRAG_DISTANCE) {
                        this.targetOffsetCameraX = this.offsetCameraX += dx;
                        this.targetOffsetCameraY = this.offsetCameraY += dy;
                        this.canClick = false;
                    }
                }

            }

            if (oldPinchDistance !== null
                && newPinchDistance !== null) {
                const ddist = oldPinchDistance - newPinchDistance;
                this.zoom(ddist / 5);
                this.canClick = false;
            }
        });

        this.frontBuffer.addEventListener("pointerup", (evt) => {
            const pointer = readPointer(evt),
                _ = replacePointer(pointer);

            if (!!this.me && pointer.dragDistance < 2) {
                const tile = this.getTileAt(pointer),
                    dx = tile.x - this.me.tx,
                    dy = tile.y - this.me.ty;

                if (dx === 0 && dy === 0) {
                    this.emote(this.me.id, this.currentEmoji);
                }
                else if (this.canClick) {
                    this.moveMeBy(dx, dy);
                }
            }
        });

        this.frontBuffer.addEventListener("pointercancel", (evt) => {
            const pointer = readPointer(evt),
                idx = findPointer(pointer);

            if (idx >= 0) {
                this.pointers.splice(idx, 1);
            }

            return pointer;
        });

        // ============= POINTERS =================

        // ============= GAMEPAD =================
        {
            addEventListener("gamepadconnected", (evt) => {
                const pad = evt.gamepad,
                    idx = this.gamepads.findIndex(x => x.id === pad.id);
                if (idx === -1) {
                    this.gamepads.push(pad);
                    if (this.gamepads.length === 1) {
                        this.gamepadIndex = 0;
                    }
                }
            });

            addEventListener("gamepaddisconnected", (evt) => {
                const pad = evt.gamepad,
                    idx = this.gamepads.findIndex(x => x.id === pad.id);
                if (idx >= 0) {
                    this.gamepads.splice(idx, 1);
                    if (this.gamepads.length === 0) {
                        this.gamepadIndex = -1;
                    }
                }
            });
        }
        // ============= GAMEPAD =================

        // ============= ACTION ==================
    }

    updateAudioActivity(evt) {
        const id = evt.data && evt.data.participantID
            || evt.participantID,
            isActive = evt.data && evt.data.isActive
                || evt.isActive,
            user = this.userLookup[id];
        if (!!user) {
            user.isActive = isActive;
        }
    }

    emote(participantID, emoji) {
        const user = this.userLookup[participantID];

        if (!!user) {

            if (user.isMe) {

                emoji = emoji
                    || this.currentEmoji;

                if (!emoji) {
                    this.dispatchEvent(emojiNeededEvt);
                }
                else {
                    this.currentEmoji = emoji;
                    for (let user of this.userList) {
                        if (user !== this.me) {
                            emoteEvt.participantID = user.id;
                            emoteEvt.emoji = emoji;
                            this.dispatchEvent(emoteEvt);
                        }
                    }
                }
            }

            if (!!emoji) {
                this.emotes.push(new Emote(emoji, user.tx + 0.5, user.ty));
            }
        }
    }

    getTileAt(cursor) {
        const imageX = cursor.x - this.gridOffsetX - this.offsetCameraX,
            imageY = cursor.y - this.gridOffsetY - this.offsetCameraY,
            zoomX = imageX / this.cameraZ,
            zoomY = imageY / this.cameraZ,
            mapX = zoomX - this.cameraX,
            mapY = zoomY - this.cameraY,
            mapWidth = this.map.tileWidth,
            mapHeight = this.map.tileHeight,
            gridX = Math.floor(mapX / mapWidth),
            gridY = Math.floor(mapY / mapHeight),
            tile = { x: gridX, y: gridY };
        return tile;
    }

    moveMeBy(dx, dy) {
        const clearTile = this.map.getClearTile(this.me.tx, this.me.ty, dx, dy, this.me.avatarEmoji);
        this.me.moveTo(clearTile.x, clearTile.y);
        this.targetOffsetCameraX = 0;
        this.targetOffsetCameraY = 0;
    }

    zoom(deltaZ) {
        const mag = Math.abs(deltaZ);
        if (0 < mag && mag <= 50) {
            const a = project(this.targetCameraZ, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX),
                b = Math.pow(a, CAMERA_ZOOM_SHAPE),
                c = b - deltaZ * CAMERA_ZOOM_SPEED,
                d = clamp(c, 0, 1),
                e = Math.pow(d, 1 / CAMERA_ZOOM_SHAPE);

            this.targetCameraZ = unproject(e, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
            this.dispatchEvent(zoomChangedEvt);
        }
    }

    addUser(evt) {
        //evt = {
        //    id: "string", // the id of the participant
        //    displayName: "string" // the display name of the participant
        //};
        if (this.userLookup[evt.id]) {
            this.removeUser(evt);
        }

        const user = new User(evt.id, evt.displayName, false);
        this.userLookup[evt.id] = user;
        this.userList.unshift(user);
        userJoinedEvt.user = user;
        this.dispatchEvent(userJoinedEvt);
    }

    changeUserName(evt) {
        //evt = {
        //    id: string, // the id of the participant that changed his display name
        //    displayName: string // the new display name
        //};

        const user = this.userLookup[evt.id];
        if (!!user) {
            user.setDisplayName(evt.displayName);
        }
    }

    toggleMyAudio() {
        this.muteUserAudio({
            participantID: this.me.id,
            muted: !this.me.audioMuted
        });
    }

    toggleMyVideo() {
        this.muteUserVideo({
            participantID: this.me.id,
            muted: !this.me.videoMuted
        });
    }

    muteUserAudio(evt) {
        let mutingUser = this.me;
        if (!!evt.participantID) {
            mutingUser = this.userLookup[evt.participantID];
        }

        if (!mutingUser) {
            console.log("no user");
            setTimeout(this.muteUserAudio.bind(this, evt), 1000);
        }
        else {
            const muted = evt.data && evt.data.muted
                || !evt.data && evt.muted;
            mutingUser.audioMuted = muted;

            if (mutingUser === this.me) {
                this.dispatchEvent(muted
                    ? audioMutedEvt
                    : audioUnmutedEvt);
            }
        }
    }

    muteUserVideo(evt) {
        let mutingUser = this.me;
        if (!!evt.participantID) {
            mutingUser = this.userLookup[evt.participantID];
        }

        if (!mutingUser) {
            console.log("no user");
            setTimeout(this.muteUserVideo.bind(this, evt), 1000);
        }
        else {
            const muted = evt.data && evt.data.muted
                || !evt.data && evt.muted;
            mutingUser.videoMuted = muted;

            if (mutingUser === this.me) {
                this.dispatchEvent(muted
                    ? videoMutedEvt
                    : videoUnmutedEvt);
            }
        }
    }

    removeUser(evt) {
        //evt = {
        //    id: "string" // the id of the participant
        //};
        const user = this.userLookup[evt.id];
        if (!!user) {
            delete this.userLookup[evt.id];

            const userIndex = this.userList.indexOf(user);
            if (userIndex >= 0) {
                this.userList.splice(userIndex, 1);
            }
        }
    }

    setAvatarURL(evt) {
        //evt = {
        //  id: string, // the id of the participant that changed his avatar.
        //  avatarURL: string // the new avatar URL.
        //}
        if (!!evt) {
            const user = this.userLookup[evt.id];
            if (!!user) {
                user.setAvatarURL(evt.avatarURL);
            }
        }
    }

    async start(evt) {
        //evt = {
        //    roomName: "string", // the room name of the conference
        //    id: "string", // the id of the local participant
        //    displayName: "string", // the display name of the local participant
        //    avatarURL: "string" // the avatar URL of the local participant
        //};

        this.currentRoomName = evt.roomName.toLowerCase();
        this.me = new User(evt.id, evt.displayName, true);
        this.userList.push(this.me);
        this.userLookup[this.me.id] = this.me;

        this.setAvatarURL(evt);

        this.map = new TileMap(this.currentRoomName);
        let success = false;
        for (let retryCount = 0; retryCount < 2; ++retryCount) {
            try {
                await this.map.load();
                success = true;
            }
            catch (exp) {
                console.warn(exp);
                this.map = new TileMap("default");
            }
        }

        if (!success) {
            console.error("Couldn't load any maps!");
        }

        this.startLoop();
        this.dispatchEvent(zoomChangedEvt);
        this.dispatchEvent(gameStartedEvt);
    }

    startLoop() {
        this.frontBuffer.show();
        this.frontBuffer.resize();
        this.frontBuffer.focus();

        requestAnimationFrame((time) => {
            this.lastTime = time;
            requestAnimationFrame(this._loop);
        });
    }

    loop(time) {
        if (this.currentRoomName !== null) {
            requestAnimationFrame(this._loop);
            const dt = time - this.lastTime;
            this.lastTime = time;
            this.update(dt / 1000);
            this.render();
        }
    }

    end() {
        this.currentRoomName = null;
        this.map = null;
        this.userLookup = {};
        this.userList.splice(0);
        this.me = null;
        this.dispatchEvent(gameEndedEvt);
    }

    update(dt) {
        this.gridOffsetX = Math.floor(0.5 * this.frontBuffer.width / this.map.tileWidth) * this.map.tileWidth;
        this.gridOffsetY = Math.floor(0.5 * this.frontBuffer.height / this.map.tileHeight) * this.map.tileHeight;

        this.lastMove += dt;
        if (this.lastMove >= MOVE_REPEAT) {
            let dx = 0,
                dy = 0;

            for (let evt of Object.values(this.keys)) {
                if (!evt.altKey
                    && !evt.shiftKey
                    && !evt.ctrlKey
                    && !evt.metaKey) {
                    switch (evt.key) {
                        case this.keyUp: dy--; break;
                        case this.keyDown: dy++; break;
                        case this.keyLeft: dx--; break;
                        case this.keyRight: dx++; break;
                        case this.keyEmote: this.emote(this.me.id, this.currentEmoji); break;
                    }
                }
            }

            if (0 <= this.gamepadIndex && this.gamepadIndex < this.gamepads.length) {
                const lastPad = this.gamepads[this.gamepadIndex],
                    pad = navigator.getGamepads()[lastPad.index];

                if (this.gamepadIndex != this.lastGamepadIndex) {
                    while (this.gamepadButtonPressedEvents.length > pad.buttons.length) {
                        this.gamepadButtonPressedEvents.pop();
                    }
                    while (this.gamepadButtonPressedEvents.length < pad.buttons.length) {
                        this.gamepadButtonPressedEvents.push(new GamepadButtonPressedEvent(this.gamepadButtonPressedEvents.length));
                    }
                }
                this.lastGamepadIndex = this.gamepadIndex;

                for (let i = 0; i < pad.buttons.length; ++i) {
                    if (!lastPad.buttons[i].pressed
                        && pad.buttons[i].pressed) {
                        this.dispatchEvent(this.gamepadButtonPressedEvents[i]);
                    }
                }

                if (pad.buttons[this.buttonEmote].pressed) {
                    this.emote(this.me.id, this.currentEmoji);
                }

                if (!lastPad.buttons[this.buttonToggleAudio].pressed
                    && pad.buttons[this.buttonToggleAudio].pressed) {
                    this.toggleMyAudio();
                }

                if (pad.buttons[this.buttonUp].pressed) {
                    --dy;
                }
                else if (pad.buttons[this.buttonDown].pressed) {
                    ++dy;
                }

                if (pad.buttons[this.buttonLeft].pressed) {
                    --dx;
                }
                else if (pad.buttons[this.buttonRight].pressed) {
                    ++dx;
                }

                dx += Math.round(pad.axes[0]);
                dy += Math.round(pad.axes[1]);

                this.targetOffsetCameraX += -50 * Math.round(2 * pad.axes[2]);
                this.targetOffsetCameraY += -50 * Math.round(2 * pad.axes[3]);
                this.zoom(2 * (pad.buttons[6].value - pad.buttons[7].value));

                this.gamepads[this.gamepadIndex] = pad;
            }

            dx = clamp(dx, -1, 1);
            dy = clamp(dy, -1, 1);

            if (dx !== 0
                || dy !== 0) {
                this.moveMeBy(dx, dy);
            }

            this.lastMove = 0;
        }

        for (let emote of this.emotes) {
            emote.update(dt);
        }

        this.emotes = this.emotes.filter(e => !e.isDead());

        for (let user of this.userList) {
            user.update(dt, this.map, this.userList);
        }
    }

    render() {
        const targetCameraX = -this.me.x * this.map.tileWidth,
            targetCameraY = -this.me.y * this.map.tileHeight;

        this.cameraZ = lerp(this.cameraZ, this.targetCameraZ, CAMERA_LERP * 10);
        this.cameraX = lerp(this.cameraX, targetCameraX, CAMERA_LERP * this.cameraZ);
        this.cameraY = lerp(this.cameraY, targetCameraY, CAMERA_LERP * this.cameraZ);

        this.offsetCameraX = lerp(this.offsetCameraX, this.targetOffsetCameraX, CAMERA_LERP);
        this.offsetCameraY = lerp(this.offsetCameraY, this.targetOffsetCameraY, CAMERA_LERP);

        this.gFront.resetTransform();
        this.gFront.imageSmoothingEnabled = false;
        this.gFront.clearRect(0, 0, this.frontBuffer.width, this.frontBuffer.height);

        this.gFront.save();
        {
            this.gFront.translate(
                this.gridOffsetX + this.offsetCameraX,
                this.gridOffsetY + this.offsetCameraY);
            this.gFront.scale(this.cameraZ, this.cameraZ);
            this.gFront.translate(this.cameraX, this.cameraY);

            this.map.draw(this.gFront);

            for (let user of this.userList) {
                user.drawShadow(this.gFront, this.map, this.cameraZ);
            }

            for (let emote of this.emotes) {
                emote.drawShadow(this.gFront, this.map, this.cameraZ);
            }

            for (let user of this.userList) {
                user.drawAvatar(this.gFront, this.map);
            }

            this.drawCursor();

            for (let user of this.userList) {
                user.drawName(this.gFront, this.map, this.cameraZ, this.fontSize);
            }

            if (this.drawHearing) {
                this.me.drawHearingRange(
                    this.gFront,
                    this.map,
                    this.cameraZ,
                    this.audioDistanceMin,
                    this.audioDistanceMax);
            }

            for (let emote of this.emotes) {
                emote.drawEmote(this.gFront, this.map);
            }

        }
        this.gFront.restore();
    }


    drawCursor() {
        if (this.pointers.length === 1) {
            const pointer = this.pointers[0],
                tile = this.getTileAt(pointer);
            this.gFront.strokeStyle = "red";
            this.gFront.strokeRect(
                tile.x * this.map.tileWidth,
                tile.y * this.map.tileHeight,
                this.map.tileWidth,
                this.map.tileHeight);
        }
    }
}

class GamepadButtonPressedEvent extends Event {
    constructor(button) {
        super("gamepadButtonPressed");
        this.button = button;
    }
}
