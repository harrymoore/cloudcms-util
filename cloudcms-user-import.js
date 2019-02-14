#!/usr/bin/env node

/*jshint -W069 */
/*jshint -W104*/
const Gitana = require("gitana");
const fs = require("fs");
const path = require("path");
const mime = require('mime-types');
const async = require("async");
const cliArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage')
const util = require("./lib/util");
const writeJsonFile = require('write-json-file');
const _ = require('underscore');
const csv = require('csvtojson');
const wrench = require("wrench");
const Logger = require('basic-logger');
const log = new Logger({
    showMillis: false,
    showTimestamp: true
});

// debug only when using charles proxy ssl proxy when intercepting cloudcms api calls:
if (process.env.NODE_ENV !== "production") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

var options = handleOptions();
if (!options) {
    return;
}
if (options["verbose"]) {
    Logger.setLevel('debug', true);
} else {
    Logger.setLevel('info', true);
}

var option_prompt = options["prompt"];
var option_username = options["username"];
var option_password = options["password"];
var option_useCredentialsFile = options["use-credentials-file"];
var option_gitanaFilePath = options["gitana-file-path"] || "./gitana.json";
var option_dataFolderPath = options["folder-path"];
var option_csvSource = options["csv-source"];
var option_defaultPassword = options["default-password"];
var option_projectId = options["project-id"];
var option_teamKey = options["team-key"];
var option_help = options["help"];

//
// load gitana.json config and override credentials
//
var gitanaConfig = JSON.parse("" + fs.readFileSync(option_gitanaFilePath));
if (option_useCredentialsFile) {
    // override gitana.json credentials with username and password properties defined in the cloudcms-cli tool local db
    var rootCredentials = JSON.parse("" + fs.readFileSync(path.join(util.homeDirectory(), ".cloudcms", "credentials.json")));
    gitanaConfig.username = rootCredentials.username;
    gitanaConfig.password = rootCredentials.password;
} else if (option_prompt) {
    // override gitana.json credentials with username and password properties entered at command prompt
    var option_prompt = require('prompt-sync')({
        sigint: true
    });
    gitanaConfig.username = option_prompt('name: ');
    gitanaConfig.password = option_prompt.hide('password: ');
}

if (option_username) {
    gitanaConfig.username = option_username;
}

if (option_password) {
    gitanaConfig.password = option_password;
}

util.parseGitana(gitanaConfig);

// figure out what to do from specified options
if (option_csvSource && option_dataFolderPath) {
    log.error("You must use either --csv-source or --folder-path but not both");
} else if (option_csvSource) {
    // import from csv file
    handleCsvUsers();
} else if (option_help) {
    printHelp(getOptions());
} else {
    // import from data folder
    handleUsers();
}

return;

//
// functions
//
function handleCsvUsers() {
    log.debug("handleCsvUsers()");

    util.getBranch(gitanaConfig, "master", function (err, branch, platform, stack, domain, primaryDomain, project) {
        if (err) {
            log.debug("Error connecting to Cloud CMS: " + err);
            return;
        }

        log.info("connected to project: \"" + project.title + "\" and branch: \"" + (branch.title || branch._doc) + "\"");
        log.info("primary domain id: \"" + primaryDomain.__id() + "\"");

        var context = {
            branch: branch,
            platform: platform,
            stack: stack,
            domain: domain,
            primaryDomain: primaryDomain,
            project: project,
            gitanaConfig: gitanaConfig,
            csvSource: option_csvSource,
            defaultPassword: option_defaultPassword,
            projectId: option_projectId,
            teamKey: option_teamKey,
            usersToImport: null // stores the data from the csv file after parsing
        };

        async.waterfall([
            async.ensureAsync(async.apply(parseCsv, context)),
            async.ensureAsync(queryExistingUsers),
            async.ensureAsync(createMissingUsers),
            async.ensureAsync(addUsersToProject),
            async.ensureAsync(addUsersToProjectTeam)
        ], function (err, context) {
            if (err) {
                log.error("Error importing: " + err);
                return;
            }

            log.info("Import complete");
            return;
        });

    });
}

function handleUsers() {
    log.debug("handleUsers()");

    util.getBranch(gitanaConfig, "master", function (err, branch, platform, stack, domain, primaryDomain, project) {
        if (err) {
            log.debug("Error connecting to Cloud CMS: " + err);
            return;
        }

        log.info("primary domain id: \"" + primaryDomain.__id() + "\"");

        var context = {
            branch: branch,
            platform: platform,
            stack: stack,
            domain: domain,
            primaryDomain: primaryDomain,
            project: project,
            gitanaConfig: gitanaConfig,
            queryFilePath: option_queryFilePath,
            dataFolderPath: option_dataFolderPath || './data',
            query: {},
            nodes: []
        };

        if (option_queryFilePath) {
            context.query = require(option_queryFilePath);
        }

        if (option_allUsers) {
            context.query = {};
        }

        async.waterfall([
            async.apply(queryUsers, context)
        ], function (err, context) {
            if (err) {
                log.error("Error exporting: " + err);
                return;
            }

            log.info("Export complete");
            return;
        });

    });
}

function parseCsv(context, callback) {
    log.debug("parseCsv()");

    if (!fs.existsSync(option_csvSource)) {
        callback("csv file not found: " + option_csvSource, context);
    }

    csv().fromFile(option_csvSource).then(function (data) {
        context.usersToImport = data;
        log.info("usersToImport: " + JSON.stringify(context.usersToImport, null, 2));
        callback(null, context);
        return;
    });
}

function queryExistingUsers(context, callback) {
    log.debug("queryExistingUsers()");

    var usersByName = {};
    var userNames = _.map(context.usersToImport, function (user) {
        usersByName[user.name || user.NAME] = user;
        return user.name || user.NAME;
    });

    context.primaryDomain.queryUsers({
        name: {
            "$in": userNames
        }
    }, {
        limit: -1
    }).eachX(function () {
        var node = this;
        if (usersByName[node.name]) {
            usersByName[node.name].node = node;
        }
    }).then(function () {
        context.existingUsers = this.asArray();
        context.existingUserNames = _.each(context.existingUsers, function (user) {
            return user.name;
        });

        callback(null, context);
    });
}

function createMissingUsers(context, callback) {
    log.debug("createMissingUsers()");

    var newUsers = _.filter(context.usersToImport, function (newUser) {
        return _.isEmpty(context.existingUserNames[newUser.name || newUser.NAME]);
    });

    if (!option_defaultPassword) {
        // if no default password then filter out users with no password
        newUsers = _.filter(newUsers, function (newUser) {
            var pw = newUser.password || newUser.PASSWORD;
            if (_.isEmpty(pw)) {
                log.warn("Skipping user \"" + (newUser.NAME || newUser.name) + "\". No password specified and there is no --default-password option.");
                return false;
            }

            return true;
        });
    }

    async.eachSeries(newUsers, function (user, callback) {

        var userObject = {
            name: user.name || user.NAME,
            email: user.email || user.EMAIL,
            first: user.first || user.FIRST,
            last: user.last || user.LAST,
            company: user.company || user.COMPANY,
            password: user.password || user.PASSWORD || context.defaultPassword,
        };

        Chain(context.primaryDomain).trap(function (err) {
            log.warn("user create failed on primary domain: " + JSON.stringify(err.message || err));
            callback();
        }).createUser(userObject).then(function () {
            var node = this;
            user.node = node;
            log.info("Created user node " + node._doc + " for \"" + userObject.name + "\"");
            callback();
        });
    }, function () {
        // update list of users to filter out users who could not be created
        context.usersToImport = _.filter(context.usersToImport, function (user) {
            return !_.isEmpty(user.node);
        });

        callback(null, context);
    });
}

function addUsersToProject(context, callback) {
    log.debug("addUsersToProject()");

    if (!option_projectId) {
        // no project id specified
        return callback(null, context);
    }

    async.eachSeries(context.usersToImport,
        function (user, callback) {
            Chain(context.project).trap(function (err) {
                log.warn("Error adding user " + user.node.name + " " + user.node._doc + " to the project " + option_projectId + ".  " + err);
                callback();
            }).inviteUser(user.node._doc).then(function () {
                log.info("Added user to the project " + user.node.name + " " + user.node._doc);
                callback(null, context);
            });
        }, function (err) {
            callback(null, context);
        }
    );
}

function addUsersToProjectTeam(context, callback) {
    log.debug("addUsersToProjectTeam()");

    if (!option_projectId) {
        // no project id specified
        return callback(null, context);
    }

    if (!option_teamKey) {
        // no team key specified
        return callback(null, context);
    }

    async.eachSeries(context.usersToImport, function (user, callback) {
        Chain(context.stack).trap(function (err) {
            log.warn("Error adding user " + user.node.name + " " + user.node._doc + " to the project team " + option_teamKey + ".  " + err);
            callback();
        }).readTeam(option_teamKey).addMember(user.node).then(function () {
            log.info("Added user to the project team" + userId);
            callback();
        });
    }, function (err) {
        callback(err, context);
    });
}

function logContext(context, callback) {
    log.debug("logContext() " + JSON.stringify(context.branch, null, 2));
    callback(null, context);
}

function getOptions() {
    return [{
            name: 'help',
            alias: 'h',
            type: Boolean
        },
        {
            name: 'verbose',
            alias: 'v',
            type: Boolean,
            description: 'verbose logging'
        },
        {
            name: 'prompt',
            alias: 'p',
            type: Boolean,
            description: 'prompt for username and password. overrides gitana.json credentials'
        },
        {
            name: 'username',
            type: String,
            description: 'username for api login. overrides gitana.json credentials'
        },
        {
            name: 'password',
            type: String,
            description: 'password for api login. overrides gitana.json credentials'
        },
        {
            name: 'use-credentials-file',
            alias: 'c',
            type: Boolean,
            description: 'use credentials file ~/.cloudcms/credentials.json. overrides gitana.json credentials'
        },
        {
            name: 'gitana-file-path',
            alias: 'g',
            type: String,
            description: 'path to gitana.json file to use when connecting. defaults to ./gitana.json'
        },
        {
            name: 'folder-path',
            alias: 'f',
            type: String,
            description: 'folder to store import files. defaults to ./data. This value will be concatenated with "/users". Not needed when using csv-source.'
        },
        {
            name: 'csv-source',
            type: String,
            description: 'path to a csv file with user information. The csv file should have headers: NAME, EMAIL, FIRST, LAST, COMPANY, PASSWORD. COMPANY and PASSWORD values are optional.'
        },
        {
            name: 'default-password',
            type: String,
            description: 'password to use when a row in the csv does not specify one. This is optional. However, a user cannot be created without a password'
        },
        {
            name: 'project-id',
            alias: 'r',
            type: String,
            description: 'id of the project to which users will be added.'
        },
        {
            name: 'team-key',
            alias: 't',
            type: String,
            default: 'project-users-team',
            description: 'Optional key of a project team to which the users should be added. The default is project-users-team.'
        }
    ];
}

function handleOptions() {

    var options = cliArgs(getOptions());

    if (options.help) {
        printHelp(getOptions());
        return null;
    }

    return options;
}

function printHelp(optionsList) {
    console.log(commandLineUsage([{
            header: 'Cloud CMS Export',
            content: 'Create user accounts in Cloud CMS primary platform domain. Optionally add the users to a project.\nExisting users (identified by their account NAME will not be modified).'
        },
        {
            header: 'Options',
            optionList: optionsList
        },
        {
            header: 'Examples',
            content: [{
                    desc: '1. Create users from a csv file:',
                },
                {
                    desc: 'npx cloudcms-util user-import -g ./my-gitana.json --csv-source ./users.csv\nThe csv file should have headers: NAME, EMAIL, FIRST, LAST, COMPANY, PASSWORD. COMPANY and PASSWORD. Each row defines a user. COMPANY and PASSWORD is optional.'
                },
                {
                    desc: '2. Create users from a csv file:',
                },
                {
                    desc: 'npx cloudcms-util user-import -g ./my-gitana.json --csv-source ./users.csv --project-id 5751b6235492fef8614d --team-key my-project-team'
                }
            ]
        }
    ]));
}