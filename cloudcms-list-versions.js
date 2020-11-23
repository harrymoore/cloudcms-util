#!/usr/bin/env node
/*jshint -W069 */
/*jshint -W104*/
var Gitana = require("gitana");
var async = require("async");
const path = require("path").posix;
var cliArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage')
var fs = require("fs");
var util = require("./lib/util");
var Logger = require('basic-logger');
var log = new Logger({
    showMillis: false,
    showTimestamp: true
});
const table = require('table');

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
var option_branchId = options["branch"] || "master";
var option_nodeId = options["node-id"];
var option_queryFilePath = options["query-file-path"];
var option_userName = options["username"];
var option_password = options["password"];

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

var handled = false;

if (option_queryFilePath || option_nodeId) {
    handled = true;
    handleVersions();
}

if (!handled) {
    printHelp(getOptions());
}

return;

//
// functions
//
function handleVersions() {
    log.debug("handleVersions()");

    util.getBranch(gitanaConfig, option_branchId, function (err, branch, platform, stack, domain, primaryDomain, project) {
        if (err) {
            log.error("Error connecting to Cloud CMS branch: " + err);
            return;
        }

        log.info("connected to project: \"" + project.title + "\" and branch: \"" + (branch.title || branch._doc) + "\".");

        var context = {
            branchId: option_branchId,
            branch: branch,
            userName: option_userName,
            password: option_password,
            nodeId: option_nodeId,
            queryFilePath: option_queryFilePath,
            query: option_queryFilePath ? require(path.resolve(path.normalize(option_queryFilePath))) : null,
            nodes: [],
            versions: []
        };

        async.waterfall([
            async.ensureAsync(async.apply(getNodeById, context)),
            async.ensureAsync(getNodesFromQuery),
            async.ensureAsync(getNodeVersions),
            async.ensureAsync(printResults)
        ], function (err, context) {
            if (err) {
                log.error("Error: " + err);
                return;
            }

            log.info("Complete");
            return;
        });
    });
}

function getNodeById(context, callback) {
    log.debug("getNodeById()");

    if (!context.nodeId) {
        return callback(null, context);
    }

    context.branch.readNode(context.nodeId).then(function () {
        var node = this;
        util.enhanceNode(node);
        context.nodes = [node];
        callback(null, context);
    });
}

function getNodesFromQuery(context, callback) {
    log.debug("getNodesFromQuery()");

    if (!context.query) {
        return callback(null, context);
    }

    var query = context.query;

    context.branch.queryNodes(query, {
        limit: -1
    }).then(function () {
        context.nodes = this.asArray();
        callback(null, context);
    });
}

function getNodeVersions(context, callback) {
    log.debug("getNodeVersions()");

    var nodes = context.nodes;

    async.eachSeries(nodes, function (node, cb) {
        log.info("get versions for " + node._doc);

        Chain(node).listVersions({ limit: 500 }).then(function () {
            var versions = this.asArray();
            versions.forEach(element => {
                util.enhanceNode(element);
                log.debug(JSON.stringify(element, null, 2));
                context.versions.push(element);
            });
            cb();
        });
    }, function (err) {
        if (err) {
            log.error("Error loading forms: " + err);
            callback(err);
            return;
        }

        log.debug("done");
        callback(null, context);
        return;
    });
}

function printResults(context, callback) {
    log.debug("printResults()");
    let c = 0;
    let data = context.versions.map(v => {
        return [
            ++c,
            v._system.changeset,
            v._system.previousChangeset,
            v._system.rev,
            v._system._op,
            v._system.created_by,
            v._system.created_on.timestamp,
            v._system.modified_by,
            v._system.modified_on.timestamp,
            v._system.edited_by,
            v._system.edited_on.timestamp
        ];            
    });

    data.unshift(['n', 'Changeset', 'Previous Changeset', 'Revision', 'Operation', 'Created By', 'Created On', 'Modified By', 'Modified On', 'Edited By', 'Edited On'])

    let output = table.table(data, {
        border: table.getBorderCharacters(`norc`)
    });
    
    console.log(output);

    callback(null, context);
}

function getOptions() {
    return [
        { name: 'help', alias: 'h', type: Boolean },
        { name: 'verbose', alias: 'v', type: Boolean, description: 'verbose logging' },
        { name: 'prompt', alias: 'p', type: Boolean, description: 'prompt for username and password. overrides gitana.json credentials' },
        { name: 'use-credentials-file', alias: 'c', type: Boolean, description: 'use credentials file ~/.cloudcms/credentials.json. overrides gitana.json credentials' },
        { name: 'gitana-file-path', alias: 'g', type: String, description: 'path to gitana.json file to use when connecting. defaults to ./gitana.json' },
        { name: 'branch', alias: 'b', type: String, description: 'branch id (not branch name!) to write content to. branch id or "master". Default is "master"' },
        { name: 'node-id', alias: 'n', type: String, description: 'id (_doc) value of the node. required unless --query-file-path is used' },
        // { name: 'query-file-path', alias: 'y', type: String, description: 'path to a json file defining the query. required unless --node-id is used instead' },
        { name: 'username', alias: 'u', type: String, description: 'api server admin user name"' },
        { name: 'password', alias: 'w', type: String, description: 'api server admin password"' },
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
    console.log(commandLineUsage([
        {
            header: 'Cloud CMS Touch',
            content: 'List node versions from a Cloud CMS project branch.'
        },
        {
            header: 'Options',
            optionList: optionsList
        },
        {
            header: 'Examples',
            content: [
                {
                    desc: 'list versions of a node found by its id (_doc property)',
                },
                {
                    desc: 'node cloudcms-list-versions.js --node-id 9f6c175a41df35544404'
                }
            ]
        }
    ]));
}