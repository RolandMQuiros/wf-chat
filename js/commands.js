const {Room} = require("./room");


const helpDescriptions = {
    "/help":        `Displays an explanation of a given command\n\tusage: /help command`,
    "/rooms":       `Displays the currently active rooms\n\tusage: /rooms`,
    "/join":        `Join a room\n\tusage: /join roomname`,
    "/leave":       `Leave the current room\n\tusage: /leave`,
    "/create":      `Creates a new room\n\tusage: /create roomname`,
    "/about":       `Displays the current room's description\n\tusage: /about`,
    "/dedit":       `Changes the description of the current room. Only available to the owner.\n\tusage:/dedit description`,
    "/motd":        `Displays the current room's message of the day\n\tusage: /motd`,
    "/medit":       `Changes a room's message of the day. Only available to the owner\n\tusage: /medit message`,
    "/destroy":     `Destroys the current room. Only the owner can do this.\n\tusage: /destroy`,
}

function help(user, args) {
    if (args.length < 1) {
        Object.keys(helpDescriptions).forEach(
            k => user.send(`${k}: ${helpDescriptions[k]}`)
        );
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
            motd(user);
            await room.post({ type: "join", body: `New user joined the chat: ${user.info.name}` });
        } else {
            user.send(`No room named "${roomName}" exists!`);
        }
    }
}

async function leave(user) {
    if (user.currentRoom) {
        const room = user.currentRoom;
        room.post({ type: "leave", body: `User has left the chat: ${user.info.name}` });
        await room.removeUser(user);
        user.send(`You have left "${room.name}"`);
    }
}

function quit(user) {
    user.send("Bye");
    user.disconnect();
}

async function create(client, user, args) {
    if (args.length < 1) {
        help(user, ["/create"]);
    } else {
        const roomName = args[0];
        let options = { creator: user.info.id };

        if (Room.activeRooms.hasOwnProperty(roomName)) {
            user.send(`A room named "${roomName}" already exists`);
        } else {
            const newRoom = new Room(client, roomName);
            await newRoom.create(options);
            user.send(`New room "${roomName}" created successfully`);
        }
    }
}

function about(user) {
    if (user.currentRoom) {
        if (user.currentRoom.options.description) {
            user.send(user.currentRoom.options.description);
        } else {
            user.send("No description has been set for this room");
        }
    } else {
        user.send("You are not currently in a room");
    }
}

async function dedit(user, args) {
    if (args.length <= 0) {
        help(user, ["/dedit"]);
    } else {
        const room = user.currentRoom;
        if (room) {
            if (room.options.creator == user.info.id) {
                const description = args.join(" ");
                const newOptions = { ...room.options, description };
                console.log(newOptions);
                room.setOptions(newOptions);
                user.send(`Updated description for ${room.name} to: ${description}`);
            } else {
                user.send("Only the room owner can change the description");
            }
        } else {
            user.send("You are currently not in a room");   
        }
    }
}


function motd(user) {
    if (user.currentRoom) {
        if (user.currentRoom.options.motd) {
            user.send(`Message of the day\n\t${user.currentRoom.options.motd}\n`);
        }
    } else {
        user.send("You are not currently in a room");
    }
}

async function medit(user, args) {
    if (args.length <= 0) {
        help(user, ["/medit"]);
    } else {
        const room = user.currentRoom;
        if (room) {
            if (room.options.creator == user.info.id) {
                const motd = args.join(" ");
                const newOptions = { ...room.options, motd };
                console.log(newOptions);
                room.setOptions(newOptions);
                user.send(`Updated motd for ${room.name} to: ${motd}`);
            } else {
                user.send("Only the room owner can change the MOTD");
            }
        } else {
            user.send("You are currently not in a room");   
        }
    }
}

async function destroy(user) {
    const room = user.currentRoom;
    if (room) {
        const createdBy = user.currentRoom.options.creator;
        if (createdBy && createdBy == user.info.id) {
            user.send("This will kick all users from the room and remove it from the directory. Continue? [y/n]");
            const yn = await user.data();
            if (yn == "y") {
                room.post({
                    type: "post",
                    body: "This room is now being destroyed. Vacate the premises."
                });
                room.destroy();
            }
        } else {
            user.send("Only the room's creator can destroy a room");
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
        
        // Do a direct echo if a command was given
        if (helpDescriptions.hasOwnProperty(command)) {
            user.send(data, false);
        }
        
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
            case "/about":
                about(user);
                break;
            case "/dedit":
                await dedit(user, args);
                break;
            case "/motd":
                motd(user);
                break;
            case "/medit":
                await medit(user, args);
                break;
            case "/destroy":
                await destroy(user);
                break;
            case "/quit":
                quit(user);
                break;
            default:
                if (post(user, data)) {
                    user.send(data, false);
                }
        }
    }
}