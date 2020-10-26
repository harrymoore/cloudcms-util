#!/usr/bin/env node
/*jshint -W069 */ 
/*jshint -W104*/ 
var Gitana = require("gitana");
var async = require("async");
var request = require("request");
var cliArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage')
var fs = require("fs");
var util = require("./lib/util");
var Logger = require('basic-logger');
var log = new Logger({
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
var option_branchId = options["branch"] || "master";
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

var handled = false;

if (option_queryFilePath)
{
    handled = true;
    handleDelete();
}

if (!handled) {
    printHelp(getOptions());
}

return;

//
// functions
//
function handleDelete() {
    log.debug("handleDelete()");

    util.getBranch(gitanaConfig, option_branchId, function(err, branch, platform, stack, domain, primaryDomain, project) {
        if (err)
        {
            log.debug("Error connecting to Cloud CMS branch: " + err);
            return;
        }

        log.info("connected to project: \"" + project.title + "\" and branch: \"" + (branch.title || branch._doc) + "\".");
        
        var context = {
            branchId: option_branchId,
            branch: branch,
            queryFilePath: option_queryFilePath,
            query: require(option_queryFilePath),
            nodes: []
        };
        
        async.waterfall([
            async.ensureAsync(async.apply(getNodesFromQuery, context)),
            async.ensureAsync(deleteNodes)
        ], function (err, context) {
            if (err)
            {
                log.error("Error: " + err);
                return;
            }
            
            log.info("Delete complete");
            return;
        });                
    });
}

function getNodesFromQuery(context, callback) {
    log.info("getNodesFromQuery()");

    var query = context.query;

    context.branch.queryNodes(query,{
        limit: -1
    // }).each(function() {
    //     var node = this;
    //     util.enhanceNode(node);
    //     nodes.push(node);
    }).then(function() {
        context.nodes = this.asArray();
        callback(null, context);
    });
}

function deleteNodes(context, callback) {
    log.info("deleteNodes()");

    var nodes = context.nodes;

    async.eachSeries(nodes, function(node, cb) {
        log.info("deleting " + node._doc);
        
        Chain(node).del().then(function() {            
            cb();
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

function getOptions() {
    return [
        {name: 'help',                  alias: 'h', type: Boolean},
        {name: 'verbose',               alias: 'v', type: Boolean, description: 'verbose logging'},
        {name: 'prompt',                alias: 'p', type: Boolean, description: 'prompt for username and password. overrides gitana.json credentials'},
        {name: 'use-credentials-file',  alias: 'c', type: Boolean, description: 'use credentials file ~/.cloudcms/credentials.json. overrides gitana.json credentials'},
        {name: 'gitana-file-path',      alias: 'g', type: String, description: 'path to gitana.json file to use when connecting. defaults to ./gitana.json'},
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
            header: 'Cloud CMS Bulk Node Delete',
            content: 'Delete nodes from a Cloud CMS project branch.'
        },
        {
            header: 'Options',
            optionList: optionsList
        },
        {
            header: 'Examples',
            content: [
                {
                    desc: '1. bulk delete of nodes matched by query',
                },
                {
                    desc: 'npx cloudcms-util delete --query-file-path ./my-query.json'
                }
            ]
        }
    ]));
}