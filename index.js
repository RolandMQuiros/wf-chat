const net = require("net");
const redis = require("redis-promisify");

const {Room} = require("./js/room");
const {User} = require("./js/user");
const commands = require("./js/commands");

const PORT = process.env.WFCHAT_PORT || 0;
const LOGIN_RETRIES = process.env.LOGIN_RETRIES || 5;
const LOGIN_TIMEOUT = process.env.WFCHAT_LOGIN_TIMEOUT || 30000; // Timeout at login screen in 30 seconds
const ACTIVE_TIMEOUT = process.env.WFCHAT_ACTIVE_TIMEOUT || 9E3; // Timeout if inactive for 15 mins

const client = redis.createClient(
    process.env.REDIS_URL,
    {
        port: process.env.REDIS_PORT
    }
);

// Create rooms from the KV store
Room.createAllRooms(client);

// Watch the store for when new rooms are created
Room.watchPushChannel(client);

/**
 * Poll a user for input and process it
 * @param {User} user The user to poll for input
 */
async function listen(user) {
    let data;
    while (data = await user.data()) {
        commands.parse(client, user, data);
    }
}

async function login(socket) {
    const user = new User(client, socket);
    const address = socket.address();
    console.log(`Connection established from ${address.address}:${address.port}`);

    //user.timeout = LOGIN_TIMEOUT;
    // user.onTimeout = () => {
    //     user.send(`Session timed out (inactive for ${LOGIN_TIMEOUT / 1000.0} seconds)`);
    //     user.disconnect();
    // };

    user.send("Welcome to the WFCHAT server!");
    let loggedInUser = null;

    for (let i = LOGIN_RETRIES; !loggedInUser && i > 0; i--) {
        user.send("Username?");
        const username = await user.data();

        let registerYN = "";
        if (!await User.exists(client, username)) {
            while (registerYN !== "y" && registerYN !== "n") {
                user.send("Username does not exist on this server! Create an account? [y/n]");
                registerYN = (await user.data()).toLowerCase();
            }
            if (registerYN === "n") { continue; }
        }
    
        user.send("Password:");
        const password = await user.data();

        if (registerYN === "y") {
            loggedInUser = await user.create(username, password);
        } else {
            loggedInUser = await user.login(username, password);
        }

        if (loggedInUser) {
            if (registerYN === "y") {
                user.send("Account created successfully!");
            } else {
                user.send(`Welcome back, ${user.info.name}`);
            }
        } else {
            user.send(`Bad username or password. Please try again (retries left: ${i})`);
        }
    }

    if (!loggedInUser) {
        user.send(`Too many retries. Disconnecting.`);
        user.disconnect();
    } else {
        await listen(loggedInUser);
    }
}

// Listen for connections

const server = net.createServer(login);
server.listen(PORT)
   .on("listening", () => { console.log(`WFChat started! Listening on port ${server.address().port}`); })
   .on("close", Room.clearAllRooms)
   .on("error", Room.clearAllRooms);