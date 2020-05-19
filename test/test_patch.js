/*jshint esversion: 8 */
var assert = require('assert');

describe("Connect", async function () {
    const Command = require('../Patch');
    let cmd = new Command();
    await cmd.exec();
});
