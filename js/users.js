const bcrypt = require("bcrypt");
const keys = require("./redis-keys");

async function checkUsername(client, username) {
    return await client.hgetAsync(keys.USERNAME_ID_MAP, username);
}

/**
 * Creates a user in the database, if the username is available. 
 * @param {redis} client 
 * @param {string} username 
 * @param {string} password 
 * @returns A Promise resolving to a user object
 */
exports.createUser = async function(client, username, password) {
    let user = {};
    if (await checkUsername(client, username)) {
        return user;
    }
    const userID = await client.incrAsync(keys.SEQ_USER_ID);
    const saltRounds = process.env.USER_SALT_ROUNDS || 10;

    try {
        const hash = await bcrypt.hash(password, saltRounds);
        const credKey = keys.userCreds(userID);
        await client.multi()
            .hmset(credKey, "username", username, "hash", hash)
            .hmset(keys.USERNAME_ID_MAP, username, userID)
            .execAsync();

        user = {
            id: userID,
            info: {
                username,
                aliases: [],
                channels: []
            }
        };
    } catch (err) {
        client.decr(keys.SEQ_USER_ID);
        throw err;
    }
    return user;
}

/**
 * 
 * @param {redis} client 
 * @param {string} username 
 * @param {string} password 
 */
exports.getUser = async function(client, username, password) {
    let user = {};
    const userID = await client.hgetAsync(keys.USERNAME_ID_MAP, username);
    const hash = await client.hgetAsync(keys.userCreds(userID), "hash");

    if (await bcrypt.compare(password, hash)) {
        user.username = username;
        [user.aliases, user.channels] = (await client.mgetAsync(
            keys.userAliases(userID),
            keys.userChannels(userID)
        )).map(result => result || []);
    }
    return user;
}

exports.createSession = async function(client, socket, user) {
    user.socket = socket;
}