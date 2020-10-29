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
var option_deleteDupQNames = options["delete-dup-qnames"];
var option_repositoryId = options["repository"];
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

if (option_queryFilePath)
{
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

    util.getBranch(gitanaConfig, option_branchId, function(err, branch, platform, stack, domain, primaryDomain, project) {
        if (err)
        {
            log.debug("Error connecting to Cloud CMS branch: " + err);
            return;
        }

        log.info("connected to project: \"" + project.title + "\" and branch: \"" + (branch.title || branch._doc) + "\".");
        
        var context = {
            deleteDupQNames: option_deleteDupQNames,
            branchId: option_branchId,
            branch: branch,
            repositoryId: option_repositoryId,
            userName: option_userName,
            password: option_password,
            queryFilePath: option_queryFilePath,
            query: require(path.resolve(path.normalize(option_queryFilePath))),
            nodes: []
        };
        
        async.waterfall([
            async.ensureAsync(async.apply(getNodesFromQuery, context)),
            async.ensureAsync(getNodeVersions)
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

function getNodeVersions(context, callback) {
    log.info("getNodeVersions()");

    var nodes = context.nodes;

    async.eachSeries(nodes, function(node, cb) {
        log.info("get versions for " + node._doc);
        
        Chain(node).listVersions({limit: 1}).then(function() {  
            var versions = this.asArray();
            versions.forEach(element => {
                log.info(JSON.stringify(element, null, 4));
            });
            cb();
        });
    }, function (err) {
        if(err)
        {
            log.error("Error loading forms: " + err);
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
        {name: 'query-file-path',       alias: 'y', type: String, description: 'path to a json file defining the query'},
        {name: 'delete-dup-qnames',     alias: 'd', type: Boolean, multiple: true, description: 'direct call to the api server to clean up duplicate qnames before touching nodes. requires --qname --branch (even if master) and --repository options.'},
        {name: 'repository',            alias: 'r', type: String, description: 'repository id where duplicate qnames will be repaired"'},
        {name: 'username',            alias: 'u', type: String, description: 'api server admin user name"'},
        {name: 'password',            alias: 'w', type: String, description: 'api server admin password"'},
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
            header: 'Cloud CMS Touch',
            content: 'Touch nodes a Cloud CMS project branch.'
        },
        {
            header: 'Options',
            optionList: optionsList
        },
        {
            header: 'Examples',
            content: [
                {
                    desc: '1. touch nodes found by query',
                },
                {
                    desc: 'node mm-touch.js --query-file-path ./touch-query.json'
                },
                {
                    desc: '2. delete duplicate qnames prior to touching nodes',
                },
                {
                    desc: 'node mm-touch.js --delete-dup-qnames --user-name "admin" --password "admin" --repository "61ce2c4467e2797836ae" --branch "26d0bbe8ae745184e39f" --query-file-path ./touch-query.json'
                }
            ]
        }
    ]));
}