#!/usr/bin/env node
'use strict';
const chalk = require('chalk');

const [,, ... args] = process.argv;
var script = args[0] || "";
process.argv.shift();

console.log('cloudcms-util ' + chalk.blue(script));

if (script === "import") {
    require('../cloudcms-import');
} else if (script === "export") {
    require('../cloudcms-export');
} else {
    console.log(chalk.red("Unknown command " + script));
    console.log(chalk.blue("Supported commands are: ") + chalk.green("import, export"));
    return;
}

