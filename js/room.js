const redis = require("redis-promisify");
const {User} = require("./user");

const KEYS = {
    SEQ_ROOM_ID: "seq:room.id",
    ROOM_NS: "room",
    ROOM_ID_MAP: "rooms",
    ROOM_PUSH_CHANNEL: "rooms:push.channel",
    room: roomID => `${KEYS.ROOM_NS}:${roomID}`,
    roomInfo: roomID => `${KEYS.room(roomID)}:info`,
    roomArchive: roomID => `${KEYS.room(roomID)}:archive`,
    roomChannel: roomID => `${KEYS.room(roomID)}:channel`,
    roomUsers: roomID => `${KEYS.room(roomID)}:users`
};

let activeRooms = {};
let roomPushPub = null;
let roomPushSub = null;

/**
 * A collection of static information about a Room
 * @typedef RoomOptions
 * @member {number} creator The ID of the user that created this room, who has exclusive rights to delete and modify it
 * @member {string} description A short description of the room
 * @member {string} motd The message of the day. Displayed when a user first enters a room, or uses the /motd command.
 */

 /**
  * A message object broadcast throughout a Room. Contains recipient information and the message body.
  * @typedef RoomMessage
  * @member {string} type The type of message. Can be either a "post", a "join", or a "leave"
  * @member {number} from User ID number of the sending user
  * @member {string} body The message body
  * @member {number|Array<number>} to One or more users receiving the message. null if sent to all users in a room.
  */

/**
 * Class and namespace for chatroom logic. Handles both synchronizing data with the KV store and transmitting information between
 * sockets.
 */
class Room {
    static get activeRooms() { return activeRooms; }
    /**
     * Creates a Room object for every active room specified in the KV store.
     * @param {redis} client The redis client instance used to generate the Room instances
     */
    static async createAllRooms(client) {
        const allRooms = await client.hgetallAsync(KEYS.ROOM_ID_MAP);
        activeRooms = {};
        Object.keys(allRooms).forEach(rn => {
            activeRooms[rn] = new Room(client, rn).create()
        });
        return activeRooms;
    }
    /**
     * Sets up a subscription to the room push channel in Redis, which emits a message whenever a new room has been created. This lets
     * server instances know when to create new Room instances.
     * @param {redis} client The source redis client to clone for the subscription
     */
    static async watchPushChannel(client) {
        // Clone the redis client
        roomPushSub = redis.createClient(client.options);
        roomPushPub = redis.createClient(client.options);

        // Subscribe to the room push channel
        roomPushSub.subscribe(KEYS.ROOM_PUSH_CHANNEL);
        roomPushSub.on("message", msg => {
            switch (msg.type) {
                case "create":
                    if (!activeRooms.hasOwnProperty(msg.roomName)) {
                        activeRooms[msg.roomName] = new Room(client, msg.roomName).create();
                    }
                    break;
                case "destroy":
                    if (activeRooms.hasOwnProperty(msg.roomName)) {
                        activeRooms[msg.roomName].destroy();
                        delete activeRooms[msg.roomName];
                    }
                    break;
            }
        });
    }
    /**
     * Kicks all users from all rooms. Used in case the server suddenly goes down and we need to sync the Redis store as
     * well as we can.
     */
    static clearAllRooms() {
        activeRooms.forEach(r => r.unsubscribe());
    }
    /**
     * Constructs a new chatroom.  A chatroom is a Redis channel subscription/publish pair which broadcasts messages to and from 
     * user sockets.
     * @param {redis} client The Redis client instance, used to synchronize state between all instances of this server
     * @param {string} roomName The user-visible name of this chat room. Used to identify it until an ID can be established
     */
    constructor(client, roomName) {
        this._client = client; // Reference to the redis client
        this._name = roomName; // Display name for the room
        this._id = -1; // Redis key number
        this._instanceUsers = {}; // A map of users that are connected directly to this instance
        this._allUsers = {} // A map of all users connected to this room from all server instances
        this._channel = ""; // The redis channel the room is subscribed to
        this._pub = null; // The publish redis client. All messages are sent through this.
        this._sub = null; // The subscription redis client. All messages are retrieved through this.
        this._options = {}; // Various user-facing strings such as the room description or MOTD

        // method binds
        this.create = this.create.bind(this);
        this.unsubscribe = this.unsubscribe.bind(this);
        this.post = this.post.bind(this);
        this.join = this.addUser.bind(this);
        this.leave = this.removeUser.bind(this);
        this._onSubMessage = this._onSubMessage.bind(this);
    }
    /** Returns the user-readable name of the chatroom */
    get name() { return this._name; }
    /** Returns the current options object */
    get options() { return this._options; }
    /**
     * Retrieves an array of UserInfo objects for each user in this chatroom.
     * @returns {Array<UserInfo>} An array of UserInfo for all users in the chatroom
     */
    async getAllUsersInfo() {
        return this._client.smembersAsync(KEYS.roomUsers(this._id))
            .then(ids =>
                Promise.all(ids.map(id => User.userInfo(this._client, id)))
            );
    }
    /**
     * Sets the options object and syncs it with the KV store
     * @async
     * @param {RoomOptions} opt A collection of static information about the room
     */
    async setOptions(opt) {
        this._options = await this._client.hgetallAsync(KEYS.roomInfo(this._id));
        this._options = { ...this._options, ...opt };
        return this._client.multi()
            .hmset(KEYS.ROOM_ID_MAP, this._name, this._id)
            .hset(
                KEYS.roomInfo(this._id),
                "creator", this._options.creator || "",
                "description", this._options.description || "",
                "motd", this._options.motd || ""
            )
            .execAsync();
    }
    /**
     * Creates a new Room instance on this server instance. If an `options` parameter is specified, it's used to update the
     * KV store's options.
     * @async
     * @param {RoomOptions} options A collection of static information about the room
     */
    async create(options) {
        // Create a new room on the KV if one doesn't exist by its name
        const existingID = await this._client.hgetAsync(KEYS.ROOM_ID_MAP, this._name);
        if (!existingID) {
            this._id = await this._client.incrAsync(KEYS.SEQ_ROOM_ID);
            if (!this._id) { throw new Error("Could not create new room"); }
        } else {
            this._id = existingID;
        }

        // Update the options
        await this.setOptions(options || {});
        
        // Cache some keys
        this._channel = KEYS.roomChannel(this._id);
        this._archive = KEYS.roomArchive(this._id);

        // Create publish/subscribe clients for message sync'ing
        this._sub = redis.createClient(this._client.options);
        this._pub = redis.createClient(this._client.options);
        
        // Subscribe this room to a redis channel
        this._sub.subscribe(KEYS.roomChannel(this._id));

        // Handle message from the subscription
        this._sub.on("message", this._onSubMessage);

        // Cache this Room instance
        activeRooms[this.name] = this;

        // Notify all other server instances that a room was created
        roomPushPub.publish(KEYS.ROOM_PUSH_CHANNEL, JSON.stringify({
            type: "create",
            roomName: this.name
        }));
        
        return this;
    }
    /**
     * Unsubscribes this Room from the Redis message channel and kicks all users
     */
    unsubscribe() {
        this._sub.unsubscribe();
        const users = Object.values(this._instanceUsers);
        users.forEach(u => this.removeUser(u));
        return this;
    }
    /**
     * Unsubscribes this room from the Redis channel, removes all users, and removes the room from the room-id map, making it
     * invisible from the list. The message archive remains, however.
     */
    async destroy() {
        if (this._name) {
            await this._client.hdelAsync(KEYS.ROOM_ID_MAP, this._name);
            this.unsubscribe();
        }
        return this;
    }
    /**
     * Adds a user to this room. The user will then receive messages published to this room's channel.
     * @async
     * @param {User} user User to add
     */
    async addUser(user) {
        this._instanceUsers[user.info.id] = user;
        user.currentRoom = this;     
        user.once("close", () => { this.removeUser(user); });
        return this._client.saddAsync(KEYS.roomUsers(this._id), user.info.id);
    }
    /**
     * Removes a user from this room.
     * @async
     * @param {User} user User to remove
     */
    async removeUser(user) {
        if (this._instanceUsers.hasOwnProperty(user.info.id)) {
            delete this._instanceUsers[user.info.id];
            user.currentRoom = null;
        }
        return this._client.sremAsync(KEYS.roomUsers(this._id), user.info.id);
    }
    /**
     * Posts a message to this room.
     * @async
     * @param {Message} message Message to post
     */
    async post(message) {
        console.log(message);
        this._pub.publish(this._channel, JSON.stringify(message));
        await this._client.zaddAsync(this._archive, new Date().getTime(), JSON.stringify(message));
        return this;
    }
    async _onSubMessage(channel, raw) {
        const message = JSON.parse(raw);

        switch (message.type) {
            // Leaves and Joins trigger an update of our _allUsers cache
            case "leave":
            case "join":
                const allUserInfo = await this.getAllUsersInfo();
                this._allUsers = {};
                allUserInfo.forEach(u => this._allUsers[u.id] = u.name);
            // Posts are displayed to the users
            case "post":
                Object.values(this._instanceUsers)
                    .filter(u => (!message.to || message.to.includes(u.info.id)))  // If message.to is defined, only send it to its intended recipient(s)
                    .forEach(user => {
                        const from = message.from ? `${this._allUsers[message.from]}:` : "*";
                        user.send(`${from} ${message.body}`, message.from != user.info.id);
                    });
                break;
        }
    }
};

exports.Room = Room;