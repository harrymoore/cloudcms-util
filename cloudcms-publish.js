#!/usr/bin/env node
/*jshint -W069 */ 
/*jshint -W104*/ 
const Gitana = require("gitana");
const path = require("path");
const async = require("async");
const cliArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage')
const fs = require("fs");
const util = require("./lib/util");
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
var option_userName = options["username"];
var option_password = options["password"];
var option_branchId = options["branch"] || "master";
var option_queryFilePath = options["query-file-path"];

var gitanaConfig = util.getGitanaConfig(option_prompt, option_useCredentialsFile, option_gitanaFilePath, option_userName, option_password);

if (option_queryFilePath) {
    handlePublish();
} else {
    printHelp(getOptions());
}

return;

//
// functions
//
function handlePublish() {
    log.debug("handlePublish()");

    util.getBranch(gitanaConfig, option_branchId, function(err, branch, platform, stack, domain, primaryDomain, project) {
        if (err)
        {
            log.debug("Error connecting to Cloud CMS branch: " + err);
            return;
        }

        log.info("connected to project: \"" + project.title + "\" and branch: \"" + (branch.title || branch._doc) + "\".");
        
        var context = {
            platform: platform,
            project: project,
            branchId: option_branchId,
            branch: branch,
            userName: option_userName,
            password: option_password,
            queryFilePath: option_queryFilePath,
            query: require(path.resolve(path.normalize(option_queryFilePath))),
            nodes: []
        };
        
        async.waterfall([
            async.ensureAsync(async.apply(getNodesFromQuery, context)),
            // async.ensureAsync(publishNodes)

            async.ensureAsync(async.apply(addFeature, "f:publishable", {state: "draft"})),
            async.ensureAsync(getNodesFromQuery, context),
            async.ensureAsync(async.apply(addFeature, "f:publishable", {state: "live"})),
            async.ensureAsync(getNodesFromQuery, context),
        ], function (err, context) {
            if (err)
            {
                log.error("Error: " + err);
                return;
            }
            
            log.info("Complete");
            return;
        });                
    });
}

function getNodesFromQuery(context, callback) {
    log.info("getNodesFromQuery()");

    var query = context.query;

    context.branch.queryNodes(query,{
        limit: -1
    }).then(function() {
        context.nodes = this.asArray();
        callback(null, context);
    });
}

function addFeature(featureName, featureConfig, context, callback) {
    log.info("addFeature()");

    var nodes = context.nodes;

    async.eachSeries(nodes, function(node, cb) {
        log.info(`add feature ${featureName} to node ${node._doc}`);
        
        Chain(node).addFeature(featureName, featureConfig).then(function () {
            console.log("done adding feature: \n" + JSON.stringify(this, null, 2));
            return cb(null, context);
        });

    }, function (err) {
        if(err)
        {
            log.error("Error: " + err);
            callback(err);
            return;
        }
        
        log.debug("done");
        callback(null, context);
        return;
    });        
}

// function publishNodes(context, callback) {
//     log.info("publishNodes()");

//     var nodes = context.nodes;

//     async.eachSeries(nodes, function(node, cb) {
//         log.info("start publish workflow for node " + node._doc);
        
//         let wfContext = {
//             context: {
//                 proejctId: context.project.getId()
//             },
//             payloadType: "content",
//             payloadData: {
//                 repositoryId: context.branch.getRepositoryId(),
//                 branchId: context.branch._doc,
//                 resources: {
//                 }
//             }
//         };

//         wfContext.payloadData.resources[node._doc] = util.refFromNode(node);

//         Chain(context.platform).createWorkflow(context.workflowModelId, wfContext).then(function () {
//             var workflowInstance = this;

//             workflowInstance.addResource(node);

//             workflowInstance.start().then(function () {
//                 console.log("Started workflow instance: \n" + JSON.stringify(this, null, 2));
//                 return cb(null, context);
//             });
//         });

//     }, function (err) {
//         if(err)
//         {
//             log.error("Error: " + err);
//             callback(err);
//             return;
//         }
        
//         log.debug("done");
//         callback(null, context);
//         return;
//     });        
// }

function getOptions() {
    return [
        {name: 'help',                  alias: 'h', type: Boolean},
        {name: 'verbose',               alias: 'v', type: Boolean, description: 'verbose logging'},
        {name: 'prompt',                alias: 'p', type: Boolean, description: 'prompt for username and password. overrides gitana.json credentials'},
        {name: 'use-credentials-file',  alias: 'c', type: Boolean, description: 'use credentials file ~/.cloudcms/credentials.json. overrides gitana.json credentials'},
        {name: 'gitana-file-path',      alias: 'g', type: String, description: 'path to gitana.json file to use when connecting. defaults to ./gitana.json'},
        {name: 'username',              alias: 'u', type: String, description: 'api server admin user name"'},
        {name: 'password',              alias: 'w', type: String, description: 'api server admin password"'},
        {name: 'branch',                alias: 'b', type: String, description: 'branch id (not branch name!) to write content to. branch id or "master". Default is "master"'},
        {name: 'query-file-path',       alias: 'y', type: String, description: 'path to a json file defining the query'}
    ];
}

function handleOptions() {

    var options = cliArgs(getOptions());

    if (options.help)
    {
        printHelp(getOptions());
        return null;
    }

    return options;
}

function printHelp(optionsList) {
    console.log(commandLineUsage([
        {
            header: 'Cloud CMS Publish',
            content: 'Publish nodes in Cloud CMS project branch by starting a workflow.'
        },
        {
            header: 'Options',
            optionList: optionsList
        },
        {
            header: 'Examples',
            content: [
                {
                    desc: '1. publish nodes found by query',
                },
                {
                    desc: 'npx cloudcms-util publish --query-file-path ./query-unpublished-docs.json'
                }
            ]
        }
    ]));
}