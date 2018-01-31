
const SEQ_USER_ID = "seq:user.id";
const USER_NS = "user";
const USERNAME_ID_MAP = "usernames";
const user = userID => `${USER_NS}:${userID}`;
const userCreds = userID => `${user(userID)}:creds`;
const userAliases = userID => `${user(userID)}:aliases`;
const userChannels = userID => `${user(userID)}:channels`;

const SEQ_ROOM_ID = "seq:room.id";
const ROOM_NS = "room";
const ROOM_ID_MAP = "rooms";
const room = roomID => `${ROOM_NS}:${roomID}`;
const roomInfo = roomID => `${room(roomID)}:info`;
const roomArchive = roomID => `${room(roomID)}:archive`;
const roomChannel = roomID => `${room(roomID)}:channel`;

module.exports = {
    SEQ_USER_ID,
    USER_NS,
    USERNAME_ID_MAP,
    user,
    userCreds,
    userAliases,
    userChannels,
    SEQ_ROOM_ID,
    ROOM_NS,
    ROOM_ID_MAP,
    room,
    roomInfo,
    roomChannel
};