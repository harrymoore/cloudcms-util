#!/usr/bin/env node

/*jshint -W069 */
/*jshint -W104*/
/*jshint -W083 */
const Gitana = require("gitana");
const fs = require("fs");
const path = require("path");
const mime = require('mime-types');
const async = require("async");
const cliArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const util = require("./lib/util");
const _ = require('underscore');
const chalk = require('chalk');
const Logger = require('basic-logger');
const log = new Logger({
    showMillis: false,
    showTimestamp: true
});
const csv = require('csvtojson');
const objectPath = require("object-path");

//set OS-dependent path resolve function 
const isWindows = /^win/.test(process.platform);
const pathResolve = isWindows ? path.resolve : path.posix.resolve;

// debug feature. only use when using charles proxy ssl proxy for intercepting cloud cms api calls:
if (process.env.NODE_ENV === "development") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

Gitana.defaultErrorHandler = function (err) {
    if (console && console.warn) {
        console.warn("API error: " + err.message);
    }
};

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
var option_report = options["report"] || false;
var option_csvSource = options["csv-source"];
var option_overwrite = options["overwrite"] || false;

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

if (option_report || option_csvSource) {
    handlePatch();
} else {
    printHelp(getOptions());
}

return;

//
// functions
//
function handlePatch(reportOnly) {
    log.debug("handlePatch()");

    util.getBranch(gitanaConfig, option_branchId, function (err, branch, platform, stack, domain, primaryDomain, project) {
        if (err) {
            log.error(chalk.red("Error: ") + err);
            return;
        }

        log.info(chalk.yellow("Connected to project: \"" + project.title + "\" and branch: " + branch.title || branch._doc));

        var context = {
            branchId: option_branchId,
            branch: branch,
            platformId: platform.getId(),
            repositoryId: branch.getRepositoryId(),
            reportOnly: option_report,
            csvSource: option_csvSource,
            overwrite: option_overwrite,

            nodes: [] // read the nodes by id and save them here for reporting or patchings
        };

        async.waterfall([
            async.ensureAsync(async.apply(parseCsv, context)),
                async.ensureAsync(queryNodes),
                    async.ensureAsync(reportNodes),
                        async.ensureAsync(patchNodes)
        ], function (err, context) {
            if (err) {
                log.error(chalk.red("Error: " + err));
                return;
            }

            // log.debug(JSON.stringify(context, null, 2));

            log.info(chalk.green("Completed"));
            return;
        });
    });
}

function parseCsv(context, callback) {
    log.debug("parseCsv()");

    if (!fs.existsSync(context.csvSource)) {
        callback("csv file not found: " + context.csvSource, context);
    }

    csv({
        noheader: false,
        headers: ['id', 'property_path', 'property_value']
    }).fromFile(option_csvSource).then(function (data) {
        context.csvNodes = data;
        log.debug("node list from csv: " + JSON.stringify(context.csvNodes, null, 2));
        callback(null, context);
        return;
    });
}

function queryNodes(context, callback) {
    log.debug("queryNodes()");

    context.csvNodeIds = _.pluck(context.csvNodes, "id");
    context.csvNodesById = _.indexBy(context.csvNodes, "id");

    // log.debug("csvNodes: " + JSON.stringify(context.csvNodes, null, 2));
    log.debug("csvNodesById: " + JSON.stringify(context.csvNodesById, null, 2));

    context.branch.trap(function (err) {
        log.debug("query for nodes by id failed");
        log.error(chalk.red("err: " + err));
        callback(err, context);
    }).queryNodes({
        _doc: {
            "$in": context.csvNodeIds
        }
    }).then(function () {
        if (this.size() === 0) {
            log.warn("No nodes found");
            callback(null, context);
            return;
        }

        context.nodes = this.asArray();
        log.debug("query result: " + JSON.stringify(context.nodes, null, 2));

        callback(null, context);
        return;
    });
}

function reportNodes(context, callback) {
    log.debug("reportNodes()");

    if (!context.reportOnly) {
        callback(null, context);
        return;
    }

    log.info("report:");
    _.each(context.nodes, function (element, index, list) {
        console.log(element._doc + " " + context.csvNodesById[element._doc].property_path + ": " + objectPath.get(element, context.csvNodesById[element._doc].property_path, ""));
    });

    callback(null, context);
    return;
}

function patchNodes(context, callback) {
    log.debug("patchNodes()");

    if (context.reportOnly) {
        callback(null, context);
        return;
    }

    var patches = [];

    _.each(context.nodes, function (node, index, list) {
        var value = objectPath.get(node, context.csvNodesById[node._doc].property_path);
        if (!value || context.overwrite) {
            // patch this node
            patches.push({
                node: node,
                patch: {
                    op: Gitana.isUndefined(value) ? "add" : "replace",
                    path: "/" + context.csvNodesById[node._doc].property_path.split(".").join("/"),
                    value: context.csvNodesById[node._doc].property_value
                }
            });
        }
    });

    log.debug("Patches: " + JSON.stringify(patches, null, 2));

    async.each(patches, function (patch, callback) {
        Chain(patch.node).patch([patch.patch]).then(callback);
    }, function (err) {
        // completed pathes
        callback(null, context);
        return;
    });
}

// function logContext(context, callback) {
//     log.debug("logContext() " + JSON.stringify(context.branch, null, 2));
//     callback(null, context);
// }

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
            name: 'branch',
            alias: 'b',
            type: String,
            description: 'branch id (not branch name!) to write content to. branch id or "master". Default is "master"'
        },
        {
            name: 'csv-source',
            type: String,
            description: 'path to a csv file with node id and property information. The csv file should have headers: ID, PROPERTY_PATH, PROPERTY_VALUE'
        },
        {
            name: 'report',
            type: Boolean,
            description: 'read nodes listed in the csv file and report the current value of the property. No node updates are made.'
        },
        {
            name: 'overwrite',
            alias: 'o',
            type: Boolean,
            description: 'overwrite properties that already exist. by default only missing properties will be set'
        }
    ];
}

function handleOptions() {

    var options = cliArgs(getOptions());

    if (_.isEmpty(options) || options.help) {
        printHelp(getOptions());
        return null;
    }

    return options;
}

function printHelp(optionsList) {
    console.log(commandLineUsage([{
            header: 'Cloud CMS Patch Nodes',
            content: 'Update nodes in a branch by applying an HTTP PATCH method API call. The node ids and property information should be supplied in a CSV file.'
        },
        {
            header: 'Options',
            optionList: optionsList
        },
        {
            header: 'Examples',
            content: [{
                    desc: '\n1. Connect to Cloud CMS and report current node property values',
                },
                {
                    desc: 'npx cloudcms-util patch --report --csv-source ./patch-test1.csv'
                },
                {
                    desc: '\n2. import definitions and content records by qname:',
                },
                {
                    desc: 'npx cloudcms-util import --definition-qname "test:type1" "test:type2" --include-instances --folder-path ./data'
                },
                {
                    desc: '\n3. import nodes and their related records:',
                },
                {
                    desc: 'npx cloudcms-util import --nodes --include-related --folder-path ./data'
                }
            ]
        }
    ]));
}