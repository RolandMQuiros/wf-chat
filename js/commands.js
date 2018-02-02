const {Room} = require("./room");


const helpDescriptions = {
    "/help": `Displays an explanation of a given command\n\tusage: /help command`,
    "/rooms": `Displays the currently active rooms\n\tusage: /rooms`,
    "/join": `Join a room\n\tusage: /join roomname`,
    "/leave": `Leave the current room\n\tusage: /leave`,
    "/create": `Creates a new room\n\tusage: /create roomname [description] [motd]`,
    "/nick": `Change your visible username within the current room\n\tusage: /nick newname`,
    "/motd": `Displays the current room's message of the day\n\tusage: /motd`,
}

function help(user, args) {
    if (args.length < 1) {
        user.send(helpDescriptions["/help"]);
    } else {
        const description = helpDescriptions[args[0]];
        user.send(description || `No command "${args[0]}" found`);
    }
}

function rooms(user) {
    Object.keys(Room.activeRooms).forEach(roomName => {
        user.send(` * ${roomName}`);
    });
}

async function join(user, args) {
    if (args.length < 1) {
        help(user, ["/join"]);
    } else {
        const roomName = args[0];
        if (Room.activeRooms.hasOwnProperty(roomName)) {
            const room = Room.activeRooms[roomName];
            if (user.currentRoom && room !== user.currentRoom) {
                leave(user);
            }

            await room.addUser(user);

            user.send(`Entering room: ${room.name}`);
            const roomUsers = await room.getAllUsersInfo();
            
            roomUsers.forEach(u => {
                user.send(` * ${u.name}${u.id == user.info.id ? "(** this is you)" : ""}`);
            });

            user.send("end of list.");
            if (room.options.motd) {
                user.send(room.options.motd);
            }
            await room.post({ type: "join", body: `New user joined the chat: ${user.info.name}` });
        } else {
            user.send(`No room named "${roomName}" exists!`);
        }
    }
}

async function leave(user) {
    if (user.currentRoom) {
        user.currentRoom.post({ type: "leave", body: `User has left the chat: ${user.info.name}` });
        await user.currentRoom.removeUser(user);
    }
}

function quit(user) {

}

async function create(client, user, args) {
    if (args.length < 1) {
        help(user, ["/create"]);
    } else {
        const roomName = args[0];
        let options = { creator: user.info.id };
        if (args.length >= 2) { options.description = args[1]; }
        if (args.length >= 3) { options.motd = args[2]; }

        if (Room.activeRooms.hasOwnProperty(roomName)) {
            user.send(`A room named "${roomName}" already exists`);
        } else {
            const newRoom = new Room(client, roomName);
            await newRoom.create(options);
            user.send(`New room "${roomName}" created successfully`);
        }
    }
}

function post(user, data) {
    if (user.currentRoom) {
        user.currentRoom.post({
            type: "post",
            from: user.info.id,
            body: data
        });
        return false;
    }
    return true;
}

exports.parse = async function parse(client, user, data) {
    const tokens = data.split(" ");
    if (tokens.length > 0) {
        const command = tokens[0];
        const args = tokens.slice(1);
        let echo = true;
        switch (command) {
            case "/help":
                help(user, args);
                break;
            case "/rooms":
                rooms(user);
                break;
            case "/join":
                await join(user, args);
                break;
            case "/leave":
                leave(user, args);
                break;
            case "/create":
                await create(client, user, args);
                break;
            case "/quit":
                quit(user);
                break;
            default:
                echo = post(user, data);
        }

        if (echo) {
            user.send(data, false);
        }
    }
}