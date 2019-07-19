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
const Logger = require('basic-logger');
const log = new Logger({
    showMillis: false,
    showTimestamp: true
});

// debug only when using charles proxy ssl proxy when intercepting cloudcms api calls:
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

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
var option_useCredentialsFile = options["use-credentials-file"];
var option_gitanaFilePath = options["gitana-file-path"] || "./gitana.json";
var option_dataFolderPath = options["folder-path"] || "./data";
var option_allUsers = options["all-users"] || false;
var option_domainId = options["domain"] || "primary";
var option_queryFilePath = options["query-file-path"];

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
} // else don't override credentials

util.parseGitana(gitanaConfig);

// if listing types
if (option_allUsers && option_queryFilePath) {
    log.error("Can't export all users from a custom query. use either --all-users or query-file-path but not both");
    printHelp(getOptions());
} else if (option_allUsers || option_queryFilePath) {
    // export users
    handleUsers();
} else {
    printHelp(getOptions());
}

return;

//
// functions
//
function handleUsers() {
    log.debug("handleUsers()");

    util.getBranch(gitanaConfig, "master", function (err, branch, platform, stack, domain, primaryDomain, project) {
        if (err) {
            log.debug("Error connecting to Cloud CMS: " + err);
            return;
        }

        log.info("primary domain id: \"" + primaryDomain._doc + "\"");

        var context = {
            branch: branch,
            platform: platform,
            stack: stack,
            domain: domain,
            primaryDomain: primaryDomain,
            project: project,
            gitanaConfig: gitanaConfig,
            queryFilePath: option_queryFilePath,
            dataFolderPath: option_dataFolderPath,
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
            async.apply(listDomainUsers, context),
                async.ensureAsync(async.apply(writeNodesJSONtoDisk, "users")),
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

function listDomainUsers(context, callback) {
    log.debug("listDomainUsers()");

    context.primaryDomain.listPrincipals().then(function () {
        // console.log( JSON.stringify( this.asArray(),null,2) );
        context.nodes = _.filter(this.asArray(), function (node) {
            return !node.name.startsWith("appuser-");
        });
        callback(null, context);
    });
}

function queryUsers(context, callback) {
    log.debug("queryUsers()");

    var query = context.query;

    context.primaryDomain.queryUsers(query, {
        limit: -1
    }).then(function () {
        // console.log( JSON.stringify( this.asArray(),null,2) );
        context.nodes = _.filter(this.asArray(), function (node) {
            return !node.name.startsWith("appuser-");
        });
        callback(null, context);
    });
}

function writeNodesJSONtoDisk(pathPart, context, callback) {
    log.debug("writeNodesJSONtoDisk()");

    var dataFolderPath = path.posix.normalize(context.dataFolderPath);
    var nodes = context.nodes;

    for (var i = 0; i < nodes.length; i++) {
        var node = cleanNode(nodes[i], "");
        var filePath = path.normalize(path.posix.resolve(context.dataFolderPath, pathPart, node.name, "node.json"));
        writeJsonFile.sync(filePath, node);
    }

    callback(null, context);
}

function cleanNode(node, qnameMod) {
    var n = node;
    util.enhanceNode(n);
    n = JSON.parse(JSON.stringify(n));

    // n._source_doc = n._doc;
    delete n._doc;
    delete n.directoryId;
    delete n.identityId;
    delete n.domainId;

    return n;
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
            description: 'folder to store exported files. defaults to ./data'
        },
        {
            name: 'all-users',
            alias: 'a',
            type: Boolean,
            description: 'export all users. Or use --query-file-path'
        },
        {
            name: 'domain-id',
            alias: 'd',
            type: String,
            description: 'id of the domain to query. defaults to "primary"'
        },
        {
            name: 'query-file-path',
            alias: 'y',
            type: String,
            description: 'path to a json file defining the query. required unless --all-users is specified'
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
            content: 'Export user accounts from a Cloud CMS domain.'
        },
        {
            header: 'Options',
            optionList: optionsList
        },
        {
            header: 'Examples',
            content: [{
                    desc: '1. Export all user accounts:',
                },
                {
                    desc: 'npx cloudcms-util export-users --all-users -g ./gitana/gitana.json --folder-path ./data'
                }
            ]
        }
    ]));
}