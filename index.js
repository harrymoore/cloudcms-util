#!/usr/bin/env node
'use strict';
const [,, ... args] = process.argv;
var script = args[0] || "";
process.argv.shift();
if (script === "import") {
    require('./cloudcms-import');
} else if (script === "export") {
    require('./cloudcms-export');
} else {
    console.log("Unknown command " + script);
    console.log("Supported commands are import and export");
    return;
}

