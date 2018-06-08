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
const wrench = require("wrench");
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
var option_branchId = options["branch"] || "master";
var option_listTypes = options["list-types"];
var option_definitionQNames = options["definition-qname"]; // array
var option_allDefinitions = options["all-definitions"] || false;
var option_includeInstances = options["include-instances"] || false;
var option_includeRelated = options["include-related"] || false;
var option_dataFolderPath = options["folder-path"] || "./data";
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
if (option_listTypes) {
    // print a list of definition qnames on the project/branch
    handleListTypes();
} else if (option_queryFilePath) {
    // download and store data from project/branch to a local folder
    handleQueryBasedExport();
} else if (option_allDefinitions || (option_definitionQNames && Gitana.isArray(option_definitionQNames))) {
    // download and store data from project/branch to a local folder
    handleExport();
} else {
    printHelp(getOptions());
}

return;

//
// functions
//
function handleQueryBasedExport() {
    log.debug("handleQueryBasedExport()");

    util.getBranch(gitanaConfig, option_branchId, function(err, branch, platform, stack, domain, primaryDomain, project) {
        if (err)
        {
            log.debug("Error connecting to Cloud CMS branch: " + err);
            return;
        }

        log.info("connected to project: \"" + project.title + "\" and branch: " + branch.title || branch._doc);
        
        var context = {
            branchId: option_branchId,
            branch: branch,
            gitanaConfig: gitanaConfig,
            platform: platform,
            queryFilePath: option_queryFilePath,
            dataFolderPath: option_dataFolderPath,
            includeRelated: option_includeRelated,
            query: require(option_queryFilePath),
            nodes: [],
            relatedIds: [],
            relatedNodes: []
        };

        async.waterfall([
            async.apply(getNodesFromQuery, context),
            async.ensureAsync(async.apply(getRelated, context.nodes)),
            async.ensureAsync(async.apply(downloadAttachments, context.relatedNodes, "related")),
            async.ensureAsync(async.apply(downloadAttachments, context.nodes, "nodes")),
            async.ensureAsync(async.apply(writeContentInstanceJSONtoDisk, context.nodes, "nodes")),
        ], function (err, context) {
            if(err)
            {
                log.error("Error exporting: " + err);
                return;
            }
            
            log.info("Export complete");
            return;
        });        
        
    });
}

function handleExport() {
    log.debug("handleExport()");

    util.getBranch(gitanaConfig, option_branchId, function(err, branch, platform, stack, domain, primaryDomain, project) {
        if (err)
        {
            log.debug("Error connecting to Cloud CMS branch: " + err);
            return;
        }

        log.info("connected to project: \"" + project.title + "\" and branch: \"" + (branch.title || branch._doc) + "\"");
        
        var context = {
            branchId: option_branchId,
            branch: branch,
            allDefinitions: option_allDefinitions,
            importTypeQNames: option_definitionQNames,
            gitanaConfig: gitanaConfig,
            platform: platform,
            typeDefinitions: [],
            dataFolderPath: option_dataFolderPath,
            includeInstances: option_includeInstances,
            includeRelated: option_includeRelated,
            relatedIds: [],
            relatedNodes: [],
            instanceNodes: {}
        };

        async.waterfall([
            async.apply(getDefinitions, context),
            async.ensureAsync(getDefinitionFormAssociations),
            async.ensureAsync(getDefinitionForms),
            async.ensureAsync(writeDefinitionJSONtoDisk),
            async.ensureAsync(getContentInstances),
            async.ensureAsync(async.apply(getRelated, context.instanceNodes)),
            async.ensureAsync(async.apply(downloadAttachments, context.instanceNodes, "instances")),
            async.ensureAsync(async.apply(downloadAttachments, context.relatedNodes, "related")),
            async.ensureAsync(async.apply(writeContentInstanceJSONtoDisk, context.instanceNodes, "instances"))
        ], function (err, context) {
            if(err)
            {
                log.error("Error exporting: " + err);
                return;
            }

            // log.debug(JSON.stringify(context.typeDefinitions, null, 2));
            
            log.info("Export complete");
            return;
        });        
        
    });
}

function getNodesFromQuery(context, callback) {
    log.debug("getNodesFromQuery()");

    var query = context.query;
    var nodes = context.nodes;

    context.branch.queryNodes(query,{
        limit: -1,
        paths: true
    }).each(function() {
        var node = this;
        util.enhanceNode(node);
        nodes.push(node);
    }).then(function() {
        callback(null, context);
    });
}

function downloadAttachments(list, pathPart, context, callback) {
    log.debug("downloadAttachments() " + pathPart);

    if (!Gitana.isArray(list)) {
        // flatten to an array if list is an associative array of sub lists (by type)
        var newList = [];
        var types = _.keys(list);
        for (var i = 0; i < types.length; i++) {
            for (var j = 0; j < list[types[i]].length; j++) {
                newList.push(list[types[i]][j]);
            }
        }

        list = newList;
    }

    async.eachSeries(list, async.apply(downloadNodeAttachments, context, pathPart), function (err) {
        if(err)
        {
            log.error("Error reading attachments: " + err);
            callback(err);
            return;
        }
        
        log.debug("done downloading node attachments");
        callback(null, context);
        return;
    });        
}

function downloadNodeAttachments(context, pathPart, node, callback) {
    log.debug("downloadNodeAttachments()");

    async.eachSeries(_.filter(_.keys(node.attachments), function(k){return !k.match(/^_preview_/)}), async.apply(downloadAttachment, context, node, pathPart), function (err) {
        if(err)
        {
            log.error("Error reading attachments: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded node attachments");
        callback(null, context);
        return;
    });        
}

function downloadAttachment(context, node, pathPart, attachmentId, callback) {
    log.debug("downloadAttachment()");

    var attachmentPath = path.normalize(path.posix.resolve(context.dataFolderPath, pathPart, node._type.replace(':', '__SC__'), node._doc, "attachments"));
    wrench.mkdirSyncRecursive(path.normalize(attachmentPath));

    var filename = attachmentId;
    if (node.title) {
        var filenameParts = node.title.match(/\..+$/);
        if (filenameParts && filenameParts.length >= 1) {
            filename += filenameParts[0];
        } else {
            filename += ".txt"; // assume .txt file extension
        }
    }

    var filePath = attachmentPath + path.sep + filename;
    log.debug("file path: " + filePath);

    util.downloadNode(context.platform, filePath, context.branch.getRepositoryId(), context.branchId, node._doc, attachmentId, function(err){
        callback();
    });
}

function writeContentInstanceJSONtoDisk(nodes, pathPart, context, callback) {
    log.debug("writeContentInstanceJSONtoDisk()");

    var dataFolderPath = path.posix.normalize(context.dataFolderPath);
    
    if (!Gitana.isArray(nodes)) {
        // flatten to an array if list is an associative array of sub lists (by type)
        var newList = [];
        var types = _.keys(nodes);
        for (var i = 0; i < types.length; i++) {
            for (var j = 0; j < nodes[types[i]].length; j++) {
                newList.push(nodes[types[i]][j]);
            }
        }

        nodes = newList;
    }

    for(var i = 0; i < nodes.length; i++) {
        var node = cleanNode(nodes[i], "");
        var filePath = path.normalize(path.posix.resolve(context.dataFolderPath, pathPart, node._type.replace(':', '__SC__'), node._doc || node._source_doc, "node.json"));        
        writeJsonFile.sync(filePath, node);
    }

    // write related nodes
    var relatedNodes = context.relatedNodes;
    _.map(relatedNodes, function(v, k){
        var node = cleanNode(v, "");
        writeJsonFile.sync(buildRelatedPath(dataFolderPath, node), node);
    });

    callback(null, context);
}

function buildInstancePath(dataFolderPath, node) {
    return path.normalize(path.posix.resolve(dataFolderPath, "instances", node._type.replace(':', '__SC__'), node._source_doc, "node.json"));
}

function buildRelatedPath(dataFolderPath, node) {
    return path.normalize(path.posix.resolve(dataFolderPath, "related", node._type.replace(':', '__SC__'), node._source_doc, "node.json"));
}

function getRelated(list, context, callback) {
    log.debug("getRelated()");

    if (!context.includeRelated) {
        callback(null, context);
        return;
    }

    var instanceNodes = list;

    var instances = JSON.parse(JSON.stringify(instanceNodes));
    var related = util.findKeyValues(instances, "ref", []);
    var relatedIds = {};
    for(var i = 0; i < related.length; i++) {
        var id = related[i].split('/')[5];
        relatedIds[id] = id;
    }
    relatedIds = Object.keys(relatedIds);
    log.debug("relatedIds: \n" + JSON.stringify(relatedIds, null, 2));

    context.relatedIds = relatedIds || [];
    if (!context.relatedIds.length) {
        callback(null, context);
        return;
    }

    var query = {
        _doc: {
            $in: relatedIds
        }
    };

    context.branch.queryNodes(query,{
        limit: -1,
        paths: true
    }).each(function() {
        var node = this;
        util.enhanceNode(node);
        context.relatedNodes.push(node);
    }).then(function() {
        // log.debug("related nodes: " + JSON.stringify(context.relatedNodes, null, 2));
        callback(null, context);
    });
}

function getContentInstances(context, callback) {
    log.debug("getContentInstances()");

    if (!context.includeInstances) {
        callback(null, context);
        return;
    }

    var typeDefinitions = context.typeDefinitions;

    if (!typeDefinitions || !Gitana.isArray(typeDefinitions) || !typeDefinitions.length) {
        callback("No type defintions");
        return;
    }

    async.eachSeries(typeDefinitions, async.apply(getDefinitionInstances, context), function (err) {
        if(err)
        {
            log.error("Error reading content instances: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded definition instances");
        callback(null, context);
        return;
    });        
}

function getDefinitionInstances(context, typeDefinitionNode, callback) {
    log.debug("getDefinitionInstances()");

    var query = {
        _type: typeDefinitionNode._qname
    }

    if (!context.instanceNodes[typeDefinitionNode._qname]) {
        context.instanceNodes[typeDefinitionNode._qname] = [];
    }

    context.branch.queryNodes(query,{
        limit: -1,
        paths: true
    }).each(function() {
        var instance = this;
        util.enhanceNode(instance);
        context.instanceNodes[typeDefinitionNode._qname].push(instance);
    }).then(function() {
        // log.debug("instances: " + JSON.stringify(context.instanceNodes, null, 2));
        log.debug("instances count: " + context.instanceNodes.length);
        callback(null, context);
    });
}

function handleListTypes() {
    log.debug("handleListTypes()");
    
    util.getBranch(gitanaConfig, option_branchId, function(err, branch, platform, stack, domain, primaryDomain) {
        if (err)
        {
            log.debug("Error connecting to Cloud CMS branch: " + err);
            return;
        }

        log.info("connected to branch: " + branch.title || branch._doc);

        var context = {
            branchId: option_branchId,
            branch: branch,
            typeDefinitions: []
        };
        
        getDefinitions(context, function(err, context) {
            if (err)
            {
                log.error("Error listing definition nodes " + err);
                return;
            }

            Object.keys(context.typeDefinitions).forEach(function(type) {
                log.debug(JSON.stringify(context.typeDefinitions[type]));
                console.log("type: " + context.typeDefinitions[type]._type + "\t_qname: " + context.typeDefinitions[type]._qname + "\tTitle: \"" + context.typeDefinitions[type].title + "\"");
            });

            console.log("\ndone");            
        });
    });
}

function writeDefinitionJSONtoDisk(context, callback) {
    var dataFolderPath = context.dataFolderPath;
    var includeInstances = context.includeInstances;
    var typeDefinitions = context.typeDefinitions;

    dataFolderPath = path.posix.normalize(dataFolderPath)
    if (fs.existsSync(dataFolderPath)) {
        Object.keys(typeDefinitions).forEach(function(typeId) {
            log.debug(JSON.stringify(typeDefinitions[typeId]));
            writeFormJsontoDisk(dataFolderPath, typeDefinitions[typeId]);
            var node = cleanNode(typeDefinitions[typeId]);
            writeJsonFile.sync(buildDefinitionPath(dataFolderPath, node), node);
        });

        console.log('done');
        callback(null, context);
        return;
    }
    else
    {
        callback("folder path not found: " + dataFolderPath);
        return;
    }
}

function writeFormJsontoDisk(dataFolderPath, node) {
    if (!node.__forms) {
        return;
    }
    
    for(var i = 0; i < node.__formAssociations.length; i++) {
        var formAssociation = node.__formAssociations[i];
        var forms = node.__forms;
        var formKey = formAssociation["form-key"];
        for(var j = 0; j < forms.length; j++) {
            var form = node.__forms[j];
            if (form._doc == formAssociation.target) {
                var formNode = cleanNode(form, formKey);
                writeJsonFile.sync(buildDefinitionFormPath(dataFolderPath, node, formKey), formNode);                    
            }
        }
    }
}

function buildDefinitionPath(dataFolderPath, node) {
    return path.normalize(path.posix.resolve(dataFolderPath, "definitions", node._qname.replace(':', '__SC__'), "node.json"));
}

function buildDefinitionFormPath(dataFolderPath, node, formKey) {
    return path.normalize(path.posix.resolve(dataFolderPath, "definitions", node._qname.replace(':', '__SC__'), "forms", formKey.replace(':', '__SC__') + ".json"));
}

function cleanNode(node, qnameMod) {
    var n = node;
    util.enhanceNode(n);
    n = JSON.parse(JSON.stringify(n));
    
    
    n._source_doc = n._doc;
    n._qname += qnameMod || "";
    delete n._doc;
    delete n._system;
    delete n.attachments;
    delete n._attachments;
    delete n.__forms;
    delete n.__formAssociations;
    
    return n;
}

function logContext(context, callback) {
    log.debug("logContext() " + JSON.stringify(context.branch, null, 2));
    callback(null, context);
}

function getDefinitions(context, callback) {
    log.debug("getDefinitions()");

    var qnames = context.importTypeQNames;

    if (!context.typeDefinitions) {
        context.typeDefinitions = [];
    }

    var query = {
        _type: {
            "$in": ["d:type", "d:association", "d:feature"]
        },
        systemBootstrapped: { 
            $exists: false 
        }
    }

    if (qnames && Gitana.isArray(qnames)) {
        query._qname = {
            "$in": qnames
        };
    }

    context.branch.queryNodes(query,{
        limit: -1,
        sort: {
            _type: 1,
            title: 1
        }
    }).each(function() {
        var definition = this;
        util.enhanceNode(definition);
        context.typeDefinitions.push(definition);
    }).then(function() {
        log.debug("definitions: " + JSON.stringify(context.typeDefinitions, null, 2));
        callback(null, context);
    });
}

function readDefinition(context, callback) {
    log.debug("readDefinition()");

    context.branch.readDefinition().each(function() {
        var definition = this;
        util.enhanceNode(definition);
        context.typeDefinitions.push(definition);
    }).then(function() {
        log.debug("definitions: " + JSON.stringify(context.typeDefinitions, null, 2));
        callback(null, context);
    });
}

function getDefinitionForms(context, callback) {
    log.debug("getDefinitionForms()");

    var typeDefinitions = context.typeDefinitions;

    if (!typeDefinitions || !Gitana.isArray(typeDefinitions) || !typeDefinitions.length) {
        callback("No type defintions");
        return;
    }

    async.eachSeries(typeDefinitions, getDefinitionFormList, function (err) {
        if(err)
        {
            log.error("Error reading definition forms: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded definition forms");
        callback(null, context);
        return;
    });        
}

function getDefinitionFormAssociations(context, callback) {
    log.debug("getDefinitionFormAssociations()");

    var typeDefinitions = context.typeDefinitions;

    if (!typeDefinitions || !Gitana.isArray(typeDefinitions) || !typeDefinitions.length) {
        callback("No type defintions");
        return;
    }

    async.eachSeries(typeDefinitions, getDefinitionFormAssociationList, function (err) {
        if(err)
        {
            log.error("Error reading definition form associations: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded definition form associations");
        callback(null, context);
        return;
    });        
}

function getDefinitionFormList(typeDefinitionNode, callback) {
    log.debug("getDefinitionFormList()");

    typeDefinitionNode.listRelatives({
        "type": "a:has_form",
        "direction": "OUTGOING"
    }).then(function() {
        log.debug("relatives: " + JSON.stringify(this, null, 2));
        typeDefinitionNode.__forms = this.asArray();
        callback();
    });
}

function getDefinitionFormAssociationList(typeDefinitionNode, callback) {
    log.debug("getDefinitionFormList()");

    typeDefinitionNode.associations({
        "type": "a:has_form",
        "direction": "OUTGOING"
    }).then(function() {
        log.debug("associations: " + JSON.stringify(this, null, 2));
        typeDefinitionNode.__formAssociations = this.asArray();
        callback();
    });
}

function getOptions() {
    return [
        {name: 'help', alias: 'h', type: Boolean},
        {name: 'verbose', alias: 'v', type: Boolean, description: 'verbose logging'},
        {name: 'prompt', alias: 'p', type: Boolean, description: 'prompt for username and password. overrides gitana.json credentials'},
        {name: 'use-credentials-file', alias: 'c', type: Boolean, description: 'use credentials file ~/.cloudcms/credentials.json. overrides gitana.json credentials'},
        {name: 'gitana-file-path', alias: 'g', type: String, description: 'path to gitana.json file to use when connecting. defaults to ./gitana.json'},
        {name: 'branch', alias: 'b', type: String, description: 'branch id (not branch name!) to write content to. branch id or "master". Default is "master"'},
        {name: 'list-types', alias: 'l', type: Boolean, description: 'list type definitions available in the branch'},
        {name: 'definition-qname', alias: 'q', type: String, multiple: true, description: '_qname of the type definition. Or use --all-definitions'},
        {name: 'all-definitions', alias: 'a', type: Boolean, description: 'export all definitions. Or use --definition-qname'},
        {name: 'include-instances', alias: 'i', type: Boolean, description: 'include instance records for conent type definitions'},
        {name: 'include-related', alias: 'r', type: Boolean, description: 'include instance records referred to in relators on instance records'},
        {name: 'folder-path', alias: 'f', type: String, description: 'folder to store exported files. defaults to ./data'},
        {name: 'query-file-path', alias: 'y', type: String, description: 'path to a json file defining the query'}
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
            header: 'Cloud CMS Export',
            content: 'Export defintions and content instance records from a Cloud CMS project branch.'
        },
        {
            header: 'Options',
            optionList: optionsList
        },
        {
            header: 'Examples',
            content: [
                {
                    desc: '1. connect to Cloud CMS and list available definition qnames',
                },
                {
                    desc: 'node cloudcms-export.js --list-types'
                },
                {
                    desc: '2. export definitions and content records by qname:',
                },
                {
                    desc: 'node cloudcms-export.js --definition-qname "my:type1" "my:type2" --include-instances --folder-path ./data'
                },
                {
                    desc: '3. export all definition nodes:',
                },
                {
                    desc: 'node cloudcms-export.js --all-definitions --include-instances --folder-path ./data'
                },
                {
                    desc: '4. export a list of nodes based on a user defined query:',
                },
                {
                    desc: 'node cloudcms-export.js -y ./myquery.json --folder-path ./data'
                }
            ]
        }
    ]));
}