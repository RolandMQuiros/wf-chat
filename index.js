const users = require("./js/users");
const redis = require("redis-promisify");
const keys = require("./js/redis-keys");
const {Room} = require("./js/room");

const client = redis.createClient();