#!/usr/bin/env node

/*jshint -W069 */
/*jshint -W104*/
const Gitana = require("gitana");
const assert = require('assert').strict;
const fs = require("fs");
const path = require("path").posix;
const async = require("async");
const cliArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage')
const util = require("./lib/util");
const writeJsonFile = require('write-json-file');
const _ = require('underscore');
const Logger = require('basic-logger');
const { map } = require("underscore");
const jsonexport = require('jsonexport');
const log = new Logger({
    showMillis: false,
    showTimestamp: true
});
const SC_SEPARATOR = "__";

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
var option_useCredentialsFile = options["use-credentials-file"];
var option_gitanaFilePath = options["gitana-file-path"] || "./gitana.json";
var option_branchId = options["branch"] || "master";
var option_associationType = options["association-type"];
var option_qname = options["qname"];
var option_reportFilePath = options["report-file-path"];

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
    var prompt = require('prompt-sync')({
        sigint: true
    });
    gitanaConfig.username = prompt('name: ');
    gitanaConfig.password = prompt.hide('password: ');
} // else don't override credentials

util.parseGitana(gitanaConfig);

if (option_qname && option_associationType) {
    handleQueryBasedExport();
} else {
    printHelp(getOptions());
}

return;

//
// functions
//
function handleQueryBasedExport() {
    log.debug("handleQueryBasedExport()");

    util.getBranch(gitanaConfig, option_branchId, function (err, branch, platform, stack, domain, primaryDomain, project) {
        if (err) {
            log.debug("Error connecting to Cloud CMS branch: " + err);
            return;
        }

        log.info("connected to project: \"" + project.title + "\" and branch: " + branch.title || branch._doc);

        var context = {
            qname: option_qname || null,
            associationType: option_associationType || null,
            reportFilePath: option_reportFilePath || null,
            branchId: option_branchId,
            branch: branch,
            gitanaConfig: gitanaConfig,
            platform: platform,
            query: {
                "_type": option_qname
            },
            nodes: [],
            queryPageSize: 1000
        };

        async.waterfall([
            async.apply(getNodesFromQuery, context),
            getNodesFromTraverseQuery,
            outputReport
        ], function (lerr) {
            if (lerr) {
                log.error("Error exporting: " + lerr);
                return;
            }

            log.info("Export complete");
            return;
        });

    });
}



function getNodesFromQuery(context, callback) {
    log.debug("getNodesFromQuery()");

    var query = context.query;
    var nodes = context.nodes;
    var queryPageSize = context.queryPageSize || 100;

    query._fields = {
        _type: 1,
        _qname: 1,
        title: 1,
        disease: 1
    };

    context.branch.queryNodes(query, {
        limit: queryPageSize,
        paths: true
    }).each(function () {
        var node = this;
        util.enhanceNode(node);
        nodes.push(node);
    }).then(function () {
        callback(null, context);
    });
}

function getNodesFromTraverseQuery(context, callback) {
    log.debug("getNodesFromTraverseQuery()");

    // there should already be nodes from the previous query.
    // use this list of nodes to then run a traverse on each
    var nodes = context.nodes;
    if (!context.associations) {
        context.associations = [];
    }

    async.eachOfLimit(nodes, 5, function(node, key, cb) {
        // run the traverse
        node.traverse({
            filter: "ALL_BUT_START_NODE",
            associations: {
                "ers:article-module-association": "ANY",
            },
            depth: 1,
            types: [
                "ers:article"
            ]
        }).then(function () {
            var result = this;
            node._articleNodes = node._articleNodes || [];
            // context.associations.push(Object.values(result._associations));

            Object.values(result._nodes).forEach(associatedNode => {
                // context.nodes.push(util.enhanceNode(node));
                node._articleNodes.push(util.enhanceNode(associatedNode));
            });

            cb();
        });    
    }, function(err) {
        if (err) {
            console.log("traverse error: " + err);
        }
        callback(null, context);
    });
}


function outputReport(context, callback) {
    log.debug("outputReport()");

    var reportData = [];

    context.nodes.forEach((node, index) => {
        if (node._articleNodes) {
            node._articleNodes.forEach(articleNode => {
                reportData.push({
                    moduleTitle: node.title.replace(/\|.+/gi, "").trim(),
                    moduleDisease: node.disease,
                    relatedArticleTitle: articleNode.title.replace(/\|.+/gi, "").trim(),
                    externalLink: articleNode.externalLink && articleNode.externalLink.link ? articleNode.externalLink.link : "",
                    contentType: articleNode.contentType,
                    type: articleNode.type
                });
            });
        } else {
            reportData.push({
                moduleTitle: node.title.replace(/\|.+/gi, "").trim(),
                moduleDisease: node.disease,
                relatedArticleTitle: "N/A",
                externalLink: "N/A"
            });
        }
    });

    jsonexport(reportData, {
        headers: ["moduleDisease", "moduleTitle", "relatedArticleTitle", "externalLink", "contentType", "type"],
        rename: ["Disease", "Module", "Article", "External Link", "Content Type", "Type"]
    }, function(err, csv){
        if(err) {
            return callback(null, context);
        }

        log.debug(csv);

        if (context.reportFilePath) {
            fs.writeFileSync(path.normalize(context.reportFilePath), csv);
        }
    });

    callback(null, context);
}

function cleanNode(node, qnameMod) {
    var n = node;
    util.enhanceNode(n);
    n = JSON.parse(JSON.stringify(n));

    n._source_doc = n._doc;
    n._qname += qnameMod || "";
    // delete n._doc;
    delete n._system;
    delete n.attachments;
    delete n._attachments;
    delete n.__forms;
    delete n.__formAssociations;
    delete n.__translationOf;

    return n;
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
            name: 'branch',
            alias: 'b',
            type: String,
            description: 'branch id (not branch name!) to write content to. branch id or "master". Default is "master"'
        },
        {
            name: 'association-type',
            type: String,
            description: 'find related nodes based on association type'
        },
        {
            name: 'qname',
            type: String,
            description: 'qname type of nodes to initially query for modules. ex.: --qname "ers:module"'
        },        
        {
            name: 'report-file-path',
            type: String,
            description: 'path to file where report results will be written. ex.: ./report.csv'
        }
    ];
}

function handleOptions() {

    var loptions = cliArgs(getOptions());

    if (loptions.help) {
        printHelp(getOptions());
        return null;
    }

    return loptions;
}

function printHelp(optionsList) {
    console.log(commandLineUsage([{
            header: 'Cloud CMS Export',
            content: 'Export defintions and content instance records from a Cloud CMS project branch.'
        },
        {
            header: 'Options',
            optionList: optionsList
        },
        {
            header: 'Examples',
            content: [{
                    desc: '\n1. connect to Cloud CMS and list available definition qnames',
                },
                {
                    desc: 'npx cloudcms-util export --list-types'
                },
                {
                    desc: '\n2. export definitions and content records by qname:',
                },
                {
                    desc: 'npx cloudcms-util export --definition-qname "my:type1" "my:type2" --include-instances --folder-path ./data'
                },
                {
                    desc: '\n3. export all definition nodes:',
                },
                {
                    desc: 'npx cloudcms-util export --all-definitions --include-instances --folder-path ./data'
                },
                {
                    desc: '\n4. export a list of nodes based on a user defined query:',
                },
                {
                    desc: 'npx cloudcms-util export -y ./myquery.json --folder-path ./data'
                }
            ]
        }
    ]));
}