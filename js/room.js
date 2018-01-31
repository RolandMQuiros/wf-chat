const keys = require("./redis-keys");

const KEYS = {
    SEQ_ROOM_ID: "seq:room.id",
    ROOM_NS: "room",
    ROOM_ID_MAP: "rooms",
    room: roomID => `${ROOM_NS}:${roomID}`,
    roomInfo: roomID => `${room(roomID)}:info`,
    roomArchive: roomID => `${room(roomID)}:archive`,
    roomChannel: roomID => `${room(roomID)}:channel`,
};

exports.Room = class {
    static get KEYS() { return KEYS; }
    constructor(client, roomName) {
        this._client = client;
        this._name = roomName;
        this._users = [];
        this._userIDs = new Set();
        this._channel = "";
        this._pub = null;
        this._sub = null;
        this.info = { creator: "", description: "" };

        this.create = this.create.bind(this);
        this.unsubscribe = this.unsubscribe.bind(this);
        this.post = this.post.bind(this);
        this._onSubMessage = this._onSubMessage.bind(this);
    }
    async create(options) {
        if (!(await client.getAsync(KEYS.ROOM_ID_MAP, roomName))) {
            const roomID = await client.incrAsync(KEYS.SEQ_ROOM_ID);
            client.hsetAsync(
                KEYS.roomInfo(roomID),
                "creator", options.creator || "",
                "description", options.description || ""
            );   
        }
        this.info.creator = options.creator || "";
        this.info.description = options.description || "";
        
        this._channel = KEYS.roomChannel(roomID);
        this._archive = KEYS.roomArchive(roomID);
        this._sub = redis.createClient(this._client.options);
        this._pub = redis.createClient(this._client.options);
        
        // Subscribe this room to a redis channel
        this._sub.subscribe(KEYS.roomChannel(roomID));

        // Handle message from the subscription
        this._sub.on("message", this._onSubMessage);

        return this;
    }
    unsubscribe() {
        this._sub.unsubscribe();
    }
    async post(message) {
        this._pub.publish(this._channel, JSON.stringify(message));
        await this._client.zadd(this._archive, JSON.stringify(message));
        return this;
    }
    _onSubMessage(channel, raw) {
        const message = JSON.parse(raw);
        this._users
            .filter(u => (!message.to || message.to.includes(u.id)) && // If message.to is defined, only send it to its intended recipient(s)
                          message.from !== u.id) // Don't echo it back to the user that sent the message
            .forEach(user => {
                user.socket.write(`${message.from}: ${message.body}\n`);
            });
    }
};