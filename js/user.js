const bcrypt = require("bcrypt");

const KEYS = {
    SEQ_USER_ID: "seq:user.id",
    USER_NS: "user",
    USERNAME_ID_MAP: "usernames",
    USERS_ACTIVE: `users:active`,
    user: userID => `${KEYS.USER_NS}:${userID}`,
    userCreds: userID => `${KEYS.user(userID)}:creds`,
    userAliases: userID => `${KEYS.user(userID)}:aliases`,
    userChannels: userID => `${KEYS.user(userID)}:channels`
};

const USER_SALT_ROUNDS = process.env.USER_SALT_ROUNDS || 10;

function cleanInput(data) {
	return data.toString().replace(/(\r\n|\n|\r)/gm,"");
}

exports.User = class User {
    static async exists(client, username) {
        return await client.hgetAsync(KEYS.USERNAME_ID_MAP, username);
    }
    static async activeUsers(client) {
        return await client.smembersAsync(KEYS.USERS_ACTIVE);
    }
    static async userInfo(client, userID) {
        let credentials = await client.hgetallAsync(KEYS.userCreds(userID));
        if (credentials) {
            return { id: userID,  name: credentials.username };
        }
        return null;
    }
    constructor(client, socket) {
        this._info = null;
        this._client = client;
        this._socket = socket;

        this._onSocketData = this._onSocketData.bind(this);
        this._onSocketEnd = this._onSocketEnd.bind(this);
        this.currentRoom = null;

        this._socket.on("timeout", () => {
            if (this._onTimeout) { this._onTimeout(); }
        });
    }
    get info() { return this._info; }
    set timeout(t) {
        this._timeout = t;
        this._socket.setTimeout(this._timeout);
    }
    set onTimeout(cb) { this._onTimeout = cb; }
    set onData(cb) { this._onData = cb; }
    on(event, cb) { this._socket.on(event, cb); }
    once(event, cb) { this._socket.once(event, cb); }
    async create(username, password) {
        if (this._info) { return this; }

        let existingID = await User.exists(this._client, username);
        if (existingID) { return login(username, password); }
        existingID = await this._client.incrAsync(KEYS.SEQ_USER_ID);

        try {
            const hash = await bcrypt.hash(password, USER_SALT_ROUNDS);
            await this._client.multi()
                .hmset(KEYS.userCreds(existingID), "username", username, "hash", hash)
                .hmset(KEYS.USERNAME_ID_MAP, username, existingID)
                .execAsync();
        } catch (err) {
            await this._client.decrAsync(KEYS.SEQ_USER_ID);
            throw err;
        }

        this._info = {
            id: existingID,
            name: username
        };

        await this._finishLogin();

        return this;
    }
    async login(username, password) {
        if (this._info) { return this; }

        const existingID = await this._client.hgetAsync(KEYS.USERNAME_ID_MAP, username);
        if (existingID === null) { return null; }
        
        const hash = await this._client.hgetAsync(KEYS.userCreds(existingID), "hash");
        if (!await bcrypt.compare(password, hash)) { return null; }

        this._info = {
            id: existingID,
            name: username
        };

        await this._finishLogin();

        return this;
    }
    async disconnect() {
        this._socket.end();
        return this._client.srem(KEYS.USERS_ACTIVE, this._info.id);
    }
    send(data, incoming=true) {
        this._socket.write(`${incoming ? "<=" : "=>"} ${data}\n`);
    }
    async data() {
        return new Promise((resolve, reject) => {
            try { this._socket.once("data", data => resolve(cleanInput(data))); }
            catch (err) { reject(err); }
        });
    }
    async _finishLogin() {
        this._socket.on("data", this._onSocketData);
        this._socket.on("end", this._onSocketEnd);
        this._info = Object.freeze(this._info);

        return this._client.saddAsync(KEYS.USERS_ACTIVE, this._info.id);
    }
    _onSocketData(data) {
        if (this._onData) { this._onData(this._info, data); }
    }
    _onSocketEnd() {
        if (this._onDisconnect) { this._onDisconnect(); }
        return this._client.sremAsync(KEYS.USERS_ACTIVE, this._info.id);
    }
}